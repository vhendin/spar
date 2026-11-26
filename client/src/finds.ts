// Small things found while driving: summer farms, waterfalls, springs, historic places, fords,
// passes and the shores of named lakes. Quieter than the destinations: no trip and no clock,
// only a line on the screen when reached, a mark on the map and a tally in the logbook. Also
// keeps the highest ground reached in each region. Both are kept in the browser and go with
// the account (`account.ts`).

import { FINDS_KEY, HIGHEST_KEY, mergeFinds, readFinds, readHighest, type FindPoint, type Found, type FoundByRegion, type Highest, type HighestByRegion, type Lake } from '@spar/shared';

/** Something to find, from the region's finds and its named lakes. */
export interface Findable {
  /** The find's OpenStreetMap id; for a lake `lake:` and its name (a lake cut in parts is one). */
  id: string;
  kind: FindPoint['kind'] | 'lake';
  what?: string;
  name: string;
  x: number;
  z: number;
}

/** How close counts as reached, metres: you drive through a ford; a pass is a wide saddle. */
export const REACH: Record<Findable['kind'], number> = {
  farm: 30, waterfall: 30, rapids: 30, spring: 30, historic: 30, ford: 10, pass: 60, lake: 15,
};
/** What each kind is called in the logbook, one and many. */
export const KIND_WORDS: Record<Findable['kind'], [string, string]> = {
  farm: ['summer farm', 'summer farms'],
  waterfall: ['waterfall', 'waterfalls'],
  rapids: ['rapids', 'rapids'],
  spring: ['spring', 'springs'],
  historic: ['historic place', 'historic places'],
  pass: ['pass', 'passes'],
  ford: ['ford', 'fords'],
  lake: ['lake', 'lakes'],
};
/** In this order in the logbook. */
const ORDER: Findable['kind'][] = ['farm', 'waterfall', 'rapids', 'spring', 'historic', 'pass', 'ford', 'lake'];

/** Milliseconds between looks round for something reached. */
const EVERY_MS = 250;
/** The highest point is kept when it has risen this much, metres, at most every SAVE_MS. */
const RISE = 1;
const SAVE_MS = 10_000;

interface LakeShape {
  id: string;
  /** Bounding box, with the reach added. */
  box: [number, number, number, number];
  outlines: number[][][];
}

export interface FindsSummary {
  kinds: { kind: Findable['kind']; words: [string, string]; found: number; total: number }[];
  found: { name: string; kind: Findable['kind']; date: string; vehicle: string; at: number }[];
  highest: Highest | null;
}

/** On arrival: what it is and what it is called. */
export interface FoundNow {
  name: string;
  kind: Findable['kind'];
  /** The word for it ("summer farm", "boundary stone"). */
  what: string;
}

const WHAT_WORDS: Record<string, string> = {
  boundary_stone: 'boundary stone', memorial: 'memorial', monument: 'monument', aircraft_wreck: 'aircraft wreck',
  mine: 'old mine', ruins: 'ruins', tomb: 'grave', wayside_cross: 'wayside cross', cairn: 'cairn',
};

/** The things to find in a region: its finds, and each named lake once. */
export function findables(finds: readonly FindPoint[], lakes: readonly Lake[]): { points: Findable[]; lakes: LakeShape[] } {
  const points: Findable[] = finds.map((f) => ({ id: f.id, kind: f.kind, ...(f.what ? { what: f.what } : {}), name: f.name, x: f.x, z: f.z }));
  const byName = new Map<string, LakeShape>();
  const reach = REACH.lake;
  for (const l of lakes) {
    if (!l.name || l.outline.length < 3) continue;
    const id = `lake:${l.name}`;
    let shape = byName.get(id);
    if (!shape) {
      shape = { id, box: [Infinity, Infinity, -Infinity, -Infinity], outlines: [] };
      byName.set(id, shape);
      // Marked on the map at the middle of its first part.
      const xs = l.outline.map((p) => p[0]!), zs = l.outline.map((p) => p[1]!);
      points.push({ id, kind: 'lake', name: l.name, x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2 });
    }
    shape.outlines.push(l.outline as number[][]);
    for (const [x, z] of l.outline as number[][]) {
      shape.box[0] = Math.min(shape.box[0], x! - reach);
      shape.box[1] = Math.min(shape.box[1], z! - reach);
      shape.box[2] = Math.max(shape.box[2], x! + reach);
      shape.box[3] = Math.max(shape.box[3], z! + reach);
    }
  }
  return { points, lakes: [...byName.values()] };
}

/** Whether (x, z) is in a lake or within `reach` metres of its shore. */
export function atShore(outlines: readonly number[][][], x: number, z: number, reach: number): boolean {
  for (const outline of outlines) {
    let inside = false;
    for (let k = 0, m = outline.length - 1; k < outline.length; m = k++) {
      const ax = outline[m]![0]!, az = outline[m]![1]!, bx = outline[k]![0]!, bz = outline[k]![1]!;
      if (az > z !== bz > z && x < ax + ((z - az) * (bx - ax)) / (bz - az)) inside = !inside;
      const dx = bx - ax, dz = bz - az;
      const len2 = dx * dx + dz * dz;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
      if (Math.hypot(ax + t * dx - x, az + t * dz - z) <= reach) return true;
    }
    if (inside) return true;
  }
  return false;
}

