import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Species, VegetationRules } from '@spar/shared';
import { groundHeight, groupByChunk, placeLayer, STRIDE, type GroundData, type Placement } from './placement';
import { bandWeight, compileRules } from './rules';

const defs = join(import.meta.dirname, '../../../defs');
const species = readdirSync(join(defs, 'species')).sort().map((f) => JSON.parse(readFileSync(join(defs, 'species', f), 'utf8')) as Species);
const rules = JSON.parse(readFileSync(join(defs, 'biomes.json'), 'utf8')) as VegetationRules;
const biomes = (JSON.parse(readFileSync(join(defs, 'ground.json'), 'utf8')) as { biomes: { id: number; name: string }[] }).biomes;
const layers = compileRules(rules, species, biomes);
const layer = (name: string) => layers.find((l) => l.name === name)!;
const biomeId = (name: string) => biomes.find((b) => b.name === name)!.id;
const speciesAt = (p: Placement, n: number) => species[p.species[n]!]!.name;

const SAMPLES = 257;
const PLANE = SAMPLES * SAMPLES;

/** A 512 m square of ground: `paint` sets the mask bytes of each 2 m sample. */
function ground(paint: (x: number, z: number) => { biome: string; road?: number; wetness?: number; canopy?: number; slope?: number }, elevation = 500): GroundData {
  const mask = new Uint8Array(PLANE * 6);
  for (let j = 0; j < SAMPLES; j++)
    for (let i = 0; i < SAMPLES; i++) {
      const s = paint(i * 2, j * 2);
      const at = j * SAMPLES + i;
      mask[at] = biomeId(s.biome);
      mask[2 * PLANE + at] = s.road ?? 0;
      mask[3 * PLANE + at] = Math.round((s.wetness ?? 0.3) * 255);
      mask[4 * PLANE + at] = Math.round((s.canopy ?? 0) / 0.25);
      mask[5 * PLANE + at] = Math.round(((s.slope ?? 5) * 255) / 90);
    }
  const side = 259;
  const heights = new Uint16Array(side * side);
  for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) heights[j * side + i] = Math.round((elevation + (i - 1) * 0.5 - 200) / 0.02);
  return {
    mask, maskX0: 0, maskZ0: 0, maskSpacing: 2, maskSamples: SAMPLES,
    planes: { biome: 0, road: 2, wetness: 3, canopy: 4, slope: 5 },
    wetnessScale: 1 / 255, canopyScale: 0.25, slopeScale: 90 / 255,
    heights, heightX0: 0, heightZ0: 0, heightSpacing: 2, heightSide: side, heightApron: 1, heightOffset: 200, heightScale: 0.02,
    waterId: biomeId('water'), treeline: 750, regionSize: 512,
  };
}

// Low enough that the whole square lies well below the treeline.
const forest = ground(() => ({ biome: 'forest', canopy: 16 }), 300);

describe('bandWeight', () => {
  const band = { t0: 0, p0: 10, p1: 20, t1: 40 };
  it('is 1 inside prefer, 0 outside tolerate and slides between', () => {
    expect([15, 10, 20].map((v) => bandWeight(band, v))).toEqual([1, 1, 1]);
    expect([-5, 0, 40, 50].map((v) => bandWeight(band, v))).toEqual([0, 0, 0, 0]);
    expect(bandWeight(band, 5)).toBe(0.5);
    expect(bandWeight(band, 30)).toBe(0.5);
    expect(bandWeight(null, 123)).toBe(1);
  });
  it('handles a band open at one end', () => {
    const open = { t0: -9999, p0: -9999, p1: -100, t1: -50 };
    expect(bandWeight(open, -9999)).toBe(1);
    expect(bandWeight(open, -500)).toBe(1);
    expect(bandWeight(open, -75)).toBe(0.5);
    expect(bandWeight(open, 0)).toBe(0);
  });
});

