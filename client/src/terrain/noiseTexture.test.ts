import { describe, expect, it } from 'vitest';
import { NOISE_SIZE, noiseData } from './noiseTexture';

describe('ground noise texture', () => {
  const data = noiseData();
  const at = (x: number, y: number, ch: number): number => data[(y * NOISE_SIZE + x) * 4 + ch]! / 255 * 2 - 1;

  it('repeats without a seam: across each edge it changes no more than inside', () => {
    for (let ch = 0; ch < 4; ch++) {
      let inside = 0;
      let seam = 0;
      for (let y = 0; y < NOISE_SIZE; y++) {
        inside = Math.max(inside, Math.abs(at(1, y, ch) - at(0, y, ch)));
        seam = Math.max(seam, Math.abs(at(0, y, ch) - at(NOISE_SIZE - 1, y, ch)), Math.abs(at(y, 0, ch) - at(y, NOISE_SIZE - 1, ch)));
      }
      expect(seam).toBeLessThan(inside * 1.5 + 0.02);
    }
  });

  it('spreads round zero with about the reach of mx_noise_float, each channel its own', () => {
    for (let ch = 0; ch < 4; ch++) {
      let sum = 0;
      let sq = 0;
      const n = NOISE_SIZE * NOISE_SIZE;
      for (let i = 0; i < n; i++) {
        const v = data[i * 4 + ch]! / 255 * 2 - 1;
        sum += v;
        sq += v * v;
      }
      expect(Math.abs(sum / n)).toBeLessThan(0.06);
      const sd = Math.sqrt(sq / n);
      expect(sd).toBeGreaterThan(0.2);
      expect(sd).toBeLessThan(0.5);
    }
    expect(at(100, 100, 0)).not.toBeCloseTo(at(100, 100, 1), 3);
  });
});
