// What stands at the places worth driving to, which the map data has only as points: a
// lean-to and fire ring at a shelter, a cairn on a summit, a bench at a viewpoint, a tent and
// tables at a camp site, a board at a sight, a cabin at a hut and a bigger house at a lodge.
// The small things to find get theirs too: a boundary stone, a memorial, a wreck, the mouth of
// a mine, ruins, a grave cairn, a spring's trough, a cairn at a pass, barns at a summer farm.
// Where the place is mapped as a building too, the building stands there already and nothing
// is added. Each faces the nearest road or path within reach, so the open side of a shelter
// greets whoever arrives; otherwise the generator turns it downhill, towards the view.

import type { Building, DestinationPoint, FindPoint, PlacedObject, RoadLine } from '@spar/shared';
import { objectRng } from './mesh';

/** Object definition for each kind of place; huts and lodges become buildings instead. */
export const POI_DEFS: Partial<Record<DestinationPoint['kind'], string>> = {
  shelter: 'shelter',
  peak: 'cairn',
  viewpoint: 'viewpoint',
  camp: 'camp_site',
  sight: 'info_board',
};

/** Object definition for each thing to find: by what a historic place is, else by kind. Waterfalls, rapids and fords keep only their water; summer farms get barns. */
export const FIND_DEFS: Record<string, string> = {
  spring: 'spring',
  pass: 'pass_cairn',
  boundary_stone: 'boundary_stone',
  memorial: 'memorial',
  monument: 'memorial',
  wayside_cross: 'memorial',
  aircraft_wreck: 'wreck',
  mine: 'mine',
  ruins: 'ruins',
  tomb: 'grave',
  cairn: 'cairn',
};

/** Half the side of the square kept clear of trees round each, metres. */
const CLEAR: Record<string, number> = {
  shelter: 4.5, cairn: 1.6, viewpoint: 2.5, camp_site: 8, info_board: 1.5,
  spring: 2, pass_cairn: 1.2, boundary_stone: 0.8, memorial: 1.5, wreck: 7, mine: 5, ruins: 4, grave: 2.5,
};
/** A summer farm with a mapped building this close has its buildings already, metres. */
const FARM_BUILT = 40;

/** A building closer than this to the point is taken to be the place itself, metres. */
const OWN_BUILDING = 8;
/** Faces a road or path closer than this, metres. */
const ROAD_REACH = 120;

export interface PoiFeatures {
  objects: PlacedObject[];
  buildings: Building[];
  /** Squares nothing grows in, as outlines. */
  clear: number[][][];
}

/** Distance from (x, z) to the segment a–b, and the closest point on it. */
function toSegment(x: number, z: number, ax: number, az: number, bx: number, bz: number): [number, number, number] {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
  const px = ax + t * dx, pz = az + t * dz;
  return [Math.hypot(x - px, z - pz), px, pz];
}

/** Whether (x, z) is inside an outline or within `margin` of its walls. */
function nearOutline(outline: number[][], x: number, z: number, margin: number): boolean {
  let inside = false;
  for (let k = 0, m = outline.length - 1; k < outline.length; m = k++) {
    const ax = outline[m]![0]!, az = outline[m]![1]!, bx = outline[k]![0]!, bz = outline[k]![1]!;
    if (az > z !== bz > z && x < ax + ((z - az) * (bx - ax)) / (bz - az)) inside = !inside;
    if (toSegment(x, z, ax, az, bx, bz)[0] < margin) return true;
  }
  return inside;
}

/** Degrees (0 north, 90 east) from (x, z) towards the nearest road within reach, or −1 for none. */
function towardsRoad(x: number, z: number, roads: readonly RoadLine[]): number {
  let best = ROAD_REACH, tx = 0, tz = 0;
  for (const r of roads) {
    const p = r.points;
    for (let k = 0; k + 1 < p.length; k++) {
      const a = p[k]!, b = p[k + 1]!;
      // Quick reject on the box round the segment.
      if (x < Math.min(a[0]!, b[0]!) - best || x > Math.max(a[0]!, b[0]!) + best) continue;
      if (z < Math.min(a[1]!, b[1]!) - best || z > Math.max(a[1]!, b[1]!) + best) continue;
      const [d, px, pz] = toSegment(x, z, a[0]!, a[1]!, b[0]!, b[1]!);
      if (d < best) {
        best = d;
        tx = px;
        tz = pz;
      }
    }
  }
  if (best >= ROAD_REACH || Math.hypot(tx - x, tz - z) < 0.5) return -1;
  // North is −z.
  return ((Math.atan2(tx - x, -(tz - z)) * 180) / Math.PI + 360) % 360;
}

