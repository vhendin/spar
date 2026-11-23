// Generated from schemas/vehicle.schema.json by scripts/gen-types.ts. Do not edit.

/**
 * @minItems 3
 * @maxItems 3
 */
export type Vec3 = [number, number, number];
export type VehicleColor = string;

/**
 * A vehicle, defined entirely as data. Lives in defs/vehicles/<name>.json. Positions are [x, y, z] in metres in the vehicle's own frame: x to the left, y up, z forward, measured from the point on the ground under the middle of the body when it stands still.
 */
export interface VehicleDef {
  name: string;
  title: string;
  chassis: Chassis;
  wheels: Wheels;
  /**
   * Front to rear; any number.
   *
   * @minItems 2
   */
  axles: [Axle, Axle, ...Axle[]];
  drivetrain: Drivetrain;
  brakes: Brakes;
  tires: Tires;
  body: Body;
  /**
   * Points where things can be hooked on; reserved for the winch.
   */
  attachments: Attachment[];
  winch?: Winch;
}
export interface Chassis {
  /**
   * Kilograms, ready to drive.
   */
  mass: number;
  centerOfMass: Vec3;
  box: CollisionBox;
  /**
   * Height of the lowest part between the axles.
   */
  groundClearance: number;
  /**
   * Deepest water, in metres above the bottom of the tyres, the engine can breathe through; deeper and it drowns. 0.6 if left out.
   */
  wading?: number;
  /**
   * Air drag: the drag coefficient times the frontal area, in square metres (Cd·A). Sets the top speed together with the engine. 0 if left out.
   */
  dragArea?: number;
}
/**
 * The bodywork as a box for collisions: its centre and full width, height and length. The frame under it, between the axles and down to the ground clearance, is added automatically; keeping the box above the wheels gives the vehicle its approach and departure angles.
 */
export interface CollisionBox {
  center: Vec3;
  size: Vec3;
}
export interface Wheels {
  radius: number;
  width: number;
}
export interface Axle {
  /**
   * Position along the vehicle, metres forward of the middle.
   */
  z: number;
  /**
   * Distance between the two wheels' centres.
   */
  track: number;
  driven: boolean;
  /**
   * Largest steering angle in degrees; 0 for an axle that does not steer, negative for one that turns the other way from the front (rear-wheel steering).
   */
  steer: number;
  /**
   * Share of the total brake force this axle gets; shares add up to 1.
   */
  brakeShare: number;
  handbrake?: boolean;
  suspension: Suspension;
  /**
   * open sends drive to the wheel that turns easiest; lockable can be locked by the driver; locked always drives both wheels together; braked is open with traction control, which brakes a spinning wheel so the other one can push with its half of the torque.
   */
  differential: 'open' | 'lockable' | 'locked' | 'braked';
}
/**
 * Per wheel.
 */
export interface Suspension {
  /**
   * Metres the wheel can move up or down from where it rests.
   */
  travel: number;
  /**
   * Spring rate in newtons per metre.
   */
  stiffness: number;
  /**
   * Damper rate in newton seconds per metre.
   */
  damping: number;
}
export interface Drivetrain {
  /**
   * What drives the wheels: a combustion engine (the default) or electric motors. An electric drivetrain has full torque from standstill with no clutch, a single gear, regenerative braking in place of engine braking, no exhaust, and sounds like an electric motor; torqueCurve, idle and redline are then the motor's.
   */
  motor?: 'combustion' | 'electric';
  /**
   * Number of cylinders, for the engine's sound. 6 if left out.
   */
  cylinders?: number;
  /**
   * Engine torque at full throttle as [rpm, newton metres] points, rising in rpm.
   *
   * @minItems 2
   */
  torqueCurve: [[number, number], [number, number], ...[number, number][]];
  /**
   * Engine speed at idle; 0 for an electric motor, which stands still with the vehicle.
   */
  idle: number;
  redline: number;
  /**
   * Forward gear ratios, first gear first.
   *
   * @minItems 1
   */
  gears: [number, ...number[]];
  reverse: number;
  ranges: Ranges;
  /**
   * Crawl control: speeds in km/h, slowest first, that the vehicle holds by itself in low range with the driver only steering, working throttle and brakes; a pedal pressed takes over while it is held. Without it there is none.
   *
   * @minItems 1
   * @maxItems 9
   */
  crawl?:
    | [number]
    | [number, number]
    | [number, number, number]
    | [number, number, number, number]
    | [number, number, number, number, number]
    | [number, number, number, number, number, number]
    | [number, number, number, number, number, number, number]
    | [number, number, number, number, number, number, number, number]
    | [number, number, number, number, number, number, number, number, number];
  /**
   * Axle ratio including any hub reduction.
   */
  finalDrive: number;
  /**
   * Share of engine torque that reaches the wheels.
   */
  efficiency: number;
  /**
   * Braking torque with the throttle closed at the redline, as a share of peak torque. For an electric motor, regenerative braking: the same share at any speed above a crawl.
   */
  engineBraking: number;
  shift: ShiftPoints;
}
/**
 * Transfer case ratios; without 'low' there is no low range.
 */
