/// <reference lib="webworker" />
// Features worker: builds the man-made objects of one tile on the finest ground heights.

import type { RegionIndex } from '@spar/shared';
import { fetchUint16, heightFileUrl } from '../terrain/region';
import { buildTile, LIFT_DEFS, type BuiltTile } from './build';
import { OBJECTS } from './defs';
import { assignToTiles, tileKey, type FeatureVectors, type TileJob } from './layout';

export type FeatureRequest =
  | { kind: 'init'; index: RegionIndex; vectors: FeatureVectors; seed: number; glow?: string[] }
  | { kind: 'tile'; id: number; tx: number; tz: number };

export type FeatureResponse =
  /** The tiles with anything in them, each with the farthest any of its objects is drawn. */
  | { kind: 'ready'; tiles: [string, number][] }
  | { kind: 'tile'; id: number; ok: true; tile: BuiltTile }
  | { kind: 'tile'; id: number; ok: false; error: string };

let index: RegionIndex;
let seed = 0;
/** Buildings whose windows and chimney are marked for lighting at a camp. */
let glow: ReadonlySet<string> = new Set();
let jobs = new Map<string, TileJob>();
const files = new Map<string, Promise<Uint16Array>>();

/** Every point a tile's objects stand on, to know which height files to load. */
function extent(job: TileJob): [number, number, number, number] {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  const add = (x: number, z: number): void => {
    x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z);
  };
  for (const b of job.buildings) for (const p of b.outline) add(p[0], p[1]);
  for (const f of job.fences) for (const p of f.points) add(p[0]!, p[1]!);
  for (const { line, poles } of job.power) {
    for (const k of poles) for (const j of [k - 1, k, k + 1]) if (line.points[j]) add(line.points[j][0], line.points[j][1]);
  }
  for (const o of job.objects) add(o.x, o.z);
  // Slanting rails and log piles reach a little past their points.
  const pad = 30;
  return [x0 - pad, z0 - pad, x1 + pad, z1 + pad];
}

/**
 * Points along every lift through the tile, end to end: its towers are placed from the ground
 * along the whole line, so each tile it crosses needs all of it to agree on where they stand.
 */
function liftPoints(job: TileJob): [number, number][] {
  const out: [number, number][] = [];
  for (const { lift } of job.lifts) {
    for (let k = 0; k + 1 < lift.points.length; k++) {
      const a = lift.points[k]!, b = lift.points[k + 1]!;
      const steps = Math.max(1, Math.ceil(Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!) / 32));
      for (let s = 0; s <= steps; s++) out.push([a[0]! + ((b[0]! - a[0]!) * s) / steps, a[1]! + ((b[1]! - a[1]!) * s) / steps]);
    }
  }
  return out;
}

/** The farthest any object in the tile is drawn. */
function reach(job: TileJob): number {
  const range = (name: string | undefined): number => (name && OBJECTS[name]?.range) || 0;
  let r = 0;
  if (job.buildings.length) r = Math.max(r, range('building'));
  if (job.power.length) r = Math.max(r, range('power_pole'));
  for (const f of job.fences) r = Math.max(r, range(f.kind));
  for (const o of job.objects) r = Math.max(r, range(o.kind));
  for (const { lift } of job.lifts) r = Math.max(r, range(LIFT_DEFS[lift.kind]));
  return r || 500;
}

async function build(tx: number, tz: number): Promise<BuiltTile> {
  const job = jobs.get(tileKey(tx, tz));
  if (!job) return { parts: [], solids: [], spots: [], low: 0, high: 0 };
  const h = index.heights;
  const level = h.levels[0]!;
  const side = h.samples + 2 * h.apron;
  const fileOf = (v: number): number => Math.min(level.count - 1, Math.max(0, Math.floor(v / level.span)));
  const [x0, z0, x1, z1] = extent(job);
  const wanted = new Set<string>();
  if (x0 <= x1) for (let fz = fileOf(z0); fz <= fileOf(z1); fz++) for (let fx = fileOf(x0); fx <= fileOf(x1); fx++) wanted.add(`${fx},${fz}`);
  for (const [x, z] of liftPoints(job)) for (const [ox, oz] of [[-30, -30], [30, -30], [30, 30], [-30, 30]] as const) wanted.add(`${fileOf(x + ox)},${fileOf(z + oz)}`);
  const loaded = new Map<string, Uint16Array>();
  const waits: Promise<void>[] = [];
  for (const key of wanted) {
    const [fx, fz] = key.split(',').map(Number) as [number, number];
    const url = heightFileUrl(index, level.level, fx, fz);
    let file = files.get(url);
    if (!file) {
      file = fetchUint16(url, side * side);
      file.catch(() => files.delete(url));
      files.set(url, file);
      if (files.size > 64) files.delete(files.keys().next().value!);
    }
    waits.push(file.then((data) => void loaded.set(key, data)));
  }
  await Promise.all(waits);

  const ground = (x: number, z: number): number => {
    const fx = fileOf(x), fz = fileOf(z);
    const data = loaded.get(`${fx},${fz}`);
    if (!data) return h.min;
    const last = h.samples - 1;
    const u = Math.min(last, Math.max(0, (x - fx * level.span) / level.spacing));
    const v = Math.min(last, Math.max(0, (z - fz * level.span) / level.spacing));
    const i = Math.min(last - 1, Math.floor(u)), j = Math.min(last - 1, Math.floor(v));
    const fu = u - i, fv = v - j;
    const at = (j + h.apron) * side + i + h.apron;
    const top = data[at]! * (1 - fu) + data[at + 1]! * fu;
    const bottom = data[at + side]! * (1 - fu) + data[at + side + 1]! * fu;
    return h.encoding.offset + (top * (1 - fv) + bottom * fv) * h.encoding.scale;
  };
  return buildTile(job, OBJECTS, seed, ground, glow);
}

self.onmessage = (ev: MessageEvent<FeatureRequest>): void => {
  const req = ev.data;
  if (req.kind === 'init') {
    ({ index, seed } = req);
    glow = new Set(req.glow ?? []);
    jobs = assignToTiles(req.vectors, index.tileSize, index.size);
    self.postMessage({ kind: 'ready', tiles: [...jobs].map(([key, job]) => [key, reach(job)]) } satisfies FeatureResponse);
    return;
  }
  build(req.tx, req.tz).then(
    (tile) => {
      const transfer = tile.parts.flatMap((p) => [p.positions.buffer, p.normals.buffer, p.colors.buffer, p.indices.buffer, p.lines.buffer]);
      self.postMessage({ kind: 'tile', id: req.id, ok: true, tile } satisfies FeatureResponse, { transfer });
    },
    (err: unknown) => self.postMessage({ kind: 'tile', id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies FeatureResponse),
  );
};
