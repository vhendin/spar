// Decides what stands where. Pure and repeatable: the same seed, rules and ground data
// give the same objects in every browser, so the forest never travels over the network.
//
// Each layer lays a grid over the whole region. Every cell gets its own random numbers
// from a hash of (seed, layer, cell), so a cell's content does not depend on which batch
// it is placed in, and (layer, cell x, cell z) names an object for good.
//
// Only + - * / and comparisons are used on the way to a decision; those give identical
// results everywhere, unlike sin or pow.

import { hash32 } from '@spar/shared';
import { bandWeight, type CompiledLayer } from './rules';

/** One mask file and one height file that cover the area being placed. */
export interface GroundData {
  mask: Uint8Array;
  /** Local position of the mask file's first sample, sample spacing and samples per side. */
  maskX0: number;
  maskZ0: number;
  maskSpacing: number;
  maskSamples: number;
  /** Plane number of each channel in the mask file. */
  planes: { biome: number; road: number; wetness: number; canopy: number; slope: number };
  /** Multipliers turning mask bytes into 0..1 wetness, metres of canopy and degrees of slope. */
  wetnessScale: number;
  canopyScale: number;
  slopeScale: number;

  heights: Uint16Array;
  heightX0: number;
  heightZ0: number;
  heightSpacing: number;
  /** Stored samples per side, apron included, and the apron width. */
  heightSide: number;
  heightApron: number;
  heightOffset: number;
  heightScale: number;

  waterId: number;
  treeline: number;
  regionSize: number;
}

/** Floats per placed object: x, y, z, size (height in metres), yaw (radians), rand (0..1). */
export const STRIDE = 6;

export interface Placement {
  count: number;
  data: Float32Array;
  species: Uint8Array;
  variant: Uint8Array;
  /** Cell x and z of each object: with the layer id, its permanent name. */
  cells: Int32Array;
}

