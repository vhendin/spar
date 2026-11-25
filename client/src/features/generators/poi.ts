import type { ObjectDef, PlacedObject, Rng } from '@spar/shared';
import { objectRng, param, pick, shade, type FeatureMesh, type GroundFn, type Rgb, type Vec3 } from '../mesh';

/**
 * What stands at a place worth driving to (features/poi.ts places them): a lean-to shelter of
 * logs with a fire ring in front, a summit cairn, a bench at a viewpoint, a camp site with a
 * tent and tables, or an information board. Each faces its heading, or downhill when it has
 * none (heading below 0).
 */
export function poi(o: PlacedObject, def: ObjectDef, seed: number, ground: GroundFn, out: FeatureMesh): void {
  const rng = objectRng(o.id, seed);
  const f = frame(o, rng, ground);
  switch (def.params.shape) {
    case 'shelter': return shelter(o, def, rng, out, f);
    case 'cairn': return cairn(o, def, rng, ground, out);
    case 'viewpoint': return viewpoint(o, def, rng, out, f);
    case 'camp': return camp(o, def, rng, out, f);
    case 'board': return board(o, def, rng, out, f);
  }
}

/** The object's own axes: +z forward (its heading), +x across, y in metres above sea level. */
interface Frame {
  yaw: number;
  at(lx: number, y: number, lz: number): Vec3;
  /** Ground height under a local point. */
  groundAt(lx: number, lz: number): number;
}

function frame(o: PlacedObject, rng: Rng, ground: GroundFn): Frame {
  let heading = o.heading;
  if (heading < 0) {
    // Downhill, towards the view; on the flat any way.
    const gx = ground(o.x + 3, o.z) - ground(o.x - 3, o.z), gz = ground(o.x, o.z + 3) - ground(o.x, o.z - 3);
    heading = Math.hypot(gx, gz) > 0.15 ? (Math.atan2(-gx, gz) * 180) / Math.PI : rng.float() * 360;
  }
  // Forward is (sin h, −cos h); the box and solid convention puts local +z at (sin yaw, cos yaw).
  const yaw = Math.PI - (heading * Math.PI) / 180;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const at = (lx: number, y: number, lz: number): Vec3 => [o.x + lx * c + lz * s, y, o.z - lx * s + lz * c];
  return { yaw, at, groundAt: (lx, lz) => { const p = at(lx, 0, lz); return ground(p[0], p[2]); } };
}

/** Lowest and highest ground under some local points. */
function span(f: Frame, points: [number, number][]): [number, number] {
  let low = Infinity, high = -Infinity;
  for (const [x, z] of points) {
    const g = f.groundAt(x, z);
    low = Math.min(low, g);
    high = Math.max(high, g);
  }
  return [low, high];
}

/** A solid box on the object's axes, from `bottom` to `top`. */
function solid(o: PlacedObject, out: FeatureMesh, f: Frame, key: string, lx: number, lz: number, hx: number, hz: number, bottom: number, top: number): void {
  const p = f.at(lx, 0, lz);
  out.solids.push({ key: `o${o.id}${key}`, x: p[0], y: (bottom + top) / 2, z: p[2], hx, hy: (top - bottom) / 2, hz, yaw: f.yaw });
}

/** A slab with its top running from (z0, y0) to (z1, y1) across x ±hx, `t` thick: a roof. */
function slab(out: FeatureMesh, f: Frame, hx: number, z0: number, y0: number, z1: number, y1: number, t: number, top: Rgb, edge: Rgb): void {
  const a = (x: number, y: number, z: number): Vec3 => f.at(x, y, z);
  out.face([a(-hx, y0, z0), a(-hx, y1, z1), a(hx, y1, z1), a(hx, y0, z0)], top);
  out.face([a(hx, y0 - t, z0), a(hx, y1 - t, z1), a(-hx, y1 - t, z1), a(-hx, y0 - t, z0)], edge);
  out.face([a(-hx, y1 - t, z1), a(hx, y1 - t, z1), a(hx, y1, z1), a(-hx, y1, z1)], edge);
  out.face([a(hx, y0 - t, z0), a(-hx, y0 - t, z0), a(-hx, y0, z0), a(hx, y0, z0)], edge);
  out.face([a(hx, y0 - t, z0), a(hx, y0, z0), a(hx, y1, z1), a(hx, y1 - t, z1)], edge);
  out.face([a(-hx, y1 - t, z1), a(-hx, y1, z1), a(-hx, y0, z0), a(-hx, y0 - t, z0)], edge);
}

