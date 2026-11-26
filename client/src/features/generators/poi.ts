import type { ObjectDef, PlacedObject, Rng } from '@spar/shared';
import { objectRng, param, pick, shade, type FeatureMesh, type GroundFn, type Rgb, type Vec3 } from '../mesh';
import { hexColor } from '../../vegetation/generators/mesh';

/**
 * What stands at a place worth driving to (features/poi.ts places them): a lean-to shelter of
 * logs with a fire ring in front, a summit cairn, a bench at a viewpoint, a camp site with a
 * tent and tables, or an information board. And at the small things to find: a boundary
 * stone, a memorial stone, an aircraft wreck, the mouth of an old mine, ruined walls, or a
 * spring with a log trough. Each faces its heading, or downhill when it has
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
    case 'boundary_stone': return boundaryStone(o, def, rng, out, f);
    case 'memorial': return memorial(o, def, rng, out, f);
    case 'wreck': return wreck(o, def, rng, out, f);
    case 'mine': return mine(o, def, rng, out, f);
    case 'ruins': return ruins(o, def, rng, out, f);
    case 'spring': return spring(o, def, rng, out, f);
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





/** Ruins: the low, broken stone walls of a small house, with a gap for the door. */
function ruins(o: PlacedObject, def: ObjectDef, rng: Rng, out: FeatureMesh, f: Frame): void {
  const hx = rng.range(2.4, 3.2), hz = rng.range(1.8, 2.4);
  const stone = pick(def, 'stone', rng);
  const walls: [number, number, number, number][] = [[-hx, -hz, hx, -hz], [hx, -hz, hx, hz], [hx, hz, -hx, hz], [-hx, hz, -hx, -hz]];
  walls.forEach(([ax, az, bx, bz], w) => {
    const length = Math.hypot(bx - ax, bz - az);
    const n = Math.round(length / 0.5);
    const yaw = f.yaw + (w % 2 ? Math.PI / 2 : 0);
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      // The door in the front wall.
      if (w === 2 && Math.abs(t - 0.5) < 0.12) continue;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      const g = f.groundAt(x, z);
      // Higher at the corners, crumbled between.
      const corner = Math.min(t, 1 - t);
      const h = Math.max(0.15, rng.range(0.4, 1.1) * (1 - corner) - (rng.float() < 0.2 ? 0.4 : 0));
      out.box(f.at(x, g + h / 2 - 0.05, z), 0.26, h / 2 + 0.05, 0.3, yaw + rng.range(-0.05, 0.05), shade(stone, rng.range(0.85, 1.1)));
    }
    const mx = (ax + bx) / 2, mz = (az + bz) / 2, g = f.groundAt(mx, mz);
    solid(o, out, f, `w${w}`, mx, mz, w % 2 ? 0.3 : length / 2, w % 2 ? length / 2 : 0.3, g - 0.1, g + 0.6);
  });
  // A fallen stone or two inside.
  for (let k = 0; k < 4; k++) {
    const x = rng.range(-hx + 0.6, hx - 0.6), z = rng.range(-hz + 0.6, hz - 0.6);
    out.box(f.at(x, f.groundAt(x, z) + 0.1, z), rng.range(0.15, 0.3), 0.12, rng.range(0.15, 0.25), rng.float() * Math.PI, shade(stone, 0.9));
  }
}

/** A spring: water led out of the slope in a wooden pipe into a hollowed log, and a dark pool below. */
function spring(o: PlacedObject, def: ObjectDef, rng: Rng, out: FeatureMesh, f: Frame): void {
  const [low] = span(f, [[-0.9, -0.3], [0.9, -0.3], [0.9, 0.3], [-0.9, 0.3]]);
  const g = low - 0.05;
  const wood = pick(def, 'wood', rng), water = pick(def, 'water', rng);
  // The trough: a log with its top hollowed, water standing in it.
  out.box(f.at(0, g + 0.22, 0), 0.9, 0.22, 0.25, f.yaw, wood, false, shade(wood, 0.7));
  out.box(f.at(0, g + 0.4, 0), 0.8, 0.005, 0.17, f.yaw, water);
  // The pipe from the bank behind, on a forked stick.
  const pg = f.groundAt(-0.6, -1.4);
  out.rod(f.at(-0.6, pg + 0.25, -1.4), f.at(-0.6, g + 0.6, -0.05), 0.05, 6, shade(wood, 0.8));
  out.rod(f.at(-0.6, f.groundAt(-0.6, -0.7) - 0.05, -0.7), f.at(-0.6, g + 0.58, -0.7), 0.025, 5, shade(wood, 0.7));
  // The pool where it runs over.
  const pz = 0.75, pr = rng.range(0.5, 0.7), pgr = f.groundAt(0.4, pz) + 0.02;
  const ring: Vec3[] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    ring.push(f.at(0.4 + Math.cos(a) * pr, pgr, pz + Math.sin(a) * pr * 0.7));
  }
  out.face([...ring].reverse(), water);
  solid(o, out, f, '', 0, 0, 0.9, 0.25, g, g + 0.45);
}