export interface Ranges {
  high: number;
  low?: number;
}
/**
 * Engine speeds at which the automatic gear change shifts.
 */
export interface ShiftPoints {
  up: number;
  down: number;
}
export interface Brakes {
  /**
   * Total braking force at the tyres with the pedal down, newtons.
   */
  force: number;
}
/**
 * Keyed by the ground names of defs/ground.json.
 */
export interface Tires {
  /**
   * Friction coefficient on dry ground.
   */
  grip: {
    [k: string]: number;
  };
  /**
   * Multiplier on grip when the ground is soaked.
   */
  wetGrip: {
    [k: string]: number;
  };
  /**
   * Drag as a share of the load on the wheel.
   */
  rollingResistance: {
    [k: string]: number;
  };
}
/**
 * Parameters of the procedural body. Heights are above the ground.
 */
export interface Body {
  length: number;
  width: number;
  height: number;
  /**
   * Height of the body's lower edge.
   */
  floor: number;
  /**
   * Height where the windows start.
   */
  beltline: number;
  cabLength: number;
  /**
   * How far the top of the windscreen leans back, metres.
   */
  windscreenRake: number;
  bonnet?: Bonnet;
  /**
   * On a hard top: how far the top of the back leans forward from the beltline, metres; upright when left out.
   */
  tailgateRake?: number;
  /**
   * The body's side outline as [z, y] points (z forward, y up), convex, in order round the outline. Replaces the bonnet, cab and rear shapes with one wedge or slab; the windscreen lies on the outline where it crosses the beltline at the front, and the side windows follow the outline above the beltline.
   *
   * @minItems 3
   */
  profile?: [[number, number], [number, number], [number, number], ...[number, number][]];
  /**
   * What sits behind the cab. 'open' has no roof at all: a tub with low sides, a windscreen frame and a roll bar.
   */
  rear: 'hardtop' | 'canvas' | 'pickup' | 'open';
  roofRack: boolean;
  /**
   * A spare wheel on the back.
   */
  spareWheel?: boolean;
  colors: BodyColors;
  headlights: Vec3[];
  taillights: Vec3[];
  /**
   * Head and tail lamps drawn as one thin strip across, between the outermost lamps, instead of round lamps.
   */
  lightBars?: boolean;
}
/**
 * An engine bonnet ahead of the windscreen; without it the front is flat. cabLength then counts from the front of the bonnet.
 */
export interface Bonnet {
  length: number;
  /**
   * Height of the bonnet's top at the front.
   */
  height: number;
  /**
   * How much higher the bonnet's top is at the windscreen than at the front, metres; 0.06 when left out. A larger rise gives a sloping bonnet.
   */
  rise?: number;
  /**
   * Radius of the rounded edge where the bonnet's top meets the front, metres; a sharp edge when left out.
   */
  nose?: number;
}
export interface BodyColors {
  body: VehicleColor;
  roof: VehicleColor;
  trim: VehicleColor;
  glass: VehicleColor;
  canvas: VehicleColor;
  hub: VehicleColor;
  tire: VehicleColor;
}
export interface Attachment {
  name: string;
  position: Vec3;
}
/**
 * A cable winch: pulls the vehicle towards a tree, rock or building it is hooked to.
 */
export interface Winch {
  /**
   * Name of the attachment point the cable leaves from.
   */
  attachment: string;
  /**
   * Most the winch pulls before it stalls, newtons.
   */
  pull: number;
  /**
   * Cable speed with no load, metres per second.
   */
  speed: number;
  /**
   * Length of cable on the drum, metres.
   */
  cable: number;
}
