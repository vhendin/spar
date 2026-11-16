import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isGroundClasses, isRegionDef, isSpecies, isVegetationRules } from './validate';

const defs = join(import.meta.dirname, '../../defs');

describe('defs/regions', () => {
  const files = readdirSync(join(defs, 'regions')).filter((f) => f.endsWith('.json'));

  it('has at least one region', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s matches the schema and its file name', (file) => {
    const def: unknown = JSON.parse(readFileSync(join(defs, 'regions', file), 'utf8'));
    expect(isRegionDef(def), JSON.stringify(isRegionDef.errors)).toBe(true);
    expect((def as { name: string }).name).toBe(basename(file, '.json'));
  });
});

describe('defs/ground.json', () => {
  const ground: unknown = JSON.parse(readFileSync(join(defs, 'ground.json'), 'utf8'));

  it('matches the schema', () => {
    expect(isGroundClasses(ground), JSON.stringify(isGroundClasses.errors)).toBe(true);
  });

  it('numbers classes 0, 1, 2… with unique names, since mask files store the ids', () => {
    if (!isGroundClasses(ground)) return;
    for (const list of [ground.biomes, ground.surfaces]) {
      expect(list.map((c) => c.id)).toEqual(list.map((_, i) => i));
      expect(new Set(list.map((c) => c.name)).size).toBe(list.length);
    }
    expect(ground.biomes[0]!.name).toBe('unknown');
    expect(ground.surfaces[0]!.name).toBe('none');
  });
});

describe('defs/species and defs/biomes.json', () => {
  const files = readdirSync(join(defs, 'species')).filter((f) => f.endsWith('.json'));
  const species = files.map((f) => JSON.parse(readFileSync(join(defs, 'species', f), 'utf8')) as unknown);
  const rules: unknown = JSON.parse(readFileSync(join(defs, 'biomes.json'), 'utf8'));
  const ground = JSON.parse(readFileSync(join(defs, 'ground.json'), 'utf8')) as { biomes: { name: string }[] };

  it.each(files)('species %s matches the schema and its file name', (file) => {
    const def = species[files.indexOf(file)];
    expect(isSpecies(def), JSON.stringify(isSpecies.errors)).toBe(true);
    expect((def as { name: string }).name).toBe(basename(file, '.json'));
  });

  it('rules match the schema', () => {
    expect(isVegetationRules(rules), JSON.stringify(isVegetationRules.errors)).toBe(true);
  });

  it('rules only name species, layers and land cover classes that exist', () => {
    if (!isVegetationRules(rules)) return;
    const speciesNames = new Set(species.map((s) => (s as { name: string }).name));
    const layers = new Set(rules.layers.map((l) => l.name));
    const biomes = new Set(ground.biomes.map((b) => b.name));
    for (const rule of rules.rules) {
      expect(speciesNames, rule.species).toContain(rule.species);
      expect(layers, rule.layer).toContain(rule.layer);
      for (const biome of Object.keys(rule.biomes)) expect(biomes, `${rule.species}: ${biome}`).toContain(biome);
      expect(Boolean(rule.size.canopy) !== Boolean(rule.size.range), `${rule.species}: size needs canopy or range`).toBe(true);
    }
  });

  it('never asks for more than one object per cell where rules overlap fully', () => {
    if (!isVegetationRules(rules)) return;
    // Sums above 1 are clamped when placing; far above 1 means the shares are not what was meant.
    for (const layer of rules.layers) {
      const total = new Map<string, number>();
      for (const rule of rules.rules.filter((r) => r.layer === layer.name))
        for (const [biome, w] of Object.entries(rule.biomes)) total.set(biome, (total.get(biome) ?? 0) + w);
      for (const [biome, sum] of total) expect(sum, `${layer.name} in ${biome}`).toBeLessThanOrEqual(2.2);
    }
  });

  it('covers the vegetation types of the milestone', () => {
    expect(files.length).toBeGreaterThanOrEqual(15);
  });
});