/** A ring of stones round a fire, with charred wood in it, at local (lx, lz). */
function fireRing(def: ObjectDef, rng: Rng, out: FeatureMesh, f: Frame, lx: number, lz: number): void {
  const n = 9 + Math.floor(rng.float() * 3);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + rng.range(-0.1, 0.1);
    const x = lx + Math.cos(a) * 0.6, z = lz + Math.sin(a) * 0.6;
    const hy = rng.range(0.08, 0.13);
    out.box(f.at(x, f.groundAt(x, z) + hy * 0.6, z), rng.range(0.12, 0.18), hy, rng.range(0.1, 0.15), f.yaw + a, shade(pick(def, 'stone', rng), rng.range(0.85, 1.1)));
  }
  const g = f.groundAt(lx, lz);
  for (let k = 0; k < 3; k++) {
    const a = rng.float() * Math.PI;
    const dx = Math.cos(a) * 0.32, dz = Math.sin(a) * 0.32;
    out.rod(f.at(lx - dx, g + 0.06, lz - dz), f.at(lx + dx, g + 0.06 + k * 0.03, lz + dz), 0.05, 5, pick(def, 'char', rng));
  }
}

/**
 * A lean-to (vindskydd): three walls of logs on a raised plank floor, open at the front, the
 * side walls rising towards it under a roof sloping down to the back; a fire ring in front
 * and a log to sit on beside it.
 */
function shelter(o: PlacedObject, def: ObjectDef, rng: Rng, out: FeatureMesh, f: Frame): void {
  const w = param(def, 'width', 4, rng), d = param(def, 'depth', 2.6, rng);
  const hx = w / 2, hz = d / 2;
  const [low, high] = span(f, [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz], [0, 0]]);
  const base = low - 0.1;
  const floor = high + 0.3;
  const back = floor + param(def, 'back', 1, rng), front = floor + param(def, 'front', 2, rng);
  const wood = pick(def, 'wood', rng);
  const ends = shade(wood, 1.35);
  const log = (): Rgb => shade(wood, rng.range(0.85, 1.12));
  const r = 0.11, step = 0.2;

  // Footings, and the floor on them.
  for (const [x, z] of [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz], [0, -hz], [0, hz]] as const) {
    out.box(f.at(x, (base + floor) / 2, z), 0.16, (floor - base) / 2, 0.16, f.yaw, shade(wood, 0.7));
  }
  out.box(f.at(0, floor - 0.06, 0), hx, 0.06, hz, f.yaw, pick(def, 'floor', rng));
  // The back wall, then the sides, each log ending where the roof comes down.
  for (let y = floor + r; y <= back; y += step) out.rod(f.at(-hx - 0.18, y, -hz), f.at(hx + 0.18, y, -hz), r, 6, log(), ends);
  for (let y = floor + r; y <= front - 0.12; y += step) {
    const z0 = y <= back ? -hz - 0.18 : -hz + (d * (y - back)) / (front - back);
    for (const x of [-hx, hx]) out.rod(f.at(x, y, z0), f.at(x, y, hz + 0.12), r, 6, log(), ends);
  }
  // Posts at the corners and a beam along the open front.
  for (const x of [-hx, hx]) {
    out.rod(f.at(x, base, hz), f.at(x, front + 0.05, hz), 0.12, 7, shade(wood, 0.9));
    out.rod(f.at(x, base, -hz), f.at(x, back + 0.05, -hz), 0.12, 7, shade(wood, 0.9));
  }
  out.rod(f.at(-hx - 0.2, front - 0.02, hz), f.at(hx + 0.2, front - 0.02, hz), 0.12, 7, log(), ends);
  // The roof, overhanging most at the front.
  const k = (front - back) / d;
  const zb = -hz - 0.35, zf = hz + 0.6;
  slab(out, f, hx + 0.3, zb, back + 0.13 - k * 0.35, zf, front + 0.13 + k * 0.6, 0.14, pick(def, 'roof', rng), shade(wood, 0.8));
  solid(o, out, f, '', 0, 0, hx + 0.15, hz + 0.15, base, front + 0.15);

  // The fire ring in front, and a log to sit on.
  const fire = hz + 2.1;
  fireRing(def, rng, out, f, rng.range(-0.3, 0.3), fire);
  const side = rng.float() < 0.5 ? -1 : 1;
  const sx = side * 1.4, g = f.groundAt(sx, fire);
  out.rod(f.at(sx, g + 0.16, fire - 0.8), f.at(sx, g + 0.16, fire + 0.8), 0.2, 8, log(), ends);
}

