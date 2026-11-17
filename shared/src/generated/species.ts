// Generated from schemas/species.schema.json by scripts/gen-types.ts. Do not edit.

export type HexColor = string;
/**
 * Bark colour high on the trunk, when it differs.
 */
export type HexColor1 = string;
/**
 * Main colour in summer; for rocks, the stone.
 */
export type HexColor2 = string;
/**
 * Tips, flowers, seed heads or lichen.
 */
export type HexColor3 = string;

/**
 * One kind of plant or rock, drawn by a procedural generator. Lives in defs/species/<name>.json. Adding a species means adding a file here and a rule in defs/biomes.json.
 */
export interface Species {
  name: string;
  /**
   * English name, with the Swedish name in brackets.
   */
  title: string;
  /**
   * Which mesh generator builds it.
   */
  generator: 'conifer' | 'broadleaf' | 'shrub' | 'grass' | 'boulder' | 'stump';
  /**
   * How many different individuals are generated; instances pick one at random.
   */
  variants: number;
  /**
   * Shape parameters read by the generator. A [min, max] pair is drawn anew for every variant. Lengths are fractions of the plant's height.
   */
  params: {
    [k: string]: number | boolean | string | [number, number];
  };
  colors: SpeciesColors;
  seasons: SeasonColors;
  /**
   * True when it stands bare in winter.
   */
  deciduous: boolean;
  wind: SpeciesWind;
  collider?: SpeciesCollider;
}
export interface SpeciesColors {
  bark?: HexColor;
  barkTop?: HexColor1;
  foliage: HexColor2;
  accent?: HexColor3;
  /**
   * How much individuals differ in brightness, 0 to 0.5.
   */
  variation: number;
}
/**
 * Foliage colour through the year.
 */
export interface SeasonColors {
  spring: HexColor;
  summer: HexColor;
  autumn: HexColor;
  winter: HexColor;
}
export interface SpeciesWind {
  /**
   * 0 sways freely, 1 does not move.
   */
  stiffness: number;
}
/**
 * Present when vehicles can hit it. A trunk is a post, a rock is a ball.
 */
export interface SpeciesCollider {
  shape: 'trunk' | 'rock';
  /**
   * Collider radius as a fraction of the instance's height.
   */
  radiusPerHeight: number;
}
