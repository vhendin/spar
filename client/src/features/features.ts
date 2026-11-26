// Streams and draws the man-made objects of a region: buildings, power lines, fences, log
// piles, lifts, and what stands at the places worth driving to (features/poi.ts). Each tile is built once in a worker; every object kind in it is one mesh,
// shown up to that kind's own distance. Stretches of wooden fence knocked over stay over,
// tipped about their foot, and are no longer solid.

import * as THREE from 'three/webgpu';
import type { SeeThrough } from '../seeThrough';
import type { RegionIndex, RegionVectors } from '@spar/shared';
import type { BuiltPart, BuiltTile } from './build';
import { OBJECTS } from './defs';
import type { Breakable, Solid, Spot } from './mesh';
import type { FeatureRequest, FeatureResponse } from './worker';

const MAX_IN_FLIGHT = 2;

interface Tile {
  tx: number;
  tz: number;
  state: 'loading' | 'ready';
  group: THREE.Group | null;
  parts: { object: THREE.Object3D; range: number; triangles: number }[];
  solids: Solid[];
  spots: Spot[];
  /** Each kind's mesh and wires, for tipping fences over. */
  drawn: Map<string, { mesh?: THREE.Mesh; lines?: THREE.LineSegments }>;
}

/** How far a knocked-over fence leans, radians from upright. */
const TIPPED = (78 * Math.PI) / 180;

export interface FeatureStats {
  tiles: number;
  /** Triangles in meshes currently shown. */
  triangles: number;
  loading: number;
}

export class Features {
  readonly group = new THREE.Group();
  readonly stats: FeatureStats = { tiles: 0, triangles: 0, loading: 0 };
  /** Multiplies every kind's draw distance; set by the quality preset. */
  rangeScale = 1;

  private readonly worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private readonly material = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
  private readonly wireMaterial = new THREE.LineBasicNodeMaterial({ color: 0x1c1c1c });
  private readonly tiles = new Map<string, Tile>();
  private readonly pending = new Map<number, (r: Extract<FeatureResponse, { kind: 'tile' }>) => void>();
  /** Tiles that have anything in them, with the farthest any of it is drawn; the rest are never asked for. */
  private occupied = new Map<string, number>();
  private readonly reach: number;
  private nextId = 1;
  private inFlight = 0;
  private warned = false;
  /** Fence stretches knocked over, and the way they fell. */
  private readonly broken = new Map<string, { dx: number; dz: number }>();

  constructor(
    private readonly index: RegionIndex,
    vectors: RegionVectors,
    seed: number,
    seeThrough: SeeThrough | null = null,
    glow: string[] = [],
  ) {
    this.group.name = 'features';
    seeThrough?.apply(this.material);
    this.reach = Math.max(...Object.values(OBJECTS).map((d) => d.range));
    this.worker.onmessage = (ev: MessageEvent<FeatureResponse>) => {
      const msg = ev.data;
      if (msg.kind === 'ready') {
        this.occupied = new Map(msg.tiles);
        return;
      }
      const done = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      done?.(msg);
    };
    const { buildings, powerLines, fences, objects, lifts } = vectors;
    this.post({ kind: 'init', index, vectors: { buildings, powerLines, fences, objects, lifts }, seed, glow });
  }

  update(camera: THREE.Vector3): void {
    const size = this.index.tileSize;
    const reach = this.reach * this.rangeScale;
    const distance = (tx: number, tz: number): number =>
      Math.hypot(Math.max(tx * size - camera.x, 0, camera.x - tx * size - size), Math.max(tz * size - camera.z, 0, camera.z - tz * size - size));

    // Ask for the nearest missing tiles.
    if (this.inFlight < MAX_IN_FLIGHT && this.occupied.size > 0) {
      const missing: { tx: number; tz: number; d: number }[] = [];
      const count = Math.ceil(this.index.size / size);
      const lo = (v: number): number => Math.max(0, Math.floor((v - reach) / size));
      const hi = (v: number): number => Math.min(count - 1, Math.floor((v + reach) / size));
      for (let tz = lo(camera.z); tz <= hi(camera.z); tz++) {
        for (let tx = lo(camera.x); tx <= hi(camera.x); tx++) {
          const key = `${tx},${tz}`;
          const own = this.occupied.get(key);
          if (own === undefined || this.tiles.has(key)) continue;
          const d = distance(tx, tz);
          if (d <= own * this.rangeScale) missing.push({ tx, tz, d });
        }
      }
      missing.sort((a, b) => a.d - b.d);
      for (const m of missing.slice(0, MAX_IN_FLIGHT - this.inFlight)) this.request(m.tx, m.tz);
    }

    let triangles = 0;
    for (const [key, tile] of this.tiles) {
      if (tile.state !== 'ready') continue;
      const d = distance(tile.tx, tile.tz);
      if (d > (this.occupied.get(key) ?? 0) * this.rangeScale + size * 2) {
        this.drop(key, tile);
        continue;
      }
      for (const part of tile.parts) {
        part.object.visible = d <= part.range * this.rangeScale;
        if (part.object.visible) triangles += part.triangles;
      }
    }
    this.stats.triangles = triangles;
    this.stats.tiles = this.tiles.size;
    this.stats.loading = this.inFlight;
  }