/** What the driver is in, and when, for what is found. */
export interface FindInfo {
  vehicle: string;
  date: string;
  season: string;
}

export class Finds {
  readonly points: Findable[];
  private readonly lakes: LakeShape[];
  private readonly byId = new Map<string, Findable>();
  private all: FoundByRegion;
  private highestAll: HighestByRegion;
  private lastAt = -Infinity;
  private highSavedAt = -Infinity;
  private highDirty = false;
  /** Rises with every new find, so the map knows to draw again. */
  version = 0;

  constructor(private readonly region: string, finds: readonly FindPoint[], lakes: readonly Lake[]) {
    const f = findables(finds, lakes);
    this.points = f.points;
    this.lakes = f.lakes;
    for (const p of this.points) this.byId.set(p.id, p);
    this.all = readFinds(read(FINDS_KEY));
    this.highestAll = readHighest(read(HIGHEST_KEY));
  }

  private get here(): Record<string, Found> {
    return this.all[this.region] ?? {};
  }

  /** Whether a find (by id) has been found. */
  has(id: string): boolean {
    return id in this.here;
  }

  /** The ids found in this region. */
  found(): Set<string> {
    return new Set(Object.keys(this.here));
  }

  /**
   * Call every frame while driving (not flying, not paused) with where the vehicle is and the
   * height of the ground under it. Returns what was found just now, if anything.
   */
  update(now: number, x: number, z: number, ground: number | null, info: () => FindInfo): FoundNow[] {
    if (now - this.lastAt < EVERY_MS) return [];
    this.lastAt = now;
    const out: FoundNow[] = [];
    if (ground !== null) this.climb(now, ground, info);
    const here = this.here;
    for (const p of this.points) {
      if (p.id in here || p.kind === 'lake') continue;
      if (Math.abs(p.x - x) > REACH[p.kind] || Math.abs(p.z - z) > REACH[p.kind]) continue;
      if (Math.hypot(p.x - x, p.z - z) <= REACH[p.kind]) out.push(this.find(p, info));
    }
    for (const l of this.lakes) {
      if (l.id in here || x < l.box[0] || z < l.box[1] || x > l.box[2] || z > l.box[3]) continue;
      if (atShore(l.outlines, x, z, REACH.lake)) out.push(this.find(this.byId.get(l.id)!, info));
    }
    if (out.length) {
      // Together with what another tab may have found meanwhile.
      this.all = readFinds(mergeFinds(read(FINDS_KEY), JSON.stringify(this.all)));
      write(FINDS_KEY, JSON.stringify(this.all));
      this.version++;
    }
    return out;
  }

  private find(p: Findable, info: () => FindInfo): FoundNow {
    const i = info();
    (this.all[this.region] ??= {})[p.id] = { at: Date.now(), vehicle: i.vehicle, date: i.date, season: i.season };
    const what = p.kind === 'historic' ? (WHAT_WORDS[p.what ?? ''] ?? 'historic place') : KIND_WORDS[p.kind][0];
    return { name: p.name, kind: p.kind, what };
  }

  private climb(now: number, ground: number, info: () => FindInfo): void {
    const best = this.highestAll[this.region];
    if (best && ground < best.ele + RISE) {
      if (this.highDirty && now - this.highSavedAt >= SAVE_MS) this.saveHighest(now);
      return;
    }
    const i = info();
    this.highestAll[this.region] = { ele: Math.round(ground), vehicle: i.vehicle, date: i.date, at: Date.now() };
    this.highDirty = true;
    if (now - this.highSavedAt >= SAVE_MS) this.saveHighest(now);
  }

  private saveHighest(now: number): void {
    const kept = readHighest(read(HIGHEST_KEY));
    const mine = this.highestAll[this.region], theirs = kept[this.region];
    if (mine && (!theirs || mine.ele > theirs.ele)) kept[this.region] = mine;
    this.highestAll = kept;
    write(HIGHEST_KEY, JSON.stringify(kept));
    this.highSavedAt = now;
    this.highDirty = false;
  }

  /** Keeps the highest point now (leaving the page, say). */
  save(): void {
    if (this.highDirty) this.saveHighest(performance.now());
  }

  /** The logbook's tally: found of each kind, what was found, and the highest point. */
  summary(): FindsSummary {
    const here = this.here;
    const kinds = ORDER.map((kind) => {
      const of = this.points.filter((p) => p.kind === kind);
      return { kind, words: KIND_WORDS[kind], found: of.filter((p) => p.id in here).length, total: of.length };
    }).filter((k) => k.total > 0);
    const found = this.points
      .filter((p) => p.id in here)
      .map((p) => ({ name: p.name, kind: p.kind, date: here[p.id]!.date, vehicle: here[p.id]!.vehicle, at: here[p.id]!.at }))
      .sort((a, b) => a.at - b.at);
    return { kinds, found, highest: this.highestAll[this.region] ?? null };
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
    // Not kept: found again next time.
  }
}
