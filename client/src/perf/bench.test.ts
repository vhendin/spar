import { describe, expect, it } from 'vitest';
import { alongRoute, BENCH_ROUTE, BENCH_SECONDS, benchPose } from './bench';

const hills = (x: number, z: number): number => 400 + 30 * Math.sin(x / 200) + 20 * Math.cos(z / 150);

describe('benchmark route', () => {
  it('starts on the road at driving height and ends when the time is up', () => {
    const p = benchPose(0, hills)!;
    expect(p.x).toBe(BENCH_ROUTE[0]![0]);
    expect(p.z).toBe(BENCH_ROUTE[0]![1]);
    expect(p.y).toBeCloseTo(hills(p.x, p.z) + 3.5, 6);
    expect(benchPose(BENCH_SECONDS, hills)).toBeNull();
  });

  it('moves smoothly the whole way, with no jumps in place or view', () => {
    let before = benchPose(0, hills)!;
    let highest = 0;
    for (let t = 1 / 60; t < BENCH_SECONDS; t += 1 / 60) {
      const p = benchPose(t, hills)!;
      expect(Math.hypot(p.x - before.x, p.y - before.y, p.z - before.z)).toBeLessThan(1);
      const look = (q: typeof p): number[] => {
        const l = Math.hypot(q.tx - q.x, q.ty - q.y, q.tz - q.z);
        return [(q.tx - q.x) / l, (q.ty - q.y) / l, (q.tz - q.z) / l];
      };
      const [a, b] = [look(before), look(p)];
      expect(a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!).toBeGreaterThan(Math.cos(0.1));
      highest = Math.max(highest, p.y - hills(p.x, p.z));
      before = p;
    }
    expect(highest).toBeGreaterThan(200);
  });

  it('carries on straight past the end of the road', () => {
    const end = (BENCH_ROUTE.length - 1) * 20;
    const a = alongRoute(end), b = alongRoute(end + 100);
    // The points are rounded to the metre, so the last stretch is not exactly 20 m.
    expect(Math.abs(Math.hypot(b.x - a.x, b.z - a.z) - 100)).toBeLessThan(2);
    expect(Math.abs(b.dx * (b.x - a.x) + b.dz * (b.z - a.z))).toBeGreaterThan(98);
  });
});
