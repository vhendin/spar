import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeStars } from './stars';

const data = readFileSync(join(import.meta.dirname, '../../../defs/sky/stars.bin'));
const stars = decodeStars(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
/** The brightest star within half a degree of a place in the sky. */
const near = (ra: number, dec: number) =>
  stars
    .filter((s) => Math.abs(s.dec - dec) < 0.5 && Math.abs(((s.ra - ra + 540) % 360) - 180) * Math.cos((dec * Math.PI) / 180) < 0.5)
    .sort((a, b) => a.mag - b.mag)[0];

describe('star catalogue', () => {
  it('holds every star the eye can see', () => {
    expect(stars.length).toBeGreaterThan(8000);
    expect(Math.max(...stars.map((s) => s.mag))).toBeLessThanOrEqual(6.52);
  });

  it('has the well-known ones where they belong', () => {
    // Sirius, the brightest; Polaris; Vega; Betelgeuse, red; Rigel, blue.
    expect(near(101.29, -16.72)!.mag).toBeCloseTo(-1.46, 1);
    expect(near(37.95, 89.26)!.mag).toBeCloseTo(2.02, 1);
    expect(near(279.23, 38.78)!.mag).toBeCloseTo(0.03, 1);
    expect(near(88.79, 7.41)!.bv).toBeGreaterThan(1.5);
    expect(near(78.63, -8.2)!.bv).toBeLessThan(0);
  });
});
