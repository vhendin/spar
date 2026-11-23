// Which tile builds which object. Each object belongs to exactly one tile, so it is built
// once and its collider keeps one name, however many tiles are loaded around it.

import type { Building, FenceLine, Lift, PlacedObject, PowerLine, RegionVectors } from '@spar/shared';

export interface FencePiece {
  /** Fence id plus the piece number: stable, since pieces follow from the data alone. */
  id: string;
  kind: string;
  points: number[][];
}

export interface TileJob {
  buildings: Building[];
  /** Lines with the numbers of the poles standing in this tile. */
  power: { line: PowerLine; poles: number[] }[];
  fences: FencePiece[];
  objects: PlacedObject[];
  /** Lifts passing through, with the tile's own ground [x0, z0, x1, z1): its towers and stations are built here. */
  lifts: { lift: Lift; box: [number, number, number, number] }[];
}

export type FeatureVectors = Pick<RegionVectors, 'buildings' | 'powerLines' | 'fences' | 'objects' | 'lifts'>;

/** Whether a point lies on a tile's own ground. */
export const inBox = (box: [number, number, number, number], x: number, z: number): boolean => x >= box[0] && z >= box[1] && x < box[2] && z < box[3];

export const tileKey = (tx: number, tz: number): string => `${tx},${tz}`;

/** Splits every feature by tile: buildings by their first corner's centre, lines segment by segment. */
export function assignToTiles(v: FeatureVectors, tileSize: number, regionSize: number): Map<string, TileJob> {
  const jobs = new Map<string, TileJob>();
  const last = Math.ceil(regionSize / tileSize) - 1;
  const tileOf = (x: number, z: number): string =>
    tileKey(Math.min(last, Math.max(0, Math.floor(x / tileSize))), Math.min(last, Math.max(0, Math.floor(z / tileSize))));
  const job = (key: string): TileJob => {
    let j = jobs.get(key);
    if (!j) jobs.set(key, (j = { buildings: [], power: [], fences: [], objects: [], lifts: [] }));
    return j;
  };
  const inside = (x: number, z: number): boolean => x >= 0 && z >= 0 && x <= regionSize && z <= regionSize;

  for (const b of v.buildings) {
    let x = 0, z = 0;
    for (const p of b.outline) { x += p[0]; z += p[1]; }
    job(tileOf(x / b.outline.length, z / b.outline.length)).buildings.push(b);
  }

  for (const line of v.powerLines) {
    const byTile = new Map<string, number[]>();
    line.points.forEach(([x, z], k) => {
      if (!inside(x, z)) return;
      const key = tileOf(x, z);
      byTile.set(key, [...(byTile.get(key) ?? []), k]);
    });
    for (const [key, poles] of byTile) job(key).power.push({ line, poles });
  }

  const cut = (f: FenceLine | FencePiece): void => {
    let piece: number[][] = [];
    let pieceTile = '';
    let n = 0;
    const flush = (): void => {
      if (piece.length >= 2) job(pieceTile).fences.push({ id: `${f.id}#${n++}`, kind: f.kind, points: piece });
      piece = [];
    };
    // Long straight stretches get extra points, so no segment reaches far into another tile.
    const points: number[][] = [f.points[0]!];
    for (let k = 0; k + 1 < f.points.length; k++) {
      const a = f.points[k]!, b = f.points[k + 1]!;
      const steps = Math.ceil(Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!) / (tileSize / 8));
      for (let s = 1; s <= steps; s++) points.push([a[0]! + ((b[0]! - a[0]!) * s) / steps, a[1]! + ((b[1]! - a[1]!) * s) / steps]);
    }
    for (let k = 0; k + 1 < points.length; k++) {
      const a = points[k]!, b = points[k + 1]!;
      const key = tileOf((a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2);
      if (key !== pieceTile) {
        flush();
        pieceTile = key;
        piece = [a];
      }
      piece.push(b);
    }
    flush();
  };
  for (const f of v.fences) cut(f);

  for (const o of v.objects) job(tileOf(o.x, o.z)).objects.push(o);

  // A lift goes to every tile its line crosses inside the region; each builds what stands on it.
  const edge = (t: number): number => (t === last ? regionSize + 1e-6 : (t + 1) * tileSize);
  for (const lift of v.lifts ?? []) {
    const tiles = new Set<string>();
    for (let k = 0; k + 1 < lift.points.length; k++) {
      const a = lift.points[k]!, b = lift.points[k + 1]!;
      const steps = Math.max(1, Math.ceil(Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!) / 4));
      for (let s = 0; s <= steps; s++) {
        const x = a[0]! + ((b[0]! - a[0]!) * s) / steps, z = a[1]! + ((b[1]! - a[1]!) * s) / steps;
        if (inside(x, z)) tiles.add(tileOf(x, z));
      }
    }
    for (const key of tiles) {
      const [tx, tz] = key.split(',').map(Number) as [number, number];
      job(key).lifts.push({ lift, box: [tx === 0 ? 0 : tx * tileSize, tz === 0 ? 0 : tz * tileSize, edge(tx), edge(tz)] });
    }
  }
  return jobs;
}
