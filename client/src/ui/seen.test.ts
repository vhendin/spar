import { describe, expect, it } from 'vitest';
import { SeenGrid, type SightRasters } from './seen';

/** A square region of `n` samples 8 m apart, flat at 500 m unless `shape` says otherwise. */
function rasters(n: number, shape: (x: number, z: number) => { h?: number; tree?: number } = () => ({})): SightRasters {
  const heights = new Float32Array(n * n);
  const canopy = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const s = shape(i * 8, j * 8);
      heights[j * n + i] = s.h ?? 500;
      canopy[j * n + i] = Math.round((s.tree ?? 0) * 4);
    }
  }
  return { n, spacing: 8, heights, canopy, canopyScale: 0.25 };
}

const SIZE = 2048;
const N = SIZE / 8 + 1;

describe('seeing', () => {
  it('on open flat ground, sees as far as the range and no further', () => {
    const g = new SeenGrid(SIZE);
    g.look(rasters(N), 1024, 1024, 502.5, 500);
    expect(g.has(1024 + 480, 1024)).toBe(true);
    expect(g.has(1024, 1024 - 480)).toBe(true);
    expect(g.has(1024 + 600, 1024)).toBe(false);
  });

  it('a ridge hides what lies behind it', () => {
    // A 30 m ridge running north–south 200 m east of the eye.
    const r = rasters(N, (x) => ({ h: Math.abs(x - 1224) < 20 ? 530 : 500 }));
    const g = new SeenGrid(SIZE);
    g.look(r, 1024, 1024, 502.5, 1000);
    expect(g.has(1208, 1024)).toBe(true);
    expect(g.has(1500, 1024)).toBe(false);
    expect(g.has(600, 1024)).toBe(true);
  });

  it('in a forest, sight wears out after some 80 m', () => {
    const r = rasters(N, () => ({ tree: 15 }));
    const g = new SeenGrid(SIZE);
    g.look(r, 1024, 1024, 502.5, 1000);
    expect(g.has(1024 + 50, 1024)).toBe(true);
    expect(g.has(1024 + 200, 1024)).toBe(false);
  });

  it('from high over the forest, sees far across it', () => {
    // A pointed hill 200 m high, its foot 250 m out, with forest all round below.
    const r = rasters(N, (x, z) => {
      const d = Math.hypot(x - 1024, z - 1024);
      return d < 250 ? { h: 700 - d * 0.8 } : { h: 500, tree: 15 };
    });
    const g = new SeenGrid(SIZE);
    g.look(r, 1024, 1024, 702.5, 900);
    expect(g.has(1024 + 800, 1024)).toBe(true);
    expect(g.has(1024, 1024 + 800)).toBe(true);
  });

  it('keeps count and a changed rectangle, and reads back what it saved', () => {
    const g = new SeenGrid(SIZE);
    g.markCircle(100, 100, 40);
    expect(g.count).toBeGreaterThan(0);
    expect(g.takeChanged()).not.toBeNull();
    expect(g.takeChanged()).toBeNull();
    const h = new SeenGrid(SIZE);
    expect(h.load(g.save())).toBe(true);
    expect(h.count).toBe(g.count);
    expect(h.has(100, 100)).toBe(true);
    expect(new SeenGrid(4096).load(g.save())).toBe(false);
  });

  it('fills specks left between seen cells', () => {
    const g = new SeenGrid(SIZE);
    // Seen all round one cell, from a look over flat open ground that reaches it...
    g.look(rasters(N), 1024, 1024, 502.5, 300);
    const hole = g.n * 70 + 70;
    g.cells[hole] = 0;
    g.count--;
    // ...and looked at again: the hole is filled even if no ray lands in it.
    g.look(rasters(N), 1100, 1100, 502.5, 300);
    expect(g.cells[hole]).toBe(1);
  });
});
