import * as THREE from 'three/webgpu';
import type { RegionIndex } from '@spar/shared';
import type { GroundLook, GroundShading } from './groundMaterial';
import { distanceToBox, MASK_TEXELS, maskSource, NODE_QUADS, nodeSize, nodeSource, terrainLayout, type TerrainLayout } from './layout';
import { buildNodeIndex, type NodeMeshData } from './meshData';
import { heightFileUrl, maskFileUrl } from './region';
import type { WorkerRequest, WorkerResponse } from './worker';

/** A node splits when the camera is closer than this many node sizes. */
const SPLIT_FACTOR = 1.6;
/** Node builds running in the worker at once. */
const MAX_IN_FLIGHT = 6;
/** Unused finer nodes are dropped after this many updates. */
const KEEP_FRAMES = 240;
/** When mask samples are skipped, the surface that wins: roads over tracks over footpaths over streams. */
const SURFACE_IMPORTANCE = ['none', 'pool', 'stream', 'trail', 'boardwalk', 'dirt', 'gravel', 'asphalt'];

const enum State {
  Empty,
  Loading,
  Ready,
}

interface Node {
  depth: number;
  ix: number;
  iz: number;
  x0: number;
  z0: number;
  size: number;
  minY: number;
  maxY: number;
  state: State;
  mesh: THREE.Mesh | null;
  children: Node[] | null;
  /** Last update in which this node was wanted, shown or not. */
  touched: number;
  distance: number;
  retryAt: number;
}

export interface TerrainStats {
  nodes: number;
  triangles: number;
  loading: number;
}

type Pending = { resolve: (r: WorkerResponse & { ok: true }) => void; reject: (e: Error) => void };

/** Streams and draws the ground of one region as a quadtree of equally detailed patches. */
export class Terrain {
  readonly group = new THREE.Group();
  readonly stats: TerrainStats = { nodes: 0, triangles: 0, loading: 0 };

  private readonly layout: TerrainLayout;
  private readonly worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private readonly pending = new Map<number, Pending>();
  private readonly indexArray = buildNodeIndex(NODE_QUADS);
  private material: THREE.Material;
  /** The ground's looks for the parts benchmark, built when first asked for. */
  private readonly looks = new Map<GroundLook, THREE.Material>();
  private readonly surfaceRank: number[];
  private readonly maskPlanes: { biome: number; surface: number; road: number; wetness: number; canopy: number };
  private readonly roots: Node[] = [];
  private readonly rootFiles: Uint16Array[] = [];
  private shown: Node[] = [];
  private wanted: Node[] = [];
  private frame = 0;
  private nextId = 1;
  private inFlight = 0;
  private warned = false;

