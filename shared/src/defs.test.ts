import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isGroundClasses, isRegionDef } from './validate';

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
