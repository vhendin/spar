import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface RegionEntry {
  name: string;
  title: string;
  size: number;
  /** SWEREF 99 TM north-west corner, for showing where it lies. */
  origin?: { easting: number; northing: number };
}

/** The regions the importer has built under `dir`, by title. Broken folders are left out. */
export async function listRegions(dir: string): Promise<RegionEntry[]> {
  let names: string[];
  try {
    names = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory() && !d.name.endsWith('.tmp')).map((d) => d.name);
  } catch {
    return [];
  }
  const found = await Promise.all(
    names.map(async (name): Promise<RegionEntry | null> => {
      try {
        const index = JSON.parse(await readFile(join(dir, name, 'index.json'), 'utf8')) as Partial<RegionEntry>;
        const o = index.origin;
        return {
          name,
          title: typeof index.title === 'string' ? index.title : name,
          size: typeof index.size === 'number' ? index.size : 0,
          ...(o && typeof o.easting === 'number' && typeof o.northing === 'number' ? { origin: { easting: o.easting, northing: o.northing } } : {}),
        };
      } catch {
        return null;
      }
    }),
  );
  return found.filter((r): r is RegionEntry => r !== null).sort((a, b) => a.title.localeCompare(b.title, 'sv'));
}
