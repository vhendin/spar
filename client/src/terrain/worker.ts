/// <reference lib="webworker" />
// Terrain worker: downloads height and mask files and builds node data off the main thread.

import { buildNodeMask, type NodeMaskRequest } from './maskData';
import { buildNodeMesh, type NodeMeshData, type NodeMeshRequest } from './meshData';
import { fetchBytes, fetchUint16 } from './region';

export type WorkerRequest =
  | { id: number; kind: 'node'; heightUrl: string; mesh: NodeMeshRequest; maskUrl: string; mask: NodeMaskRequest }
  | { id: number; kind: 'file'; url: string; side: number };

export type WorkerResponse =
  | { id: number; ok: true; mesh: NodeMeshData; mask: Uint8Array }
  | { id: number; ok: true; file: Uint16Array }
  | { id: number; ok: false; error: string };

/** Keeps the most recently used files, dropping the oldest beyond `limit`. */
class FileCache<T> {
  private readonly files = new Map<string, Promise<T>>();

  constructor(
    private readonly limit: number,
    private readonly load: (url: string, length: number) => Promise<T>,
  ) {}

  get(url: string, length: number): Promise<T> {
    let file = this.files.get(url);
    if (file) {
      this.files.delete(url); // re-inserted below: the map then lists least recently used first
    } else {
      file = this.load(url, length);
      file.catch(() => this.files.delete(url));
    }
    this.files.set(url, file);
    if (this.files.size > this.limit) this.files.delete(this.files.keys().next().value!);
    return file;
  }
}

const heights = new FileCache(96, fetchUint16);
const masks = new FileCache(48, fetchBytes);

const post = (msg: WorkerResponse, transfer: Transferable[] = []): void => self.postMessage(msg, { transfer });
const fail = (id: number) => (err: unknown) =>
  post({ id, ok: false, error: err instanceof Error ? err.message : String(err) });

self.onmessage = (ev: MessageEvent<WorkerRequest>): void => {
  const req = ev.data;
  if (req.kind === 'file') {
    heights.get(req.url, req.side * req.side).then((file) => post({ id: req.id, ok: true, file: file.slice() }), fail(req.id));
    return;
  }
  Promise.all([
    heights.get(req.heightUrl, req.mesh.side * req.mesh.side),
    masks.get(req.maskUrl, req.mask.samples * req.mask.samples * req.mask.channels),
  ]).then(([heightFile, maskFile]) => {
    const mesh = buildNodeMesh(heightFile, req.mesh);
    const mask = buildNodeMask(maskFile, req.mask);
    post({ id: req.id, ok: true, mesh, mask }, [mesh.positions.buffer, mesh.normals.buffer, mesh.uvs.buffer, mask.buffer]);
  }, fail(req.id));
};