const square = (x: number, z: number, h: number): number[][] => [[x - h, z - h], [x + h, z - h], [x + h, z + h], [x - h, z + h]];

/** A rectangle `length` by `width` centred on (x, z), its length across the heading. */
function rectangle(x: number, z: number, length: number, width: number, headingDeg: number): Building['outline'] {
  const h = (headingDeg * Math.PI) / 180;
  // Forward (sin h, −cos h); across it (cos h, sin h).
  const fx = Math.sin(h), fz = -Math.cos(h), ax = Math.cos(h), az = Math.sin(h);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [
    x + (ax * u! * length) / 2 + (fx * v! * width) / 2,
    z + (az * u! * length) / 2 + (fz * v! * width) / 2,
  ]) as Building['outline'];
}

/** The objects and buildings for the places, leaving out those mapped as buildings already. */
export function poiFeatures(
  places: readonly DestinationPoint[],
  buildings: readonly Building[],
  roads: readonly RoadLine[],
  seed: number,
  finds: readonly FindPoint[] = [],
): PoiFeatures {
  const out: PoiFeatures = { objects: [], buildings: [], clear: [] };
  for (const p of places) {
    if (p.kind === 'lift') continue;
    if (buildings.some((b) => nearOutline(b.outline, p.x, p.z, OWN_BUILDING))) continue;
    const road = towardsRoad(p.x, p.z, roads);
    const id = `poi${p.id}`;
    if (p.kind === 'hut' || p.kind === 'lodge') {
      const rng = objectRng(id, seed);
      const heading = road >= 0 ? road : rng.float() * 360;
      const hut = p.kind === 'hut';
      const outline = hut
        ? rectangle(p.x, p.z, rng.range(5, 6.5), rng.range(4, 5), heading)
        : rectangle(p.x, p.z, rng.range(15, 19), rng.range(8.5, 10), heading);
      out.buildings.push(hut ? { id, kind: 'cabin', outline } : { id, kind: 'house', levels: 2, outline });
      continue;
    }
    const kind = POI_DEFS[p.kind];
    if (!kind) continue;
    out.objects.push({ id, kind, x: p.x, z: p.z, heading: road });
    out.clear.push(square(p.x, p.z, CLEAR[kind] ?? 2));
  }
  for (const p of finds) {
    const id = `find${p.id}`;
    if (p.kind === 'farm') {
      if (buildings.some((b) => nearOutline(b.outline, p.x, p.z, FARM_BUILT))) continue;
      // Two or three small barns round the clearing, turned a little from one another.
      const rng = objectRng(id, seed);
      const n = rng.float() < 0.5 ? 2 : 3;
      const turn = rng.float() * 360;
      for (let k = 0; k < n; k++) {
        const a = ((turn + (k * 360) / n) * Math.PI) / 180, d = rng.range(7, 10);
        const x = p.x + Math.sin(a) * d, z = p.z - Math.cos(a) * d;
        const heading = turn + k * 90 + rng.range(-8, 8);
        out.buildings.push({ id: `${id}.${k}`, kind: 'hut', outline: rectangle(x, z, rng.range(4, 5.5), rng.range(3.2, 4), heading) });
      }
      continue;
    }
    const kind = FIND_DEFS[p.what ?? ''] ?? FIND_DEFS[p.kind];
    if (!kind) continue;
    if (buildings.some((b) => nearOutline(b.outline, p.x, p.z, OWN_BUILDING))) continue;
    out.objects.push({ id, kind, x: p.x, z: p.z, heading: towardsRoad(p.x, p.z, roads) });
    out.clear.push(square(p.x, p.z, CLEAR[kind] ?? 2));
  }
  return out;
}
