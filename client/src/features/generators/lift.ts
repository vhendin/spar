// Ski lifts and gondolas: steel towers along the line, a station at each end, the haul rope
// running up one side and down the other, and chairs, cabins or drag hangers on it.
// Most lifts are mapped by their two end stations only, so towers are placed from the ground:
// each span as long as the lift allows while the rope stays clear of the ground under it,
// and a tower wherever a ridge would come too close. Mapped points between the ends are
// towers too. Every tile asking gets the same answer, since it depends on the ground alone.

import type { Lift, ObjectDef } from '@spar/shared';
import { objectRng, param, pick, shade, type FeatureMesh, type GroundFn, type Rgb, type Vec3 } from '../mesh';

/** Where the rope rests: a tower or an end station. */
export interface Support {
  /** Metres along the line from its first point. */
  s: number;
  x: number;
  z: number;
  /** Ground under it. */
  y: number;
  /** Rope height above the ground here. */
  height: number;
  station: boolean;
  /** Unit direction along the line (from first point to last). */
  dx: number;
  dz: number;
}

/** Metres between ground samples when placing towers. */
const STEP = 4;
/** Ropes dip into the stations: the ground this close to one is not checked for clearance. */
const STATION_REACH = 22;

/** The line as distances along it. */
class Path {
  readonly cum: number[] = [0];
  constructor(readonly points: number[][]) {
    for (let k = 1; k < points.length; k++) this.cum.push(this.cum[k - 1]! + Math.hypot(points[k]![0]! - points[k - 1]![0]!, points[k]![1]! - points[k - 1]![1]!));
  }

  get total(): number {
    return this.cum[this.cum.length - 1]!;
  }

  at(s: number): [number, number] {
    let k = 1;
    while (k < this.cum.length - 1 && this.cum[k]! < s) k++;
    const a = this.points[k - 1]!, b = this.points[k]!;
    const len = this.cum[k]! - this.cum[k - 1]! || 1;
    const t = Math.min(1, Math.max(0, (s - this.cum[k - 1]!) / len));
    return [a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t];
  }

  /** Unit direction at s, averaged over a few metres so a bend tower sits square to both spans. */
  direction(s: number): [number, number] {
    const [ax, az] = this.at(Math.max(0, s - 3)), [bx, bz] = this.at(Math.min(this.total, s + 3));
    const len = Math.hypot(bx - ax, bz - az) || 1;
    return [(bx - ax) / len, (bz - az) / len];
  }
}

/** The lift's look: which of the definition's styles, with rope tows and cable cars told apart. */
function style(lift: Lift, def: ObjectDef): { kind: string; rope: boolean; cableCar: boolean } {
  return { kind: String(def.params.style ?? 'chair'), rope: lift.kind === 'rope_tow', cableCar: lift.kind === 'cable_car' };
}

/** Towers and stations from the first point to the last. */
export function liftSupports(lift: Lift, def: ObjectDef, seed: number, ground: GroundFn): Support[] {
  const rng = objectRng(lift.id, seed);
  const { rope } = style(lift, def);
  const tower = rope ? 1.6 : param(def, 'towerHeight', 10, rng);
  const station = rope ? 1.2 : param(def, 'stationHeight', 5, rng);
  const maxSpan = param(def, 'maxSpan', 250, rng);
  const minSpan = param(def, 'minSpan', 25, rng);
  const clearance = rope ? 0.7 : param(def, 'clearance', 6, rng);
  const path = new Path(lift.points);
  const total = path.total;
  const n = Math.max(1, Math.ceil(total / STEP));
  const ds = total / n;
  const gs: number[] = [];
  for (let i = 0; i <= n; i++) gs.push(ground(...path.at(i * ds)));

  const height = (i: number): number => (i === 0 || i === n ? station : tower);
  const clears = (a: number, b: number, hb: number): boolean => {
    const ya = gs[a]! + height(a), yb = gs[b]! + hb;
    for (let k = a + 1; k < b; k++) {
      const s = k * ds;
      if (s < STATION_REACH || s > total - STATION_REACH) continue;
      if (ya + ((yb - ya) * (k - a)) / (b - a) - gs[k]! < clearance) return false;
    }
    return true;
  };

  // Mapped points are kept as towers; between them, towers go where the ground needs them.
  const fixed = [0, ...path.cum.slice(1, -1).map((s) => Math.round(s / ds)), n].filter((v, k, all) => k === 0 || v > all[k - 1]!);
  const chosen: number[] = [0];
  const longest = Math.max(1, Math.floor(maxSpan / ds)), shortest = Math.max(1, Math.ceil(minSpan / ds));
  for (let f = 1; f < fixed.length; f++) {
    const end = fixed[f]!;
    let at = fixed[f - 1]!;
    while (end - at > longest || !clears(at, end, height(end))) {
      let next = -1;
      for (let k = Math.min(end - 1, at + longest); k >= at + shortest; k--) {
        if (clears(at, k, tower)) {
          next = k;
          break;
        }
      }
      // Over a sharp ridge no span clears: the shortest one, then onwards.
      if (next < 0) next = at + shortest;
      if (end - next < shortest / 2) break;
      chosen.push(next);
      at = next;
    }
    chosen.push(end);
  }

  return chosen.map((i) => {
    const s = i * ds;
    const [x, z] = path.at(s);
    const [dx, dz] = path.direction(s);
    return { s, x, z, y: gs[i]!, height: height(i), station: i === 0 || i === n, dx, dz };
  });
}

