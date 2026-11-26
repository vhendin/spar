// What the driver has seen of the region, for the map that fills in as you go. Seeing is a
// line-of-sight test over the map's whole-region heights: hills hide what is behind them, and
// forest wears sight out after some 80 metres, so in a wood you see little and from an open
// summit a whole valley. Kept per region in the browser (and with the account) as cells of
// SEEN_CELL metres; see `shared/src/seen.ts`.

import { decodeSeen, encodeSeen, SEEN_CELL, seenCells } from '@spar/shared';

/** The ground the test looks over: heights and tree heights, n × n samples `spacing` apart. */
export interface SightRasters {
  n: number;
  spacing: number;
  heights: Float32Array;
  /** Height of the trees in metres, same layout; 0 for open ground. */
  canopy: Uint8Array | Float32Array;
  /** Metres per canopy unit (the mask stores quarter metres). */
  canopyScale: number;
  /** 1 where there is open water (a lake, a river), same layout; none: no water. */
  water?: Uint8Array;
}

/** Metres of trees that still let sight through; beyond that the forest is a wall. */
export const FOREST_DEPTH = 80;
/** How far sight reaches out over open water, when a look's own range runs out on a lake. */
export const OVER_WATER = 4000;
/** Metres of the far shore seen past the water, once out beyond a look's own range. */
const SHORE = 150;
/** Trees lower than this are not counted as forest (scrub, a clear-cut growing back). */
const TREES = 2;
/** Height over the ground that has to be in sight for a cell to count: a road, a person. */
const TARGET = 1;

export class SeenGrid {
  /** Cells per side. */
  readonly n: number;
  readonly cells: Uint8Array;
  /** Rises with every change, so what is drawn from the grid knows to be drawn again. */
  version = 0;
  /** Cells seen; kept up to date for the read-out. */
  count = 0;
  /** The rectangle of cells changed since `takeChanged`, as i0, j0, i1, j1 (inclusive); null if none. */
  private changed: [number, number, number, number] | null = null;

  constructor(readonly size: number, readonly cell = SEEN_CELL) {
    this.n = seenCells(size, cell);
    this.cells = new Uint8Array(this.n * this.n);
  }

  /** Whether the cell holding a point has been seen. Outside the region: no. */
  has(x: number, z: number): boolean {
    const i = Math.floor(x / this.cell), j = Math.floor(z / this.cell);
    return i >= 0 && j >= 0 && i < this.n && j < this.n && this.cells[j * this.n + i] === 1;
  }

  /** Marks a cell by its indices. */
  setCell(i: number, j: number): void {
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return;
    const k = j * this.n + i;
    if (this.cells[k]) return;
    this.cells[k] = 1;
    this.count++;
    const c = this.changed;
    if (!c) this.changed = [i, j, i, j];
    else {
      if (i < c[0]) c[0] = i;
      if (j < c[1]) c[1] = j;
      if (i > c[2]) c[2] = i;
      if (j > c[3]) c[3] = j;
    }
  }

  /** Marks every cell within `radius` metres of a point. */
  markCircle(x: number, z: number, radius: number): void {
    const before = this.count;
    const r = radius / this.cell, ci = x / this.cell, cj = z / this.cell;
    for (let j = Math.floor(cj - r); j <= Math.ceil(cj + r); j++) {
      for (let i = Math.floor(ci - r); i <= Math.ceil(ci + r); i++) {
        if (Math.hypot(i + 0.5 - ci, j + 0.5 - cj) <= r) this.setCell(i, j);
      }
    }
    if (this.count !== before) this.version++;
  }

  /** Everything seen at once (the proving ground, `?seen=all`). */
  fill(): void {
    this.cells.fill(1);
    this.count = this.cells.length;
    this.changed = [0, 0, this.n - 1, this.n - 1];
    this.version++;
  }

  /** The share of the region seen, 0 to 1. */
  get share(): number {
    return this.count / this.cells.length;
  }

  /** The rectangle changed since last asked, and forgets it. */
  takeChanged(): [number, number, number, number] | null {
    const c = this.changed;
    this.changed = null;
    return c;
  }

  /** Takes what was kept; false when there was nothing (or it was for another size of region). */
  load(text: string | null): boolean {
    const cells = decodeSeen(text, this.size, this.cell);
    if (!cells) return false;
    this.cells.set(cells);
    let count = 0;
    for (let k = 0; k < cells.length; k++) count += cells[k]!;
    this.count = count;
    this.changed = [0, 0, this.n - 1, this.n - 1];
    this.version++;
    return true;
  }

  save(): string {
    return encodeSeen(this.cells, this.size, this.cell);
  }

  /**
   * Fills the specks between seen cells in a rectangle: an unseen cell with at least five of
   * its eight neighbours seen counts as seen. Sight wearing out ray by ray in a wood otherwise
   * leaves the edge of what was seen speckled.
   */
  private fillGaps(i0: number, j0: number, i1: number, j1: number): void {
    const n = this.n, c = this.cells;
    const fill: number[] = [];
    for (let j = Math.max(1, j0 - 1); j <= Math.min(n - 2, j1 + 1); j++) {
      for (let i = Math.max(1, i0 - 1); i <= Math.min(n - 2, i1 + 1); i++) {
        const k = j * n + i;
        if (c[k]) continue;
        const around = c[k - n - 1]! + c[k - n]! + c[k - n + 1]! + c[k - 1]! + c[k + 1]! + c[k + n - 1]! + c[k + n]! + c[k + n + 1]!;
        if (around >= 5) fill.push(i, j);
      }
    }
    for (let f = 0; f < fill.length; f += 2) this.setCell(fill[f]!, fill[f + 1]!);
  }

