// Generated from schemas/seasons.schema.json by scripts/gen-types.ts. Do not edit.

/**
 * How the year turns in the region: on which days leaves come out, colour and fall, and the ground greens and withers. Lives in defs/seasons.json. Between two entries everything blends evenly; after the last entry the year wraps round to the first.
 */
export interface SeasonCalendar {
  /**
   * @minItems 2
   */
  calendar: [SeasonKey, SeasonKey, ...SeasonKey[]];
  /**
   * How snow depth grows with height: the calendar's depth lies at `reference` metres above sea level, and every hundred metres higher adds `gainPerHundred` of it (lower takes it away, down to a fifth).
   */
  snowHeight: {
    reference: number;
    gainPerHundred: number;
  };
}
export interface SeasonKey {
  /**
   * Day of the year, 1 for 1 January. Entries go in order.
   */
  day: number;
  /**
   * Which of each species' season colours its foliage has on this day.
   */
  foliage: 'spring' | 'summer' | 'autumn' | 'winter';
  /**
   * How much of a deciduous tree's crown is in leaf, 0 bare to 1 full.
   */
  leaves: number;
  /**
   * The colour of vegetated ground: green summer, coloured autumn, or withered dormant (late autumn to spring).
   */
  ground: 'summer' | 'autumn' | 'dormant';
  /**
   * Depth of lying snow on open ground at the reference height, metres. Precipitation falls as snow while there is any.
   */
  snow: number;
  /**
   * Thickness of the ice on lakes away from streams, metres; 0 when they are open.
   */
  ice: number;
}
