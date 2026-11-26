// The marks along the trails, as they are in the fjäll: red crosses on poles every few dozen
// metres along a snowmobile trail (they stand in summer too), small cairns with an orange top
// along a hiking route, thin wands up an ascent. Power lines need none: the poles are the marks.
// Each stands a little to the side of the line, never in a lake nor on a road.

import type { Lake, PlacedObject, RoadLine, TrailLine } from '@spar/shared';

/** Object kind and spacing in metres for each kind of trail. */
const MARKS: Partial<Record<TrailLine['kind'], { kind: string; every: number; side: number }>> = {
  snowmobile: { kind: 'trail_cross', every: 70, side: 2.5 },
  hiking: { kind: 'trail_cairn', every: 110, side: 2 },
  ascent: { kind: 'trail_wand', every: 50, side: 1.5 },
};
/** Grid cell for finding the roads and lakes near a mark, metres. */
const CELL = 100;
/** A mark is left out closer than this to a drivable road's edge, metres. */
const ROAD_GAP = 2;

/** Degrees from a to b, 0 north (towards −z), 90 east. */
const headingOf = (ax: number, az: number, bx: number, bz: number): number => ((Math.atan2(bx - ax, -(bz - az)) * 180) / Math.PI + 360) % 360;

function inside(outline: readonly number[][], x: number, z: number): boolean {
  let hit = false;
  for (let k = 0, m = outline.length - 1; k < outline.length; m = k++) {
    const ax = outline[m]![0]!, az = outline[m]![1]!, bx = outline[k]![0]!, bz = outline[k]![1]!;
    if (az > z !== bz > z && x < ax + ((z - az) * (bx - ax)) / (bz - az)) hit = !hit;
  }
  return hit;
}

/** The marks along every trail. */
export function trailMarks(trails: readonly TrailLine[], roads: readonly RoadLine[], lakes: readonly Lake[]): PlacedObject[] {
  // Drivable road segments and lakes by grid cell.
  const segs = new Map<number, [number, number, number, number, number][]>();
  const key = (cx: number, cz: number): number => cx * 100_003 + cz;
  for (const r of roads) {
    if (!r.drivable) continue;
    const half = r.width / 2 + ROAD_GAP;
    for (let k = 0; k + 1 < r.points.length; k++) {
      const a = r.points[k]!, b = r.points[k + 1]!;
      const seg: [number, number, number, number, number] = [a[0]!, a[1]!, b[0]!, b[1]!, half];
      for (let cx = Math.floor((Math.min(a[0]!, b[0]!) - half) / CELL); cx <= Math.floor((Math.max(a[0]!, b[0]!) + half) / CELL); cx++) {
        for (let cz = Math.floor((Math.min(a[1]!, b[1]!) - half) / CELL); cz <= Math.floor((Math.max(a[1]!, b[1]!) + half) / CELL); cz++) {
          const list = segs.get(key(cx, cz));
          if (list) list.push(seg);
          else segs.set(key(cx, cz), [seg]);
        }
      }
    }
  }
  const boxes = lakes.map((l) => {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of l.outline) {
      x0 = Math.min(x0, x!); z0 = Math.min(z0, z!); x1 = Math.max(x1, x!); z1 = Math.max(z1, z!);
    }
    return [x0, z0, x1, z1] as const;
  });
  const onRoad = (x: number, z: number): boolean => {
    for (const [ax, az, bx, bz, half] of segs.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) ?? []) {
      const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
      if (Math.hypot(ax + dx * t - x, az + dz * t - z) < half) return true;
    }
    return false;
  };
  const inLake = (x: number, z: number): boolean => lakes.some((l, i) => {
    const b = boxes[i]!;
    return x >= b[0] && z >= b[1] && x <= b[2] && z <= b[3] && inside(l.outline, x, z);
  });

  const out: PlacedObject[] = [];
  for (const t of trails) {
    const m = MARKS[t.kind];
    if (!m) continue;
    let next = m.every / 2, walked = 0, n = 0;
    for (let k = 0; k + 1 < t.points.length; k++) {
      const a = t.points[k]!, b = t.points[k + 1]!;
      const len = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!);
      if (len === 0) continue;
      const ux = (b[0]! - a[0]!) / len, uz = (b[1]! - a[1]!) / len;
      while (next <= walked + len) {
        const d = next - walked;
        // To the right of the way (east when going north).
        const x = a[0]! + ux * d - uz * m.side, z = a[1]! + uz * d + ux * m.side;
        next += m.every;
        if (onRoad(x, z) || inLake(x, z)) continue;
        out.push({ id: `${t.id}#${n++}`, kind: m.kind, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, heading: headingOf(a[0]!, a[1]!, b[0]!, b[1]!) });
      }
      walked += len;
    }
  }
  return out;
}
