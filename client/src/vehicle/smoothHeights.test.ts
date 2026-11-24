import { describe, expect, it } from 'vitest';
import { smoothHeights } from './groundStore';

describe('smoothHeights', () => {
  // A 5 x 5 tile with an apron of 1: a 7 x 7 file.
  const side = 7, n = 5;
  const file = (f: (i: number, j: number) => number) => {
    const out = new Uint16Array(side * side);
    for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) out[j * side + i] = f(i - 1, j - 1);
    return out;
  };

  it('keeps slopes as they are and takes the edge off a single lump', () => {
    const slope = smoothHeights(file((i, j) => 100 + 3 * i + j), side, 1, n, 0, 1);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) expect(slope[i * n + j]).toBeCloseTo(100 + 3 * i + j, 5);
    const lump = smoothHeights(file((i, j) => (i === 2 && j === 2 ? 116 : 100)), side, 1, n, 0, 1);
    expect(lump[2 * n + 2]).toBeCloseTo(104, 5);
    expect(lump[1 * n + 2]).toBeCloseTo(102, 5);
  });

  it('gives neighbouring tiles the same shared edge, from the apron', () => {
    const world = (x: number, z: number) => Math.round(100 + 10 * Math.sin(x * 1.7) + 7 * Math.cos(z * 2.3));
    // Tile B starts where tile A ends (the edge sample is shared).
    const a = smoothHeights(file((i, j) => world(i, j)), side, 1, n, 0, 1);
    const b = smoothHeights(file((i, j) => world(i + n - 1, j)), side, 1, n, 0, 1);
    for (let j = 0; j < n; j++) expect(b[0 * n + j]).toBeCloseTo(a[(n - 1) * n + j]!, 5);
  });
});
