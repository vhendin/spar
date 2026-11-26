// Trails to drive, made from the map (`importer/spar_importer/trails.py`): stretches of the
// hiking routes and snowmobile trails, power-line corridors and ascents to summits. Stopped at
// either end of one, the driver is offered it (an ascent only from its foot; a snowmobile
// trail only with snow on the ground). On the way there is a checkpoint every few hundred
// metres; strayed too far from the line, a note, and after a few seconds the vehicle is put
// back at the last checkpoint, facing on. The time is kept quietly, for the logbook.

import { TRAILS_KEY, addRun, mergeTrails, readTrails, type Driven, type DrivenByRegion, type TrailLine } from '@spar/shared';

/** Stopped within this many metres of a trail's end, the trail is offered. */
export const TRAIL_REACH = 20;
/** Slower than this (m/s) counts as stopped. */
const STOPPED = 0.6;
/** About this far apart along the line, metres. */
export const CHECKPOINT_EVERY = 300;
/** A checkpoint is passed within this many metres. */
export const CHECKPOINT_REACH = 25;
/** Further than this from the line, metres, is off the trail. */
export const STRAY = 100;
/** Seconds off the trail before being put back. */
export const STRAY_SECONDS = 5;
/** Moved further than this between two looks (put somewhere else): the trail is given up. */
const LEFT = 250;
/** Just finished or given up here: not offered again until this far away. */
const AWAY = 40;
/** Looked at most this often, milliseconds, when not on a trail. */
const EVERY_MS = 250;

export const TRAIL_WORDS: Record<TrailLine['kind'], [string, string]> = {
  hiking: ['hiking route', 'hiking routes'],
  snowmobile: ['snowmobile trail', 'snowmobile trails'],
  power: ['power line', 'power lines'],
  ascent: ['ascent', 'ascents'],
};
const ORDER: TrailLine['kind'][] = ['hiking', 'snowmobile', 'power', 'ascent'];

export interface Checkpoint {
  x: number;
  z: number;
  /** Degrees, 0 north (towards −z), 90 east: along the trail. */
  heading: number;
  /** Metres along the line. */
  at: number;
}

/** Where a trail can be set off from: either end, an ascent from the bottom only; facing along it. */
export interface TrailEnd {
  x: number;
  z: number;
  /** Degrees, 0 north, 90 east: along the trail. */
  heading: number;
  /** The far end, set off from towards the start. */
  reversed: boolean;
}

export function trailEnds(t: TrailLine): TrailEnd[] {
  const ends = t.kind === 'ascent' ? [false] : [false, true];
  return ends.map((reversed) => {
    const points = reversed ? [...t.points].reverse() : t.points;
    const [x, z] = points[0]!;
    // Aimed at a point a little way on, so a kink at the very end does not turn it.
    let [ax, az] = points[points.length - 1]!;
    for (const p of points) {
      if (Math.hypot(p[0]! - x!, p[1]! - z!) >= AIM) {
        [ax, az] = p;
        break;
      }
    }
    const heading = ((Math.atan2(ax! - x!, -(az! - z!)) * 180) / Math.PI + 360) % 360;
    return { x: x!, z: z!, heading: Math.round(heading * 10) / 10, reversed };
  });
}
/** Metres along the trail its end faces towards. */
const AIM = 25;

/** A trail as driven one way. */
export interface Course {
  trail: TrailLine;
  reversed: boolean;
  points: number[][];
  /** Metres along the line at each point. */
  along: number[];
  /** The first is the start, the last the end. */
  checkpoints: Checkpoint[];
}

export type TrailOffer =
  | { kind: 'none' }
  /** Stopped at its start: J to drive it. */
  | { kind: 'offer'; trail: TrailLine; reversed: boolean }
  /** On the way: the checkpoint next, of how many; `astray` the seconds left before being put back. */
  | { kind: 'running'; trail: TrailLine; next: number; of: number; astray: number | null };

export type TrailEvent =
  | { kind: 'checkpoint'; n: number; of: number }
  | { kind: 'finished'; trail: TrailLine; seconds: number; driven: Driven; best: boolean }
  | { kind: 'putBack'; x: number; z: number; heading: number }
  | { kind: 'lost' };

export interface RunInfo {
  vehicle: string;
  date: string;
  season: string;
}

export interface TrailsSummary {
  driven: number;
  total: number;
  kinds: { kind: TrailLine['kind']; words: [string, string]; driven: number; total: number }[];
  list: { name: string; kind: TrailLine['kind']; length: number; best: number; runs: number; date: string; vehicle: string; last: number }[];
}

/** Degrees from a to b, 0 north (towards −z), 90 east. */
const headingOf = (ax: number, az: number, bx: number, bz: number): number => ((Math.atan2(bx - ax, -(bz - az)) * 180) / Math.PI + 360) % 360;

