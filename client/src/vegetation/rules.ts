// Turns the vegetation rules from defs/ into flat tables the placement loop can run fast.

import type { RegionIndex, Species, VegetationRules } from '@spar/shared';

/** Weight 1 between p0 and p1, 0 outside t0..t1, sliding in between. */
export interface Band {
  t0: number;
  p0: number;
  p1: number;
  t1: number;
}

export interface CompiledRule {
  /** Index into the species list. */
  species: number;
  variants: number;
  /** Chance per cell by biome id. */
  biome: number[];
  wetness: Band | null;
  slope: Band | null;
  elevation: Band | null;
  /** Height = canopy mask * this, or 0 when the rule uses its own range. */
  canopy: number;
  sizeMin: number;
  sizeMax: number;
  skew: number;
}

export interface CompiledLayer {
  /** Position in defs/biomes.json; part of every placed object's identity. */
  id: number;
  name: string;
  spacing: number;
  batch: 'tile' | 'patch';
  ranges: { full: number; low?: number; impostor?: number };
  rules: CompiledRule[];
}

export function bandWeight(band: Band | null, v: number): number {
  if (band === null) return 1;
  if (v <= band.t0 || v >= band.t1) return v >= band.p0 && v <= band.p1 ? 1 : 0;
  if (v < band.p0) return (v - band.t0) / (band.p0 - band.t0);
  if (v > band.p1) return (band.t1 - v) / (band.t1 - band.p1);
  return 1;
}

const band = (b: { prefer: number[]; tolerate: number[] } | undefined): Band | null =>
  b ? { t0: b.tolerate[0]!, p0: b.prefer[0]!, p1: b.prefer[1]!, t1: b.tolerate[1]! } : null;

export function compileRules(rules: VegetationRules, species: Species[], biomes: RegionIndex['masks']['biomes']): CompiledLayer[] {
  const biomeCount = Math.max(...biomes.map((b) => b.id)) + 1;
  return rules.layers.map((layer, id) => ({
    id,
    name: layer.name,
    spacing: layer.spacing,
    batch: layer.batch,
    ranges: layer.ranges,
    rules: rules.rules
      .filter((r) => r.layer === layer.name)
      .map((r) => {
        const at = species.findIndex((s) => s.name === r.species);
        if (at < 0) throw new Error(`defs/biomes.json names an unknown species "${r.species}"`);
        const weights = new Array<number>(biomeCount).fill(0);
        for (const [name, chance] of Object.entries(r.biomes)) {
          const biome = biomes.find((b) => b.name === name);
          if (biome) weights[biome.id] = chance;
        }
        return {
          species: at,
          variants: species[at]!.variants,
          biome: weights,
          wetness: band(r.wetness),
          slope: band(r.slope),
          elevation: band(r.elevation),
          canopy: r.size.canopy ?? 0,
          sizeMin: r.size.range?.[0] ?? 0,
          sizeMax: r.size.range?.[1] ?? 0,
          skew: r.size.skew ?? 1,
        };
      }),
  }));
}