  /**
   * Looks round from an eye at height `eye` (metres above sea level) over (x, z), as far as
   * `range` metres, and marks what is in sight. Returns how many cells were new. A long look
   * can be done a part at a time: rays `from` up to `to` of `rayCount(range)`.
   */
  look(r: SightRasters, x: number, z: number, eye: number, range: number, from = 0, to = rayCount(range)): number {
    const before = this.count;
    let i0 = this.n, j0 = this.n, i1 = -1, j1 = -1;
    viewshed(r, x, z, eye, range, from, to, (px, pz) => {
      const i = Math.floor(px / this.cell), j = Math.floor(pz / this.cell);
      this.setCell(i, j);
      if (i < i0) i0 = i;
      if (j < j0) j0 = j;
      if (i > i1) i1 = i;
      if (j > j1) j1 = j;
    });
    // Right round the eye is always seen, whatever the trees.
    if (from === 0) this.markCircle(x, z, this.cell * 1.5);
    if (i1 >= 0) this.fillGaps(i0, j0, i1, j1);
    const added = this.count - before;
    if (added) this.version++;
    return added;
  }
}

/** Rays for a look `range` metres out: enough that neighbours are a cell apart at the far end. */
export function rayCount(range: number): number {
  return Math.max(16, Math.ceil((2 * Math.PI * range) / (SEEN_CELL * 0.9)));
}

/**
 * Walks rays `from` up to `to` (of `rayCount(range)`) out from the eye over the rasters and
 * calls `seen` for each point in sight.
 * A point is in sight when the ground there (or the treetops, in forest) stands above every
 * hill between, and when fewer than FOREST_DEPTH metres of trees stand above the line to it.
 * A ray that is out on open water where `range` runs out goes on over the water, up to
 * OVER_WATER metres, and sees SHORE metres of the land beyond: a lake opens up its far side.
 */
export function viewshed(r: SightRasters, x: number, z: number, eye: number, range: number, from: number, to: number, seen: (x: number, z: number) => void): void {
  const { n, spacing, heights, canopy, canopyScale } = r;
  const extent = (n - 1) * spacing;
  const step = spacing;
  const rays = rayCount(range);
  // The angles of the highest treetops passed, highest first: sight through the forest ends
  // where the FOREST_DEPTH-th of them stands above the line, so `woods` holds that many.
  const woodCells = Math.max(1, Math.round(FOREST_DEPTH / step));
  const woods = new Float64Array(woodCells);
  // The highest anything could stand: the top of the region with tall trees on it.
  const roof = highestOf(heights) + 40;
  const { water } = r;
  const far = water ? Math.max(range, OVER_WATER) : range;
  const sample = (px: number, pz: number): number => Math.round(pz / spacing) * n + Math.round(px / spacing);
  const ground = (px: number, pz: number): number => {
    const u = px / spacing, v = pz / spacing;
    const i = Math.min(n - 2, Math.floor(u)), j = Math.min(n - 2, Math.floor(v));
    const fu = u - i, fv = v - j;
    const k = j * n + i;
    const a = heights[k]!, b = heights[k + 1]!, c = heights[k + n]!, d = heights[k + n + 1]!;
    return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
  };
  for (let ray = from; ray < Math.min(to, rays); ray++) {
    const angle = (ray / rays) * Math.PI * 2;
    const dx = Math.cos(angle), dz = Math.sin(angle);
    let hill = -Infinity;
    woods.fill(-Infinity);
    // Out past the range: where the land beyond the water stops being seen.
    let ashore = Infinity;
    for (let d = step; d <= far; d += step) {
      const px = x + dx * d, pz = z + dz * d;
      if (px < 0 || pz < 0 || px > extent || pz > extent) break;
      const k = sample(px, pz);
      const beyond = d > range;
      if (beyond) {
        if (!water![k]) {
          // Back on land: past the range only from the water, and then only the shore.
          if (ashore === Infinity) {
            if (d - step <= range) break;
            ashore = d + SHORE;
          }
          if (d > ashore) break;
        }
      }
      const g = ground(px, pz);
      const tree = canopy[k]! * canopyScale;
      const top = tree >= TREES ? tree : 0;
      const target = (g + Math.max(TARGET, top) - eye) / d;
      const wall = woods[woodCells - 1]!;
      if (target >= hill && target >= wall) {
        seen(px, pz);
        // Past the range the rays spread wider than a cell: fill across to the next.
        if (beyond) {
          const gap = (Math.PI * d) / rays;
          for (let o = SEEN_CELL * 0.9; o < gap; o += SEEN_CELL * 0.9) {
            seen(px - dz * o, pz + dx * o);
            seen(px + dz * o, pz - dx * o);
          }
        }
      }
      // What stands here hides what is beyond: the ground always, trees once deep enough.
      const ga = (g - eye) / d;
      if (ga > hill) hill = ga;
      if (top > 0) {
        const ta = (g + top - eye) / d;
        if (ta > wall) {
          // Into the sorted list of the highest treetops.
          let k = woodCells - 1;
          while (k > 0 && woods[k - 1]! < ta) {
            woods[k] = woods[k - 1]!;
            k--;
          }
          woods[k] = ta;
        }
      }
      // Nothing further can be seen once the line clears even the highest ground of the
      // region with trees on it: rays into a hillside or a dense wood stop early.
      if (Math.max(hill, woods[woodCells - 1]!) * d > roof - eye) break;
    }
  }
}

const highest = new WeakMap<Float32Array, number>();

/** The highest ground in the rasters, worked out once. */
function highestOf(heights: Float32Array): number {
  let h = highest.get(heights);
  if (h === undefined) {
    h = -Infinity;
    for (let k = 0; k < heights.length; k++) if (heights[k]! > h) h = heights[k]!;
    highest.set(heights, h);
  }
  return h;
}
