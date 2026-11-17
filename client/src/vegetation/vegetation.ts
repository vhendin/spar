import * as THREE from 'three/webgpu';
import type { RegionIndex, Species } from '@spar/shared';
import { RULES, SPECIES } from './defs';
import { generate, type Detail, type MeshData } from './generators';
import { copyReach, needsCopy, REFILL_MOVE, shownBy } from './coverage';
import { bakeImpostors, type ImpostorAtlas } from './impostors';
import type { SeeThrough } from '../seeThrough';
import { VegetationShading } from './materials';
import { STRIDE } from './placement';
import { compileRules, type CompiledLayer } from './rules';
import { CHUNK, PATCH, type PlacedLayer, type VegetationRequest, type VegetationResponse } from './worker';

/** Placement jobs running in the worker at once. */
const MAX_IN_FLIGHT = 4;

export interface VegetationStats {
  /** Instances handed to the GPU as meshes, and those among them drawn in full detail. */
  meshes: number;
  full: number;
  /** Trees held as flat pictures, in how many tiles. */
  impostors: number;
  tiles: number;
  loading: number;
}

function toGeometry(data: MeshData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
  geometry.setAttribute('sway', new THREE.BufferAttribute(data.sway, 1));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  return geometry;
}

/** All instances of one species variant at one detail level, drawn in one call. */
class Batch {
  mesh: THREE.InstancedMesh | null = null;
  wanted = 0;
  private filled = 0;
  private capacity = 0;
  private origins = new Float32Array(0);

  constructor(
    private readonly source: THREE.BufferGeometry,
    private readonly material: THREE.Material,
    private readonly variation: number,
    private readonly group: THREE.Group,
    private readonly castShadow: boolean,
  ) {}

  /** Makes room for `wanted` instances and starts a new fill. */
  begin(): void {
    this.filled = 0;
    if (this.wanted <= this.capacity) return;
    this.dispose();
    this.capacity = Math.max(64, Math.ceil(this.wanted * 1.5));
    // Each batch needs its own geometry object for its per-instance attribute; the vertex
    // data itself is shared with the source.
    const geometry = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'color', 'sway']) geometry.setAttribute(name, this.source.getAttribute(name));
    geometry.setIndex(this.source.getIndex());
    this.origins = new Float32Array(this.capacity * 4);
    geometry.setAttribute('iOrigin', new THREE.InstancedBufferAttribute(this.origins, 4));
    this.mesh = new THREE.InstancedMesh(geometry, this.material, this.capacity);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 3), 3);
    this.mesh.frustumCulled = false; // instances surround the camera; the shader hides the far ones
    this.mesh.matrixAutoUpdate = false;
    this.mesh.castShadow = this.castShadow;
    this.group.add(this.mesh);
  }

  /** Adds one placed object: six floats starting at `at` (x, y, z, size, yaw, rand). */
  add(data: Float32Array, at: number): void {
    const n = this.filled++;
    const x = data[at]!, y = data[at + 1]!, z = data[at + 2]!, size = data[at + 3]!, yaw = data[at + 4]!, rand = data[at + 5]!;
    const c = Math.cos(yaw) * size, s = Math.sin(yaw) * size;
    const m = this.mesh!.instanceMatrix.array;
    const o = n * 16;
    m[o] = c; m[o + 1] = 0; m[o + 2] = -s; m[o + 3] = 0;
    m[o + 4] = 0; m[o + 5] = size; m[o + 6] = 0; m[o + 7] = 0;
    m[o + 8] = s; m[o + 9] = 0; m[o + 10] = c; m[o + 11] = 0;
    m[o + 12] = x; m[o + 13] = y; m[o + 14] = z; m[o + 15] = 1;
    this.origins[n * 4] = x;
    this.origins[n * 4 + 1] = y;
    this.origins[n * 4 + 2] = z;
    this.origins[n * 4 + 3] = rand;
    // Individuals differ a little in brightness and warmth, from their own random number.
    const light = 1 + this.variation * (((rand * 9.13) % 1) * 2 - 1);
    const warm = 0.05 * (((rand * 23.7) % 1) * 2 - 1);
    const tint = this.mesh!.instanceColor!.array;
    tint[n * 3] = light * (1 + warm);
    tint[n * 3 + 1] = light;
    tint[n * 3 + 2] = light * (1 - warm);
  }

  end(): void {
    if (!this.mesh) return;
    this.mesh.count = this.filled;
    this.mesh.visible = this.filled > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
    this.mesh.geometry.getAttribute('iOrigin').needsUpdate = true;
  }

  dispose(): void {
    if (!this.mesh) return;
    this.group.remove(this.mesh);
    this.mesh.dispose();
    this.mesh = null;
    this.capacity = 0;
  }
}