/** The rope's resting point on a support, on one side (+1 right of the line's direction, -1 left). */
function attach(p: Support, side: number, gauge: number): Vec3 {
  return [p.x - p.dz * side * gauge / 2, p.y + p.height, p.z + p.dx * side * gauge / 2];
}

/** A point on the rope between two supports, sagging. */
function ropeAt(a: Vec3, b: Vec3, t: number, sag: number): Vec3 {
  const span = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const drop = Math.min(4, span * span * sag);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - 4 * drop * t * (1 - t), a[2] + (b[2] - a[2]) * t];
}

/** Yaw for a box whose x axis lies across the line, to the right of (dx, dz): (cos, -sin) = (-dz, dx). */
const acrossYaw = (dx: number, dz: number): number => Math.atan2(-dx, -dz);

/**
 * The parts of a lift standing in this tile (`own` says which supports are), each with the
 * rope spans and carriers running from it to the next support.
 */
export function lift(l: Lift, def: ObjectDef, seed: number, ground: GroundFn, own: (x: number, z: number) => boolean, out: FeatureMesh): void {
  const { kind, rope, cableCar } = style(l, def);
  const rng = objectRng(`${l.id}:look`, seed);
  const steel = pick(def, 'steel', rng), concrete = pick(def, 'concrete', rng), roof = pick(def, 'roof', rng);
  const chair = pick(def, 'chair', rng), seat = pick(def, 'seat', rng);
  if (kind === 'carpet') return carpet(l, def, ground, own, steel, seat, out);

  const supports = liftSupports(l, def, seed, ground);
  const first = supports[0]!, last = supports[supports.length - 1]!;
  const gauge = rope ? 1.2 : param(def, 'gauge', 5, rng);
  const sag = param(def, 'sag', 0.0004, rng);
  const spacing = param(def, 'spacing', 15, rng);
  const hang = param(def, 'hang', 2.5, rng);
  const seats = l.occupancy ?? param(def, 'seats', 4, rng);
  // The rope goes up on the right of the way up.
  const up = last.y >= first.y ? 1 : -1;
  const stationLength = param(def, 'stationLength', 16, rng), stationWidth = param(def, 'stationWidth', 9, rng);
  const total = last.s;

  supports.forEach((p, k) => {
    if (!own(p.x, p.z)) return;
    const yaw = acrossYaw(p.dx, p.dz);
    if (p.station) {
      const inward = k === 0 ? 1 : -1;
      if (kind === 'drag' || rope) dragStation(l, p, k, inward, gauge, k === 0 ? first.y <= last.y : last.y < first.y, steel, roof, out);
      else bigStation(l, p, k, inward, gauge, stationLength, stationWidth, ground, steel, concrete, roof, out);
    } else {
      tower(l, p, k, kind, rope, gauge, yaw, steel, concrete, out);
    }

    const next = supports[k + 1];
    if (!next) return;
    for (const side of [1, -1]) {
      const a = attach(p, side, gauge), b = attach(next, side, gauge);
      const pieces = Math.max(2, Math.min(16, Math.round((next.s - p.s) / 10)));
      let prev = a;
      for (let j = 1; j <= pieces; j++) {
        const q = ropeAt(a, b, j / pieces, sag);
        out.line(prev, q);
        prev = q;
      }
      if (rope) continue;
      // Carriers along this span, never inside a station or on top of a tower.
      const moving = side === up ? 1 : -1;
      const margin0 = p.station ? stationLength / 2 : 4, margin1 = next.station ? stationLength / 2 : 4;
      const where: number[] = [];
      if (cableCar) {
        if (p.s <= total / 2 && total / 2 < next.s) where.push(total / 2);
      } else {
        const offset = side > 0 ? 0 : spacing / 2;
        for (let s = Math.ceil((p.s + margin0 - offset) / spacing) * spacing + offset; s < next.s - margin1; s += spacing) where.push(s);
      }
      for (const s of where) {
        const at = ropeAt(a, b, (s - p.s) / (next.s - p.s), sag);
        const dx = (next.x - p.x) / (next.s - p.s || 1), dz = (next.z - p.z) / (next.s - p.s || 1);
        carrier(kind, l.kind, cableCar, at, dx * moving * up, dz * moving * up, hang, seats, chair, seat, out);
      }
    }
  });
}

