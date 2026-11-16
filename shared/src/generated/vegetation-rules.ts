// Generated from schemas/vegetation-rules.schema.json by scripts/gen-types.ts. Do not edit.

/**
 * What grows where. Lives in defs/biomes.json. Each layer scatters candidate spots on its own jittered grid; at each spot every rule of the layer gets a weight from the ground masks, the weights' sum is the chance that something stands there, and the species is drawn in proportion to the weights.
 */
export interface VegetationRules {
  /**
   * @minItems 1
   */
  layers: [VegetationLayer, ...VegetationLayer[]];
  rules: VegetationRule[];
}
export interface VegetationLayer {
  name: string;
  /**
   * Grid cell size in metres: at most one object per cell.
   */
  spacing: number;
  /**
   * tile = placed per 256 m world tile and kept far out; patch = placed per 32 m patch near the camera only.
   */
  batch: 'tile' | 'patch';
  ranges: LayerRanges;
}
/**
 * Distances in metres out to which each representation is drawn.
 */
export interface LayerRanges {
  /**
   * Full mesh.
   */
  full: number;
  /**
   * Simplified mesh, beyond full.
   */
  low?: number;
  /**
   * Flat picture, beyond low.
   */
  impostor?: number;
}
export interface VegetationRule {
  /**
   * Name of a file in defs/species.
   */
  species: string;
  layer: string;
  /**
   * Chance per grid cell in each land cover class, before the bands below scale it down.
   */
  biomes: {
    [k: string]: number;
  };
  wetness?: Band;
  slope?: Band1;
  elevation?: Band2;
  size: SizeRule;
}
/**
 * 0 dry to 1 standing water.
 */
export interface Band {
  /**
   * @minItems 2
   * @maxItems 2
   */
  prefer: [number, number];
  /**
   * @minItems 2
   * @maxItems 2
   */
  tolerate: [number, number];
}
/**
 * Degrees.
 */
export interface Band1 {
  /**
   * @minItems 2
   * @maxItems 2
   */
  prefer: [number, number];
  /**
   * @minItems 2
   * @maxItems 2
   */
  tolerate: [number, number];
}
/**
 * Metres above (+) or below (-) the region's treeline.
 */
export interface Band2 {
  /**
   * @minItems 2
   * @maxItems 2
   */
  prefer: [number, number];
  /**
   * @minItems 2
   * @maxItems 2
   */
  tolerate: [number, number];
}
/**
 * Height of the instance in metres: either a share of the canopy height mask, or a range of its own.
 */
export interface SizeRule {
  /**
   * Multiplier on the canopy height at the spot.
   */
  canopy?: number;
  /**
   * @minItems 2
   * @maxItems 2
   */
  range?: [number, number];
  /**
   * With range: 1 spreads sizes evenly, 2 or 3 make small ones more common.
   */
  skew?: number;
}
