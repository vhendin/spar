// How strong the northern lights are at a moment. Made up, but the same for everyone: each
// night gets its own strength from its date, most nights weak and a few strong, with slow
// surges through the evening and the biggest burst around midnight, as substorms do.
//
// Whether they can be seen (dark enough, clear enough, far enough north) is the client's
// business; this is only what is going on up there.

import { hash32 } from '../rng';

const HOUR = 3600000;
const DAY = 24 * HOUR;

/** 0 quiet to 1 a great storm, at a UTC instant (ms) on clocks `utcOffset` hours ahead. */
export function auroraActivity(utcMs: number, utcOffset: number): number {
  const local = utcMs + utcOffset * HOUR;
  // A night runs from noon to noon, so it keeps one strength across midnight.
  const night = Math.floor((local - 12 * HOUR) / DAY);
  const hour = (((local / HOUR) % 24) + 24) % 24;
  const roll = (hash32(night, 0xa0) >>> 0) / 4294967296;
  const base = roll ** 2.2;
  // Surges every forty minutes or so, out of step from night to night.
  const phase = ((hash32(night, 0xa1) >>> 0) / 4294967296) * Math.PI * 2;
  const t = utcMs / HOUR;
  const surge = 0.55 + 0.25 * Math.sin(t * 9.4 + phase) + 0.2 * Math.sin(t * 3.1 + phase * 2.3);
  // Hours from midnight, either side.
  const fromMidnight = Math.min(Math.abs(hour - 23.5), 24 - Math.abs(hour - 23.5));
  const burst = Math.exp(-((fromMidnight / 1.4) ** 2));
  return Math.min(1, base * (surge + 0.7 * burst));
}
