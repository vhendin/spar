// Generated from schemas/region-vectors.schema.json by scripts/gen-types.ts. Do not edit.

/**
 * @minItems 2
 */
export type Line = [[number, number], [number, number], ...[number, number][]];
/**
 * Outer shoreline, cut at the area edge.
 *
 * @minItems 2
 */
export type Line1 = [[number, number], [number, number], ...[number, number][]];

/**
 * Line and outline data of a region, written by the importer to vectors.json. All coordinates are [x, z] in metres from the north-west corner: x east, z south.
 */
export interface RegionVectors {
  roads: RoadLine[];
  waterways: Waterway[];
  lakes: Lake[];
  places: Place[];
  /**
   * Points on drivable roads where a vehicle can start; the first is the default.
   */
  spawns: SpawnPoint[];
}
export interface RoadLine {
  /**
   * Stable id: OpenStreetMap way id, plus a part number when the way was cut at the area edge.
   */
  id: string;
  /**
   * OpenStreetMap highway value.
   */
  kind: string;
  /**
   * Name of a surface class.
   */
  surface: string;
  /**
   * Metres.
   */
  width: number;
  /**
   * True for ways meant for motor vehicles.
   */
  drivable: boolean;
  bridge?: boolean;
  name?: string;
  points: Line;
}
export interface Waterway {
  id: string;
  /**
   * OpenStreetMap waterway value, such as stream or river.
   */
  kind: string;
  name?: string;
  points: Line;
}
export interface Lake {
  id: string;
  name?: string;
  /**
   * Water surface elevation in metres.
   */
  level: number;
  outline: Line1;
}
export interface Place {
  name: string;
  kind: string;
  x: number;
  z: number;
}
export interface SpawnPoint {
  name: string;
  x: number;
  z: number;
  /**
   * Direction along the road in degrees: 0 north, 90 east.
   */
  heading: number;
  /**
   * Id of the road the point lies on.
   */
  road: string;
}
