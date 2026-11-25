// Builds everything man-made in one tile: one mesh per object kind, so each kind can be
// shown to its own distance.

import type { ObjectDef } from '@spar/shared';
import { building } from './generators/building';
import { fence } from './generators/fence';
import { lift } from './generators/lift';
import { logPile } from './generators/logPile';
import { poi } from './generators/poi';
import { powerLine } from './generators/pole';
import { inBox, type TileJob } from './layout';
import { FeatureMesh, type GroundFn, type Solid } from './mesh';

export interface BuiltPart {
  /** Object definition name. */
  kind: string;
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  lines: Float32Array;
}

export interface BuiltTile {
  parts: BuiltPart[];
  solids: Solid[];
  /** Lowest and highest point, for culling. */
  low: number;
  high: number;
}

/** Definition used for each feature family; fences name theirs in the data. */
const BUILDING = 'building';
const POLE = 'power_pole';
/** Definition used for each kind of lift, by OpenStreetMap aerialway value. */
export const LIFT_DEFS: Record<string, string> = {
  chair_lift: 'chair_lift',
  mixed_lift: 'chair_lift',
  gondola: 'gondola',
  cable_car: 'gondola',
  drag_lift: 'drag_lift',
  't-bar': 'drag_lift',
  'j-bar': 'drag_lift',
  platter: 'drag_lift',
  rope_tow: 'drag_lift',
  magic_carpet: 'magic_carpet',
};

export function buildTile(job: TileJob, defs: Record<string, ObjectDef>, seed: number, ground: GroundFn): BuiltTile {
  const meshes = new Map<string, FeatureMesh>();
  const mesh = (kind: string): FeatureMesh => {
    let m = meshes.get(kind);
    if (!m) meshes.set(kind, (m = new FeatureMesh()));
    return m;
  };
  const buildingDef = defs[BUILDING];
  if (buildingDef) for (const b of job.buildings) building(b, buildingDef, seed, ground, mesh(BUILDING));
  const poleDef = defs[POLE];
  if (poleDef) {
    for (const { line, poles } of job.power) {
      const own = new Set(poles);
      powerLine(line, poleDef, seed, ground, (k) => own.has(k), mesh(POLE));
    }
  }
  for (const f of job.fences) {
    const def = defs[f.kind];
    if (def?.generator === 'fence') fence(f.id, f.points, def, seed, ground, mesh(f.kind));
  }
  for (const { lift: l, box } of job.lifts) {
    const name = LIFT_DEFS[l.kind];
    const def = name ? defs[name] : undefined;
    if (def?.generator === 'lift') lift(l, def, seed, ground, (x, z) => inBox(box, x, z), mesh(name!));
  }
  for (const o of job.objects) {
    const def = defs[o.kind];
    if (def?.generator === 'log_pile') logPile(o, def, seed, ground, mesh(o.kind));
    else if (def?.generator === 'poi') poi(o, def, seed, ground, mesh(o.kind));
  }

  const parts: BuiltPart[] = [];
  const solids: Solid[] = [];
  let low = Infinity, high = -Infinity;
  for (const [kind, m] of meshes) {
    const built = m.build();
    if (built.indices.length === 0 && built.lines.length === 0) continue;
    for (const list of [built.positions, built.lines]) {
      for (let k = 1; k < list.length; k += 3) {
        low = Math.min(low, list[k]!);
        high = Math.max(high, list[k]!);
      }
    }
    parts.push({ kind, ...built });
    if (defs[kind]?.collider) solids.push(...m.solids);
  }
  return { parts, solids, low, high };
}
