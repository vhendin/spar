// The trails a driver has driven in each region: when first and last, how often, and the
// quickest time. Kept in the browser and with the account; two copies (two devices) merge
// rather than one replacing the other.

/** Storage key of the trails driven: `{ [region]: { [trail id]: Driven } }`. */
export const TRAILS_KEY = 'spar.trails';

export interface Driven {
  /** Real time of the first finish, milliseconds since 1970. */
  first: number;
  /** Real time of the latest finish. */
  last: number;
  /** How many times driven to the end. */
  runs: number;
  /** The quickest time, seconds of driving. */
  best: number;
  /** The vehicle, in-game date ("14 Mar") and season of the quickest run. */
  vehicle: string;
  date: string;
  season: string;
}

export type DrivenByRegion = Record<string, Record<string, Driven>>;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The trails driven, as stored; anything malformed is left out. */
export function readTrails(text: string | null | undefined): DrivenByRegion {
  let all: unknown;
  try {
    all = JSON.parse(text ?? '{}');
  } catch {
    return {};
  }
  const out: DrivenByRegion = {};
  if (!isRecord(all)) return out;
  for (const [region, trails] of Object.entries(all)) {
    if (!isRecord(trails)) continue;
    for (const [id, t] of Object.entries(trails)) {
      if (!isRecord(t) || !num(t.first) || !num(t.best) || t.best <= 0) continue;
      (out[region] ??= {})[id] = {
        first: t.first,
        last: num(t.last) ? t.last : t.first,
        runs: num(t.runs) && t.runs >= 1 ? Math.round(t.runs) : 1,
        best: t.best,
        vehicle: String(t.vehicle ?? ''),
        date: String(t.date ?? ''),
        season: String(t.season ?? ''),
      };
    }
  }
  return out;
}

/** One finished run added to what was driven before. */
export function addRun(before: Driven | undefined, run: { at: number; seconds: number; vehicle: string; date: string; season: string }): Driven {
  const quicker = !before || run.seconds < before.best;
  return {
    first: before ? Math.min(before.first, run.at) : run.at,
    last: before ? Math.max(before.last, run.at) : run.at,
    runs: (before?.runs ?? 0) + 1,
    best: quicker ? run.seconds : before.best,
    vehicle: quicker ? run.vehicle : before.vehicle,
    date: quicker ? run.date : before.date,
    season: quicker ? run.season : before.season,
  };
}

/**
 * Two stores as one: every trail driven in either, with the earliest first finish, the latest
 * last, the larger count (runs on two devices may be the same runs, merged before) and the
 * quicker best.
 */
export function mergeTrails(a: string | null | undefined, b: string | null | undefined): string {
  const out = readTrails(a);
  for (const [region, trails] of Object.entries(readTrails(b))) {
    const kept = (out[region] ??= {});
    for (const [id, t] of Object.entries(trails)) {
      const k = kept[id];
      if (!k) {
        kept[id] = t;
        continue;
      }
      const quicker = t.best < k.best ? t : k;
      kept[id] = {
        first: Math.min(k.first, t.first),
        last: Math.max(k.last, t.last),
        runs: Math.max(k.runs, t.runs),
        best: quicker.best,
        vehicle: quicker.vehicle,
        date: quicker.date,
        season: quicker.season,
      };
    }
  }
  return JSON.stringify(out);
}
