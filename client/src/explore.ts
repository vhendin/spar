// Seeing the region as you go: looks round from the vehicle (or the drone) every so often and
// marks what is in sight on the map; arriving on a summit, at a viewpoint or a lift top looks
// much further. What has been seen is kept per region in the browser, and goes with the
// account (`account.ts`); see `ui/seen.ts` for the looking itself.

import { SEEN_PREFIX } from '@spar/shared';
import type { MapScreen } from './ui/map';
import { rayCount } from './ui/seen';

/** How far sight reaches while driving, and from a summit, viewpoint or lift top. */
export const RANGE = 1500;
export const LOOKOUT_RANGE = 5000;
/** Metres moved before looking round again, and the least time between looks. */
const MOVED = 25;
const EVERY_MS = 1000;
/** Close enough to a lookout to count as standing on it (as arriving at a destination). */
const ON_TOP = 30;
/** Height of the driver's eyes over the ground, in metres. */
export const EYE = 2.5;
/** Seen around each place already in the logbook, the first time a region is seen at all. */
const AROUND_REACHED = 300;
/** Kept in storage at most this often while things are being seen. */
const SAVE_MS = 10_000;
/** Milliseconds of looking a frame may take; a longer look goes on in the next frames. */
const BUDGET_MS = 2;
/** Rays done between looks at the clock. */
const BATCH = 64;
/** Kinds of place that are lookouts. */
const LOOKOUTS = new Set(['peak', 'viewpoint', 'lift']);

interface Point {
  x: number;
  z: number;
}

/** A look under way: from where, and the next ray to walk. */
interface Look extends Point {
  eye: number;
  range: number;
  next: number;
  rays: number;
}

interface Place extends Point {
  id: string;
  kind: string;
  name: string;
}

export class Explorer {
  private readonly key: string;
  private last: Point | null = null;
  private lastAt = -Infinity;
  private savedVersion: number;
  private savedAt = 0;
  private readonly lookouts: Place[];
  /** Looks still to be finished, oldest first. */
  private readonly looks: Look[] = [];
  /** Lookouts already looked out from this visit. */
  private readonly onTop = new Set<string>();
  /** Nothing to do: the proving ground is always seen whole. */
  private readonly off: boolean;

  /**
   * `flag` is the `?seen=` of the address: `none` forgets what was seen here, `all` sees all.
   * `reached` places (by name) are seen round about when nothing has been kept yet.
   */
  constructor(private readonly map: MapScreen, region: string, places: Place[], reached: Set<string>, flag: string | null) {
    this.key = SEEN_PREFIX + region;
    this.off = region === 'proving';
    this.lookouts = places.filter((p) => LOOKOUTS.has(p.kind));
    const grid = map.seen;
    let kept = false;
    if (this.off) grid.fill();
    else if (flag === 'all') grid.fill();
    else if (flag === 'none') this.store(null);
    else kept = grid.load(this.read());
    if (!kept && !this.off && flag !== 'all') for (const p of places) if (reached.has(p.name)) grid.markCircle(p.x, p.z, AROUND_REACHED);
    // Saved at the first chance unless it is just as it was kept.
    this.savedVersion = kept ? grid.version : -1;
  }

  /**
   * Call every frame with where the eyes are: their height above sea level, over (x, z).
   * Looks round when they have moved far enough, and far round on a lookout.
   */
  update(now: number, x: number, z: number, eye: number): void {
    if (this.off || !this.map.ready) return;
    const moved = this.last ? Math.hypot(x - this.last.x, z - this.last.z) : Infinity;
    // A new look waits until the last is done, so they never pile up.
    if (moved >= MOVED && now - this.lastAt >= EVERY_MS && this.looks.length === 0) {
      this.begin(x, z, eye, RANGE);
      this.last = { x, z };
      this.lastAt = now;
    }
    for (const p of this.lookouts) {
      if (this.onTop.has(p.id) || Math.hypot(p.x - x, p.z - z) > ON_TOP) continue;
      this.onTop.add(p.id);
      this.begin(x, z, eye, LOOKOUT_RANGE);
    }
    this.work();
    if (this.map.seen.version !== this.savedVersion && now - this.savedAt >= SAVE_MS) this.save(now);
  }

  private begin(x: number, z: number, eye: number, range: number): void {
    this.looks.push({ x, z, eye, range, next: 0, rays: rayCount(range) });
  }

  /** Walks rays of the looks under way for as long as this frame allows. */
  private work(): void {
    const until = performance.now() + BUDGET_MS;
    while (this.looks.length && performance.now() < until) {
      const l = this.looks[0]!;
      const to = Math.min(l.rays, l.next + BATCH);
      this.map.look(l.x, l.z, l.eye, l.range, l.next, to);
      l.next = to;
      if (to >= l.rays) this.looks.shift();
    }
  }

  /** Keeps what has been seen now (leaving the page, say), if anything new was. */
  save(now = performance.now()): void {
    if (this.off || this.map.seen.version === this.savedVersion) return;
    this.store(this.map.seen.save());
    this.savedVersion = this.map.seen.version;
    this.savedAt = now;
  }

  private read(): string | null {
    try {
      return localStorage.getItem(this.key);
    } catch {
      return null;
    }
  }

  private store(text: string | null): void {
    try {
      if (text === null) localStorage.removeItem(this.key);
      else localStorage.setItem(this.key, text);
    } catch {
      // Not kept; seen again next time.
    }
  }
}
