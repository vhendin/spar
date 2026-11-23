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
 * Footprint corners, not repeating the first.
 *
 * @minItems 2
 */
export type Line2 = [[number, number], [number, number], ...[number, number][]];

/**
 * Line and outline data of a region, written by the importer to vectors.json. All coordinates are [x, z] in metres from the north-west corner: x east, z south.
 */
export interface RegionVectors {
  roads: RoadLine[];
  waterways: Waterway[];
  lakes: Lake[];
  places: Place[];
  /**
   * Places worth driving to: summits, huts, shelters, viewpoints, lodges, camp sites and sights from OpenStreetMap, and the top station of every lift. Unnamed ones are named by kind and position. Optional: older regions have none.
   */
  destinations?: DestinationPoint[];
  /**
   * Points on drivable roads where a vehicle can start; the first is the default.
   */
  spawns: SpawnPoint[];
  /**
   * Building footprints from OpenStreetMap.
   */
  buildings: Building[];
  /**
   * Overhead power lines. Every point is a tower or pole; points outside the area only carry the wires.
   */
  powerLines: PowerLine[];
  /**
   * Ski lifts and gondolas, from end station to end station. Points between the ends are towers where mapped; the game adds towers where the ground needs them. Points outside the area only carry the cable. Missing in regions built before lifts were imported.
   */
  lifts?: Lift[];
  /**
   * Fences and walls: mapped ones, and fences along field edges.
   */
  fences: FenceLine[];
  /**
   * Single man-made objects placed by the importer, such as log piles beside fresh clear-cuts.
   */
  objects: PlacedObject[];
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
export interface DestinationPoint {
  /**
   * OpenStreetMap id, such as n123 or w456; for a lift top, the lift's.
   */
  id: string;
  kind: 'peak' | 'hut' | 'shelter' | 'viewpoint' | 'lodge' | 'camp' | 'sight' | 'lift';
  name: string;
  x: number;
  z: number;
  /**
   * Height above sea level from the map (for a lift top, from the ground), metres.
   */
  ele?: number;
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
export interface Building {
  /**
   * Stable id: OpenStreetMap id, plus a part number for multipolygons.
   */
  id: string;
  /**
   * OpenStreetMap building value, such as house, cabin, barn or yes.
   */
  kind: string;
  /**
   * Storeys above ground, when mapped.
   */
  levels?: number;
  /**
   * Height in metres, when mapped.
   */
  height?: number;
  /**
   * OpenStreetMap roof:shape, when mapped.
   */
  roof?: string;
  outline: Line2;
}
export interface PowerLine {
  id: string;
  /**
   * OpenStreetMap power value: line or minor_line.
   */
  kind: string;
  /**
   * Highest voltage in kV, when mapped.
   */
  voltage?: number;
  points: Line;
}
export interface Lift {
  id: string;
  /**
   * OpenStreetMap aerialway value: chair_lift, gondola, cable_car, mixed_lift, drag_lift, t-bar, j-bar, platter, rope_tow or magic_carpet.
   */
  kind: string;
  /**
   * Name, or the lift's number when it has no name.
   */
  name?: string;
  /**
   * People per chair or cabin, when mapped.
   */
  occupancy?: number;
  points: Line;
}
export interface FenceLine {
  id: string;
  /**
   * Name of an object definition: roundpole, wire or stone_wall.
   */
  kind: string;
  points: Line;
}
export interface PlacedObject {
  id: string;
  /**
   * Name of an object definition.
   */
  kind: string;
  x: number;
  z: number;
  /**
   * Degrees: 0 north, 90 east.
   */
  heading: number;
  /**
   * Id of the road it stands beside.
   */
  road?: string;
}
