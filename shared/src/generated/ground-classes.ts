// Generated from schemas/ground-classes.schema.json by scripts/gen-types.ts. Do not edit.

/**
 * The land cover (biome) classes and the surface classes of narrow features (roads, paths, streams) stored in region masks. Lives in defs/ground.json. Ids are what the mask files hold; never renumber, only append.
 */
export interface GroundClasses {
  /**
   * @minItems 1
   */
  biomes: [GroundClass, ...GroundClass[]];
  /**
   * @minItems 1
   */
  surfaces: [GroundClass, ...GroundClass[]];
}
export interface GroundClass {
  id: number;
  name: string;
}
