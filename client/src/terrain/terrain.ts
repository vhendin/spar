import * as THREE from 'three/webgpu';
import type { RegionIndex } from '@spar/shared';
import { distanceToBox, NODE_QUADS, nodeSize, nodeSource, terrainLayout, type TerrainLayout } from './layout';
import { buildNodeIndex, type NodeMeshData } from './meshData';
import { heightFileUrl } from './region';
import type { WorkerRequest, WorkerResponse } from './worker';

/** A node splits when the camera is closer than this many node sizes. */
const SPLIT_FACTOR = 1.6;
/** Node builds running in the worker at once. */
const MAX_IN_FLIGHT = 6;
/** Unused finer nodes are dropped after this many updates. */
const KEEP_FRAMES = 240;

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
  private readonly material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  private readonly roots: Node[] = [];
  private readonly rootFiles: Uint16Array[] = [];
  private shown: Node[] = [];
  private wanted: Node[] = [];
  private frame = 0;
  private nextId = 1;
  private inFlight = 0;
  private warned = false;

  private constructor(readonly index: RegionIndex) {
    this.layout = terrainLayout(index);
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
  static async load(index: RegionIndex): Promise<Terrain> {
    const t = new Terrain(index);
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

  dispose(): void {
    this.worker.terminate();
    const drop = (node: Node): void => {
      node.children?.forEach(drop);
      this.release(node);
    };
    this.roots.forEach(drop);
    this.material.dispose();
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
    if (node.depth < this.layout.maxDepth && node.distance < SPLIT_FACTOR * node.size) {
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
    const src = nodeSource(this.layout, h.samples, node.depth, node.ix, node.iz);
    node.state = State.Loading;
    this.inFlight++;
    try {
      const reply = await this.call({
        id: 0,
        kind: 'mesh',
        url: heightFileUrl(this.index, src.level, src.fileX, src.fileY),
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
        },
      });
      if ('mesh' in reply) this.attach(node, reply.mesh);
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

  private attach(node: Node, data: NodeMeshData): void {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(this.indexArray, 1));
    const box = new THREE.Box3(
      new THREE.Vector3(0, data.minY, 0),
      new THREE.Vector3(node.size, data.maxY, node.size),
    );
    geometry.boundingBox = box;
    geometry.boundingSphere = box.getBoundingSphere(new THREE.Sphere());

    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.position.set(node.x0, 0, node.z0);
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