/** The trail laid out for driving one way: the line, distances along it, and its checkpoints. */
export function course(trail: TrailLine, reversed: boolean): Course {
  const points = reversed ? [...trail.points].reverse() : trail.points;
  const along = [0];
  for (let k = 1; k < points.length; k++) along.push(along[k - 1]! + Math.hypot(points[k]![0]! - points[k - 1]![0]!, points[k]![1]! - points[k - 1]![1]!));
  const total = along[along.length - 1]!;
  const n = Math.max(1, Math.round(total / CHECKPOINT_EVERY));
  const checkpoints: Checkpoint[] = [];
  let k = 0;
  for (let i = 0; i <= n; i++) {
    const d = (total * i) / n;
    while (k + 2 < points.length && along[k + 1]! < d) k++;
    const a = points[k]!, b = points[k + 1] ?? a;
    const len = along[k + 1]! - along[k]! || 1;
    const t = Math.max(0, Math.min(1, (d - along[k]!) / len));
    checkpoints.push({ x: a[0]! + (b[0]! - a[0]!) * t, z: a[1]! + (b[1]! - a[1]!) * t, heading: headingOf(a[0]!, a[1]!, b[0]!, b[1]!), at: d });
  }
  return { trail, reversed, points, along, checkpoints };
}

/** Distance from (x, z) to the part of the line between `from` and `to` metres along it. */
export function offLine(c: Course, x: number, z: number, from: number, to: number): number {
  let best = Infinity;
  for (let k = 0; k + 1 < c.points.length; k++) {
    if (c.along[k + 1]! < from || c.along[k]! > to) continue;
    const a = c.points[k]!, b = c.points[k + 1]!;
    const dx = b[0]! - a[0]!, dz = b[1]! - a[1]!;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]!) * dx + (z - a[1]!) * dz) / len2)) : 0;
    best = Math.min(best, Math.hypot(a[0]! + dx * t - x, a[1]! + dz * t - z));
  }
  return best;
}

interface Run {
  course: Course;
  /** The checkpoint to reach next (1 to the last). */
  next: number;
  seconds: number;
  /** Seconds spent off the line just now, or null when on it. */
  astray: number | null;
  lastX: number;
  lastZ: number;
}

export class Trails {
  readonly lines: TrailLine[];
  private all: DrivenByRegion;
  private run: Run | null = null;
  /** Where a trail was last finished or given up: not offered again until driven away. */
  private restedAt: { x: number; z: number } | null = null;
  private lookedAt = -Infinity;
  private lastOffer: TrailOffer = { kind: 'none' };
  /** The trail gone to from the map, offered first while at its end. */
  private chosen: Extract<TrailOffer, { kind: 'offer' }> | null = null;
  /** Rises with every finish, so the map knows to draw again. */
  version = 0;

  constructor(private readonly region: string, trails: readonly TrailLine[]) {
    this.lines = [...trails];
    this.all = readTrails(read(TRAILS_KEY));
  }

  private get here(): Record<string, Driven> {
    return this.all[this.region] ?? {};
  }

  /** Whether a trail can be driven now: a snowmobile trail only with snow on the ground. */
  static open(t: TrailLine, winter: boolean): boolean {
    return t.kind !== 'snowmobile' || winter;
  }

  /** The trail on the way, if any. */
  get current(): Course | null {
    return this.run?.course ?? null;
  }

  /** The checkpoint to reach next, if on a trail. */
  get nextCheckpoint(): Checkpoint | null {
    const r = this.run;
    return r ? r.course.checkpoints[r.next]! : null;
  }

  /** The quickest time of each trail driven to the end here, seconds. */
  bests(): Map<string, number> {
    return new Map(Object.entries(this.here).map(([id, d]) => [id, d.best]));
  }

  /**
   * Put at a trail's end on purpose (the map's trail list): any trail on the way is dropped, and
   * that trail is offered at once, before any other starting at the same spot.
   */
  goTo(trail: TrailLine, reversed: boolean): void {
    this.run = null;
    this.restedAt = null;
    this.lookedAt = -Infinity;
    this.chosen = { kind: 'offer', trail, reversed };
  }

  /** The ids of the trails driven to the end here. */
  driven(): Set<string> {
    return new Set(Object.keys(this.here));
  }

  /** What to offer or show now, for a driver at (x, z) going `speed` m/s; `winter` with snow on the ground. */
  offer(now: number, x: number, z: number, speed: number, winter: boolean): TrailOffer {
    const r = this.run;
    if (r) return { kind: 'running', trail: r.course.trail, next: r.next, of: r.course.checkpoints.length - 1, astray: r.astray === null ? null : Math.max(0, STRAY_SECONDS - r.astray) };
    if (now - this.lookedAt < EVERY_MS) return this.lastOffer;
    this.lookedAt = now;
    const rested = this.restedAt;
    if (rested && Math.hypot(rested.x - x, rested.z - z) > AWAY) this.restedAt = null;
    this.lastOffer = this.restedAt || Math.abs(speed) > STOPPED ? { kind: 'none' } : this.nearest(x, z, winter);
    return this.lastOffer;
  }

