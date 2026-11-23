import { describe, expect, it } from 'vitest';
import { bonnetOutline } from './body';

/** Signed area of a [z, y] outline: positive when it runs anticlockwise. */
const turns = (o: [number, number][]): number[] =>
  o.map((p, k) => {
    const q = o[(k + 1) % o.length]!, s = o[(k + 2) % o.length]!;
    return (q[0] - p[0]) * (s[1] - q[1]) - (q[1] - p[1]) * (s[0] - q[0]);
  });

describe('bonnet outline', () => {
  const front = 1.2, half = 2.5, floor = 0.55;

  it('is a sharp-edged box rising to the windscreen without a nose', () => {
    const o = bonnetOutline({ length: 1.3, height: 1.1 }, front, half, floor);
    expect(o.at(-2)).toEqual([half, 1.1]);
    expect(o.at(-1)![1]).toBeCloseTo(1.16);
  });

  it('rounds the front edge with an arc touching the front and the sloping top, and stays convex', () => {
    const o = bonnetOutline({ length: 1.3, height: 1.06, rise: 0.13, nose: 0.14 }, front, half, floor);
    expect(o.length).toBeGreaterThan(6);
    for (const t of turns(o)) expect(t).toBeGreaterThan(-1e-9);
    // Nothing sticks out past the front or above the top line.
    const top = (z: number): number => 1.06 + (0.13 * (half - z)) / (half - front);
    for (const [z, y] of o) {
      expect(z).toBeLessThanOrEqual(half + 1e-9);
      expect(y).toBeLessThanOrEqual(top(z) + 1e-9);
    }
    // The arc starts on the front face and ends on the top line.
    const arc = o.slice(3, -1);
    expect(arc[0]![0]).toBeCloseTo(half);
    expect(arc.at(-1)![1]).toBeCloseTo(top(arc.at(-1)![0]));
    expect(o.at(-1)).toEqual([front, 1.19]);
  });
});
