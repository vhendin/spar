// Another driver's vehicle, as the snapshots they send describe it. Snapshots arrive about 20
// times a second, a little unevenly; the vehicle is drawn DELAY behind the newest, blended
// between the two snapshots either side of that moment, so it moves smoothly even when one
// is late. Past the newest it is carried on at its last velocity for up to AHEAD, then it
// stands still until more arrive.

import type { SnapshotWinch, VehicleSnapshot } from '@spar/shared';

/** How far behind the newest snapshot the vehicle is drawn, milliseconds. */
export const DELAY = 100;
/** Longest a vehicle is carried on past its newest snapshot, milliseconds. */
export const AHEAD = 250;
/** Snapshots older than this behind the drawn moment are dropped, milliseconds. */
const KEEP = 1000;
/**
 * The sender's clock is matched to ours by the quickest a snapshot has ever come through. A
 * slower network later would leave that too optimistic, so the match creeps towards what
 * arrives, this share per snapshot.
 */
const CREEP = 0.01;

export interface Pose {
  p: [number, number, number];
  q: [number, number, number, number];
  /** Velocity, m/s. */
  v: [number, number, number];
  /** Per wheel, as in the snapshot: steer, suspension, sink, spin, skid, slide, water. */
  wheels: number[][];
  /** Per wheel, the ground under it; '' off the ground. */
  ground: string[];
  engine: VehicleSnapshot['engine'];
  wading: number;
  /** Forward speed, m/s (negative backwards). */
  speed: number;
  lights: boolean;
  braking: boolean;
  paused: boolean;
  /** The winch's cable, while it is out. */
  winch?: SnapshotWinch;
}

/** Forward (+z of the body) speed of a velocity under a rotation. */
export function forwardSpeed(q: readonly number[], v: readonly number[]): number {
  const [x, y, z, w] = q as [number, number, number, number];
  const fx = 2 * (x * z + w * y), fy = 2 * (y * z - w * x), fz = 1 - 2 * (x * x + y * y);
  return v[0]! * fx + v[1]! * fy + v[2]! * fz;
}

export class Track {
  private readonly snaps: VehicleSnapshot[] = [];
  /** Our clock minus the sender's, for the quickest snapshot so far (see CREEP). */
  private offset: number | null = null;
  /** Our clock when the last snapshot arrived. */
  heard = -Infinity;
  /** Whose browser sent the snapshots: the driver's own, or one running the vehicle for them. */
  private by = '';

  /** The newest snapshot. */
  get latest(): VehicleSnapshot | undefined {
    return this.snaps.at(-1);
  }

  /**
   * Takes a snapshot as it arrives; `now` is our clock, milliseconds, and `by` whose browser
   * sent it. Another sender has another clock: then it starts afresh.
   */
  push(s: VehicleSnapshot, now: number, by = ''): void {
    if (by !== this.by) {
      this.by = by;
      this.reset();
    }
    const last = this.latest;
    // Put somewhere new: start afresh there, instead of sliding across the map.
    if (last && (s.jump !== last.jump || s.vehicle !== last.vehicle || s.region !== last.region)) this.snaps.length = 0;
    else if (last && s.t <= last.t) return; // late, or twice
    this.heard = now;
    const gap = now - s.t;
    this.offset = this.offset === null || gap < this.offset ? gap : this.offset + (gap - this.offset) * CREEP;
    this.snaps.push(s);
  }

  /** Forgets every snapshot, and the sender's clock. */
  reset(): void {
    this.snaps.length = 0;
    this.offset = null;
  }

