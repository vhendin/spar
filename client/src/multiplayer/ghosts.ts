// Made-up drivers for trying how the game copes with company (?ghosts=4): each follows our
// own vehicle's track a set distance behind, sent through the same path as a real driver's
// snapshots, so their vehicles, effects, sounds and lights cost what a real one does.

import type { Player, VehicleSnapshot } from '@spar/shared';

/** Metres of our track between one ghost and the next. */
const GAP = 14;
const PAINTS = ['#b0472c', '#2c6fb0', '#2f6f4f', '#c28a12', '#7a3d8f', '#5a3c26', '#8e3b2d', '#3f86c2'];

export class Ghosts {
  readonly players: Player[];
  /** Our snapshots with the distance driven when each was taken, oldest first. */
  private readonly past: { s: VehicleSnapshot; along: number }[] = [];
  private along = 0;

  constructor(count: number, region: string) {
    this.players = Array.from({ length: Math.min(8, Math.max(0, count)) }, (_, i) => ({
      id: `ghost${i + 1}`,
      name: `Ghost ${i + 1}`,
      color: PAINTS[i % PAINTS.length]!,
      region,
    }));
  }

  /**
   * Our own snapshot as sent; gives back each ghost's, taken where we were GAP, 2 GAP… metres
   * ago, with the time now. Nothing until we have driven far enough for them to have a place.
   */
  follow(s: VehicleSnapshot, now: number): { id: string; snapshot: VehicleSnapshot }[] {
    const last = this.past.at(-1);
    if (last && s.jump !== last.s.jump) {
      // Put somewhere new: they start again from there.
      this.past.length = 0;
      this.along = 0;
    } else if (last) {
      this.along += Math.hypot(s.p[0]! - last.s.p[0]!, s.p[2]! - last.s.p[2]!);
    }
    this.past.push({ s, along: this.along });
    const keep = this.along - (this.players.length + 1) * GAP;
    while (this.past.length > 2 && this.past[1]!.along < keep) this.past.shift();
    const out: { id: string; snapshot: VehicleSnapshot }[] = [];
    this.players.forEach((p, i) => {
      const at = this.along - (i + 1) * GAP;
      if (at < 0) return;
      let found = this.past[0]!;
      for (const e of this.past) {
        if (e.along > at) break;
        found = e;
      }
      // Our winch cable stays ours.
      const snapshot: VehicleSnapshot = { ...found.s, t: now };
      delete snapshot.winch;
      // Our drone, though, they copy, flying beside it, so others' drones can be tried alone.
      if (s.drone) snapshot.drone = [s.drone[0]! + 4 * (i + 1), s.drone[1]! + 1, s.drone[2]!, s.drone[3]!];
      else delete snapshot.drone;
      out.push({ id: p.id, snapshot });
    });
    return out;
  }
}