  private constructor(
    readonly index: RegionIndex,
    private readonly shading: GroundShading,
    /** A patch is divided while the camera is nearer than this many times its size; can change at any time. */
    public split: number,
  ) {
    this.layout = terrainLayout(index);
    this.material = shading.material(MASK_TEXELS + 1, null);
    this.looks.set('full', this.material);
    this.surfaceRank = [];
    for (const s of index.masks.surfaces) this.surfaceRank[s.id] = Math.max(0, SURFACE_IMPORTANCE.indexOf(s.name));
    const plane = (name: string): number => {
      const at = index.masks.channels.findIndex((c) => c.name === name);
      if (at < 0) throw new Error(`Region "${index.name}" has no ${name} mask.`);
      return at;
    };
    this.maskPlanes = {
      biome: plane('biome'),
      surface: plane('surface'),
      road: plane('road'),
      wetness: plane('wetness'),
      canopy: plane('canopy'),
    };
    if (index.masks.surfaces.some((s) => s.id > 7)) throw new Error('This client handles at most eight surface classes.');
    this.group.name = 'terrain';
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const p = this.pending.get(ev.data.id);
      this.pending.delete(ev.data.id);
      if (!p) return;
      if (ev.data.ok) p.resolve(ev.data);
      else p.reject(new Error(ev.data.error));
    };
  }

  /** Loads the coarsest level for the whole area, so there is always something to draw. */
  /** `split`: a patch is divided while the camera is nearer than this many times its size. */
  static async load(index: RegionIndex, shading: GroundShading, split = SPLIT_FACTOR): Promise<Terrain> {
    const t = new Terrain(index, shading, split);
    const { rootsPerSide, rootSize, rootLevel } = t.layout;
    const h = index.heights;
    const side = h.samples + 2 * h.apron;
    const jobs: Promise<void>[] = [];
    for (let iz = 0; iz < rootsPerSide; iz++) {
      for (let ix = 0; ix < rootsPerSide; ix++) {
        const node = t.makeNode(0, ix, iz, h.min, h.max);
        t.roots.push(node);
        jobs.push(t.loadNode(node));
        const slot = iz * rootsPerSide + ix;
        jobs.push(
          t.call({ id: 0, kind: 'file', url: heightFileUrl(index, rootLevel, ix, iz), side }).then((r) => {
            if ('file' in r) t.rootFiles[slot] = r.file;
          }),
        );
      }
    }
    await Promise.all(jobs);
    const failed = t.roots.find((n) => n.state !== State.Ready);
    if (failed) throw new Error(`Could not load the terrain of "${index.name}" (${rootSize} m tile ${failed.ix},${failed.iz}).`);
    return t;
  }

  /** Chooses which nodes to draw for a camera at this position, and requests finer ones. */
  update(camera: THREE.Vector3): void {
    this.frame++;
    for (const node of this.shown) node.mesh!.visible = false;
    this.shown = [];
    this.wanted = [];
    for (const root of this.roots) this.visit(root, camera);
    for (const node of this.shown) node.mesh!.visible = true;

    this.wanted.sort((a, b) => a.distance - b.distance);
    for (const node of this.wanted) {
      if (this.inFlight >= MAX_IN_FLIGHT) break;
      void this.loadNode(node);
    }
    if (this.frame % 60 === 0) for (const root of this.roots) this.prune(root);

    this.stats.nodes = this.shown.length;
    this.stats.triangles = this.shown.length * (this.indexArray.length / 3);
    this.stats.loading = this.inFlight;
  }

  /**
   * Ground elevation in metres at a point (x east, z south of the north-west corner), from
   * the coarsest level. Null outside the area.
   */
  heightAt(x: number, z: number): number | null {
    const { size, heights: h } = this.index;
    if (x < 0 || z < 0 || x > size || z > size) return null;
    const { rootSize, rootsPerSide } = this.layout;
    const spacing = rootSize / (h.samples - 1);
    const fx = Math.min(rootsPerSide - 1, Math.floor(x / rootSize));
    const fz = Math.min(rootsPerSide - 1, Math.floor(z / rootSize));
    const file = this.rootFiles[fz * rootsPerSide + fx];
    if (!file) return null;
    const u = (x - fx * rootSize) / spacing;
    const v = (z - fz * rootSize) / spacing;
    const i = Math.min(h.samples - 2, Math.floor(u));
    const j = Math.min(h.samples - 2, Math.floor(v));
    const side = h.samples + 2 * h.apron;
    const at = (j + h.apron) * side + i + h.apron;
    const tu = u - i;
    const tv = v - j;
    const top = file[at]! * (1 - tu) + file[at + 1]! * tu;
    const bottom = file[at + side]! * (1 - tu) + file[at + side + 1]! * tu;
    return h.encoding.offset + (top * (1 - tv) + bottom * tv) * h.encoding.scale;
  }

  /** Draws the ground in another look (for the parts benchmark); 'full' is the finished one. */
  setLook(look: GroundLook): void {
    let m = this.looks.get(look);
    if (!m) this.looks.set(look, (m = this.shading.material(MASK_TEXELS + 1, null, 2, look)));
    this.material = m;
    for (const o of this.group.children) if (o instanceof THREE.Mesh) o.material = m;
  }

  dispose(): void {
    this.worker.terminate();
    const drop = (node: Node): void => {
      node.children?.forEach(drop);
      this.release(node);
    };
    this.roots.forEach(drop);
    for (const m of this.looks.values()) m.dispose();
  }

  private makeNode(depth: number, ix: number, iz: number, minY: number, maxY: number): Node {
    const size = nodeSize(this.layout, depth);
    return {
      depth, ix, iz, size, minY, maxY,
      x0: ix * size,
      z0: iz * size,
      state: State.Empty,
      mesh: null,
      children: null,
      touched: this.frame,
      distance: 0,
      retryAt: 0,
    };
  }

  private visit(node: Node, camera: THREE.Vector3): void {
    node.touched = this.frame;
    node.distance = distanceToBox(
      camera.x, camera.y, camera.z,
      node.x0, node.minY, node.z0,
      node.x0 + node.size, node.maxY, node.z0 + node.size,
    );
    if (node.depth < this.layout.maxDepth && node.distance < this.split * node.size) {
      node.children ??= [0, 1, 2, 3].map((q) =>
        this.makeNode(node.depth + 1, node.ix * 2 + (q & 1), node.iz * 2 + (q >> 1), node.minY, node.maxY),
      );
      let ready = true;
      for (const child of node.children) {
        child.touched = this.frame;
        if (child.state === State.Ready) continue;
        ready = false;
        if (child.state === State.Empty && this.frame >= child.retryAt) {
          child.distance = node.distance;
          this.wanted.push(child);
        }
      }
      // Swap to the children only when all four can be drawn; until then keep this node.
      if (ready) {
        for (const child of node.children) this.visit(child, camera);
        return;
      }
    }
    this.shown.push(node);
  }

  /** Frees finer nodes that have not been wanted for a while. Returns the newest use below. */
  private prune(node: Node): number {
    let newest = node.touched;
    if (node.children) {
      let below = 0;
      for (const child of node.children) below = Math.max(below, this.prune(child));
      const busy = node.children.some((c) => c.state === State.Loading);
      if (!busy && this.frame - below > KEEP_FRAMES) {
        for (const child of node.children) this.release(child);
        node.children = null;
      } else {
        newest = Math.max(newest, below);
      }
    }
    return newest;
  }

  private release(node: Node): void {
    if (!node.mesh) return;
    this.group.remove(node.mesh);
    node.mesh.geometry.dispose();
    (node.mesh.userData.mask as THREE.Texture).dispose();
    node.mesh = null;
    node.state = State.Empty;
  }

  private call(req: WorkerRequest): Promise<WorkerResponse & { ok: true }> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...req, id });
    });
  }

  private async loadNode(node: Node): Promise<void> {
    const h = this.index.heights;
    const m = this.index.masks;
    const src = nodeSource(this.layout, h.samples, node.depth, node.ix, node.iz);
    const maskSrc = maskSource(this.index, node.size, node.x0, node.z0);
    node.state = State.Loading;
    this.inFlight++;
    try {
      const reply = await this.call({
        id: 0,
        kind: 'node',
        heightUrl: heightFileUrl(this.index, src.level, src.fileX, src.fileY),
        mesh: {
          side: h.samples + 2 * h.apron,
          apron: h.apron,
          i0: src.i0,
          j0: src.j0,
          stride: src.stride,
          quads: NODE_QUADS,
          fileSpacing: src.fileSpacing,
          offset: h.encoding.offset,
          scale: h.encoding.scale,
          skirt: Math.max(8, node.size / 16),
          uvOffsetX: maskSrc.uvOffsetX,
          uvOffsetY: maskSrc.uvOffsetY,
          uvScale: maskSrc.uvScale,
        },
        maskUrl: maskFileUrl(this.index, maskSrc.level, maskSrc.fileX, maskSrc.fileY),
        mask: {
          samples: m.samples,
          channels: m.channels.length,
          ...this.maskPlanes,
          i0: maskSrc.i0,
          j0: maskSrc.j0,
          stride: maskSrc.stride,
          size: MASK_TEXELS + 1,
          surfaceRank: this.surfaceRank,
        },
      });
      if ('mesh' in reply) this.attach(node, reply.mesh, reply.mask);
    } catch (err) {
      node.state = State.Empty;
      node.retryAt = this.frame + 120;
      if (!this.warned) {
        this.warned = true;
        console.warn('terrain: a patch failed to load and will be retried', err);
      }
    } finally {
      this.inFlight--;
    }
  }

  private attach(node: Node, data: NodeMeshData, maskData: Uint8Array): void {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(this.indexArray, 1));
    const box = new THREE.Box3(
      new THREE.Vector3(0, data.minY, 0),
      new THREE.Vector3(node.size, data.maxY, node.size),
    );
    geometry.boundingBox = box;
    geometry.boundingSphere = box.getBoundingSphere(new THREE.Sphere());

    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.position.set(node.x0, 0, node.z0);
    const mask = new THREE.DataTexture(maskData, MASK_TEXELS + 1, MASK_TEXELS + 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    mask.needsUpdate = true;
    mesh.userData.mask = mask;
    mesh.userData.texel = node.size / MASK_TEXELS;
    mesh.receiveShadow = true;
    mesh.visible = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);

    node.mesh = mesh;
    node.minY = data.minY;
    node.maxY = data.maxY;
    node.state = State.Ready;
  }
}
