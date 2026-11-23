// Generated from schemas/object.schema.json by scripts/gen-types.ts. Do not edit.

export type HexColor = string;

/**
 * One kind of man-made object, built by a procedural generator where the region's vectors place it (buildings, power lines, fences, log piles, lifts). Lives in defs/objects/<name>.json.
 */
export interface ObjectDef {
  name: string;
  /**
   * English name, with the Swedish name in brackets.
   */
  title: string;
  /**
   * Which generator builds it.
   */
  generator: 'building' | 'pole' | 'fence' | 'log_pile' | 'lift';
  /**
   * Shape parameters read by the generator, in metres and degrees. A [min, max] pair is drawn anew for every object.
   */
  params: {
    [k: string]: number | boolean | string | [number, number];
  };
  /**
   * Named palettes; each object picks one colour from each palette. Repeat a colour to make it more common.
   */
  colors: {
    /**
     * @minItems 1
     */
    [k: string]: [HexColor, ...HexColor[]];
  };
  /**
   * Drawn up to this many metres from the camera.
   */
  range: number;
  /**
   * True when vehicles can hit it.
   */
  collider?: boolean;
}