interface Area {
  x: number;
  z: number;
  state: 'loading' | 'ready';
  layers: PlacedLayer[];
  impostor: THREE.Mesh | null;
  distance: number;
}

/** Streams and draws everything that grows or lies on the ground of one region. */
export class Vegetation {
  readonly group = new THREE.Group();
  readonly shading = new VegetationShading();
  readonly stats: VegetationStats = { meshes: 0, full: 0, impostors: 0, tiles: 0, loading: 0 };

  private readonly layers: CompiledLayer[];
  private readonly tileLayers: CompiledLayer[];
  private readonly patchLayers: CompiledLayer[];
  private readonly worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private readonly pending = new Map<number, (r: VegetationResponse) => void>();
  private readonly tiles = new Map<string, Area>();
  private readonly patches = new Map<string, Area>();
  /** batches[layer][detail][species][variant] */
  private readonly batches: Record<Detail, Batch[][]>[] = [];
  private atlas!: ImpostorAtlas;
  private readonly atlasCell: number[][] = [];
  private impostorMaterial: THREE.Material | null = null;
  private readonly impostorRange: number;
  private readonly tileReach: number;
  private readonly patchReach: number;
  private nextId = 1;
  private inFlight = 0;
  private lastScan = new THREE.Vector3(Infinity, 0, Infinity);
  /** Where the camera was at the last refill of the mesh copies. */
  private lastFill = new THREE.Vector3(Infinity, 0, Infinity);
  /** Which chunks went into which mesh copy at the last refill: "tileX,tileZ|layer|chunk|copy". */
  private filled = new Set<string>();
  private tilesDirty = false;
  private patchesDirty = false;
  private warned = false;

  /** Generates every plant mesh, draws the far-tree pictures and starts the placement worker. */
  /**
   * `range` scales the distances plants change detail and disappear; `farRange` the
   * distance far-tree pictures reach.
   */
  /** With `seeThrough`, trees and rocks between the camera and the vehicle turn see-through. */
  static async create(renderer: THREE.WebGPURenderer, index: RegionIndex, seed: number, range = 1, farRange = 1, seeThrough: SeeThrough | null = null): Promise<Vegetation> {
    const vegetation = new Vegetation(index, seed, range, farRange, seeThrough);
    await vegetation.prepare(renderer);
    return vegetation;
  }

  private constructor(
    private readonly index: RegionIndex,
    private readonly seed: number,
    range: number,
    farRange: number,
    private readonly seeThrough: SeeThrough | null,
  ) {
    this.group.name = 'vegetation';
    this.layers = compileRules(RULES, SPECIES, index.masks.biomes).map((l) => ({
      ...l,
      ranges: {
        full: l.ranges.full * range,
        ...(l.ranges.low !== undefined ? { low: l.ranges.low * range } : {}),
        ...(l.ranges.impostor !== undefined ? { impostor: Math.max(l.ranges.impostor * farRange, (l.ranges.low ?? l.ranges.full) * range * 1.5) } : {}),
      },
    }));
    this.tileLayers = this.layers.filter((l) => l.batch === 'tile');
    this.patchLayers = this.layers.filter((l) => l.batch === 'patch');
    this.impostorRange = Math.max(0, ...this.tileLayers.map((l) => l.ranges.impostor ?? 0));
    // Placed objects are wanted wherever a refill could put them in a mesh copy.
    const reach = (l: CompiledLayer): number => copyReach(l.ranges, l.ranges.low === undefined ? 'full' : 'low') + REFILL_MOVE;
    this.tileReach = Math.max(...this.tileLayers.map(reach));
    this.patchReach = this.patchLayers.length ? Math.max(...this.patchLayers.map(reach)) : 0;

  }