/**
 * A lumpy stone at local (lx, lz): rings of corners round an upright axis, each a little in or
 * out, narrowing to the top, which is flat when asked (to cut a cross in) or a blunt point.
 * Its foot sinks `sink` metres into the ground. Returns the height of its top.
 */
function rock(out: FeatureMesh, f: Frame, rng: Rng, lx: number, lz: number, ground: number, rx: number, rz: number, h: number, color: Rgb, opts: { flat?: boolean; jitter?: number; sink?: number; lichen?: Rgb[] } = {}): number {
  const n = 8, jitter = opts.jitter ?? 0.12, sink = opts.sink ?? 0.15;
  const base = ground - sink;
  // Height and width of each ring, as shares of the stone's.
  const rings: [number, number][] = [[0, 0.92], [0.4, 1], [0.78, 0.82], [1, opts.flat ? 0.6 : 0.35]];
  const twist = rng.float() * Math.PI * 2;
  const corners = rings.map(([t, w]) => {
    const ring: Vec3[] = [];
    for (let k = 0; k < n; k++) {
      const a = twist + (k / n) * Math.PI * 2 + rng.range(-0.15, 0.15);
      const j = 1 + rng.range(-jitter, jitter);
      const top = t === 1 && opts.flat ? 0 : rng.range(-0.04, 0.04) * h;
      ring.push(f.at(lx + Math.cos(a) * rx * w * j, base + sink + (h - sink) * t + top - (t === 0 ? sink : 0), lz + Math.sin(a) * rz * w * j));
    }
    return ring;
  });
  const centre = f.at(lx, 0, lz);
  // Faces turned outwards whichever way the corners went round.
  const outward = (pts: Vec3[], shadeBy: number, own: Rgb | null = null): void => {
    const [a, b, c] = pts as [Vec3, Vec3, Vec3];
    const ux = b[0] - a[0], uz = b[2] - a[2], uy = b[1] - a[1], vx = c[0] - a[0], vz = c[2] - a[2], vy = c[1] - a[1];
    const nx = uy * vz - uz * vy, nz = ux * vy - uy * vx;
    const mx = (a[0] + c[0]) / 2 - centre[0], mz = (a[2] + c[2]) / 2 - centre[2];
    out.face(nx * mx + nz * mz >= 0 ? pts : [...pts].reverse(), shade(own ?? color, shadeBy));
  };
  for (let r = 0; r + 1 < corners.length; r++) {
    const lo = corners[r]!, hi = corners[r + 1]!;
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      // Lichen on the upper faces now and then: the stone's own face, tinted.
      const spot = r > 0 && opts.lichen && rng.float() < 0.35 ? pick1(opts.lichen, rng) : null;
      const tint: Rgb | null = spot ? [spot[0] * 0.55 + color[0] * 0.45, spot[1] * 0.55 + color[1] * 0.45, spot[2] * 0.55 + color[2] * 0.45] : null;
      outward([lo[k]!, lo[k1]!, hi[k1]!, hi[k]!], rng.range(0.9, 1.06) * (r === 0 ? 0.9 : 1), tint);
    }
  }
  // The top, facing up.
  const top = corners[corners.length - 1]!;
  const peak = opts.flat ? null : f.at(lx + rng.range(-0.05, 0.05) * rx, base + h * 1.04, lz + rng.range(-0.05, 0.05) * rz);
  if (peak) for (let k = 0; k < n; k++) outward([top[k]!, top[(k + 1) % n]!, peak], 1.08);
  // A ring going round with the angle faces down; reversed, up.
  else out.face([...top].reverse(), shade(color, 1.1));
  return base + h;
}