function tower(l: Lift, p: Support, k: number, kind: string, rope: boolean, gauge: number, yaw: number, steel: Rgb, concrete: Rgb, out: FeatureMesh): void {
  const big = kind === 'gondola' ? 1.35 : kind === 'chair' ? 1 : 0.5;
  const top = p.y + p.height;
  if (rope) {
    out.rod([p.x, p.y - 0.3, p.z], [p.x, top + 0.2, p.z], 0.07, 5, steel, steel);
    out.box([p.x, top, p.z], gauge / 2 + 0.1, 0.05, 0.05, yaw, steel, true);
    return;
  }
  const radius = 0.32 * big;
  out.box([p.x, p.y - 0.2, p.z], 0.8 * big + 0.1, 0.55, 0.8 * big + 0.1, yaw, concrete);
  out.rod([p.x, p.y, p.z], [p.x, top - 0.5, p.z], radius, 8, steel, steel);
  out.box([p.x, top - 0.45, p.z], gauge / 2 + 0.35, 0.22 * big + 0.05, 0.22 * big + 0.05, yaw, steel, true);
  // Sheave trains under the rope on both sides.
  const along = kind === 'drag' ? 0.6 : 1.4 * big;
  for (const side of [1, -1]) {
    const c: Vec3 = [p.x - p.dz * side * gauge / 2, top - 0.2, p.z + p.dx * side * gauge / 2];
    out.box(c, 0.12, 0.16, along, yaw, shade(steel, 0.7), true);
  }
  out.solids.push({ key: `l${l.id}:${k}`, x: p.x, y: p.y + p.height / 2, z: p.z, hx: Math.max(radius, 0.8 * big), hy: p.height / 2, hz: Math.max(radius, 0.8 * big), yaw });
}

/** End station of a chair lift or gondola: a deck, pillars, a roof and the bull wheel under it. */
function bigStation(l: Lift, p: Support, k: number, inward: number, gauge: number, length: number, width: number, ground: GroundFn, steel: Rgb, concrete: Rgb, roof: Rgb, out: FeatureMesh): void {
  const yaw = acrossYaw(p.dx, p.dz);
  // The wheel turns at the end point; the building reaches back along the line past it.
  const back = length / 2 - gauge / 2 - 1.5;
  const cx = p.x + p.dx * inward * back, cz = p.z + p.dz * inward * back;
  const corner = (u: number, v: number): [number, number] => [cx - p.dz * u + p.dx * v, cz + p.dx * u + p.dz * v];
  let low = p.y;
  for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) low = Math.min(low, ground(...corner((u * width) / 2, (v * length) / 2)));
  const deck = p.y + 1.1;
  const hy = (deck - (low - 0.6)) / 2;
  out.box([cx, deck - hy, cz], width / 2, hy, length / 2, yaw, concrete, false, shade(concrete, 0.8));
  const roofY = p.y + p.height + 1.6;
  for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    const [x, z] = corner((u * (width - 1)) / 2, (v * (length - 1)) / 2);
    out.rod([x, deck, z], [x, roofY, z], 0.18, 6, steel);
  }
  out.box([cx, roofY + 0.2, cz], width / 2 + 0.6, 0.2, length / 2 + 0.6, yaw, roof, true);
  // Bull wheel, and the operator's hut at the side.
  out.rod([p.x, p.y + p.height - 0.15, p.z], [p.x, p.y + p.height + 0.15, p.z], gauge / 2, 18, shade(steel, 0.8), shade(steel, 0.8));
  const [hx, hz] = corner(width / 2 - 1.4, -inward * (length / 2 - 1.8));
  out.box([hx, deck + 1.3, hz], 1.2, 1.3, 1.4, yaw, shade(roof, 1.6), false, roof);
  out.solids.push({ key: `l${l.id}:${k}`, x: cx, y: deck - hy, z: cz, hx: width / 2, hy, hz: length / 2, yaw });
}