  private async prepare(renderer: THREE.WebGPURenderer): Promise<void> {
    // One generated mesh per species variant and detail level, shared by every layer using it.
    const meshes = new Map<string, THREE.BufferGeometry>();
    const geometry = (species: number, variant: number, detail: Detail): THREE.BufferGeometry => {
      const key = `${species}/${variant}/${detail}`;
      let g = meshes.get(key);
      if (!g) meshes.set(key, (g = toGeometry(generate(SPECIES[species]!, variant, detail))));
      return g;
    };

    const pictures: THREE.BufferGeometry[] = [];
    for (const layer of this.layers) {
      const perDetail: Record<Detail, Batch[][]> = { full: [], low: [] };
      const used = [...new Set(layer.rules.map((r) => r.species))];
      for (const species of used) {
        const def: Species = SPECIES[species]!;
        const { full, low } = layer.ranges;
        const options = { stiffness: def.wind.stiffness, doubleSided: def.generator !== 'boulder' && def.generator !== 'stump' };
        // Without a further representation to hand over to, the last one shrinks away.
        const fullMaterial = this.shading.meshMaterial({ ...options, near: 0, far: full, fadeOut: low === undefined });
        const lowMaterial = low === undefined ? null : this.shading.meshMaterial({ ...options, near: full, far: low, fadeOut: layer.ranges.impostor === undefined });
        // Trees and rocks can hide the vehicle; ground cover is too low to matter.
        if (this.seeThrough && layer.batch === 'tile') for (const m of [fullMaterial, lowMaterial]) if (m) this.seeThrough.apply(m);
        perDetail.full[species] = [];
        perDetail.low[species] = [];
        for (let v = 0; v < def.variants; v++) {
          // Trees and rocks throw shadows; ground cover is too small and too plentiful to bother.
          const shadow = layer.batch === 'tile';
          perDetail.full[species][v] = new Batch(geometry(species, v, 'full'), fullMaterial, def.colors.variation, this.group, shadow);
          if (lowMaterial) perDetail.low[species][v] = new Batch(geometry(species, v, 'low'), lowMaterial, def.colors.variation, this.group, shadow);
          if (layer.ranges.impostor !== undefined) {
            (this.atlasCell[species] ??= [])[v] = pictures.length;
            pictures.push(geometry(species, v, 'full'));
          }
        }
      }
      this.batches[layer.id] = perDetail;
    }

    this.atlas = await bakeImpostors(renderer, pictures, 8);
    const pictured = this.tileLayers.find((l) => l.ranges.impostor !== undefined);
    if (pictured) {
      this.impostorMaterial = this.shading.impostorMaterial(this.atlas.texture, this.atlas.columns, this.atlas.rows, pictured.ranges.low ?? pictured.ranges.full, pictured.ranges.impostor!);
    }

    this.worker.onmessage = (ev: MessageEvent<VegetationResponse>) => {
      const done = this.pending.get(ev.data.id);
      this.pending.delete(ev.data.id);
      done?.(ev.data);
    };
    this.post({ kind: 'init', index: this.index, layers: this.layers, seed: this.seed });
  }

  /** Call every frame with the camera position. Cheap unless the camera has moved to new ground. */
  update(camera: THREE.Vector3): void {
    this.shading.viewer.value.copy(camera);
    if (Math.abs(camera.x - this.lastScan.x) + Math.abs(camera.z - this.lastScan.z) > 16 || this.inFlight < MAX_IN_FLIGHT) {
      this.lastScan.copy(camera);
      this.scan(this.tiles, this.index.tileSize, this.impostorRange || this.tileReach, camera, 'tile');
      this.scan(this.patches, PATCH, this.patchReach, camera, 'patch');
    }

    // Refill the mesh copies after a short move, so none can lack a plant it should draw
    // before the next refill (see coverage.ts).
    const moved = Math.hypot(camera.x - this.lastFill.x, camera.z - this.lastFill.z) > REFILL_MOVE;
    if (moved) this.lastFill.copy(camera);
    if (moved || this.tilesDirty) {
      this.tilesDirty = false;
      this.fillFromTiles(this.lastFill);
    }
    if (moved || this.patchesDirty) {
      this.patchesDirty = false;
      this.fillFromPatches(this.lastFill);
    }
    this.stats.loading = this.inFlight;
  }

