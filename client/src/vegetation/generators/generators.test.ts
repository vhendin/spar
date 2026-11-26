import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { seasonAt, type SeasonCalendar, type Species } from '@spar/shared';
import { generate } from './index';

const dir = join(import.meta.dirname, '../../../../defs/species');
const calendar = JSON.parse(readFileSync(join(import.meta.dirname, '../../../../defs/seasons.json'), 'utf8')) as SeasonCalendar;
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

/** Total surface of a mesh's triangles. */
function area(m: { positions: Float32Array; indices: Uint16Array }): number {
  const p = m.positions;
  let sum = 0;
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = m.indices[t]! * 3, b = m.indices[t + 1]! * 3, c = m.indices[t + 2]! * 3;
    const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
    const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
    sum += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return sum;
}

describe.each(all.map((s) => [s.name, s] as const))('%s', (_, species) => {
  const tree = species.generator === 'conifer' || species.generator === 'broadleaf';

  it('keeps its shape through the year, so the meshes can be recoloured in place', () => {
    for (const detail of ['full', 'low'] as const) {
      const summer = generate(species, 0, detail, seasonAt(calendar, 200));
      for (const day of [30, 160, 258, 280]) {
        const other = generate(species, 0, detail, seasonAt(calendar, day));
        expect(other.positions.length).toBe(summer.positions.length);
        expect(Array.from(other.indices)).toEqual(Array.from(summer.indices));
      }
    }
    // Leafy trees go bare in winter: the leaves are gone, the branches and twigs stay, and
    // the crown thins on the way there.
    if (species.deciduous && species.generator === 'broadleaf') {
      const winter = area(generate(species, 0, 'full', seasonAt(calendar, 30)));
      const autumn = area(generate(species, 0, 'full', seasonAt(calendar, 270)));
      const summer = area(generate(species, 0, 'full', seasonAt(calendar, 200)));
      expect(winter).toBeLessThan(summer * 0.25);
      expect(winter).toBeGreaterThan(0);
      expect(autumn).toBeGreaterThan(winter);
      expect(autumn).toBeLessThan(summer);
    }
  });

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
    // Leafy trees carry their bare branches and twigs too, for the winter.
    expect(full).toBeLessThanOrEqual(species.generator === 'broadleaf' ? 600 : tree ? 450 : 90);
    if (tree || species.generator === 'boulder') {
      expect(low).toBeLessThanOrEqual(species.generator === 'broadleaf' ? 100 : 80);
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