/** A boundary stone (rå): a rough upright stone, flat on top with a cross cut in it, small stones at its foot. */
function boundaryStone(o: PlacedObject, def: ObjectDef, rng: Rng, out: FeatureMesh, f: Frame): void {
  const g = f.groundAt(0, 0);
  const high = param(def, 'height', 0.7, rng);
  const stone = pick(def, 'stone', rng);
  const rx = rng.range(0.15, 0.2), rz = rng.range(0.13, 0.17);
  const top = rock(out, f, rng, 0, 0, g, rx, rz, high, stone, { flat: true, jitter: 0.08, lichen: lichens(def) });
  const cut = pick(def, 'cut', rng);
  out.box(f.at(0, top + 0.003, 0), rx * 0.45, 0.004, 0.012, f.yaw, cut);
  out.box(f.at(0, top + 0.003, 0), 0.012, 0.004, rz * 0.45, f.yaw, cut);
  // The witnesses (vittnen): small stones round its foot, as round a real one.
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + rng.range(-0.4, 0.4), d = rng.range(0.32, 0.45);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    rock(out, f, rng, x, z, f.groundAt(x, z), rng.range(0.07, 0.1), rng.range(0.06, 0.09), rng.range(0.1, 0.16), shade(stone, rng.range(0.85, 1)), { jitter: 0.2, sink: 0.04 });
  }
  solid(o, out, f, '', 0, 0, rx, rz, g - 0.1, top);
}

/** A memorial: a big rough boulder set on end, a dark plaque on its smoother face towards the way. */
function memorial(o: PlacedObject, def: ObjectDef, rng: Rng, out: FeatureMesh, f: Frame): void {
  const [low] = span(f, [[-0.6, -0.3], [0.6, -0.3], [0.6, 0.3], [-0.6, 0.3]]);
  const stone = pick(def, 'stone', rng);
  const rx = rng.range(0.55, 0.7), rz = rng.range(0.32, 0.4), high = param(def, 'height', 1.3, rng);
  rock(out, f, rng, 0, 0, low, rx, rz, high, stone, { jitter: 0.05, sink: 0.2, lichen: lichens(def) });
  // The plaque leans on the front face, held clear of its bumps.
  const py = low + high * 0.5, pz = rz * 1.08;
  out.box(f.at(0, py, pz), rx * 0.45, 0.17, 0.012, f.yaw, pick(def, 'plaque', rng));
  out.box(f.at(0, py + 0.03, pz + 0.014), rx * 0.32, 0.025, 0.003, f.yaw, pick(def, 'letters', rng));
  out.box(f.at(0, py - 0.05, pz + 0.014), rx * 0.25, 0.018, 0.003, f.yaw, pick(def, 'letters', rng));
  solid(o, out, f, '', 0, 0, rx, rz, low - 0.1, low + high);
}

/** A thin sheet seen from both sides: a panel of a wreck. */
function sheet(out: FeatureMesh, pts: Vec3[], color: Rgb): void {
  out.face(pts, color);
  out.face([...pts].reverse(), shade(color, 0.8));
}

/**
 * An aircraft wreck, a small plane long down on the fell: the fuselage broken behind the
 * wings, its nose and engine with a bent propeller, a wing lying apart with its tip bent up,
 * the tail with its fin a little way off, and plates strewn in the heather.
 */