  /**
   * Visits every placed object within `radius` of a point that vehicles can hit (species
   * with a collider), giving its permanent name, shape, position, height and radius share,
   * and whether it is drawn on screen right now.
   */
  forEachSolid(
    x: number,
    z: number,
    radius: number,
    visit: (key: string, shape: 'trunk' | 'rock', px: number, py: number, pz: number, size: number, radiusPerHeight: number, drawn: boolean) => void,
  ): void {
    const viewer = this.shading.viewer.value;
    const size = this.index.tileSize;
    const perSide = size / CHUNK;
    for (const tile of this.tiles.values()) {
      if (tile.state !== 'ready') continue;
      if (Math.max(tile.x - x, 0, x - tile.x - size) > radius || Math.max(tile.z - z, 0, z - tile.z - size) > radius) continue;
      for (const placed of tile.layers) {
        const starts = placed.chunkStart!;
        for (let c = 0; c < perSide * perSide; c++) {
          const cx = tile.x + (c % perSide) * CHUNK, cz = tile.z + Math.floor(c / perSide) * CHUNK;
          if (Math.max(cx - x, 0, x - cx - CHUNK) > radius || Math.max(cz - z, 0, z - cz - CHUNK) > radius) continue;
          for (let k = starts[c]!; k < starts[c + 1]!; k++) {
            const collider = SPECIES[placed.species[k]!]!.collider;
            if (!collider) continue;
            const at = k * STRIDE;
            const px = placed.data[at]!, pz = placed.data[at + 2]!;
            if ((px - x) * (px - x) + (pz - z) * (pz - z) > radius * radius) continue;
            const py = placed.data[at + 1]!;
            // Drawn if the copy the shader picks for it holds it.
            const copy = shownBy(Math.hypot(px - viewer.x, py - viewer.y, pz - viewer.z), placed.data[at + 5]!, this.layers[placed.layer]!.ranges);
            const drawn = copy === 'impostor' ? tile.impostor !== null : copy !== null && this.filled.has(`${tile.x},${tile.z}|${placed.layer}|${c}|${copy}`);
            visit(`${placed.layer}:${placed.cells[k * 2]}:${placed.cells[k * 2 + 1]}`, collider.shape, px, py, pz, placed.data[at + 3]!, collider.radiusPerHeight, drawn);
          }
        }
      }
    }
  }