let state = 0;
/** Mulberry32 step on the module's state; 0..1. */
function next(): number {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Ground height in metres at a local position, interpolated between samples. */
export function groundHeight(g: GroundData, x: number, z: number): number {
  const last = g.heightSide - 2 * g.heightApron - 1;
  let u = (x - g.heightX0) / g.heightSpacing;
  let v = (z - g.heightZ0) / g.heightSpacing;
  u = u < 0 ? 0 : u > last ? last : u;
  v = v < 0 ? 0 : v > last ? last : v;
  let i = Math.floor(u);
  let j = Math.floor(v);
  if (i >= last) i = last - 1;
  if (j >= last) j = last - 1;
  const fu = u - i;
  const fv = v - j;
  const at = (j + g.heightApron) * g.heightSide + i + g.heightApron;
  const h = g.heights;
  const top = h[at]! * (1 - fu) + h[at + 1]! * fu;
  const bottom = h[at + g.heightSide]! * (1 - fu) + h[at + g.heightSide + 1]! * fu;
  return g.heightOffset + (top * (1 - fv) + bottom * fv) * g.heightScale;
}

/**
 * Places one layer over the cells whose corner lies in [x0, x1) x [z0, z1), in metres from
 * the region's north-west corner.
 */
export function placeLayer(layer: CompiledLayer, seed: number, x0: number, z0: number, x1: number, z1: number, g: GroundData): Placement {
  const { spacing, rules } = layer;
  const cx0 = Math.ceil(x0 / spacing);
  const cx1 = Math.ceil(x1 / spacing);
  const cz0 = Math.ceil(z0 / spacing);
  const cz1 = Math.ceil(z1 / spacing);
  const capacity = Math.max(0, cx1 - cx0) * Math.max(0, cz1 - cz0);
  const data = new Float32Array(capacity * STRIDE);
  const species = new Uint8Array(capacity);
  const variant = new Uint8Array(capacity);
  const cells = new Int32Array(capacity * 2);
  const weights = new Float64Array(rules.length);
  const plane = g.maskSamples * g.maskSamples;
  const maskLast = g.maskSamples - 1;
  let count = 0;

  for (let cz = cz0; cz < cz1; cz++) {
    for (let cx = cx0; cx < cx1; cx++) {
      state = hash32(seed, layer.id, cx, cz);
      const x = (cx + next()) * spacing;
      const z = (cz + next()) * spacing;
      const chance = next();
      const pick = next();
      const sizeDraw = next();
      const yaw = next();
      const rand = next();
      const variantDraw = next();
      if (x < 0 || z < 0 || x >= g.regionSize || z >= g.regionSize) continue;

      let i = Math.round((x - g.maskX0) / g.maskSpacing);
      let j = Math.round((z - g.maskZ0) / g.maskSpacing);
      i = i < 0 ? 0 : i > maskLast ? maskLast : i;
      j = j < 0 ? 0 : j > maskLast ? maskLast : j;
      const at = j * g.maskSamples + i;
      const biome = g.mask[g.planes.biome * plane + at]!;
      // Nothing grows in open water or on roads, paths and streams.
      if (biome === g.waterId || g.mask[g.planes.road * plane + at]! > 24) continue;

      const wetness = g.mask[g.planes.wetness * plane + at]! * g.wetnessScale;
      const canopy = g.mask[g.planes.canopy * plane + at]! * g.canopyScale;
      const slope = g.mask[g.planes.slope * plane + at]! * g.slopeScale;
      const y = groundHeight(g, x, z);
      const aboveTreeline = y - g.treeline;

      let total = 0;
      for (let r = 0; r < rules.length; r++) {
        const rule = rules[r]!;
        let w = rule.biome[biome] ?? 0;
        if (w > 0) {
          // A tree sized by the canopy needs a canopy to be sized by.
          if (rule.canopy > 0 && canopy < 2) w = 0;
          else w *= bandWeight(rule.wetness, wetness) * bandWeight(rule.slope, slope) * bandWeight(rule.elevation, aboveTreeline);
        }
        weights[r] = w;
        total += w;
      }
      if (total <= 0 || chance >= total) continue;

      let chosen = 0;
      let below = pick * total;
      for (let r = 0; r < rules.length; r++) {
        chosen = r;
        below -= weights[r]!;
        if (below < 0 && weights[r]! > 0) break;
      }
      // Rounding can walk past the end; fall back to the last rule that had any weight.
      while (weights[chosen]! <= 0 && chosen > 0) chosen--;
      const rule = rules[chosen]!;

      let size: number;
      if (rule.canopy > 0) {
        size = canopy * rule.canopy * (0.8 + 0.4 * sizeDraw);
      } else {
        let t = sizeDraw;
        for (let k = 1; k < rule.skew; k++) t *= sizeDraw;
        size = rule.sizeMin + (rule.sizeMax - rule.sizeMin) * t;
      }

      const o = count * STRIDE;
      data[o] = x;
      data[o + 1] = y;
      data[o + 2] = z;
      data[o + 3] = size;
      data[o + 4] = yaw * 6.283185307179586;
      data[o + 5] = rand;
      species[count] = rule.species;
      variant[count] = Math.min(rule.variants - 1, Math.floor(variantDraw * rule.variants));
      cells[count * 2] = cx;
      cells[count * 2 + 1] = cz;
      count++;
    }
  }
  return {
    count,
    data: data.slice(0, count * STRIDE),
    species: species.slice(0, count),
    variant: variant.slice(0, count),
    cells: cells.slice(0, count * 2),
  };
}

/**
 * Reorders a placement so objects are grouped by square chunk of `chunk` metres inside
 * the area starting at x0, z0 with `perSide` chunks per side. Returns where each chunk's
 * objects start; the last entry is the total count.
 */
export function groupByChunk(p: Placement, x0: number, z0: number, chunk: number, perSide: number): Uint32Array {
  const chunks = perSide * perSide;
  const of = new Uint16Array(p.count);
  const starts = new Uint32Array(chunks + 1);
  for (let n = 0; n < p.count; n++) {
    const cx = Math.min(perSide - 1, Math.max(0, Math.floor((p.data[n * STRIDE]! - x0) / chunk)));
    const cz = Math.min(perSide - 1, Math.max(0, Math.floor((p.data[n * STRIDE + 2]! - z0) / chunk)));
    of[n] = cz * perSide + cx;
    starts[of[n]! + 1]!++;
  }
  for (let c = 0; c < chunks; c++) starts[c + 1]! += starts[c]!;
  const fill = starts.slice(0, chunks);
  const data = new Float32Array(p.data.length);
  const species = new Uint8Array(p.count);
  const variant = new Uint8Array(p.count);
  const cells = new Int32Array(p.count * 2);
  for (let n = 0; n < p.count; n++) {
    const to = fill[of[n]!]!++;
    data.set(p.data.subarray(n * STRIDE, (n + 1) * STRIDE), to * STRIDE);
    species[to] = p.species[n]!;
    variant[to] = p.variant[n]!;
    cells[to * 2] = p.cells[n * 2]!;
    cells[to * 2 + 1] = p.cells[n * 2 + 1]!;
  }
  p.data = data;
  p.species = species;
  p.variant = variant;
  p.cells = cells;
  return starts;
}