/** A summit cairn: stones heaped into a cone. */
function cairn(o: PlacedObject, def: ObjectDef, rng: Rng, ground: GroundFn, out: FeatureMesh): void {
  const radius = param(def, 'radius', 1.1, rng), height = param(def, 'height', 1.6, rng);
  let low = ground(o.x, o.z);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    low = Math.min(low, ground(o.x + Math.cos(a) * radius, o.z + Math.sin(a) * radius));
  }
  const base = low - 0.1;
  const levels = Math.max(4, Math.round(height / 0.26));
  for (let i = 0; i < levels; i++) {
    const t = i / levels;
    const ring = radius * Math.pow(1 - t, 0.85) * 0.7;
    const size = 0.26 * (1 - 0.45 * t);
    const count = Math.max(1, Math.round((Math.PI * 2 * ring) / (size * 1.7)));
    const y = base + (i + 0.5) * (height / levels);
    for (let k = 0; k <= count; k++) {
      // The last one fills the middle.
      const a = (k / count) * Math.PI * 2 + i * 0.7 + rng.range(-0.2, 0.2);
      const rr = k === count ? 0 : ring;
      const x = o.x + Math.cos(a) * rr, z = o.z + Math.sin(a) * rr;
      out.box([x, y, z], size * rng.range(0.8, 1.25), size * rng.range(0.6, 0.85), size * rng.range(0.8, 1.2), rng.float() * Math.PI, shade(pick(def, 'stone', rng), rng.range(0.85, 1.1)), true);
    }
  }
  out.solids.push({ key: `o${o.id}`, x: o.x, y: base + height / 2, z: o.z, hx: radius * 0.75, hy: height / 2, hz: radius * 0.75, yaw: 0 });
}

/** A bench of planks on legs at local (lx, lz), facing +z, with a back if asked; returns the ground under it. */
function bench(def: ObjectDef, rng: Rng, out: FeatureMesh, f: Frame, lx: number, lz: number, back: boolean): number {
  const g = f.groundAt(lx, lz);
  const wood = pick(def, 'wood', rng);
  out.box(f.at(lx, g + 0.44, lz), 0.8, 0.03, 0.2, f.yaw, wood);
  if (back) out.box(f.at(lx, g + 0.78, lz - 0.2), 0.8, 0.12, 0.025, f.yaw, wood);
  for (const x of [-0.65, 0.65]) {
    out.box(f.at(lx + x, g + 0.2, lz), 0.04, 0.22, 0.18, f.yaw, shade(wood, 0.8));
    if (back) out.box(f.at(lx + x, g + 0.6, lz - 0.2), 0.04, 0.22, 0.03, f.yaw, shade(wood, 0.8));
  }
  return g;
}

/** A bench facing the view, and a small brown sign on a post beside it. */
function viewpoint(o: PlacedObject, def: ObjectDef, rng: Rng, out: FeatureMesh, f: Frame): void {
  const g = bench(def, rng, out, f, 0, 0, true);
  solid(o, out, f, '', 0, 0, 0.85, 0.25, g - 0.1, g + 0.9);
  const px = 1.5, pz = -0.7, pg = f.groundAt(px, pz);
  out.rod(f.at(px, pg - 0.1, pz), f.at(px, pg + 1.6, pz), 0.05, 6, pick(def, 'post', rng));
  out.box(f.at(px, pg + 1.45, pz + 0.07), 0.38, 0.11, 0.02, f.yaw, pick(def, 'sign', rng), true);
  out.box(f.at(px, pg + 1.45, pz + 0.095), 0.28, 0.025, 0.005, f.yaw, pick(def, 'letters', rng), true);
}

/** A picnic table at local (lx, lz), turned by `turn` radians: a top and a bench either side. */
function table(o: PlacedObject, def: ObjectDef, rng: Rng, out: FeatureMesh, f: Frame, lx: number, lz: number, turn: number, key: string): void {
  const g = f.groundAt(lx, lz);
  const wood = pick(def, 'wood', rng);
  const c = Math.cos(turn), s = Math.sin(turn);
  const at = (x: number, y: number, z: number): Vec3 => f.at(lx + x * c + z * s, y, lz - x * s + z * c);
  const yaw = f.yaw + turn;
  out.box(at(0, g + 0.74, 0), 0.9, 0.03, 0.38, yaw, wood);
  for (const z of [-0.68, 0.68]) out.box(at(0, g + 0.44, z), 0.9, 0.03, 0.15, yaw, wood);
  for (const x of [-0.7, 0.7]) out.box(at(x, g + 0.36, 0), 0.05, 0.38, 0.8, yaw, shade(wood, 0.8));
  const p = at(0, 0, 0);
  out.solids.push({ key: `o${o.id}${key}`, x: p[0], y: g + 0.4, z: p[2], hx: 0.95, hy: 0.45, hz: 0.85, yaw });
}