  /** The sheet of far-tree pictures on a board, for checking how they came out. */
  atlasBoard(width: number): THREE.Mesh {
    const height = (width * this.atlas.rows) / this.atlas.columns;
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: this.atlas.texture, color: 0xffffff, side: THREE.DoubleSide, fog: false }),
    );
    board.add(new THREE.Mesh(new THREE.PlaneGeometry(width, height).translate(0, 0, -0.05), new THREE.MeshBasicMaterial({ color: 0x8090a0, fog: false })));
    return board;
  }

  dispose(): void {
    this.worker.terminate();
    for (const perDetail of this.batches) for (const detail of ['full', 'low'] as const) perDetail?.[detail].forEach((v) => v.forEach((b) => b.dispose()));
    for (const tile of this.tiles.values()) this.dropImpostor(tile);
    this.atlas.texture.dispose();
  }

  private post(req: VegetationRequest): void {
    this.worker.postMessage(req);
  }

  /** Horizontal distance from a point to a square. */
  private static distance(camera: THREE.Vector3, x: number, z: number, size: number): number {
    return Math.hypot(Math.max(x - camera.x, 0, camera.x - x - size), Math.max(z - camera.z, 0, camera.z - z - size));
  }

  /** Requests the squares within `range` that are missing, nearest first, and forgets those far outside it. */
  private scan(areas: Map<string, Area>, size: number, range: number, camera: THREE.Vector3, kind: 'tile' | 'patch'): void {
    if (range <= 0) return;
    const limit = this.index.size;
    const first = (v: number): number => Math.max(0, Math.floor((v - range) / size));
    const last = (v: number): number => Math.min(Math.ceil(limit / size) - 1, Math.floor((v + range) / size));
    const missing: Area[] = [];
    for (let j = first(camera.z); j <= last(camera.z); j++) {
      for (let i = first(camera.x); i <= last(camera.x); i++) {
        const distance = Vegetation.distance(camera, i * size, j * size, size);
        if (distance > range) continue;
        const key = `${i},${j}`;
        if (!areas.has(key)) missing.push({ x: i * size, z: j * size, state: 'loading', layers: [], impostor: null, distance });
      }
    }
    missing.sort((a, b) => a.distance - b.distance);
    for (const area of missing) {
      if (this.inFlight >= MAX_IN_FLIGHT) break;
      areas.set(`${area.x / size},${area.z / size}`, area);
      this.request(area, areas, kind);
    }
    const keep = range + size * 2;
    for (const [key, area] of areas) {
      if (area.state === 'ready' && Vegetation.distance(camera, area.x, area.z, size) > keep) {
        this.dropImpostor(area);
        areas.delete(key);
      }
    }
  }

  private request(area: Area, areas: Map<string, Area>, kind: 'tile' | 'patch'): void {
    const id = this.nextId++;
    this.inFlight++;
    this.pending.set(id, (reply) => {
      this.inFlight--;
      if (!reply.ok) {
        // Forget it so a later scan asks again.
        for (const [key, value] of areas) if (value === area) areas.delete(key);
        if (!this.warned) {
          this.warned = true;
          console.warn('vegetation: a placement job failed and will be retried', reply.error);
        }
        return;
      }
      area.layers = reply.layers;
      area.state = 'ready';
      if (kind === 'tile') {
        this.buildImpostor(area);
        this.tilesDirty = true;
      } else {
        this.patchesDirty = true;
      }
    });
    this.post({ kind, id, x: area.x, z: area.z });
  }

  /** Flat pictures for every tree of a tile; the shader hides those close enough to be meshes. */
  private buildImpostor(tile: Area): void {
    if (!this.impostorMaterial) return;
    let count = 0;
    const pictured = tile.layers.filter((p) => this.layers[p.layer]!.ranges.impostor !== undefined);
    for (const placed of pictured) count += placed.count;
    if (count === 0) return;

    const origins = new Float32Array(count * 4);
    const info = new Float32Array(count * 4);
    let n = 0, low = Infinity, high = -Infinity;
    for (const placed of pictured) {
      for (let k = 0; k < placed.count; k++, n++) {
        const at = k * STRIDE;
        const species = placed.species[k]!;
        const cell = this.atlasCell[species]![placed.variant[k]!]!;
        const rand = placed.data[at + 5]!;
        origins.set(placed.data.subarray(at, at + 4), n * 4);
        info[n * 4] = cell % this.atlas.columns;
        info[n * 4 + 1] = Math.floor(cell / this.atlas.columns);
        info[n * 4 + 2] = rand;
        info[n * 4 + 3] = 1 + SPECIES[species]!.colors.variation * (((rand * 9.13) % 1) * 2 - 1);
        low = Math.min(low, placed.data[at + 1]!);
        high = Math.max(high, placed.data[at + 1]! + placed.data[at + 3]!);
      }
    }
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]), 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('iOrigin', new THREE.InstancedBufferAttribute(origins, 4));
    geometry.setAttribute('iInfo', new THREE.InstancedBufferAttribute(info, 4));
    geometry.instanceCount = count;
    const half = this.index.tileSize / 2;
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(tile.x + half, (low + high) / 2, tile.z + half), Math.hypot(half * Math.SQRT2 + 10, (high - low) / 2));

    tile.impostor = new THREE.Mesh(geometry, this.impostorMaterial);
    tile.impostor.matrixAutoUpdate = false;
    this.group.add(tile.impostor);
    this.stats.impostors += count;
    this.stats.tiles++;
  }

  private dropImpostor(tile: Area): void {
    if (!tile.impostor) return;
    this.stats.impostors -= (tile.impostor.geometry as THREE.InstancedBufferGeometry).instanceCount;
    this.stats.tiles--;
    this.group.remove(tile.impostor);
    tile.impostor.geometry.dispose();
    tile.impostor = null;
  }

  /**
   * Refills the batches of some layers from stretches of placed objects. `spans` lists,
   * per layer and detail, which stretches to take.
   */
  private fill(layers: CompiledLayer[], spans: { layer: number; detail: Detail; placed: PlacedLayer; from: number; to: number }[]): void {
    const batchOf = (span: (typeof spans)[number], k: number): Batch | undefined =>
      this.batches[span.layer]![span.detail][span.placed.species[k]!]?.[span.placed.variant[k]!];
    for (const layer of layers) for (const detail of ['full', 'low'] as const) this.batches[layer.id]![detail].forEach((v) => v.forEach((b) => (b.wanted = 0)));
    for (const span of spans) for (let k = span.from; k < span.to; k++) { const b = batchOf(span, k); if (b) b.wanted++; }
    for (const layer of layers) for (const detail of ['full', 'low'] as const) this.batches[layer.id]![detail].forEach((v) => v.forEach((b) => b.begin()));
    for (const span of spans) for (let k = span.from; k < span.to; k++) batchOf(span, k)?.add(span.placed.data, k * STRIDE);
    for (const layer of layers) for (const detail of ['full', 'low'] as const) this.batches[layer.id]![detail].forEach((v) => v.forEach((b) => b.end()));
  }

  private fillFromTiles(camera: THREE.Vector3): void {
    const spans: Parameters<Vegetation['fill']>[1] = [];
    const size = this.index.tileSize;
    const perSide = size / CHUNK;
    let meshes = 0, full = 0;
    this.filled.clear();
    for (const tile of this.tiles.values()) {
      if (tile.state !== 'ready' || Vegetation.distance(camera, tile.x, tile.z, size) > this.tileReach) continue;
      for (const placed of tile.layers) {
        const { ranges } = this.layers[placed.layer]!;
        const starts = placed.chunkStart!;
        for (let c = 0; c < perSide * perSide; c++) {
          const from = starts[c]!, to = starts[c + 1]!;
          if (from === to) continue;
          const d = Vegetation.distance(camera, tile.x + (c % perSide) * CHUNK, tile.z + Math.floor(c / perSide) * CHUNK, CHUNK);
          for (const detail of ['full', 'low'] as const) {
            if (!needsCopy(d, ranges, detail)) continue;
            spans.push({ layer: placed.layer, detail, placed, from, to });
            this.filled.add(`${tile.x},${tile.z}|${placed.layer}|${c}|${detail}`);
            meshes += to - from;
            if (detail === 'full') full += to - from;
          }
        }
      }
    }
    this.fill(this.tileLayers, spans);
    this.tileStats = { meshes, full };
    this.sumStats();
  }

  private fillFromPatches(camera: THREE.Vector3): void {
    const spans: Parameters<Vegetation['fill']>[1] = [];
    let meshes = 0;
    for (const patch of this.patches.values()) {
      if (patch.state !== 'ready') continue;
      const d = Vegetation.distance(camera, patch.x, patch.z, PATCH);
      for (const placed of patch.layers) {
        if (placed.count === 0 || !needsCopy(d, this.layers[placed.layer]!.ranges, 'full')) continue;
        spans.push({ layer: placed.layer, detail: 'full', placed, from: 0, to: placed.count });
        meshes += placed.count;
      }
    }
    this.fill(this.patchLayers, spans);
    this.patchStats = { meshes, full: meshes };
    this.sumStats();
  }

  private tileStats = { meshes: 0, full: 0 };
  private patchStats = { meshes: 0, full: 0 };
  private sumStats(): void {
    this.stats.meshes = this.tileStats.meshes + this.patchStats.meshes;
    this.stats.full = this.tileStats.full + this.patchStats.full;
  }
}