/** End of a drag lift or rope tow: a post with the wheel on top, and a hut at the bottom. */
function dragStation(l: Lift, p: Support, k: number, inward: number, gauge: number, bottom: boolean, steel: Rgb, roof: Rgb, out: FeatureMesh): void {
  const yaw = acrossYaw(p.dx, p.dz);
  const top = p.y + p.height;
  // The post stands just beyond the wheel, out of the way of the riders.
  const px = p.x - p.dx * inward * (gauge / 2 + 0.4), pz = p.z - p.dz * inward * (gauge / 2 + 0.4);
  out.rod([px, p.y - 0.3, pz], [px, top + 0.4, pz], 0.2, 7, steel, steel);
  out.box([(px + p.x) / 2, top + 0.3, (pz + p.z) / 2], 0.12, 0.12, gauge / 2 + 0.4, yaw, steel, true);
  out.rod([p.x, top - 0.1, p.z], [p.x, top + 0.1, p.z], gauge / 2, 14, shade(steel, 0.8), shade(steel, 0.8));
  out.solids.push({ key: `l${l.id}:${k}`, x: px, y: p.y + p.height / 2, z: pz, hx: 0.25, hy: p.height / 2 + 0.3, hz: 0.25, yaw });
  if (!bottom) return;
  const side = gauge / 2 + 3;
  const hx = p.x - p.dz * side + p.dx * inward * 2, hz = p.z + p.dx * side + p.dz * inward * 2;
  out.box([hx, p.y + 0.8, hz], 1.3, 1.6, 1.3, yaw, shade(roof, 1.7), false, roof);
  out.box([hx, p.y + 2.5, hz], 1.6, 0.12, 1.6, yaw, roof, true);
  out.solids.push({ key: `l${l.id}:${k}h`, x: hx, y: p.y + 0.8, z: hz, hx: 1.3, hy: 1.6, hz: 1.3, yaw });
}

/** A chair, cabin or drag hanger gripping the rope at `at`, moving along (dx, dz). */
function carrier(kind: string, liftKind: string, cableCar: boolean, at: Vec3, dx: number, dz: number, hang: number, seats: number, chair: Rgb, seat: Rgb, out: FeatureMesh): void {
  const yaw = acrossYaw(dx, dz);
  const [x, y, z] = at;
  if (kind === 'gondola') {
    const k = cableCar ? 2.4 : 1;
    const cy = y - hang * k - 1.1 * k;
    out.rod(at, [x, cy + 1.1 * k, z], 0.05 * k, 4, shade(chair, 0.5));
    out.box([x, cy, z], 1.0 * k, 1.1 * k, 1.15 * k, yaw, chair, true, shade(chair, 0.85));
    // Windows: a dark band round the upper half.
    out.box([x, cy + 0.35 * k, z], 1.02 * k, 0.4 * k, 1.17 * k, yaw, [0.03, 0.035, 0.04], false, shade(chair, 0.85));
    return;
  }
  if (kind === 'drag') {
    out.box([x, y - 0.35, z], 0.09, 0.3, 0.09, yaw, chair, true);
    const end: Vec3 = [x, y - hang, z];
    out.line([x, y - 0.65, z], end);
    if (liftKind === 'platter') out.rod([x, end[1] - 0.03, z], [x, end[1] + 0.03, z], 0.2, 8, seat, seat);
    else if (liftKind === 'j-bar') out.box([x + Math.cos(yaw) * 0.25, end[1], z - Math.sin(yaw) * 0.25], 0.28, 0.035, 0.035, yaw, seat, true);
    else out.box(end, 0.5, 0.035, 0.035, yaw, seat, true);
    return;
  }
  // A chair: the hanger comes down behind the back, the seat faces the way it travels.
  const half = Math.max(0.5, seats * 0.27);
  const sy = y - hang;
  out.rod(at, [x - dx * 0.35, sy + 0.75, z - dz * 0.35], 0.045, 4, chair);
  out.box([x - dx * 0.35, sy + 0.75, z - dz * 0.35], half * 0.6, 0.04, 0.04, yaw, chair, true);
  out.box([x, sy, z], half, 0.06, 0.28, yaw, seat, true);
  out.box([x - dx * 0.3, sy + 0.38, z - dz * 0.3], half, 0.32, 0.04, yaw, seat, true);
}

/** A moving walkway on the ground: the belt with low edges either side. */
function carpet(l: Lift, def: ObjectDef, ground: GroundFn, own: (x: number, z: number) => boolean, steel: Rgb, belt: Rgb, out: FeatureMesh): void {
  const width = param(def, 'width', 0.9, objectRng(l.id, 0));
  const path = new Path(l.points);
  const steps = Math.max(1, Math.ceil(path.total / 3));
  for (let i = 0; i < steps; i++) {
    const s0 = (path.total * i) / steps, s1 = (path.total * (i + 1)) / steps;
    const [ax, az] = path.at(s0), [bx, bz] = path.at(s1);
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    if (!own(mx, mz)) continue;
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const dx = (bx - ax) / len, dz = (bz - az) / len;
    const yaw = acrossYaw(dx, dz);
    const y = ground(mx, mz);
    out.box([mx, y + 0.12, mz], width / 2, 0.22, len / 2 + 0.05, yaw, belt);
    for (const side of [1, -1]) out.box([mx - dz * side * (width / 2 + 0.08), y + 0.2, mz + dx * side * (width / 2 + 0.08)], 0.08, 0.3, len / 2 + 0.05, yaw, steel);
  }
}
