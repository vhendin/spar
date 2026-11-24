// Roads, paths and streams drawn from their centre lines rather than the 2 m mask. For each
// ground patch the terrain worker writes a small texture with every texel's distance from the
// nearest road edge; the shader cuts at zero between texels, so edges are straight and clean
// at any distance (blended softly for trails and dirt, sharp for asphalt). Patches near the
// camera are small, so their texels are as fine as 25 cm. Pure functions.

import type { RegionIndex, RegionVectors } from '@spar/shared';

/** Distances are kept this many metres each side of an edge, in steps of 1/ROAD_STEPS m. */
export const ROAD_RANGE = 8;
export const ROAD_STEPS = 16;
/** Streams and rivers have no width in the lines; the same as the importer gives them. */
const WATERWAY_WIDTH: Record<string, number> = { stream: 2, river: 8, canal: 5, ditch: 1, drain: 1 };
/** Paths narrower than this are drawn this wide, so they read as a path. */
const MIN_WIDTH = 0.8;
/**
 * A road narrower than this many texels of its patch is drawn that wide but fainter, so far
 * roads thin out instead of breaking into dots.
 */
const MIN_TEXELS = 1.5;
/** Grid cell for finding the lines near a patch, metres. */
const CELL = 64;

export interface RoadLines {
  /** Segments as ax, az, bx, bz. */
  ends: Float32Array;
  halfWidth: Float32Array;
  surface: Uint8Array;
  /** The grid: per cell, the segments touching it (with their width and ROAD_RANGE around). */
  cells: Map<number, number[]>;
}

/** Every road, path and stream as segments, with the surface ids of the region's mask. */
export function roadLines(vectors: Pick<RegionVectors, 'roads' | 'waterways'>, surfaces: RegionIndex['masks']['surfaces']): RoadLines {
  const id = new Map(surfaces.map((s) => [s.name, s.id]));
  const stream = id.get('stream') ?? 0;
  const lines: { points: number[][]; half: number; surface: number }[] = [];
  for (const w of vectors.waterways ?? []) lines.push({ points: w.points, half: (WATERWAY_WIDTH[w.kind] ?? 2) / 2, surface: stream });
  for (const r of vectors.roads ?? []) lines.push({ points: r.points, half: Math.max(r.width, MIN_WIDTH) / 2, surface: id.get(r.surface) ?? 0 });
  let count = 0;
  for (const l of lines) count += Math.max(0, l.points.length - 1);
  const ends = new Float32Array(count * 4);
  const halfWidth = new Float32Array(count);
  const surface = new Uint8Array(count);
  const cells = new Map<number, number[]>();
  let s = 0;
  for (const l of lines) {
    for (let i = 0; i + 1 < l.points.length; i++, s++) {
      const [ax, az] = l.points[i]!;
      const [bx, bz] = l.points[i + 1]!;
      ends.set([ax!, az!, bx!, bz!], s * 4);
      halfWidth[s] = l.half;
      surface[s] = l.surface;
      const reach = l.half + ROAD_RANGE;
      for (let cz = Math.floor((Math.min(az!, bz!) - reach) / CELL); cz <= Math.floor((Math.max(az!, bz!) + reach) / CELL); cz++) {
        for (let cx = Math.floor((Math.min(ax!, bx!) - reach) / CELL); cx <= Math.floor((Math.max(ax!, bx!) + reach) / CELL); cx++) {
          const key = cellKey(cx, cz);
          let list = cells.get(key);
          if (!list) cells.set(key, (list = []));
          list.push(s);
        }
      }
    }
  }
  return { ends, halfWidth, surface, cells };
}

const cellKey = (cx: number, cz: number): number => (cz + 4096) * 8192 + (cx + 4096);

/** Encodes a distance from the edge in metres (negative inside) as a byte. */
export const encodeDistance = (d: number): number => Math.max(0, Math.min(255, Math.round(128 + d * ROAD_STEPS)));
export const decodeDistance = (b: number): number => (b - 128) / ROAD_STEPS;

/**
 * RGBA bytes, `texels` square, north row first, texel (i, j) at (x0 + i * step, z0 + j * step)
 * with step = size / (texels - 1): R the distance from the nearest road edge (encodeDistance),
 * G that road's surface id, B how strongly it shows (255, less where it was widened to stay
 * visible), A unused.
 */
export function buildRoadField(lines: RoadLines, x0: number, z0: number, size: number, texels: number): Uint8Array {
  const out = new Uint8Array(texels * texels * 4);
  const best = new Float32Array(texels * texels).fill(ROAD_RANGE);
  const step = size / (texels - 1);
  const minHalf = (MIN_TEXELS * step) / 2;
  const seen = new Set<number>();
  for (let cz = Math.floor(z0 / CELL); cz <= Math.floor((z0 + size) / CELL); cz++) {
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor((x0 + size) / CELL); cx++) {
      for (const s of lines.cells.get(cellKey(cx, cz)) ?? []) seen.add(s);
    }
  }
  for (const s of seen) {
    const ax = lines.ends[s * 4]!;
    const az = lines.ends[s * 4 + 1]!;
    const bx = lines.ends[s * 4 + 2]!;
    const bz = lines.ends[s * 4 + 3]!;
    const real = lines.halfWidth[s]!;
    const half = Math.max(real, minHalf);
    const strength = Math.round((255 * real) / half);
    const reach = half + ROAD_RANGE;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - x0) / step));
    const i1 = Math.min(texels - 1, Math.ceil((Math.max(ax, bx) + reach - x0) / step));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - reach - z0) / step));
    const j1 = Math.min(texels - 1, Math.ceil((Math.max(az, bz) + reach - z0) / step));
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    for (let j = j0; j <= j1; j++) {
      const pz = z0 + j * step;
      for (let i = i0; i <= i1; i++) {
        const px = x0 + i * step;
        const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2)) : 0;
        const ex = px - ax - t * dx;
        const ez = pz - az - t * dz;
        const d = Math.sqrt(ex * ex + ez * ez) - half;
        const k = j * texels + i;
        if (d < best[k]!) {
          best[k] = d;
          out[k * 4 + 1] = lines.surface[s]!;
          out[k * 4 + 2] = strength;
        }
      }
    }
  }
  for (let k = 0; k < best.length; k++) {
    out[k * 4] = encodeDistance(best[k]!);
    out[k * 4 + 3] = 255;
  }
  return out;
}
