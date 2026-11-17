import { describe, expect, it } from 'vitest';
import { paintGround, summits, type MapRasters } from './mapImage';

const ids = { unknown: 0, forest: 1, wetland: 2, water: 8 };

function rasters(n: number, height: (x: number, y: number) => number, biome = 1): MapRasters {
  const heights = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) heights[y * n + x] = height(x, y);
  return { n, spacing: 8, heights, biome: new Uint8Array(n * n).fill(biome), surface: new Uint8Array(n * n) };
}

const pixel = (p: Uint8ClampedArray, n: number, x: number, y: number): number[] => [...p.slice((y * n + x) * 4, (y * n + x) * 4 + 4)];

describe('map picture', () => {
  it('paints water flat blue, and forest green', () => {
    const water = paintGround(rasters(8, () => 600, 8), ids);
    expect(pixel(water, 8, 3, 3)).toEqual([150, 196, 230, 255]);
    const forest = pixel(paintGround(rasters(8, () => 601), ids), 8, 3, 3);
    expect(forest[1]).toBeGreaterThan(forest[0]!);
    expect(forest[1]).toBeGreaterThan(forest[2]!);
  });

  it('shades slopes facing the north-west lighter than those facing away', () => {
    const n = 32;
    // A ridge along the diagonal: the north-west side faces the light.
    const p = paintGround(rasters(n, (x, y) => 700 - Math.abs(x + y - n) * 3), ids);
    const lit = pixel(p, n, 8, 8)[1]!;
    const shaded = pixel(p, n, 24, 24)[1]!;
    expect(lit).toBeGreaterThan(shaded);
  });

  it('draws contour lines where the height crosses a 20 m step', () => {
    const n = 16;
    const p = paintGround(rasters(n, (x) => 601 + x * 2), ids);
    // 601 + 2x crosses 620 between x = 9 and x = 10.
    expect(pixel(p, n, 9, 5)).not.toEqual(pixel(p, n, 5, 5));
    expect(pixel(p, n, 4, 5)).toEqual(pixel(p, n, 5, 5));
  });

  it('finds the tops of two hills, highest first', () => {
    const n = 100;
    const hill = (cx: number, cy: number, h: number) => (x: number, y: number) => h * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / 120);
    const a = hill(30, 30, 300), b = hill(70, 64, 200);
    const tops = summits(rasters(n, (x, y) => 600 + a(x, y) + b(x, y)), 12, 50);
    expect(tops.length).toBe(2);
    expect(Math.hypot(tops[0]!.x - 30, tops[0]!.y - 30)).toBeLessThan(3);
    expect(Math.hypot(tops[1]!.x - 70, tops[1]!.y - 64)).toBeLessThan(3);
  });
});
