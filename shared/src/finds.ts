// The small things a driver has found in each region (summer farms, springs, fords, lake
// shores...) and the highest ground they have reached there. Kept in the browser and with the
// account; two copies (two devices) merge rather than one replacing the other.

/** Storage key of what has been found: `{ [region]: { [id]: Found } }`. */
export const FINDS_KEY = 'spar.finds';
/** Storage key of the highest ground reached: `{ [region]: Highest }`. */
export const HIGHEST_KEY = 'spar.highest';

export interface Found {
  /** Real time when found, milliseconds since 1970. */
  at: number;
  /** The vehicle's title. */
  vehicle: string;
  /** In-game date ("14 Mar") and season. */
  date: string;
  season: string;
}

export interface Highest {
  /** Metres above sea level. */
  ele: number;
  vehicle: string;
  date: string;
  at: number;
}

export type FoundByRegion = Record<string, Record<string, Found>>;
export type HighestByRegion = Record<string, Highest>;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function parse(text: string | null | undefined): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(text ?? '{}');
    return isRecord(v) ? v : {};
  } catch {
    return {};
  }
}

/** What has been found, as stored; anything malformed is left out. */
export function readFinds(text: string | null | undefined): FoundByRegion {
  const out: FoundByRegion = {};
  for (const [region, finds] of Object.entries(parse(text))) {
    if (!isRecord(finds)) continue;
    for (const [id, f] of Object.entries(finds)) {
      if (!isRecord(f) || typeof f.at !== 'number') continue;
      (out[region] ??= {})[id] = { at: f.at, vehicle: String(f.vehicle ?? ''), date: String(f.date ?? ''), season: String(f.season ?? '') };
    }
  }
  return out;
}

/** The highest points, as stored; anything malformed is left out. */
export function readHighest(text: string | null | undefined): HighestByRegion {
  const out: HighestByRegion = {};
  for (const [region, h] of Object.entries(parse(text))) {
    if (!isRecord(h) || typeof h.ele !== 'number' || !Number.isFinite(h.ele)) continue;
    out[region] = { ele: h.ele, vehicle: String(h.vehicle ?? ''), date: String(h.date ?? ''), at: typeof h.at === 'number' ? h.at : 0 };
  }
  return out;
}

/** Two stores of finds as one: everything found in either, each at its first finding. */
export function mergeFinds(a: string | null | undefined, b: string | null | undefined): string {
  const out = readFinds(a);
  for (const [region, finds] of Object.entries(readFinds(b))) {
    const kept = (out[region] ??= {});
    for (const [id, f] of Object.entries(finds)) if (!kept[id] || f.at < kept[id].at) kept[id] = f;
  }
  return JSON.stringify(out);
}

/** Two stores of highest points as one: the higher of each region's. */
export function mergeHighest(a: string | null | undefined, b: string | null | undefined): string {
  const out = readHighest(a);
  for (const [region, h] of Object.entries(readHighest(b))) {
    const kept = out[region];
    if (!kept || h.ele > kept.ele) out[region] = h;
  }
  return JSON.stringify(out);
}