describe('placeLayer', () => {
  it('gives the same objects every time, and different ones for another seed', () => {
    const a = placeLayer(layer('trees'), 7, 0, 0, 256, 256, forest);
    const b = placeLayer(layer('trees'), 7, 0, 0, 256, 256, forest);
    const c = placeLayer(layer('trees'), 8, 0, 0, 256, 256, forest);
    expect(a.count).toBeGreaterThan(1000);
    expect(Array.from(b.data)).toEqual(Array.from(a.data));
    expect(Array.from(b.species)).toEqual(Array.from(a.species));
    expect(Array.from(b.cells)).toEqual(Array.from(a.cells));
    expect(Array.from(c.data.subarray(0, 60))).not.toEqual(Array.from(a.data.subarray(0, 60)));
  });

  it('places a cell the same way whatever batch it falls in', () => {
    for (const name of ['trees', 'ground', 'rocks']) {
      const l = layer(name);
      const whole = placeLayer(l, 3, 0, 0, 128, 64, forest);
      const parts = [placeLayer(l, 3, 0, 0, 32, 64, forest), placeLayer(l, 3, 32, 0, 96, 64, forest), placeLayer(l, 3, 96, 0, 128, 64, forest)];
      const key = (p: Placement) => {
        const out = new Map<string, string>();
        for (let n = 0; n < p.count; n++) out.set(`${p.cells[n * 2]},${p.cells[n * 2 + 1]}`, `${Array.from(p.data.subarray(n * STRIDE, (n + 1) * STRIDE)).join()}|${p.species[n]}|${p.variant[n]}`);
        return out;
      };
      const merged = new Map(parts.flatMap((p) => [...key(p)]));
      expect(merged.size, name).toBe(parts.reduce((sum, p) => sum + p.count, 0)); // no cell placed twice
      expect(merged, name).toEqual(key(whole));
    }
  });

  it('keeps objects in their cell, on the ground, and inside the region', () => {
    const l = layer('trees');
    const p = placeLayer(l, 1, 256, 256, 512, 512, forest);
    for (let n = 0; n < p.count; n++) {
      const [x, y, z, size, yaw, rand] = p.data.subarray(n * STRIDE, (n + 1) * STRIDE);
      expect(Math.floor(x! / l.spacing)).toBe(p.cells[n * 2]);
      expect(Math.floor(z! / l.spacing)).toBe(p.cells[n * 2 + 1]);
      expect(x).toBeLessThan(512);
      expect(y).toBeCloseTo(groundHeight(forest, x!, z!), 3);
      expect(y).toBeCloseTo(300 + x! * 0.25, 1);
      expect(size).toBeGreaterThan(2.5);
      expect(size).toBeLessThan(22);
      expect(yaw).toBeGreaterThanOrEqual(0);
      expect(yaw).toBeLessThan(6.2832);
      expect(rand).toBeGreaterThanOrEqual(0);
      expect(rand).toBeLessThan(1);
      expect(p.variant[n]).toBeLessThan(species[p.species[n]!]!.variants);
    }
  });

  it('leaves water, roads and streams clear', () => {
    const g = ground((x, z) => (x < 100 ? { biome: 'water' } : { biome: 'forest', canopy: 15, road: z > 200 && z < 210 ? 255 : 0 }));
    for (const name of ['trees', 'shrubs', 'ground', 'rocks']) {
      const p = placeLayer(layer(name), 5, 0, 0, 256, 256, g);
      expect(p.count, name).toBeGreaterThan(0);
      for (let n = 0; n < p.count; n++) {
        expect(p.data[n * STRIDE]!, name).toBeGreaterThanOrEqual(99);
        const z = p.data[n * STRIDE + 2]!;
        expect(z > 201 && z < 209, name).toBe(false);
      }
    }
  });

  it('grows the right things in the right places', () => {
    const count = (p: Placement) => {
      const out: Record<string, number> = {};
      for (let n = 0; n < p.count; n++) out[speciesAt(p, n)] = (out[speciesAt(p, n)] ?? 0) + 1;
      return out;
    };
    const trees = (g: GroundData) => count(placeLayer(layer('trees'), 11, 0, 0, 512, 512, g));

    const valley = trees(ground(() => ({ biome: 'forest', canopy: 16, wetness: 0.4 }), 300));
    expect(valley.spruce).toBeGreaterThan(valley.pine!);
    expect(valley.pine).toBeGreaterThan(valley.birch!);
    expect(valley.mountain_birch).toBeUndefined();
    expect(valley.bog_pine).toBeUndefined();

    const dry = trees(ground(() => ({ biome: 'forest', canopy: 14, wetness: 0.05 }), 300));
    expect(dry.pine).toBeGreaterThan(dry.spruce!);

    const streamside = trees(ground(() => ({ biome: 'forest', canopy: 12, wetness: 0.95 }), 300));
    expect(streamside.alder).toBeGreaterThan(streamside.spruce ?? 0);

    // 30 to 0 m below the treeline across the square: only mountain birch holds out.
    const high = trees(ground(() => ({ biome: 'forest', canopy: 5 }), 720));
    expect(high.mountain_birch).toBeGreaterThan(1000);
    expect(high.spruce ?? 0).toBeLessThan(high.mountain_birch! / 20);

    const bog = trees(ground(() => ({ biome: 'wetland', wetness: 0.85 }), 300));
    expect(bog.bog_pine).toBeGreaterThan(50);
    expect(bog.spruce).toBeUndefined();

    const fell = trees(ground(() => ({ biome: 'heath' }), 900));
    expect(Object.keys(fell)).toEqual([]);

    const meadow = count(placeLayer(layer('ground'), 11, 0, 0, 64, 64, ground(() => ({ biome: 'grassland' }))));
    expect(meadow.grass).toBeGreaterThan(3000);
    const shore = count(placeLayer(layer('ground'), 11, 0, 0, 64, 64, ground(() => ({ biome: 'wetland', wetness: 0.97 }), 300)));
    expect(shore.reed).toBeGreaterThan(500);
    expect(shore.sedge).toBeGreaterThan(500);
  });

  it('sizes forest trees from the canopy mask', () => {
    const mean = (canopy: number) => {
      const p = placeLayer(layer('trees'), 2, 0, 0, 256, 256, ground(() => ({ biome: 'forest', canopy }), 300));
      let sum = 0, n = 0;
      for (let k = 0; k < p.count; k++) if (speciesAt(p, k) === 'spruce') { sum += p.data[k * STRIDE + 3]!; n++; }
      return sum / n;
    };
    expect(mean(20) / mean(10)).toBeCloseTo(2, 1);
    // No canopy, no canopy-sized trees.
    const bare = placeLayer(layer('trees'), 2, 0, 0, 256, 256, ground(() => ({ biome: 'forest', canopy: 0 }), 300));
    for (let k = 0; k < bare.count; k++) expect(['spruce', 'pine', 'aspen']).not.toContain(speciesAt(bare, k));
  });
});

describe('groupByChunk', () => {
  it('sorts objects into chunks without losing any', () => {
    const p = placeLayer(layer('trees'), 7, 0, 0, 256, 256, forest);
    const before = new Set(Array.from({ length: p.count }, (_, n) => `${p.cells[n * 2]},${p.cells[n * 2 + 1]},${p.species[n]},${p.data[n * STRIDE]}`));
    const starts = groupByChunk(p, 0, 0, 64, 4);
    expect(starts.length).toBe(17);
    expect(starts[16]).toBe(p.count);
    for (let c = 0; c < 16; c++) {
      for (let n = starts[c]!; n < starts[c + 1]!; n++) {
        expect(Math.min(3, Math.floor(p.data[n * STRIDE]! / 64)) + 4 * Math.min(3, Math.floor(p.data[n * STRIDE + 2]! / 64))).toBe(c);
      }
    }
    const after = new Set(Array.from({ length: p.count }, (_, n) => `${p.cells[n * 2]},${p.cells[n * 2 + 1]},${p.species[n]},${p.data[n * STRIDE]}`));
    expect(after).toEqual(before);
  });
});
