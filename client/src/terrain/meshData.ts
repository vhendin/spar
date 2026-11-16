// Turns part of a height file into vertex data for one terrain node. Pure functions, used
// from the terrain worker.

import { terrainColor } from './shade';

export interface NodeMeshRequest {
  /** Stored samples per side of the file, apron included. */
  side: number;
  /** Extra samples around the file. */
  apron: number;
  /** First sample of the node inside the file, counted without the apron. */
  i0: number;
  j0: number;
  /** File samples between neighbouring vertices. */
  stride: number;
  /** Quads per side of the node. */
  quads: number;
  /** Metres between file samples. */
  fileSpacing: number;
  /** Height in metres = offset + value * scale. */
  offset: number;
  scale: number;
  /** How far the skirt hangs below the edge, in metres. */
  skirt: number;
}

export interface NodeMeshData {
  /** x east and z south from the node's north-west corner, y is elevation; all in metres. */
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  minY: number;
  maxY: number;
}

/** Vertices in the surface grid, then four skirt strips of quads + 1 vertices each. */
export function nodeVertexCount(quads: number): number {
  return (quads + 1) * (quads + 1) + 4 * (quads + 1);
}

export function buildNodeMesh(file: Uint16Array, r: NodeMeshRequest): NodeMeshData {
  const n = r.quads + 1;
  const total = nodeVertexCount(r.quads);
  const positions = new Float32Array(total * 3);
  const normals = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);
  const step = r.stride * r.fileSpacing;
  const slope = r.scale / (2 * r.fileSpacing);
  let minY = Infinity;
  let maxY = -Infinity;

  for (let j = 0; j < n; j++) {
    const row = r.apron + r.j0 + j * r.stride;
    for (let i = 0; i < n; i++) {
      const col = r.apron + r.i0 + i * r.stride;
      const at = row * r.side + col;
      const y = r.offset + file[at]! * r.scale;
      // Slope from the nearest file samples, whatever the stride, so the lighting does
      // not change when a node is swapped for finer ones built from the same file.
      const dx = (file[at + 1]! - file[at - 1]!) * slope;
      const dz = (file[at + r.side]! - file[at - r.side]!) * slope;
      const inv = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
      const o = (j * n + i) * 3;
      positions[o] = i * step;
      positions[o + 1] = y;
      positions[o + 2] = j * step;
      normals[o] = -dx * inv;
      normals[o + 1] = inv;
      normals[o + 2] = -dz * inv;
      terrainColor(y, inv, colors, o);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  // Skirts: a copy of each edge, lowered, to hide gaps against coarser neighbours.
  let v = n * n;
  const copy = (from: number): void => {
    const s = from * 3;
    const d = v * 3;
    positions[d] = positions[s]!;
    positions[d + 1] = positions[s + 1]! - r.skirt;
    positions[d + 2] = positions[s + 2]!;
    for (let c = 0; c < 3; c++) {
      normals[d + c] = normals[s + c]!;
      colors[d + c] = colors[s + c]!;
    }
    v++;
  };
  for (let i = 0; i < n; i++) copy(i); // north
  for (let i = 0; i < n; i++) copy((n - 1) * n + i); // south
  for (let j = 0; j < n; j++) copy(j * n); // west
  for (let j = 0; j < n; j++) copy(j * n + n - 1); // east

  return { positions, normals, colors, minY, maxY };
}

/** Triangle list matching buildNodeMesh; the same for every node with this many quads. */
export function buildNodeIndex(quads: number): Uint16Array {
  const n = quads + 1;
  if (nodeVertexCount(quads) > 65535) throw new Error('too many vertices for 16-bit indices');
  const out = new Uint16Array(quads * quads * 6 + 4 * quads * 6);
  let k = 0;
  for (let j = 0; j < quads; j++) {
    for (let i = 0; i < quads; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      out[k++] = a; out[k++] = c; out[k++] = b;
      out[k++] = b; out[k++] = c; out[k++] = d;
    }
  }
  // top(i) is the surface vertex and base + i its lowered copy; `flip` turns the strip
  // so that it faces away from the node.
  const strip = (top: (i: number) => number, base: number, flip: boolean): void => {
    for (let i = 0; i < quads; i++) {
      const t0 = top(i);
      const t1 = top(i + 1);
      const b0 = base + i;
      const b1 = base + i + 1;
      if (flip) {
        out[k++] = t0; out[k++] = b0; out[k++] = t1;
        out[k++] = t1; out[k++] = b0; out[k++] = b1;
      } else {
        out[k++] = t0; out[k++] = t1; out[k++] = b0;
        out[k++] = t1; out[k++] = b1; out[k++] = b0;
      }
    }
  };
  const base = n * n;
  strip((i) => i, base, false); // north
  strip((i) => (n - 1) * n + i, base + n, true); // south
  strip((j) => j * n, base + 2 * n, true); // west
  strip((j) => j * n + n - 1, base + 3 * n, false); // east
  return out;
}
