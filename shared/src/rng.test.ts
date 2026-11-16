import { describe, expect, it } from 'vitest';
import { createRng, hash32, tileRng } from './rng';

describe('rng', () => {
  it('gives the same sequence for the same seed', () => {
    const a = createRng(1234);
    const b = createRng(1234);
    for (let i = 0; i < 100; i++) expect(a.u32()).toBe(b.u32());
  });

  it('produces known values, so a change in the algorithm is noticed', () => {
    const r = createRng(1);
    expect([r.u32(), r.u32(), r.u32()]).toEqual([2693262067, 11749833, 2265367787]);
  });

  it('keeps floats in [0, 1) and ints in range', () => {
    const r = createRng(99);
    for (let i = 0; i < 1000; i++) {
      const f = r.float();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const n = r.int(7);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(7);
    }
  });

  it('separates neighbouring tiles and layers', () => {
    const seen = new Set<number>();
    for (let x = 0; x < 40; x++)
      for (let y = 0; y < 40; y++) for (let layer = 0; layer < 4; layer++) seen.add(hash32(7, x, y, layer));
    expect(seen.size).toBe(40 * 40 * 4);
    expect(tileRng(7, 1, 2, 0).u32()).not.toBe(tileRng(7, 2, 1, 0).u32());
  });
});