  private nearest(x: number, z: number, winter: boolean): TrailOffer {
    const c = this.chosen;
    if (c) {
      const [ex, ez] = c.reversed ? c.trail.points[c.trail.points.length - 1]! : c.trail.points[0]!;
      const d = Math.hypot(ex! - x, ez! - z);
      if (d <= TRAIL_REACH && Trails.open(c.trail, winter)) return c;
      if (d > AWAY) this.chosen = null;
    }
    let best: TrailOffer = { kind: 'none' }, bestD = TRAIL_REACH;
    for (const t of this.lines) {
      if (!Trails.open(t, winter)) continue;
      // An ascent goes up only.
      const ends: [number[], boolean][] = t.kind === 'ascent' ? [[t.points[0]!, false]] : [[t.points[0]!, false], [t.points[t.points.length - 1]!, true]];
      for (const [p, reversed] of ends) {
        if (Math.abs(p[0]! - x) > bestD || Math.abs(p[1]! - z) > bestD) continue;
        const d = Math.hypot(p[0]! - x, p[1]! - z);
        if (d <= bestD) {
          bestD = d;
          best = { kind: 'offer', trail: t, reversed };
        }
      }
    }
    return best;
  }

  /** Sets off on the trail offered; returns its first checkpoint. */
  start(trail: TrailLine, reversed: boolean, x: number, z: number): Course {
    const c = course(trail, reversed);
    this.chosen = null;
    this.run = { course: c, next: 1, seconds: 0, astray: null, lastX: x, lastZ: z };
    this.lastOffer = { kind: 'none' };
    return c;
  }

  /** Gives the trail up where it is. */
  giveUp(x: number, z: number): void {
    this.run = null;
    this.restedAt = { x, z };
  }

  /** Call every frame while driving (not flying, not paused, not on the map). */
  update(dt: number, x: number, z: number, info: () => RunInfo): TrailEvent | null {
    const r = this.run;
    if (!r) return null;
    if (Math.hypot(x - r.lastX, z - r.lastZ) > LEFT) {
      // Put somewhere else (a start point, the map): the trail is left behind.
      this.giveUp(x, z);
      return { kind: 'lost' };
    }
    r.lastX = x;
    r.lastZ = z;
    r.seconds += dt;
    const c = r.course, cps = c.checkpoints;
    // The next one, or one a little further on if it was cut past.
    for (let k = Math.min(cps.length - 1, r.next + 2); k >= r.next; k--) {
      const cp = cps[k]!;
      if (Math.hypot(cp.x - x, cp.z - z) <= CHECKPOINT_REACH) {
        r.next = k + 1;
        r.astray = null;
        if (r.next >= cps.length) return this.finish(info);
        return { kind: 'checkpoint', n: k, of: cps.length - 1 };
      }
    }
    const last = cps[r.next - 1]!, next = cps[r.next]!;
    const off = offLine(c, x, z, last.at - CHECKPOINT_EVERY / 2, next.at + CHECKPOINT_EVERY / 2);
    if (off <= STRAY) {
      r.astray = null;
      return null;
    }
    r.astray = (r.astray ?? 0) + dt;
    if (r.astray < STRAY_SECONDS) return null;
    // Back at the last checkpoint, facing on; the clock runs on.
    r.astray = null;
    r.lastX = last.x;
    r.lastZ = last.z;
    return { kind: 'putBack', x: last.x, z: last.z, heading: last.heading };
  }

  private finish(info: () => RunInfo): TrailEvent {
    const r = this.run!;
    const t = r.course.trail;
    const end = r.course.checkpoints[r.course.checkpoints.length - 1]!;
    this.run = null;
    this.restedAt = { x: end.x, z: end.z };
    const seconds = Math.round(r.seconds);
    // Together with what another tab may have kept meanwhile.
    this.all = readTrails(mergeTrails(read(TRAILS_KEY), JSON.stringify(this.all)));
    const before = this.all[this.region]?.[t.id];
    const driven = addRun(before, { at: Date.now(), seconds, ...info() });
    (this.all[this.region] ??= {})[t.id] = driven;
    write(TRAILS_KEY, JSON.stringify(this.all));
    this.version++;
    return { kind: 'finished', trail: t, seconds, driven, best: !!before && seconds < before.best };
  }

  /** The logbook's tally: driven of each kind, and each trail driven with its best time. */
  summary(): TrailsSummary {
    const here = this.here;
    const kinds = ORDER.map((kind) => {
      const of = this.lines.filter((t) => t.kind === kind);
      return { kind, words: TRAIL_WORDS[kind], driven: of.filter((t) => t.id in here).length, total: of.length };
    }).filter((k) => k.total > 0);
    const list = this.lines
      .filter((t) => t.id in here)
      .map((t) => {
        const d = here[t.id]!;
        return { name: t.name, kind: t.kind, length: t.length, best: d.best, runs: d.runs, date: d.date, vehicle: d.vehicle, last: d.last };
      })
      .sort((a, b) => a.last - b.last);
    return { driven: list.length, total: this.lines.length, kinds, list };
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not kept.
  }
}
