// Generated from schemas/ground-classes.schema.json by scripts/gen-types.ts. Do not edit.

/**
 * The land cover (biome) classes and the surface classes of narrow features (roads, paths, streams) stored in region masks, and the kind of ground each one is to drive on. Lives in defs/ground.json. Ids are what the mask files hold; never renumber, only append.
 */
export interface GroundClasses {
  /**
   * Kinds of ground a tyre can stand on; vehicle definitions give grip and rolling resistance for each.
   *
   * @minItems 1
   */
  grounds: [string, ...string[]];
  /**
   * @minItems 1
   */
  biomes: [GroundClass, ...GroundClass[]];
  /**
   * @minItems 1
   */
  surfaces: [GroundClass, ...GroundClass[]];
  /**
   * How far each kind of ground gives under a tyre, 0 firm to 1 a soft bog, when dry and when soaked by rain. Grounds left out are firm. For water it is the bed under it.
   */
  softness: {
    [k: string]: {
      dry: number;
      wet: number;
    };
  };
  /**
   * Water depth in metres: streams and pools on the surface layer, and how lakes deepen away from the shore.
   */
  water: {
    /**
     * Depth of a stream.
     */
    stream: number;
    /**
     * Depth of a pool.
     */
    pool: number;
    /**
     * Deepest a lake gets, far from its shore.
     */
    lakeMax: number;
    /**
     * Metres from the shore over which a lake reaches about two thirds of its greatest depth.
     */
    lakeShelf: number;
  };
}
export interface GroundClass {
  id: number;
  name: string;
  /**
   * What this class is to drive on: one of `grounds`. A surface class without it leaves the land cover's ground in force.
   */
  ground?: string;
}