function wreck(o: PlacedObject, def: ObjectDef, rng: Rng, out: FeatureMesh, f: Frame): void {
  const metal = (): Rgb => shade(pick(def, 'metal', rng), rng.range(0.85, 1.05));
  const paint = pick(def, 'paint', rng), dark = pick(def, 'dark', rng);
  const a = (x: number, y: number, z: number): Vec3 => f.at(x, y, z);
  // The front half of the fuselage, half sunk, along local z.
  const r = rng.range(0.55, 0.7), z0 = -2.2, z1 = 1.2;
  const g0 = f.groundAt(0, z0), g1 = f.groundAt(0, z1);
  out.rod(a(0, g0 + r * 0.5, z0), a(0.1, g1 + r * 0.6, z1), r, 10, metal(), dark);
  // A faded stripe along each side.
  for (const sx of [1, -1]) {
    const yAt = (z: number): number => g0 + r * 0.5 + ((g1 + r * 0.6 - g0 - r * 0.5) * (z - z0)) / (z1 - z0);
    const xAt = (z: number): number => (0.1 * (z - z0)) / (z1 - z0) + sx * r * 1.02;
    const zs = [z0 + 0.15, z1 - 0.1];
    const pts = [a(xAt(zs[0]!), yAt(zs[0]!) - 0.07, zs[0]!), a(xAt(zs[1]!), yAt(zs[1]!) - 0.07, zs[1]!), a(xAt(zs[1]!), yAt(zs[1]!) + 0.09, zs[1]!), a(xAt(zs[0]!), yAt(zs[0]!) + 0.09, zs[0]!)];
    sheet(out, pts, paint);
  }
  // The engine at the nose, and a two-bladed propeller with one blade bent back.
  const ng = f.groundAt(0.1, z1 + 0.5);
  out.rod(a(0.1, ng + r * 0.6, z1), a(0.12, ng + r * 0.55, z1 + 0.7), r * 0.75, 8, pick(def, 'engine', rng), dark);
  const hub = a(0.12, ng + r * 0.55, z1 + 0.78);
  out.rod(a(0.12, ng + r * 0.55, z1 + 0.7), hub, 0.12, 6, dark, dark);
  out.rod(hub, a(0.14, ng + r * 0.55 + 0.9, z1 + 0.8), 0.05, 4, dark);
  out.rod(hub, a(0.6, ng + 0.05, z1 + 1.1), 0.05, 4, dark);
  solid(o, out, f, 'body', 0.05, (z0 + z1) / 2 + 0.3, r, (z1 - z0) / 2 + 0.6, Math.min(g0, g1) - 0.2, Math.max(g0, g1) + r * 1.3);
  // The wing, torn off, flat in the heather on one side, its tip bent up.
  const side = rng.float() < 0.5 ? 1 : -1;
  const wx0 = side * 1.2, wx1 = side * 4.6, wz = 0.4, chord = 0.75;
  const wg = (x: number, z: number): number => f.groundAt(x, z) + 0.08;
  const wing = metal();
  sheet(out, [a(wx0, wg(wx0, wz - chord), wz - chord), a(wx1, wg(wx1, wz - chord), wz - chord), a(wx1, wg(wx1, wz + chord), wz + chord), a(wx0, wg(wx0, wz + chord), wz + chord)].map((p) => [p[0], p[1], p[2]] as Vec3), wing);
  const tip = side * 5.4;
  sheet(out, [a(wx1, wg(wx1, wz - chord), wz - chord), a(tip, wg(wx1, wz) + 0.7, wz - chord * 0.7), a(tip, wg(wx1, wz) + 0.7, wz + chord * 0.6), a(wx1, wg(wx1, wz + chord), wz + chord)], wing);
  // The wing's marking, half worn.
  sheet(out, [a(side * 2.6, wg(side * 2.6, wz - 0.4) + 0.01, wz - 0.4), a(side * 3.4, wg(side * 3.4, wz - 0.4) + 0.01, wz - 0.4), a(side * 3.4, wg(side * 3.4, wz + 0.4) + 0.01, wz + 0.4), a(side * 2.6, wg(side * 2.6, wz + 0.4) + 0.01, wz + 0.4)], paint);
  solid(o, out, f, 'wing', (wx0 + tip) / 2, wz, Math.abs(tip - wx0) / 2, chord, wg(wx1, wz) - 0.2, wg(wx1, wz) + 0.4);
  // The tail, broken off a few metres behind, lying on its side with the fin up.
  const tx = -side * rng.range(1, 2), tz = rng.range(-6.5, -5.5);
  const tg = f.groundAt(tx, tz);
  out.rod(a(tx, tg + 0.3, tz + 1.4), a(tx + side * 0.3, tg + 0.22, tz - 1.2), 0.38, 8, metal(), dark);
  sheet(out, [a(tx + side * 0.2, tg + 0.5, tz - 0.4), a(tx + side * 0.28, tg + 0.45, tz - 1.25), a(tx + side * 0.3, tg + 1.55, tz - 1.4), a(tx + side * 0.25, tg + 1.45, tz - 0.9)], paint);
  sheet(out, [a(tx - 1.3, tg + 0.22, tz - 0.7), a(tx + 1.5, tg + 0.26, tz - 0.8), a(tx + 1.4, tg + 0.22, tz - 1.25), a(tx - 1.2, tg + 0.18, tz - 1.2)], metal());
  solid(o, out, f, 'tail', tx, tz, 0.5, 1.4, tg - 0.1, tg + 1.2);
  // Plates and pieces strewn about.
  for (let k = 0; k < 9; k++) {
    const an = rng.float() * Math.PI * 2, d = rng.range(2.5, 8);
    const x = Math.cos(an) * d, z = Math.sin(an) * d;
    out.box(f.at(x, f.groundAt(x, z) + 0.03, z), rng.range(0.12, 0.45), 0.02, rng.range(0.1, 0.35), rng.float() * Math.PI, metal(), true);
  }
}

