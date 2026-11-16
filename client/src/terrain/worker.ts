/// <reference lib="webworker" />
// Terrain worker: downloads height files and builds node vertex data off the main thread.

import { buildNodeMesh, type NodeMeshData, type NodeMeshRequest } from './meshData';
import { fetchUint16 } from './region';

export type WorkerRequest =
  | { id: number; kind: 'mesh'; url: string; mesh: NodeMeshRequest }
  | { id: number; kind: 'file'; url: string; side: number };

export type WorkerResponse =
  | { id: number; ok: true; mesh: NodeMeshData }
  | { id: number; ok: true; file: Uint16Array }
  | { id: number; ok: false; error: string };

const MAX_FILES = 96;
const files = new Map<string, Promise<Uint16Array>>();

function getFile(url: string, side: number): Promise<Uint16Array> {
  let file = files.get(url);
  if (file) {
    files.delete(url); // re-insert below: the map then lists least recently used first
  } else {
    file = fetchUint16(url, side * side);
    file.catch(() => files.delete(url));
  }
  files.set(url, file);
  if (files.size > MAX_FILES) files.delete(files.keys().next().value!);
  return file;
}

const post = (msg: WorkerResponse, transfer: Transferable[] = []): void => self.postMessage(msg, { transfer });

self.onmessage = (ev: MessageEvent<WorkerRequest>): void => {
  const req = ev.data;
  const side = req.kind === 'mesh' ? req.mesh.side : req.side;
  getFile(req.url, side).then(
    (file) => {
      if (req.kind === 'file') {
        post({ id: req.id, ok: true, file: file.slice() });
      } else {
        const mesh = buildNodeMesh(file, req.mesh);
        post({ id: req.id, ok: true, mesh }, [mesh.positions.buffer, mesh.normals.buffer, mesh.colors.buffer]);
      }
    },
    (err: unknown) => post({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) }),
  );
};