  /** Where to draw it at our time `now`, or null before any snapshot. */
  pose(now: number): Pose | null {
    const snaps = this.snaps;
    if (snaps.length === 0 || this.offset === null) return null;
    const t = now - this.offset - DELAY;
    while (snaps.length > 2 && snaps[1]!.t < t - KEEP) snaps.shift();
    const last = snaps.at(-1)!;
    if (t >= last.t) {
      // Carried on at its last velocity a little way, unless the driver has paused.
      const ahead = last.paused ? 0 : Math.min(t - last.t, AHEAD) / 1000;
      return {
        ...shape(last),
        p: [last.p[0]! + last.v[0]! * ahead, last.p[1]! + last.v[1]! * ahead, last.p[2]! + last.v[2]! * ahead],
      };
    }
    if (t <= snaps[0]!.t) return shape(snaps[0]!);
    let i = snaps.length - 2;
    while (i > 0 && snaps[i]!.t > t) i--;
    const a = snaps[i]!, b = snaps[i + 1]!;
    const k = (t - a.t) / (b.t - a.t);
    const lerp = (x: number, y: number): number => x + (y - x) * k;
    // Blend the rotations the short way round.
    const dot = a.q[0]! * b.q[0]! + a.q[1]! * b.q[1]! + a.q[2]! * b.q[2]! + a.q[3]! * b.q[3]!;
    const sign = dot < 0 ? -1 : 1;
    const q = [0, 1, 2, 3].map((j) => lerp(a.q[j]!, b.q[j]! * sign));
    const len = Math.hypot(...q) || 1;
    const near = k < 0.5 ? a : b;
    const winch = near.winch && { ...near.winch, end: near.winch.end.map((x, j) => (a.winch && b.winch ? lerp(a.winch.end[j]!, b.winch.end[j]!) : x)) as SnapshotWinch['end'] };
    return {
      p: [lerp(a.p[0]!, b.p[0]!), lerp(a.p[1]!, b.p[1]!), lerp(a.p[2]!, b.p[2]!)],
      q: [q[0]! / len, q[1]! / len, q[2]! / len, q[3]! / len],
      v: [lerp(a.v[0]!, b.v[0]!), lerp(a.v[1]!, b.v[1]!), lerp(a.v[2]!, b.v[2]!)],
      wheels: a.wheels.map((w, j) => {
        const o = b.wheels[j] ?? w;
        return w.map((x, n) => lerp(x, o[n] ?? x));
      }),
      ground: [...near.ground],
      engine: { ...near.engine, rpm: lerp(a.engine.rpm, b.engine.rpm), pedal: lerp(a.engine.pedal, b.engine.pedal) },
      wading: lerp(a.wading, b.wading),
      speed: lerp(forwardSpeed(a.q, a.v), forwardSpeed(b.q, b.v)),
      lights: near.lights,
      braking: near.braking,
      paused: near.paused,
      ...(winch && { winch }),
    };
  }
}

/** A snapshot as it is drawn. */
export function snapshotPose(s: VehicleSnapshot): Pose {
  return shape(s);
}

function shape(s: VehicleSnapshot): Pose {
  return {
    p: [s.p[0]!, s.p[1]!, s.p[2]!],
    q: [s.q[0]!, s.q[1]!, s.q[2]!, s.q[3]!],
    v: s.paused ? [0, 0, 0] : [s.v[0]!, s.v[1]!, s.v[2]!],
    wheels: s.wheels.map((w) => [...w]),
    ground: [...s.ground],
    engine: { ...s.engine },
    wading: s.wading,
    speed: s.paused ? 0 : forwardSpeed(s.q, s.v),
    lights: s.lights,
    braking: s.braking,
    paused: s.paused,
    ...(s.winch && { winch: s.winch }),
  };
}

/** Rounds to `places` decimals, to keep the message short. */
const round = (x: number, places: number): number => {
  const k = 10 ** places;
  return Math.round(x * k) / k;
};

export interface SnapshotSource {
  def: { name: string };
  body: {
    translation(): { x: number; y: number; z: number };
    rotation(): { x: number; y: number; z: number; w: number };
    linvel(): { x: number; y: number; z: number };
  };
  wheels: readonly { steer: number; suspension: number; sink: number; spin: number; skid: number; slide: number; water: number; contact: boolean; ground: string }[];
  drivetrain: { rpm: number; gear: number; range: string; shifting: number };
  pedal: number;
  drowned: boolean;
  wading: number;
}

/** The snapshot to send of our own vehicle. */
export function takeSnapshot(
  sim: SnapshotSource,
  extra: { region: string; jump: number; t: number; paused: boolean; lights: boolean; braking: boolean; winch?: SnapshotWinch },
): VehicleSnapshot {
  const p = sim.body.translation(), q = sim.body.rotation(), v = sim.body.linvel();
  return {
    region: extra.region,
    vehicle: sim.def.name,
    jump: extra.jump,
    t: round(extra.t, 1),
    paused: extra.paused,
    p: [round(p.x, 3), round(p.y, 3), round(p.z, 3)],
    q: [round(q.x, 5), round(q.y, 5), round(q.z, 5), round(q.w, 5)],
    v: extra.paused ? [0, 0, 0] : [round(v.x, 2), round(v.y, 2), round(v.z, 2)],
    wheels: sim.wheels.map((w) => [
      round(w.steer, 3),
      round(w.suspension, 3),
      round(w.sink, 3),
      round(w.spin, 2),
      round(w.skid, 2),
      round(w.slide, 2),
      round(w.water, 2),
    ]) as VehicleSnapshot['wheels'],
    ground: sim.wheels.map((w) => (w.contact ? w.ground : '')) as VehicleSnapshot['ground'],
    engine: {
      rpm: Math.round(Math.max(0, sim.drivetrain.rpm)),
      gear: sim.drivetrain.gear,
      low: sim.drivetrain.range === 'low',
      shifting: sim.drivetrain.shifting > 0,
      pedal: round(Math.min(1, Math.max(0, sim.pedal)), 2),
      drowned: sim.drowned,
    },
    wading: round(Math.max(0, sim.wading), 2),
    lights: extra.lights,
    braking: extra.braking,
    ...(extra.winch && { winch: extra.winch }),
  };
}