  /** Visits the colliders of objects within `radius` of a point. */
  forEachSolid(x: number, z: number, radius: number, visit: (solid: Solid) => void): void {
    const size = this.index.tileSize;
    for (const tile of this.tiles.values()) {
      if (tile.state !== 'ready') continue;
      if (Math.max(tile.tx * size - x, 0, x - tile.tx * size - size) > radius + 40) continue;
      if (Math.max(tile.tz * size - z, 0, z - tile.tz * size - size) > radius + 40) continue;
      for (const s of tile.solids) {
        if (s.breaks && this.broken.has(s.key)) continue;
        const reach = radius + Math.max(s.hx, s.hz);
        if ((s.x - x) * (s.x - x) + (s.z - z) * (s.z - z) <= reach * reach) visit(s);
      }
    }
  }

  /** What lights up at a camp (fire rings, chimneys, windows) of the objects with these keys, in the tiles built so far. */
  spotsOf(keys: ReadonlySet<string>, x: number, z: number, radius: number): Spot[] {
    const size = this.index.tileSize;
    const out: Spot[] = [];
    for (const tile of this.tiles.values()) {
      if (tile.state !== 'ready') continue;
      if (Math.max(tile.tx * size - x, 0, x - tile.tx * size - size) > radius) continue;
      if (Math.max(tile.tz * size - z, 0, z - tile.tz * size - size) > radius) continue;
      for (const s of tile.spots) if (keys.has(s.key) && Math.hypot(s.x - x, s.z - z) <= radius) out.push(s);
    }
    return out;
  }

  /** Whether the fence stretch with this key has been knocked over. */
  isBroken(key: string): boolean {
    return this.broken.has(key);
  }

  /** Knocks a stretch of fence over, falling the way (dx, dz); it stays down while the region is loaded. */
  knockDown(key: string, dx: number, dz: number): void {
    if (this.broken.has(key)) return;
    this.broken.set(key, { dx, dz });
    for (const tile of this.tiles.values()) {
      const s = tile.solids.find((s) => s.key === key);
      if (s?.breaks) {
        tip(tile, s.breaks, dx, dz);
        return;
      }
    }
  }

  dispose(): void {
    this.worker.terminate();
    for (const [key, tile] of this.tiles) this.drop(key, tile);
    this.material.dispose();
    this.wireMaterial.dispose();
  }

  private post(req: FeatureRequest): void {
    this.worker.postMessage(req);
  }

  private request(tx: number, tz: number): void {
    const key = `${tx},${tz}`;
    const tile: Tile = { tx, tz, state: 'loading', group: null, parts: [], solids: [], spots: [], drawn: new Map() };
    this.tiles.set(key, tile);
    const id = this.nextId++;
    this.inFlight++;
    this.pending.set(id, (reply) => {
      this.inFlight--;
      if (this.tiles.get(key) !== tile) return;
      if (!reply.ok) {
        this.tiles.delete(key);
        if (!this.warned) {
          this.warned = true;
          console.warn('features: building a tile failed and will be retried', reply.error);
        }
        return;
      }
      this.show(tile, reply.tile);
    });
    this.post({ kind: 'tile', id, tx, tz });
  }

