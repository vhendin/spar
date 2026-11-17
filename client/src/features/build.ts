// Builds everything man-made in one tile: one mesh per object kind, so each kind can be
// shown to its own distance.

import type { ObjectDef } from '@spar/shared';
import { building } from './generators/building';
import { fence } from './generators/fence';
import { logPile } from './generators/logPile';
import { powerLine } from './generators/pole';
import type { TileJob } from './layout';
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
  for (const o of job.objects) {
    const def = defs[o.kind];
    if (def?.generator === 'log_pile') logPile(o, def, seed, ground, mesh(o.kind));
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
