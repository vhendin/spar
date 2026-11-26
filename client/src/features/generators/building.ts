import type { Building, ObjectDef } from '@spar/shared';
import { ShapeUtils, Vector2 } from 'three';
import { objectRng, param, pick, shade, type FeatureMesh, type GroundFn, type Rgb, type Solid, type Vec3 } from '../mesh';

/** A footprint's smallest enclosing rectangle: centre, long-axis direction (x, z) = (cos angle, sin angle), half sizes. */
export interface Rect {
  cx: number;
  cz: number;
  angle: number;
  /** Half length along the long axis and half width across it. */
  hl: number;
  hw: number;
}

/** Signed area of an outline in the x-z plane. */
export function outlineArea(outline: number[][]): number {
  let twice = 0;
  for (let k = 0; k < outline.length; k++) {
    const a = outline[k]!, b = outline[(k + 1) % outline.length]!;
    twice += a[0]! * b[1]! - b[0]! * a[1]!;
  }
  return twice / 2;
}

function hull(points: number[][]): number[][] {
  const p = points.map((q) => [q[0]!, q[1]!]).sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
  const cross = (o: number[], a: number[], b: number[]): number => (a[0]! - o[0]!) * (b[1]! - o[1]!) - (a[1]! - o[1]!) * (b[0]! - o[0]!);
  const lower: number[][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: number[][] = [];
  for (const q of p.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** The smallest-area rectangle around an outline, its long side first. */
export function footprintRect(outline: number[][]): Rect {
  const h = hull(outline);
  let best: Rect | null = null;
  let bestArea = Infinity;
  for (let k = 0; k < h.length; k++) {
    const a = h[k]!, b = h[(k + 1) % h.length]!;
    const angle = Math.atan2(b[1]! - a[1]!, b[0]! - a[0]!);
    const c = Math.cos(angle), s = Math.sin(angle);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const q of h) {
      const u = q[0]! * c + q[1]! * s, v = -q[0]! * s + q[1]! * c;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (area < bestArea - 1e-6) {
      bestArea = area;
      const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
      best = { cx: um * c - vm * s, cz: um * s + vm * c, angle, hl: (u1 - u0) / 2, hw: (v1 - v0) / 2 };
    }
  }
  const r = best!;
  if (r.hw > r.hl) return { cx: r.cx, cz: r.cz, angle: r.angle + Math.PI / 2, hl: r.hw, hw: r.hl };
  return r;
}

/** Wall colliders' thickness, metres, inside the outline. */
const WALL = 0.6;

/**
 * Colliders for a building of no simple shape: a thin box along the inside of each wall, so
 * a curved or notched building is solid where it stands and nowhere else (one box round it
 * all would stand across the yards and roads in its bends).
 */
export function wallSolids(id: string, outline: number[][], base: number, top: number): Solid[] {
  const inward = outlineArea(outline) > 0 ? 1 : -1;
  const solids: Solid[] = [];
  for (let k = 0; k < outline.length; k++) {
    const a = outline[k]!, b = outline[(k + 1) % outline.length]!;
    const dx = b[0]! - a[0]!, dz = b[1]! - a[1]!;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    // Left of the edge is inside when the outline turns that way.
    const nx = (-dz / len) * inward, nz = (dx / len) * inward;
    solids.push({
      key: solids.length === 0 ? `b${id}` : `b${id}.w${k}`,
      x: (a[0]! + b[0]!) / 2 + (nx * WALL) / 2,
      y: (base + top) / 2,
      z: (a[1]! + b[1]!) / 2 + (nz * WALL) / 2,
      hx: len / 2 + WALL / 2,
      hy: (top - base) / 2,
      hz: WALL / 2,
      yaw: -Math.atan2(dz, dx),
    });
  }
  return solids;
}

const LARGE_KINDS = new Set(['hotel', 'apartments', 'dormitory', 'industrial', 'supermarket', 'retail', 'commercial', 'college', 'school', 'train_station', 'warehouse', 'barn', 'farm_auxiliary']);
const SMALL_KINDS = new Set(['shed', 'hut', 'garage', 'cabin', 'toilets', 'log_barn']);

/**
 * A building on its mapped footprint. Rectangles get walls, a gable roof, corner boards,
 * windows and a door: small ones become sheds, mid-sized ones houses and cabins, big ones
 * barns or low-roofed halls. L, T and other right-angled shapes are built as overlapping
 * rectangular wings; other shapes are raised as walls with a flat roof.
 */
export function building(b: Building, def: ObjectDef, seed: number, ground: GroundFn, out: FeatureMesh, glow = false): void {
  const rng = objectRng(b.id, seed);
  const area = Math.abs(outlineArea(b.outline));
  const rect = footprintRect(b.outline);
  const fill = area / (4 * rect.hl * rect.hw);
  const large = area >= param(def, 'largeArea', 260, rng) || (LARGE_KINDS.has(b.kind) && area > 120);
  const shed = !large && !glow && (area < param(def, 'shedArea', 16, rng) || (SMALL_KINDS.has(b.kind) && area < 30));

  const heights = b.outline.map(([x, z]) => ground(x, z));
  const low = Math.min(...heights), high = Math.max(...heights);
  const base = low - 0.2;
  const floor = high + (high - low > 2.5 ? 0.15 : param(def, 'foundation', 0.4, rng));

  // Walls: storeys, or the mapped height less a roof.
  const pitchDeg = large ? param(def, 'largePitch', 11, rng) : param(def, 'pitch', 32, rng);
  const pitch = (pitchDeg * Math.PI) / 180;
  let wall: number;
  let storeys = 1;
  if (shed) wall = rng.range(2.0, 2.4);
  else if (b.levels) {
    storeys = Math.round(b.levels);
    wall = storeys * param(def, 'storey', 2.6, rng);
  } else if (large) {
    storeys = ['hotel', 'apartments', 'dormitory', 'college'].includes(b.kind) ? 2 + Math.floor(rng.float() * 2) : 1;
    wall = storeys === 1 ? rng.range(4.2, 5.5) : storeys * 3;
  } else if (area < 60) wall = param(def, 'cabinStorey', 2.3, rng);
  else {
    storeys = rng.float() < 0.4 ? 2 : 1;
    wall = storeys === 2 ? 4.8 : param(def, 'storey', 2.6, rng);
  }
  if (b.height) wall = Math.max(2, b.height - rect.hw * Math.tan(pitch));
  const top = floor + wall;

  // An unpainted log barn (a summer farm's): grey timber, no white trim, an old dark roof.
  const log = b.kind === 'log_barn';
  const walls = log ? pick(def, 'log', rng) : large && rng.float() < 0.7 ? pick(def, 'large', rng) : pick(def, 'walls', rng);
  const trim = log ? shade(walls, 0.8) : pick(def, 'trim', rng);
  const roof = log ? pick(def, 'logRoof', rng) : pick(def, 'roof', rng);
  const door = log ? shade(walls, 0.7) : pick(def, 'door', rng);
  const glass = pick(def, 'glass', rng);
  const stone = pick(def, 'stone', rng);

  // Right-angled footprints that are not plain rectangles become overlapping wings, each
  // with its own gable roof; anything else is raised as walls under a flat roof.
  const wings = fill >= 0.8 || b.outline.length <= 4 ? [rect] : rectWings(b.outline, rect);
  if (!wings) {
    out.solids.push(...wallSolids(b.id, b.outline, base, top));
    prismOutline(b.outline, base, floor, stone, null, out);
    prismOutline(b.outline, floor, top, walls, shade(roof, 0.9), out);
    return;
  }

  const eaves = param(def, 'eaves', 0.4, rng) * (shed ? 0.6 : 1);
  const spacing = param(def, 'windowSpacing', 3.2, rng);
  // A hut or lodge to spend the night at always has one, for the smoke.
  const chimney = !large && ((area > 30 && rng.float() < param(def, 'chimney', 0.7, rng)) || glow);
  const chimneyAt = rng.range(-0.5, 0.5);
  const doorShare = rng.range(-0.6, 0.6) * (shed ? 0.3 : 1);
  const main = wings.reduce((best, w) => (w.hl * w.hw > best.hl * best.hw ? w : best), wings[0]!);

  wings.forEach((wing, n) => {
    const c = Math.cos(wing.angle), s = Math.sin(wing.angle);
    /** Wing frame (u along, v across, y up) to world. */
    const at = (u: number, y: number, v: number): Vec3 => [wing.cx + u * c - v * s, y, wing.cz + u * s + v * c];
    const yaw = -wing.angle;
    const roofRise = wing.hw * Math.tan(pitch);
    out.solids.push({ key: n === 0 ? `b${b.id}` : `b${b.id}.${n}`, x: wing.cx, y: (base + top) / 2, z: wing.cz, hx: wing.hl, hy: (top - base) / 2, hz: wing.hw, yaw });
    out.box(at(0, (base + floor) / 2, 0), wing.hl, (floor - base) / 2, wing.hw, yaw, stone);
    out.box(at(0, (floor + top) / 2, 0), wing.hl, wall / 2, wing.hw, yaw, walls, false, walls);
    if (log) {
      // The courses of logs: a dark seam every 22 cm, the log ends crossing out at the corners.
      const seam = shade(walls, 0.62);
      for (let y = floor + 0.22; y < top - 0.05; y += 0.22) {
        out.box(at(0, y, 0), wing.hl + 0.012, 0.018, wing.hw + 0.012, yaw, seam);
        for (const [u, v] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
          out.box(at(u * (wing.hl + 0.06), y - 0.11, v * (wing.hw + 0.06)), 0.09, 0.1, 0.09, yaw, shade(walls, 0.9));
        }
      }
    }

    // Gable roof along the long side, overhanging at the eaves and the gables.
    const hl = wing.hl + eaves * 0.8, hw = wing.hw + eaves;
    const ridge = top + roofRise;
    const eave = top - eaves * Math.tan(pitch);
    const under = shade(roof, 0.55);
    for (const side of [1, -1]) {
      const a = at(-hl * side, eave, hw * side), b2 = at(hl * side, eave, hw * side), r1 = at(hl * side, ridge, 0), r0 = at(-hl * side, ridge, 0);
      out.face([a, b2, r1, r0], roof);
      const d = -0.12;
      out.face([[r0[0], r0[1] + d, r0[2]], [r1[0], r1[1] + d, r1[2]], [b2[0], b2[1] + d, b2[2]], [a[0], a[1] + d, a[2]]], under);
      // Gable end: the wall colour up to the ridge.
      out.face([at(wing.hl * side, top, wing.hw * side), at(wing.hl * side, top, -wing.hw * side), at(wing.hl * side, ridge, 0)], walls);
    }

    /** A flat panel on a wall: wall normal (nu, nv), centre along the wall, height span and half width. */
    const panel = (nu: number, nv: number, along: number, y0: number, y1: number, half: number, out1: number, color: Rgb): void => {
      const dist = (nu !== 0 ? wing.hl : wing.hw) + out1;
      const tu = nv, tv = -nu; // to the right, seen from outside
      const cu = nu * dist + tu * along, cv = nv * dist + tv * along;
      out.face([at(cu - tu * half, y0, cv - tv * half), at(cu + tu * half, y0, cv + tv * half), at(cu + tu * half, y1, cv + tv * half), at(cu - tu * half, y1, cv - tv * half)], color);
    };
    const addWindow = (nu: number, nv: number, along: number, y0: number, w: number, h: number): void => {
      panel(nu, nv, along, y0 - 0.1, y0 + h + 0.1, w / 2 + 0.1, 0.03, trim);
      panel(nu, nv, along, y0, y0 + h, w / 2, 0.05, glass);
      if (glow) {
        // Where it glows at night: just outside the glass.
        const dist = (nu !== 0 ? wing.hl : wing.hw) + 0.07;
        const p = at(nu * dist + nv * along, y0 + h / 2, nv * dist - nu * along);
        out.spots.push({ key: b.id, kind: 'window', x: p[0], y: p[1], z: p[2], nx: nu * c - nv * s, nz: nu * s + nv * c, w, h });
      }
    };

    if (!large) {
      for (const [u, v] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        out.box(at(u * (wing.hl - 0.06), (floor + top) / 2, v * (wing.hw - 0.06)), 0.1, wall / 2, 0.1, yaw, trim);
      }
    }

    // Door on one long side of the main wing, windows along both long sides and on the gables.
    const isMain = wing === main;
    const doorAt = doorShare * wing.hl;
    const doorWidth = large ? 2.6 : shed ? 0.9 : 1.0;
    const doorHeight = large ? 3.2 : shed ? 1.8 : 2.0;
    if (isMain) {
      panel(0, 1, doorAt, floor - 0.05, floor + doorHeight + 0.12, doorWidth / 2 + 0.12, 0.03, trim);
      panel(0, 1, doorAt, floor - 0.05, floor + doorHeight, doorWidth / 2, 0.05, door);
    }
    if (shed) return;

    const rows = large ? storeys : storeys === 2 ? 2 : 1;
    const rowHeight = wall / rows;
    const count = Math.max(1, Math.floor((wing.hl * 2 - 1) / spacing));
    for (let row = 0; row < rows; row++) {
      const y0 = floor + row * rowHeight + Math.min(0.9, rowHeight * 0.32);
      const h = Math.min(1.25, rowHeight * 0.45);
      for (let k = 0; k < count; k++) {
        const along = (k - (count - 1) / 2) * ((wing.hl * 2 - 1) / count);
        for (const side of [1, -1]) {
          if (isMain && side === 1 && row === 0 && Math.abs(along - doorAt) < doorWidth / 2 + 0.8) continue;
          // The panel's own right-hand direction flips with the side; mirror so windows line up.
          addWindow(0, side, along * side, y0, 0.95, h);
        }
      }
    }
    // Gable windows, and a loft window under the ridge on taller roofs.
    if (!large && wing.hw > 1.6) {
      for (const side of [1, -1]) {
        addWindow(side, 0, 0, floor + 0.9, 0.9, 1.1);
        if (roofRise > 1.6) addWindow(side, 0, 0, top + 0.25, 0.6, 0.7);
      }
    }
    if (isMain && chimney) {
      const u = wing.hl * chimneyAt;
      const v = wing.hw * 0.25;
      const y0 = top + roofRise * 0.5;
      const y1 = ridge + 0.8;
      out.box(at(u, (y0 + y1) / 2, v), 0.3, (y1 - y0) / 2, 0.3, yaw, shade(stone, 1.15), false, shade(stone, 0.4));
      if (glow) {
        const p = at(u, y1, v);
        out.spots.push({ key: b.id, kind: 'chimney', x: p[0], y: p[1], z: p[2] });
      }
    }
  });
}

/** True when a point lies inside a polygon (even-odd rule). */
function insidePolygon(poly: number[][], u: number, v: number): boolean {
  let inside = false;
  for (let k = 0, j = poly.length - 1; k < poly.length; j = k++) {
    const a = poly[k]!, b = poly[j]!;
    if (a[1]! > v !== b[1]! > v && u < ((b[0]! - a[0]!) * (v - a[1]!)) / (b[1]! - a[1]!) + a[0]!) inside = !inside;
  }
  return inside;
}

/**
 * Splits a right-angled footprint (L, T, U and jogged shapes) into rectangles that cover
 * it, each as large as it can be; they may overlap, as the wings of real houses do. Null
 * when the outline has slanted sides.
 */
export function rectWings(outline: number[][], rect: Rect): Rect[] | null {
  const c = Math.cos(rect.angle), s = Math.sin(rect.angle);
  const local = outline.map(([x, z]) => [(x! - rect.cx) * c + (z! - rect.cz) * s, -(x! - rect.cx) * s + (z! - rect.cz) * c]);
  for (let k = 0; k < local.length; k++) {
    const a = local[k]!, b = local[(k + 1) % local.length]!;
    const du = Math.abs(b[0]! - a[0]!), dv = Math.abs(b[1]! - a[1]!);
    if (Math.min(du, dv) > 0.2 * Math.max(du, dv) + 0.15) return null;
  }
  const levels = (values: number[]): number[] => {
    const sorted = [...values].sort((a, b) => a - b);
    const out: number[] = [];
    for (const v of sorted) if (out.length === 0 || v - out[out.length - 1]! > 0.4) out.push(v);
    return out;
  };
  const us = levels(local.map((p) => p[0]!)), vs = levels(local.map((p) => p[1]!));
  const nu = us.length - 1, nv = vs.length - 1;
  if (nu < 1 || nv < 1 || nu > 10 || nv > 10) return null;
  const inside: boolean[][] = [];
  for (let i = 0; i < nu; i++) {
    inside.push([]);
    for (let j = 0; j < nv; j++) inside[i]!.push(insidePolygon(local, (us[i]! + us[i + 1]!) / 2, (vs[j]! + vs[j + 1]!) / 2));
  }
  const covered = inside.map((col) => col.map((v) => !v));
  const wings: Rect[] = [];
  while (wings.length < 4) {
    let best: [number, number, number, number] | null = null;
    let bestGain = 0;
    for (let i0 = 0; i0 < nu; i0++) for (let i1 = i0; i1 < nu; i1++) for (let j0 = 0; j0 < nv; j0++) for (let j1 = j0; j1 < nv; j1++) {
      let ok = true, gain = 0;
      for (let i = i0; i <= i1 && ok; i++) for (let j = j0; j <= j1; j++) {
        if (!inside[i]![j]) { ok = false; break; }
        if (!covered[i]![j]) gain += (us[i + 1]! - us[i]!) * (vs[j + 1]! - vs[j]!);
      }
      if (ok && gain > bestGain + 1e-6) { bestGain = gain; best = [i0, i1, j0, j1]; }
    }
    if (!best || bestGain < 4) break;
    const [i0, i1, j0, j1] = best;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) covered[i]![j] = true;
    const cu = (us[i0]! + us[i1 + 1]!) / 2, cv = (vs[j0]! + vs[j1 + 1]!) / 2;
    const hu = (us[i1 + 1]! - us[i0]!) / 2, hv = (vs[j1 + 1]! - vs[j0]!) / 2;
    const cx = rect.cx + cu * c - cv * s, cz = rect.cz + cu * s + cv * c;
    wings.push(hu >= hv ? { cx, cz, angle: rect.angle, hl: hu, hw: hv } : { cx, cz, angle: rect.angle + Math.PI / 2, hl: hv, hw: hu });
  }
  return wings.length > 0 ? wings : null;
}

/** Walls along any outline from y0 to y1, with a flat lid in `lid` colour. */
function prismOutline(outline: number[][], y0: number, y1: number, color: Rgb, lid: Rgb | null, out: FeatureMesh): void {
  const ccw = outlineArea(outline) > 0;
  for (let k = 0; k < outline.length; k++) {
    let a = outline[k]!, b = outline[(k + 1) % outline.length]!;
    // In x-z with z southwards, a positive area runs clockwise seen from above.
    if (!ccw) [a, b] = [b, a];
    out.face([[b[0]!, y0, b[1]!], [a[0]!, y0, a[1]!], [a[0]!, y1, a[1]!], [b[0]!, y1, b[1]!]], color);
  }
  if (!lid) return;
  const contour = outline.map(([x, z]) => new Vector2(x!, z!));
  for (const [i, j, k] of ShapeUtils.triangulateShape(contour, [])) {
    const p = [contour[i!]!, contour[j!]!, contour[k!]!];
    const tri: Vec3[] = p.map((q) => [q.x, y1, q.y]);
    // Keep the lid facing up whatever the triangulation's winding.
    const up = (tri[1]![2] - tri[0]![2]) * (tri[2]![0] - tri[0]![0]) - (tri[1]![0] - tri[0]![0]) * (tri[2]![2] - tri[0]![2]);
    out.face(up >= 0 ? tri : [tri[0]!, tri[2]!, tri[1]!], lid);
  }
}