/**
 * The mouth of an old mine (gruvort), dug into the slope (it faces downhill): a sagging
 * timber frame round the dark opening, rails running out on sleepers with a rusty ore cart
 * left on them, and a grey spoil heap tipped beside.
 */
function mine(o: PlacedObject, def: ObjectDef, rng: Rng, out: FeatureMesh, f: Frame): void {
  const [low, high] = span(f, [[-2.4, -0.2], [2.4, -0.2], [0, -1.5]]);
  const g = low - 0.1, top = high + 2.4;
  const wood = pick(def, 'wood', rng), earth = pick(def, 'earth', rng), dark = pick(def, 'dark', rng);
  // The bank: a mound of earth rising to the opening, sloping away behind and to the sides,
  // so on a hillside it runs into the slope and on the flat it is a heap the adit goes into.
  const a = (x: number, y: number, z: number): Vec3 => f.at(x, y, z);
  const hx = 1.6, zf = -0.2, zb = -6, wide = 4.2;
  const gb = f.groundAt(0, zb) - 0.1, gl = f.groundAt(-wide, -1) - 0.1, gr = f.groundAt(wide, -1) - 0.1;
  const middle = a(0, g + 0.8, -2.5);
  const mound = (pts: Vec3[], color: Rgb): void => {
    const [p0, p1, p2] = pts as [Vec3, Vec3, Vec3];
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2], vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    const n: Vec3 = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const c = pts.reduce((m, p) => [m[0] + p[0] / pts.length, m[1] + p[1] / pts.length, m[2] + p[2] / pts.length] as Vec3, [0, 0, 0] as Vec3);
    out.face(n[0] * (c[0] - middle[0]) + n[1] * (c[1] - middle[1]) + n[2] * (c[2] - middle[2]) >= 0 ? pts : [...pts].reverse(), color);
  };
  const tl = a(-hx, top, zf), tr = a(hx, top, zf), tb = a(0, top - 0.5, -2.2);
  const fl = a(-wide, gl, zf + 0.3), fr = a(wide, gr, zf + 0.3), bl = a(-wide * 0.7, gb, zb + 1), br = a(wide * 0.7, gb, zb + 1), back = a(0, gb, zb);
  // The face round the opening, and the slopes off it.
  mound([a(-hx, g, zf), a(hx, g, zf), tr, tl], shade(earth, 0.85));
  const turf = pick(def, 'turf', rng);
  mound([a(-hx, g, zf), tl, fl], shade(turf, 0.9));
  mound([a(hx, g, zf), fr, tr], shade(turf, 0.9));
  mound([tl, tr, tb], shade(turf, 1.12));
  mound([tr, fr, br, tb], shade(turf, 1.02));
  mound([tl, tb, bl, fl], shade(turf, 0.97));
  mound([tb, br, back], shade(turf, 1.06));
  mound([tb, back, bl], shade(turf, 1.0));
  solid(o, out, f, 'bank', 0, -2.4, 2.4, 2.2, g, top - 0.4);
  // The opening, and the frame round it: posts leaning in, the cap sagging in the middle.
  out.face([a(-0.7, g, -0.21), a(0.7, g, -0.21), a(0.62, g + 1.95, -0.21), a(-0.62, g + 1.95, -0.21)], dark);
  const post = (x: number, lean: number): void => out.rod(a(x, g - 0.1, -0.1), a(x + lean, g + 2.05, -0.1), 0.09, 6, shade(wood, rng.range(0.8, 1)));
  post(-0.8, 0.1);
  post(0.8, -0.12);
  const sag = rng.range(0.08, 0.16);
  out.rod(a(-1.0, g + 2.12, -0.08), a(0, g + 2.12 - sag, -0.08), 0.1, 6, wood);
  out.rod(a(0, g + 2.12 - sag, -0.08), a(1.0, g + 2.08, -0.08), 0.1, 6, shade(wood, 0.92));
  // Rails out of the mouth on rotting sleepers.
  const rust = pick(def, 'rust', rng);
  const rail = (x: number): void => out.rod(a(x, f.groundAt(x, 0) + 0.1, -0.15), a(x + 0.05, f.groundAt(x, 6) + 0.1, 6), 0.025, 4, rust);
  rail(-0.3);
  rail(0.3);
  for (let z = 0.3; z < 6; z += rng.range(0.55, 0.75)) {
    out.box(f.at(rng.range(-0.04, 0.04), f.groundAt(0, z) + 0.04, z), 0.5, 0.05, 0.08, f.yaw + rng.range(-0.1, 0.1), shade(wood, rng.range(0.6, 0.85)));
  }
  // The ore cart, a tub on wheels, left halfway out.
  const cz = rng.range(2.5, 4), cg = f.groundAt(0, cz) + 0.12;
  for (const [x, z] of [[-0.3, cz - 0.35], [0.3, cz - 0.35], [-0.3, cz + 0.35], [0.3, cz + 0.35]] as const) {
    out.rod(a(x * 1.15, cg + 0.12, z), a(x * 0.85, cg + 0.12, z), 0.13, 8, shade(rust, 0.7), shade(rust, 0.6));
  }
  // The tub: wider at the top, open, rust inside.
  const tub = (x: number, y: number, z: number): Vec3 => f.at(x, y, cz + z);
  const y0 = cg + 0.25, y1 = cg + 0.8;
  const lo: Vec3[] = [tub(-0.3, y0, -0.42), tub(0.3, y0, -0.42), tub(0.3, y0, 0.42), tub(-0.3, y0, 0.42)];
  const hi: Vec3[] = [tub(-0.45, y1, -0.6), tub(0.45, y1, -0.6), tub(0.45, y1, 0.6), tub(-0.45, y1, 0.6)];
  for (let k = 0; k < 4; k++) {
    const k1 = (k + 1) % 4;
    sheet(out, [lo[k]!, lo[k1]!, hi[k1]!, hi[k]!], shade(rust, k % 2 ? 0.95 : 1.05));
  }
  sheet(out, lo, shade(rust, 0.55));
  solid(o, out, f, 'cart', 0, cz, 0.45, 0.6, cg, cg + 0.8);
  // The spoil heap off to one side: grey stones in a low mound.
  const sx = rng.float() < 0.5 ? -3.8 : 3.8, sz = rng.range(2.2, 3.5);
  const stone = pick(def, 'stone', rng);
  for (let k = 0; k < 26; k++) {
    const an = rng.float() * Math.PI * 2, d = Math.sqrt(rng.float()) * 1.7;
    const x = sx + Math.cos(an) * d, z = sz + Math.sin(an) * d;
    const h = (1 - d / 1.7) * 0.6;
    out.box(f.at(x, f.groundAt(x, z) + h * 0.5 + 0.05, z), rng.range(0.15, 0.3), h * 0.5 + 0.08, rng.range(0.15, 0.3), rng.float() * Math.PI, shade(stone, rng.range(0.8, 1.1)));
  }
}

/** The lichen colours of a definition. */
function lichens(def: ObjectDef): Rgb[] {
  return (def.colors.lichen ?? []).map((c) => hexColor(c));
}

/** One of a list, at random. */
function pick1<T>(list: readonly T[], rng: Rng): T {
  return list[Math.floor(rng.float() * list.length)]!;
}