  private show(tile: Tile, built: BuiltTile): void {
    tile.state = 'ready';
    tile.solids = built.solids;
    tile.spots = built.spots;
    if (built.parts.length === 0) return;
    const group = new THREE.Group();
    const size = this.index.tileSize;
    const centre = new THREE.Vector3((tile.tx + 0.5) * size, (built.low + built.high) / 2, (tile.tz + 0.5) * size);
    const sphere = new THREE.Sphere(centre, Math.hypot(size, (built.high - built.low) / 2) + 40);
    for (const part of built.parts) {
      const range = OBJECTS[part.kind]?.range ?? 500;
      const holder = new THREE.Group();
      const drawn: { mesh?: THREE.Mesh; lines?: THREE.LineSegments } = {};
      tile.drawn.set(part.kind, drawn);
      if (part.indices.length > 0) {
        const mesh = new THREE.Mesh(this.geometry(part, sphere), this.material);
        drawn.mesh = mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        holder.add(mesh);
      }
      if (part.lines.length > 0) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(part.lines, 3));
        geometry.boundingSphere = sphere;
        const lines = new THREE.LineSegments(geometry, this.wireMaterial);
        drawn.lines = lines;
        lines.matrixAutoUpdate = false;
        holder.add(lines);
      }
      holder.matrixAutoUpdate = false;
      group.add(holder);
      tile.parts.push({ object: holder, range, triangles: part.indices.length / 3 });
    }
    group.matrixAutoUpdate = false;
    tile.group = group;
    this.group.add(group);
    // Built anew from the data, so what was knocked over is knocked over again.
    for (const s of tile.solids) {
      const fell = s.breaks && this.broken.get(s.key);
      if (fell) tip(tile, s.breaks!, fell.dx, fell.dz);
    }
  }

  /** Stand-ins drawing nothing, to build the shaders while loading (see WarmUp). */
  standIns(): THREE.Object3D[] {
    const point = (size: number): THREE.BufferAttribute => new THREE.BufferAttribute(new Float32Array(size), 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', point(9));
    geometry.setAttribute('normal', point(9));
    geometry.setAttribute('color', point(9));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array([0, 1, 2]), 1));
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.castShadow = mesh.receiveShadow = true;
    const lines = new THREE.BufferGeometry();
    lines.setAttribute('position', point(6));
    return [mesh, new THREE.LineSegments(lines, this.wireMaterial)];
  }

  private geometry(part: BuiltPart, sphere: THREE.Sphere): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(part.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(part.normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(part.colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(part.indices, 1));
    geometry.boundingSphere = sphere;
    return geometry;
  }

  private drop(key: string, tile: Tile): void {
    this.tiles.delete(key);
    if (!tile.group) return;
    this.group.remove(tile.group);
    tile.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) o.geometry.dispose();
    });
  }
}

/** Turns a fence stretch's drawing about its foot until it lies nearly flat, falling towards (dx, dz). */
function tip(tile: Tile, b: Breakable, dx: number, dz: number): void {
  const drawn = tile.drawn.get(b.kind);
  if (!drawn) return;
  const [ax, ay, az, bx, by, bz] = b.foot;
  const axis = new THREE.Vector3(bx - ax, by - ay, bz - az).normalize();
  // Turning the upright about the foot by a positive angle moves it towards axis × up.
  const side = -axis.z * dx + axis.x * dz;
  const turn = new THREE.Quaternion().setFromAxisAngle(axis, side < 0 ? -TIPPED : TIPPED);
  const v = new THREE.Vector3(), origin = new THREE.Vector3(ax, ay, az);
  const turnRange = (attr: THREE.BufferAttribute, [first, end]: [number, number], about: boolean): void => {
    for (let i = first; i < end; i++) {
      v.fromBufferAttribute(attr, i);
      if (about) v.sub(origin);
      v.applyQuaternion(turn);
      if (about) v.add(origin);
      attr.setXYZ(i, v.x, v.y, v.z);
    }
    attr.addUpdateRange(first * 3, (end - first) * 3);
    attr.needsUpdate = true;
  };
  if (drawn.mesh && b.verts[1] > b.verts[0]) {
    const g = drawn.mesh.geometry;
    turnRange(g.getAttribute('position') as THREE.BufferAttribute, b.verts, true);
    turnRange(g.getAttribute('normal') as THREE.BufferAttribute, b.verts, false);
  }
  if (drawn.lines && b.lines[1] > b.lines[0]) turnRange(drawn.lines.geometry.getAttribute('position') as THREE.BufferAttribute, b.lines, true);
}
