// Generated from schemas/region-def.schema.json by scripts/gen-types.ts. Do not edit.

/**
 * A playable area, as given to the importer. Lives in defs/regions/<name>.json.
 */
export interface RegionDef {
  /**
   * Folder and URL name.
   */
  name: string;
  /**
   * Name shown to players.
   */
  title: string;
  /**
   * Projected coordinate system in metres.
   */
  crs: 'EPSG:3006';
  origin: RegionOrigin;
  /**
   * Side of the square area in metres; a whole number of 2048 m root tiles.
   */
  size: number;
}
/**
 * North-west corner of the area.
 */
export interface RegionOrigin {
  easting: number;
  northing: number;
}
