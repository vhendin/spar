import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface RegionEntry {
  name: string;
  title: string;
  size: number;
}

/** The regions the importer has built under `dir`, by title. Broken folders are left out. */
export async function listRegions(dir: string): Promise<RegionEntry[]> {
  let names: string[];
  try {
    names = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
  const found = await Promise.all(
    names.map(async (name): Promise<RegionEntry | null> => {
      try {
        const index = JSON.parse(await readFile(join(dir, name, 'index.json'), 'utf8')) as Partial<RegionEntry>;
        return { name, title: typeof index.title === 'string' ? index.title : name, size: typeof index.size === 'number' ? index.size : 0 };
      } catch {
        return null;
      }
    }),
  );
  return found.filter((r): r is RegionEntry => r !== null).sort((a, b) => a.title.localeCompare(b.title, 'sv'));
}
