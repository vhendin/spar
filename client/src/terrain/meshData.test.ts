import { describe, expect, it } from 'vitest';
import { buildNodeIndex, buildNodeMesh, nodeVertexCount, type NodeMeshRequest } from './meshData';

const SIDE = 259;
const base: NodeMeshRequest = {
  side: SIDE, apron: 1, i0: 0, j0: 0, stride: 4, quads: 64, fileSpacing: 8, offset: 100, scale: 0.02, skirt: 50,
};

/** A file whose ground rises `east` metres per metre eastward and `south` per metre southward. */
function plane(east: number, south: number, r: NodeMeshRequest): Uint16Array {
  const file = new Uint16Array(SIDE * SIDE);
  for (let row = 0; row < SIDE; row++)
    for (let col = 0; col < SIDE; col++) {
      const h = 500 + (col - 1) * r.fileSpacing * east + (row - 1) * r.fileSpacing * south;
      file[row * SIDE + col] = Math.round((h - r.offset) / r.scale);
    }
  return file;
}

describe('buildNodeMesh', () => {
  it('places vertices from the right samples', () => {
    const r = { ...base, i0: 128, j0: 64, stride: 2 };
    const m = buildNodeMesh(plane(0.1, 0.05, r), r);
    expect(m.positions.length).toBe(nodeVertexCount(64) * 3);
    // First vertex: 128 samples east and 64 south of the file corner.
    expect(m.positions[1]).toBeCloseTo(500 + 128 * 8 * 0.1 + 64 * 8 * 0.05, 1);
    // Last surface vertex: 64 quads of 16 m further in both directions.
    const last = (65 * 65 - 1) * 3;
    expect(m.positions[last]).toBe(64 * 16);
    expect(m.positions[last + 2]).toBe(64 * 16);
    expect(m.positions[last + 1]).toBeCloseTo(500 + (128 + 128) * 8 * 0.1 + (64 + 128) * 8 * 0.05, 1);
    expect(m.minY).toBeCloseTo(m.positions[1]!, 3);
    expect(m.maxY).toBeCloseTo(m.positions[last + 1]!, 3);
  });

  it('gives unit normals that lean away from the uphill side, edges included', () => {
    const m = buildNodeMesh(plane(0.2, -0.1, base), base);
    const len = Math.hypot(0.2, 1, 0.1);
    for (const v of [0, 64, 65 * 32 + 32, 65 * 65 - 1]) {
      expect(m.normals[v * 3]).toBeCloseTo(-0.2 / len, 2);
      expect(m.normals[v * 3 + 1]).toBeCloseTo(1 / len, 2);
      expect(m.normals[v * 3 + 2]).toBeCloseTo(0.1 / len, 2);
    }
  });

  it('hangs skirts straight below the edges', () => {
    const m = buildNodeMesh(plane(0, 0, base), base);
    for (let v = 65 * 65; v < nodeVertexCount(64); v++) expect(m.positions[v * 3 + 1]).toBeCloseTo(450, 1);
    const westStart = 65 * 65 + 2 * 65;
    expect(m.positions[westStart * 3]).toBe(0);
    expect(m.positions[(westStart + 64) * 3 + 2]).toBe(64 * 32);
  });
});

describe('buildNodeIndex', () => {
  const index = buildNodeIndex(64);
  const m = buildNodeMesh(plane(0, 0, base), base);
  const normal = (t: number): [number, number, number] => {
    const p = (k: number): [number, number, number] => {
      const v = index[t * 3 + k]! * 3;
      return [m.positions[v]!, m.positions[v + 1]!, m.positions[v + 2]!];
    };
    const [a, b, c] = [p(0), p(1), p(2)];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    return [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
  };

  it('stays inside the vertex buffer', () => {
    expect(Math.max(...index)).toBe(nodeVertexCount(64) - 1);
    expect(index.length % 3).toBe(0);
  });

  it('faces the surface up and every skirt outward', () => {
    const surface = 64 * 64 * 2;
    for (let t = 0; t < surface; t++) expect(normal(t)[1]).toBeGreaterThan(0);
    const perEdge = 64 * 2;
    const expectations: [number, number][] = [[2, -1], [2, 1], [0, -1], [0, 1]]; // north, south, west, east
    expectations.forEach(([axis, sign], e) => {
      for (let t = surface + e * perEdge; t < surface + (e + 1) * perEdge; t++) {
        expect(Math.sign(normal(t)[axis]!)).toBe(sign);
      }
    });
  });
});
