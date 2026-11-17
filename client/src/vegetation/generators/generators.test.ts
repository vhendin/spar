import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Species } from '@spar/shared';
import { generate } from './index';

const dir = join(import.meta.dirname, '../../../../defs/species');
const all = readdirSync(dir).sort().map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Species);

function bounds(positions: Float32Array) {
  let minY = Infinity, maxY = -Infinity, reach = 0;
  for (let i = 0; i < positions.length; i += 3) {
    minY = Math.min(minY, positions[i + 1]!);
    maxY = Math.max(maxY, positions[i + 1]!);
    reach = Math.max(reach, Math.hypot(positions[i]!, positions[i + 2]!));
  }
  return { minY, maxY, reach };
}

describe.each(all.map((s) => [s.name, s] as const))('%s', (_, species) => {
  const tree = species.generator === 'conifer' || species.generator === 'broadleaf';

  it('builds sound unit-height meshes for every variant', () => {
    for (let variant = 0; variant < species.variants; variant++) {
      for (const detail of ['full', 'low'] as const) {
        const m = generate(species, variant, detail);
        const vertices = m.positions.length / 3;
        expect(vertices).toBeGreaterThan(3);
        expect(m.normals.length).toBe(vertices * 3);
        expect(m.colors.length).toBe(vertices * 3);
        expect(m.sway.length).toBe(vertices);
        expect(m.indices.length % 3).toBe(0);
        expect(Math.max(...m.indices)).toBeLessThan(vertices);
        for (const array of [m.positions, m.normals, m.colors, m.sway]) expect(array.every(Number.isFinite)).toBe(true);
        for (let v = 0; v < vertices; v++) {
          expect(Math.hypot(m.normals[v * 3]!, m.normals[v * 3 + 1]!, m.normals[v * 3 + 2]!)).toBeCloseTo(1, 1);
          expect(m.sway[v]).toBeGreaterThanOrEqual(0);
          expect(m.sway[v]).toBeLessThanOrEqual(1);
        }
        const b = bounds(m.positions);
        expect(b.maxY, `${detail} top`).toBeGreaterThan(0.8);
        expect(b.maxY, `${detail} top`).toBeLessThan(1.2);
        expect(b.minY, `${detail} base`).toBeGreaterThan(species.generator === 'boulder' ? -1.05 : -0.3);
        expect(b.minY, `${detail} base`).toBeLessThanOrEqual(0.05);
      }
    }
  });

  it('stays within its triangle budget', () => {
    const full = generate(species, 0, 'full').indices.length / 3;
    const low = generate(species, 0, 'low').indices.length / 3;
    expect(full).toBeLessThanOrEqual(tree ? 450 : 90);
    if (tree || species.generator === 'boulder') {
      expect(low).toBeLessThanOrEqual(80);
      expect(low).toBeLessThan(full / 3);
    }
  });

  it('is repeatable, and variants differ', () => {
    const a = generate(species, 1 % species.variants, 'full');
    const b = generate(species, 1 % species.variants, 'full');
    expect(Array.from(b.positions)).toEqual(Array.from(a.positions));
    if (species.variants > 1) expect(Array.from(generate(species, 0, 'full').positions)).not.toEqual(Array.from(a.positions));
  });

  it('keeps the same outline when simplified', () => {
    for (let variant = 0; variant < species.variants; variant++) {
      const full = bounds(generate(species, variant, 'full').positions);
      const low = bounds(generate(species, variant, 'low').positions);
      expect(low.maxY).toBeGreaterThan(full.maxY * 0.8);
      expect(low.reach).toBeGreaterThan(full.reach * 0.55);
      expect(low.reach).toBeLessThan(full.reach * 1.6);
    }
  });
});
