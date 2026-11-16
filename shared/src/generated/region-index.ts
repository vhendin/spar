// Generated from schemas/region-index.schema.json by scripts/gen-types.ts. Do not edit.

/**
 * Written by the importer to data/regions/<name>/index.json; everything the game needs to load a region. Local coordinates: x runs east and z runs south from the north-west corner, in metres. Rasters are stored north row first.
 */
export interface RegionIndex {
  formatVersion: 1;
  name: string;
  title: string;
  crs: string;
  origin: RegionIndexOrigin;
  /**
   * Side of the square area in metres.
   */
  size: number;
  /**
   * Side of one world tile in metres; object placement works per world tile.
   */
  tileSize: 256;
  center: RegionCenter;
  heights: HeightPyramid;
  horizon: Horizon;
  /**
   * Credit lines for the data used.
   */
  attribution: string[];
}
/**
 * North-west corner in the projected coordinate system.
 */
export interface RegionIndexOrigin {
  easting: number;
  northing: number;
}
/**
 * Geographic position of the middle of the area, for sun and moon.
 */
export interface RegionCenter {
  latitude: number;
  longitude: number;
}
/**
 * Ground elevation as a pyramid of square files. A file at level L holds `samples` x `samples` heights spaced 2^L metres, so it spans (samples - 1) * 2^L metres, plus `apron` extra samples on every side for slope calculations. Neighbouring files share their edge samples, and every level is a subsample of the finest one.
 */
export interface HeightPyramid {
  /**
   * File path template below the region folder, with {level}, {x} and {y}; x counts east and y counts south.
   */
  path: string;
  samples: 257;
  apron: number;
  /**
   * Levels present, finest first.
   *
   * @minItems 1
   */
  levels: [HeightLevel, ...HeightLevel[]];
  encoding: HeightEncoding;
  /**
   * Lowest elevation in the area, metres.
   */
  min: number;
  /**
   * Highest elevation in the area, metres.
   */
  max: number;
  source: ElevationSourceInfo;
}
export interface HeightLevel {
  level: number;
  /**
   * Metres between samples.
   */
  spacing: number;
  /**
   * Metres covered by one file.
   */
  span: number;
  /**
   * Files per side of the area.
   */
  count: number;
}
/**
 * Heights are unsigned 16-bit little-endian integers; metres = offset + value * scale.
 */
export interface HeightEncoding {
  type: 'uint16-le';
  offset: number;
  scale: number;
}
export interface ElevationSourceInfo {
  name: string;
  /**
   * True ground resolution of the source in metres.
   */
  resolution: number;
  /**
   * terrain = bare ground; surface = includes tree tops and roofs.
   */
  kind: 'terrain' | 'surface';
}
/**
 * One coarse height grid reaching beyond the area, for distant terrain.
 */
export interface Horizon {
  path: string;
  /**
   * Samples per side.
   */
  samples: number;
  /**
   * Metres between samples.
   */
  spacing: number;
  /**
   * Metres the grid reaches beyond the area on every side.
   */
  margin: number;
  encoding: HeightEncoding;
}
