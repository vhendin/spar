// Building footprints, for keeping trees and bushes out of houses. Only + - * / and
// comparisons, like the rest of placement, so every browser keeps the same plants.

/** Plants stay this far from a wall, metres, so trunks and crowns do not stand in it. */
export const WALL_MARGIN = 1.2;
/** Grid cell for finding the outlines near a point, metres. */
const CELL = 32;

export interface Footprints {
  outlines: number[][][];
  /** Per grid cell, the outlines (with `reach` round them) that touch it. */
  cells: Map<number, number[]>;
  /** How far from a wall the cells look, metres. */
  reach: number;
}

const cellKey = (cx: number, cz: number): number => (cz + 4096) * 8192 + (cx + 4096);

/** `reach`: the farthest from a wall that `wallDistance2` needs to see, metres. */
export function footprints(outlines: number[][][], reach = WALL_MARGIN): Footprints {
  reach = Math.max(reach, WALL_MARGIN);
  const cells = new Map<number, number[]>();
  outlines.forEach((o, n) => {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of o) {
      x0 = Math.min(x0, x!); z0 = Math.min(z0, z!); x1 = Math.max(x1, x!); z1 = Math.max(z1, z!);
    }
    for (let cz = Math.floor((z0 - reach) / CELL); cz <= Math.floor((z1 + reach) / CELL); cz++) {
      for (let cx = Math.floor((x0 - reach) / CELL); cx <= Math.floor((x1 + reach) / CELL); cx++) {
        const key = cellKey(cx, cz);
        let list = cells.get(key);
        if (!list) cells.set(key, (list = []));
        list.push(n);
      }
    }
  });
  return { outlines, cells, reach };
}

/**
 * The squared distance from (x, z) to the nearest wall, 0 inside a building; Infinity when
 * no building is within the footprints' reach (farther ones may be missed).
 */
export function wallDistance2(f: Footprints, x: number, z: number): number {
  const list = f.cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (!list) return Infinity;
  let best = Infinity;
  for (const n of list) {
    const o = f.outlines[n]!;
    let inside = false;
    for (let k = 0, m = o.length - 1; k < o.length; m = k++) {
      const ax = o[m]![0]!, az = o[m]![1]!, bx = o[k]![0]!, bz = o[k]![1]!;
      if (az > z !== bz > z && x < ax + ((z - az) * (bx - ax)) / (bz - az)) inside = !inside;
      const dx = bx - ax, dz = bz - az;
      const len2 = dx * dx + dz * dz;
      let t = len2 > 0 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = x - ax - t * dx, ez = z - az - t * dz;
      const d2 = ex * ex + ez * ez;
      if (d2 < best) best = d2;
    }
    if (inside) return 0;
  }
  return best;
}

/** Whether (x, z) is inside a building or within WALL_MARGIN of one. */
export function onFootprint(f: Footprints, x: number, z: number): boolean {
  return wallDistance2(f, x, z) < WALL_MARGIN * WALL_MARGIN;
}
