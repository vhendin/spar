import { describe, expect, it } from 'vitest';
import { MEASURE_SECONDS, PARTS, partCosts, PartsBench, PLACE_WARM_QUIET, PLACES, SETTLE_SECONDS } from './parts';

describe('parts benchmark', () => {
  it('waits for loading at each place, measures every part there after it settles, then stops', () => {
    const bench = new PartsBench();
    let now = 0;
    const seen: string[] = [];
    // Loading for the first 5 s at each place.
    let placeAt = 0;
    let lastPlace = 0;
    for (let frame = 0; frame < 60 * 400 && !bench.done; frame++) {
      const s = bench.step(now, 0)!;
      if (!s) break;
      if (s.place !== lastPlace) {
        lastPlace = s.place;
        placeAt = now;
      }
      const loading = now - placeAt < 5000 ? 1 : 0;
      const t = bench.step(now, loading);
      if (t?.measuring) seen.push(`${t.place}:${t.part}`);
      // GPU time stands for the part: the full picture 10 ms, each part left out saves 1 ms.
      bench.sample(t?.part === 'all' ? 10 : 9, 4);
      now += 1000 / 60;
    }
    expect(bench.done).toBe(true);
    expect(bench.results).toHaveLength(PARTS.length * PLACES.length);
    expect(new Set(seen).size).toBe(new Set(PARTS).size * PLACES.length);
    // Each part measured for about MEASURE_SECONDS at 60 a second.
    for (const r of bench.results) expect(Math.abs(r.frames - MEASURE_SECONDS * 60)).toBeLessThanOrEqual(2);
    const costs = partCosts(bench.results);
    expect(costs[0]!.full).toBeCloseTo(10, 6);
    expect(costs[0]!.drift).toBeCloseTo(0, 6);
    for (const p of costs[1]!.parts) expect(p.saved).toBeCloseTo(1, 6);
    // Two places, each: ~5 s loading + the quiet wait, then every part settled and measured.
    const expected = PLACES.length * (5 + PLACE_WARM_QUIET + PARTS.length * (SETTLE_SECONDS + MEASURE_SECONDS));
    expect(now / 1000).toBeGreaterThan(expected - 1);
    expect(now / 1000).toBeLessThan(expected + 2);
  });

  it('does not count frames while a part is settling', () => {
    const bench = new PartsBench();
    bench.step(0, 0);
    bench.step(PLACE_WARM_QUIET * 1000 + 1, 0);
    const s = bench.step(PLACE_WARM_QUIET * 1000 + 2, 0)!;
    expect(s.measuring).toBe(false);
    bench.sample(99, 99);
    bench.step(PLACE_WARM_QUIET * 1000 + 2 + (SETTLE_SECONDS + MEASURE_SECONDS) * 1000 + 1, 0);
    expect(bench.results[0]!.frames).toBe(0);
    expect(bench.results[0]!.gpu).toBeNull();
  });
});
