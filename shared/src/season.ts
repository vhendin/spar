// The time of year as the plants and the ground show it, worked out from the day of the year
// and the region's season calendar (defs/seasons.json).

import type { SeasonCalendar, SeasonKey } from './generated/seasons';

export type SeasonName = SeasonKey['foliage'];
export type GroundSeason = SeasonKey['ground'];

export interface SeasonState {
  /** How much of each season's foliage colour to use; the shares add up to 1. */
  foliage: Record<SeasonName, number>;
  /** How much of a deciduous tree's crown is in leaf, 0 bare to 1 full. */
  leaves: number;
  /** How much of each ground colour to use; the shares add up to 1. */
  ground: Record<GroundSeason, number>;
}

const YEAR = 365;

/** The state on `day` of the year (1 is 1 January; fractions allowed), blended between calendar entries. */
export function seasonAt(calendar: SeasonCalendar, day: number): SeasonState {
  const keys = calendar.calendar;
  const d = ((((day - 1) % YEAR) + YEAR) % YEAR) + 1;
  // The entry at or before the day, and the next one, wrapping round the new year.
  let i = keys.length - 1;
  for (let k = 0; k < keys.length; k++) if (keys[k]!.day <= d) i = k;
  const a = keys[i]!, b = keys[(i + 1) % keys.length]!;
  const span = (b.day - a.day + YEAR) % YEAR || YEAR;
  const t = (((d - a.day + YEAR) % YEAR) / span);
  const foliage: Record<SeasonName, number> = { spring: 0, summer: 0, autumn: 0, winter: 0 };
  foliage[a.foliage] += 1 - t;
  foliage[b.foliage] += t;
  const ground: Record<GroundSeason, number> = { summer: 0, autumn: 0, dormant: 0 };
  ground[a.ground] += 1 - t;
  ground[b.ground] += t;
  return { foliage, leaves: a.leaves + (b.leaves - a.leaves) * t, ground };
}

/** A blend of the four season colours by `state.foliage`, as linear RGB from linear RGB inputs. */
export function seasonMix(state: SeasonState, colors: Record<SeasonName, [number, number, number]>): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  for (const name of Object.keys(state.foliage) as SeasonName[]) {
    const w = state.foliage[name];
    if (w === 0) continue;
    for (let c = 0; c < 3; c++) out[c]! += colors[name][c]! * w;
  }
  return out;
}