/** A camp site: a fire ring in the middle, two picnic tables and a ridge tent. */
function camp(o: PlacedObject, def: ObjectDef, rng: Rng, out: FeatureMesh, f: Frame): void {
  fireRing(def, rng, out, f, 0, 0);
  table(o, def, rng, out, f, -3.6, 2.2, rng.range(-0.4, 0.4), 't1');
  table(o, def, rng, out, f, 3.4, 2.6, rng.range(-0.4, 0.4) + Math.PI / 2, 't2');
  // The tent behind the fire: two sloping sides and two ends, on a ridge pole.
  const tz = -4.5, length = rng.range(2.2, 2.6), half = rng.range(0.8, 1.0), high = rng.range(1.05, 1.25);
  const [lowG] = span(f, [[-half, tz - length / 2], [half, tz - length / 2], [half, tz + length / 2], [-half, tz + length / 2]]);
  const g = lowG - 0.02, top = g + high;
  const z0 = tz - length / 2, z1 = tz + length / 2;
  const cloth = pick(def, 'tent', rng), inner = shade(cloth, 0.6);
  const a = (x: number, y: number, z: number): Vec3 => f.at(x, y, z);
  out.face([a(half, g, z1), a(half, g, z0), a(0, top, z0), a(0, top, z1)], cloth);
  out.face([a(-half, g, z0), a(-half, g, z1), a(0, top, z1), a(0, top, z0)], cloth);
  out.face([a(-half, g, z1), a(half, g, z1), a(0, top, z1)], shade(cloth, 0.9));
  out.face([a(half, g, z0), a(-half, g, z0), a(0, top, z0)], shade(cloth, 0.9));
  // The insides, seen through nothing but drawn so the tent is not hollow from below.
  out.face([a(0, top, z1), a(0, top, z0), a(half, g, z0), a(half, g, z1)], inner);
  out.face([a(0, top, z0), a(0, top, z1), a(-half, g, z1), a(-half, g, z0)], inner);
  solid(o, out, f, 'tent', 0, tz, half, length / 2, g, top);
}

/** An information board: a panel with a map on it between two posts, under a little roof. */
function board(o: PlacedObject, def: ObjectDef, rng: Rng, out: FeatureMesh, f: Frame): void {
  const [low] = span(f, [[-0.8, 0], [0.8, 0]]);
  const g = low - 0.1;
  for (const x of [-0.8, 0.8]) out.box(f.at(x, g + 1.15, 0), 0.06, 1.15, 0.06, f.yaw, pick(def, 'post', rng));
  out.box(f.at(0, g + 1.5, 0), 0.76, 0.52, 0.04, f.yaw, pick(def, 'frame', rng), true);
  out.box(f.at(0, g + 1.5, 0.045), 0.68, 0.44, 0.008, f.yaw, pick(def, 'panel', rng), true);
  // The map: a few patches of land and water.
  for (let k = 0; k < 4; k++) {
    const x = rng.range(-0.45, 0.2), y = rng.range(-0.25, 0.15);
    out.box(f.at(x, g + 1.55 + y, 0.055), rng.range(0.08, 0.2), rng.range(0.05, 0.12), 0.004, f.yaw, pick(def, 'map', rng), true);
  }
  // A gable roof along the board, with its underside.
  const ridge = g + 2.32, eave = g + 2.12, hx = 0.98, d = 0.32;
  const roof = pick(def, 'roof', rng), under = shade(roof, 0.6);
  const a = (x: number, y: number, z: number): Vec3 => f.at(x, y, z);
  out.face([a(-hx, ridge, 0), a(-hx, eave, d), a(hx, eave, d), a(hx, ridge, 0)], roof);
  out.face([a(hx, ridge, 0), a(hx, eave, -d), a(-hx, eave, -d), a(-hx, ridge, 0)], roof);
  out.face([a(hx, ridge - 0.02, 0), a(hx, eave - 0.02, d), a(-hx, eave - 0.02, d), a(-hx, ridge - 0.02, 0)], under);
  out.face([a(-hx, ridge - 0.02, 0), a(-hx, eave - 0.02, -d), a(hx, eave - 0.02, -d), a(hx, ridge - 0.02, 0)], under);
  solid(o, out, f, '', 0, 0, 0.9, 0.15, g, ridge);
}
