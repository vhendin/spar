import { describe, expect, it } from 'vitest';
import { buildRoadField, decodeDistance, ROAD_RANGE, roadLines, topSurface, underSurface } from './roadField';

const surfaces = [
  { id: 0, name: 'none' }, { id: 1, name: 'asphalt' }, { id: 2, name: 'gravel' }, { id: 3, name: 'dirt' }, { id: 4, name: 'trail' }, { id: 6, name: 'stream' },
];
const road = (points: number[][], width: number, surface = 'gravel') =>
  ({ id: 'w1', kind: 'track', surface, width, drivable: true, points }) as never;

describe('road field', () => {
  // A 32 m patch at (100, 200) with 129 texels: a texel every 25 cm.
  const at = (field: Uint8Array, x: number, z: number, texels = 129, size = 32) => {
    const step = size / (texels - 1);
    const k = (Math.round((z - 200) / step) * texels + Math.round((x - 100) / step)) * 4;
    return { d: decodeDistance(field[k]!), surface: topSurface(field[k + 1]!), under: underSurface(field[k + 1]!), dTop: decodeDistance(field[k + 3]!), strength: field[k + 2]! };
  };

  it('gives each texel its distance from the road edge, negative inside, and the road', () => {
    const lines = roadLines({ roads: [road([[90, 216], [140, 216]], 4)], waterways: [] }, surfaces);
    const field = buildRoadField(lines, 100, 200, 32, 129);
    expect(at(field, 110, 216).d).toBeCloseTo(-2, 1);
    expect(at(field, 110, 216).surface).toBe(2);
    expect(at(field, 110, 216).strength).toBe(255);
    expect(at(field, 110, 219).d).toBeCloseTo(1, 1);
    expect(at(field, 110, 218).d).toBeCloseTo(0, 1);
    // Far from any road: the most it keeps.
    expect(at(field, 110, 200).d).toBeCloseTo(ROAD_RANGE, 0);
  });

  it('lets bilinear blending find the edge between texels, so the edge is straight', () => {
    // A slanted road: along its edge the interpolated distance stays near zero.
    const lines = roadLines({ roads: [road([[90, 205], [140, 230]], 3)], waterways: [] }, surfaces);
    const field = buildRoadField(lines, 100, 200, 32, 129);
    const step = 32 / 128;
    const sample = (x: number, z: number) => {
      const fx = (x - 100) / step;
      const fz = (z - 200) / step;
      const i = Math.floor(fx);
      const j = Math.floor(fz);
      const v = (a: number, b: number) => decodeDistance(field[((j + b) * 129 + i + a) * 4]!);
      const u = fx - i;
      const w = fz - j;
      return (v(0, 0) * (1 - u) + v(1, 0) * u) * (1 - w) + (v(0, 1) * (1 - u) + v(1, 1) * u) * w;
    };
    // Unit normal of the road, pointing south-west of the line.
    const len = Math.hypot(50, 25);
    const nx = -25 / len;
    const nz = 50 / len;
    for (let t = 0.25; t < 0.75; t += 0.013) {
      const cx = 90 + 50 * t;
      const cz = 205 + 25 * t;
      expect(Math.abs(sample(cx + nx * 1.5, cz + nz * 1.5))).toBeLessThan(0.05);
    }
  });

  it('draws streams and narrow paths, and widens what is too thin for a coarse patch but fainter', () => {
    const lines = roadLines(
      { roads: [road([[0, 1024], [2048, 1024]], 1.2, 'trail')], waterways: [{ id: 's', kind: 'stream', points: [[1024, 0], [1024, 2048]] }] as never },
      surfaces,
    );
    // A 2048 m patch: a texel every 16 m; the 1.2 m trail is drawn 24 m wide at 5 % strength.
    const field = buildRoadField(lines, 0, 0, 2048, 129);
    const k = (64 * 129 + 20) * 4;
    expect(topSurface(field[k + 1]!)).toBe(4);
    expect(decodeDistance(field[k]!)).toBeLessThan(0);
    expect(field[k + 2]).toBeLessThan(15);
    const s = (20 * 129 + 64) * 4;
    expect(topSurface(field[s + 1]!)).toBe(6);
  });

  it('lays the better road on top where two meet, cut along its own edge', () => {
    // An asphalt road along z = 216, 6 m wide; a dirt track from the south ends in its middle.
    const lines = roadLines(
      { roads: [road([[90, 216], [140, 216]], 6, 'asphalt'), road([[115, 190], [115, 216]], 4, 'dirt')], waterways: [] },
      surfaces,
    );
    const field = buildRoadField(lines, 100, 200, 32, 129);
    // On the asphalt, even where the dirt track's middle is nearer: asphalt on top, dirt under.
    const onAsphalt = at(field, 115, 215);
    expect(onAsphalt.surface).toBe(1);
    expect(onAsphalt.under).toBe(3);
    expect(onAsphalt.dTop).toBeLessThan(0);
    // On the track a metre short of the asphalt: still asphalt on top, but outside its edge.
    const onTrack = at(field, 115, 212);
    expect(onTrack.surface).toBe(1);
    expect(onTrack.under).toBe(3);
    expect(onTrack.dTop).toBeCloseTo(1, 1);
    expect(onTrack.d).toBeLessThan(0);
    // Alone: the same surface twice.
    expect(at(field, 102, 216).under).toBe(1);
  });
});
