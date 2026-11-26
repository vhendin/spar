// Camping at a shelter, camp site, hut or lodge: resting until the next dawn, and the nights
// kept in the browser and with the account. Two copies (two devices) merge, as the finds do.

import { sunPosition } from './sky/solar';

/** The sun's centre this far below the horizon (radians) is sunrise: refraction and its radius. */
const RISE = (-0.833 * Math.PI) / 180;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Where the sun neither rises nor sets in a day, a night's rest is this long. */
export const NO_DAWN_REST = 8 * HOUR;

export interface Dawn {
  /** The in-game instant the rest ends, UTC milliseconds. */
  utc: number;
  /** A sunrise; or no sunrise in the next day, the sun up all of it or down all of it. */
  kind: 'dawn' | 'never_set' | 'never_rose';
}

/** The next sunrise after `utc` at a place, or 8 hours on when there is none within a day. */
export function nextDawn(utc: number, latitude: number, longitude: number): Dawn {
  const up = (t: number): boolean => sunPosition(t, latitude, longitude).elevation >= RISE;
  const step = 10 * MINUTE;
  let before = utc + MINUTE;
  let wasUp = up(before);
  for (let t = before + step; t <= utc + 24 * HOUR + step; t += step) {
    const isUp = up(t);
    if (isUp && !wasUp) {
      // Narrowed down to a few seconds.
      let lo = before, hi = t;
      while (hi - lo > 5000) {
        const mid = (lo + hi) / 2;
        if (up(mid)) hi = mid;
        else lo = mid;
      }
      return { utc: Math.round(hi), kind: 'dawn' };
    }
    before = t;
    wasUp = isUp;
  }
  return { utc: utc + NO_DAWN_REST, kind: up(utc) ? 'never_set' : 'never_rose' };
}

/** Storage key of the nights out: `{ [region]: { [place@at]: Night } }`. */
export const NIGHTS_KEY = 'spar.nights';

export interface Night {
  /** The place's id (a destination's OpenStreetMap id) and name. */
  place: string;
  name: string;
  /** shelter, camp, hut or lodge. */
  kind: string;
  /** Real time camped, milliseconds since 1970. */
  at: number;
  vehicle: string;
  /** In-game date ("14 Mar") and season. */
  date: string;
  season: string;
  /** How it ended: at dawn, or a rest of hours with the sun up or down all day. */
  ended: Dawn['kind'];
  /** Others round the fire, by name. */
  with?: string[];
}

export type NightsByRegion = Record<string, Record<string, Night>>;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const ENDS: readonly string[] = ['dawn', 'never_set', 'never_rose'];

/** The nights out, as stored; anything malformed is left out. */
export function readNights(text: string | null | undefined): NightsByRegion {
  let v: unknown;
  try {
    v = JSON.parse(text ?? '{}');
  } catch {
    return {};
  }
  const out: NightsByRegion = {};
  if (!isRecord(v)) return out;
  for (const [region, nights] of Object.entries(v)) {
    if (!isRecord(nights)) continue;
    for (const [key, n] of Object.entries(nights)) {
      if (!isRecord(n) || typeof n.at !== 'number' || typeof n.place !== 'string') continue;
      (out[region] ??= {})[key] = {
        place: n.place,
        name: String(n.name ?? ''),
        kind: String(n.kind ?? ''),
        at: n.at,
        vehicle: String(n.vehicle ?? ''),
        date: String(n.date ?? ''),
        season: String(n.season ?? ''),
        ended: ENDS.includes(String(n.ended)) ? (n.ended as Night['ended']) : 'dawn',
        ...(Array.isArray(n.with) ? { with: n.with.map(String) } : {}),
      };
    }
  }
  return out;
}

/** The key a night is kept under: the same night from two devices is one. */
export const nightKey = (n: Pick<Night, 'place' | 'at'>): string => `${n.place}@${n.at}`;

/** Two stores of nights as one: every night in either. */
export function mergeNights(a: string | null | undefined, b: string | null | undefined): string {
  const out = readNights(a);
  for (const [region, nights] of Object.entries(readNights(b))) Object.assign((out[region] ??= {}), nights);
  return JSON.stringify(out);
}
