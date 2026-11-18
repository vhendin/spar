// Start points placed by hand on the map, kept on the server beside the region so they survive
// rebuilding it. Anyone can start from them; only the computer running the server may change them.

import type { RegionVectors } from '@spar/shared';

export interface CustomStart {
  name: string;
  x: number;
  z: number;
  /** Degrees: 0 north, 90 east. */
  heading: number;
}

/** Metres from a road within which a start point faces along it. */
const ROAD_REACH = 30;

/** Which way to face at a spot: along the nearest drivable road if there is one close by, else north. */
export function headingAt(vectors: RegionVectors, x: number, z: number): number {
  let best = ROAD_REACH;
  let heading = 0;
  for (const road of vectors.roads) {
    if (!road.drivable) continue;
    for (let i = 1; i < road.points.length; i++) {
      const [ax, az] = road.points[i - 1]!;
      const [bx, bz] = road.points[i]!;
      const dx = bx! - ax!, dz = bz! - az!;
      const length2 = dx * dx + dz * dz;
      const t = length2 === 0 ? 0 : Math.min(1, Math.max(0, ((x - ax!) * dx + (z - az!) * dz) / length2));
      const d = Math.hypot(ax! + dx * t - x, az! + dz * t - z);
      if (d < best) {
        best = d;
        heading = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
      }
    }
  }
  return Math.round(heading * 10) / 10;
}

export class StartStore {
  list: CustomStart[] = [];
  /** Whether this computer may add, rename and remove them. */
  editable = false;

  constructor(private readonly region: string) {}

  async load(): Promise<void> {
    try {
      const res = await fetch(`/api/starts/${this.region}`);
      if (res.ok) this.list = (await res.json()) as CustomStart[];
    } catch {
      // None, then.
    }
  }

  /** Sends the list to the server; resolves with an error message, or null when saved. */
  async save(): Promise<string | null> {
    try {
      const res = await fetch(`/api/starts/${this.region}`, { method: 'PUT', body: JSON.stringify(this.list) });
      return res.ok ? null : ((await res.json()) as { error: string }).error;
    } catch (err) {
      return String(err);
    }
  }
}
