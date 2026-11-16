import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isRegionDef } from './validate';

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
