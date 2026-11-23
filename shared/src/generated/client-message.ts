// Generated from schemas/client-message.schema.json by scripts/gen-types.ts. Do not edit.

/**
 * Every message a client may send to the server.
 */
export type ClientMessage =
  | Hello
  | SetWorld
  | Profile
  | State
  | Away
  | Chat
  | Push
  | Room
  | Felled
  | BrokeIce
  | Cable
  | Free
  | Drive
  | Handover
  | Pause
  | Share
  | Arrived;

/**
 * First message on a new connection, with the driver's name and colour.
 */
export interface Hello {
  type: 'hello';
  protocol: number;
  /**
   * The driver's name as others see it; empty lets the server name them.
   */
  name?: string;
  /**
   * The vehicle's paint as #rrggbb; left out, the vehicle keeps its own colours.
   */
  color?: string;
  /**
   * Chosen by the browser tab and kept across reconnects: coming back with it within a minute keeps the same player.
   */
  token?: string;
}
/**
 * Asks the server to change the clock or the weather for everyone. Any field left out stays as it is.
 */
export interface SetWorld {
  type: 'set_world';
  /**
   * Local time of day to jump to, in hours (0 midnight, 13.5 half past one). The date stays.
   */
  hour?: number;
  /**
   * Day of the year to jump to (1 is 1 January), in the same year and at the same time of day.
   */
  day?: number;
  /**
   * Real minutes one in-game day takes from now on; 0 stops the clock, 1440 is real time.
   */
  dayMinutes?: number;
  /**
   * A state to hold the weather in, or auto to let it change by itself.
   */
  weather?: 'auto' | 'clear' | 'overcast' | 'rain';
}
/**
 * A new name or colour for this driver.
 */
export interface Profile {
  type: 'profile';
  /**
   * The driver's name as others see it; empty lets the server name them.
   */
  name: string;
  /**
   * The vehicle's paint as #rrggbb; left out, the vehicle keeps its own colours.
   */
  color?: string;
}
/**
 * A vehicle now: this driver's own, or with `of` one this browser runs for another driver while they are joined by a cable.
 */
export interface State {
  type: 'state';
  /**
   * The player whose vehicle this is, when it is not the sender's own.
   */
  of?: string;
  vehicle: VehicleSnapshot;
}
/**
 * How a driver's vehicle stands at one moment, sent about 20 times a second so others can draw it.
 */
export interface VehicleSnapshot {
  /**
   * The region being driven; others draw the vehicle only in the same one.
   */
  region: string;
  /**
   * Name of the vehicle definition.
   */
  vehicle: string;
  /**
   * Goes up whenever the vehicle is put somewhere new, so others jump it there instead of sliding it.
   */
  jump: number;
  /**
   * The sender's clock, milliseconds; only differences between its own snapshots matter.
   */
  t: number;
  /**
   * The driver has paused: the vehicle stands still.
   */
  paused: boolean;
  /**
   * Position of the body, metres.
   *
   * @minItems 3
   * @maxItems 3
   */
  p: [number, number, number];
  /**
   * Rotation of the body, quaternion x, y, z, w.
   *
   * @minItems 4
   * @maxItems 4
   */
  q: [number, number, number, number];
  /**
   * Velocity of the body, metres a second.
   *
   * @minItems 3
   * @maxItems 3
   */
  v: [number, number, number];
  /**
   * Per wheel, in the definition's order: steering angle (radians), suspension length (metres), sink into soft ground (metres), drive spin (0..1), brake skid (0..1), sideways slide (m/s) and water over the ground under it (metres).
   *
   * @maxItems 12
   */
  wheels:
    | []
    | [[number, number, number, number, number, number, number]]
    | [
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number]
      ]
    | [
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number]
      ]
    | [
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number]
      ]
    | [
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number]
      ]
    | [
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number]
      ]
    | [
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number]
      ]
    | [
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number]
      ]
    | [
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number]
      ]
    | [
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number]
      ]
    | [
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number]
      ]
    | [
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number]
      ];
  /**
   * Headlights on.
   */
  lights: boolean;
  /**
   * Brake lights on.
   */
  braking: boolean;
  /**
   * Per wheel, the kind of ground under the tyre, empty while it is off the ground.
   *
   * @maxItems 12
   */
  ground:
    | []
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string];
  /**
   * What the engine is doing, for its sound and exhaust.
   */
  engine: {
    rpm: number;
    /**
     * -1 reverse, 1.. forward gears.
     */
    gear: number;
    /**
     * Low range engaged.
     */
    low: boolean;
    /**
     * A gear change in progress: no drive.
     */
    shifting: boolean;
    /**
     * The pedal driving the engine, 0..1.
     */
    pedal: number;
    /**
     * Water has got into the engine and stopped it.
     */
    drowned: boolean;
  };
  /**
   * Deepest water around the vehicle, metres above the bottom of its tyres.
   */
  wading: number;
  winch?: SnapshotWinch;
}
/**
 * The winch's cable while it is out, so others can draw it. Left out while it is on the drum.
 */
export interface SnapshotWinch {
  state: 'carrying' | 'hooked' | 'reeling';
  /**
   * The cable's far end, world position, metres.
   *
   * @minItems 3
   * @maxItems 3
   */
  end: [number, number, number];
  /**
   * Cable out, metres.
   */
  length: number;
  /**
   * Newtons the cable pulls with.
   */
  tension: number;
  /**
   * Metres a second of cable, positive winding in.
   */
  drum: number;
  /**
   * Round a trunk or rock: its middle and the strap's radius.
   *
   * @minItems 4
   * @maxItems 4
   */
  strap?: [number, number, number, number];
}
/**
 * This driver's vehicle has left the road (back at the start screen): others stop drawing it.
 */
export interface Away {
  type: 'away';
}
/**
 * A line of chat to everyone.
 */
export interface Chat {
  type: 'chat';
  text: string;
}
/**
 * Our vehicle pushed against another driver's vehicle: the push for their browser to apply, since only it moves that vehicle.
 */
export interface Push {
  type: 'push';
  /**
   * The player whose vehicle was pushed.
   */
  to: string;
  /**
   * Impulse on their vehicle, newton-seconds, world frame.
   *
   * @minItems 3
   * @maxItems 3
   */
  impulse: [number, number, number];
  /**
   * Where it pushed, world position, metres.
   *
   * @minItems 3
   * @maxItems 3
   */
  at: [number, number, number];
}
/**
 * This driver is now in this region: the server sends back what has changed in it.
 */
export interface Room {
  type: 'room';
  /**
   * The region it happened in.
   */
  region: string;
}
/**
 * Our vehicle or winch knocked a tree down.
 */
export interface Felled {
  type: 'felled';
  /**
   * The region it happened in.
   */
  region: string;
  tree: FelledTree;
}
/**
 * A tree, or a stretch of wooden fence, knocked down: kept by the server for the session and passed on to everyone in the region.
 */
export interface FelledTree {
  /**
   * The tree's permanent key: layer, cell x, cell z; or a fence stretch's: f, fence id, # piece, : first post.
   */
  key: string;
  /**
   * Where it stood, metres east.
   */
  x: number;
  /**
   * Where it stood, metres south.
   */
  z: number;
  /**
   * The way it fell: a unit vector on the ground, east part.
   */
  dx: number;
  /**
   * The way it fell, south part.
   */
  dz: number;
  /**
   * Trunk diameter, metres, for the sound of it (a fence gives about a pole's).
   */
  diameter: number;
}
/**
 * Our vehicle broke through the ice.
 */
export interface BrokeIce {
  type: 'ice_hole';
  /**
   * The region it happened in.
   */
  region: string;
  hole: IceHole;
}
/**
 * Where a vehicle broke through the ice.
 */
export interface IceHole {
  /**
   * Metres east.
   */
  x: number;
  /**
   * Metres south.
   */
  z: number;
}
/**
 * A winch this browser runs has hooked on to another driver's vehicle (`to`), or let go of it (no `to`). The server answers with `towing`.
 */
export interface Cable {
  type: 'cable';
  /**
   * The player whose vehicle's winch it is.
   */
  from: string;
  /**
   * The player whose vehicle it is hooked to.
   */
  to?: string;
  /**
   * Counts this browser's cable messages; `towing` says which it has seen.
   */
  seq: number;
}
/**
 * Our vehicle is being moved somewhere new: every cable on it, or from it, comes off.
 */
export interface Free {
  type: 'free';
  /**
   * Counts with `cable`: `towing` says when it has been seen.
   */
  seq: number;
}
/**
 * Our controls, while another browser runs our vehicle; sent about 20 times a second and at once on a key press.
 */
export interface Drive {
  type: 'drive';
  controls: DriveControls;
}
/**
 * A driver's controls, for the browser that runs their vehicle while it is joined to another by a cable.
 */
export interface DriveControls {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
  /**
   * The pedals are keys, only on or off.
   */
  digital: boolean;
  /**
   * Winching in.
   */
  pull: boolean;
  /**
   * Paying cable out.
   */
  slack: boolean;
  lights: boolean;
  /**
   * Change between high and low range, once.
   */
  range?: boolean;
  /**
   * Crawl control's key, once: the next speed, or off.
   */
  crawl?: 'next' | 'off';
  /**
   * Lock or free this axle's differential, once.
   */
  lock?: number;
  /**
   * Put the vehicle back on its wheels.
   */
  right?: boolean;
  hook?: Anchor;
  /**
   * Unhook the winch.
   */
  release?: boolean;
}
/**
 * Something a winch is hooked to: a tree, rock or building by its permanent key, or another driver's vehicle.
 */
export interface Anchor {
  key: string;
  kind: 'tree' | 'rock' | 'object' | 'vehicle';
  x: number;
  y: number;
  z: number;
  radius: number;
  diameter: number;
  box?: {
    hx: number;
    hz: number;
    yaw: number;
  };
  /**
   * The player whose vehicle it is.
   */
  vehicle?: string;
  /**
   * Where on that vehicle, in its own frame, metres.
   *
   * @minItems 3
   * @maxItems 3
   */
  local?: [number, number, number];
}
/**
 * This browser no longer runs a vehicle: everything about it, for the browser that runs it from now on.
 */
export interface Handover {
  type: 'handover';
  /**
   * The player whose vehicle it is.
   */
  vehicle: string;
  /**
   * The player whose browser runs it now.
   */
  to: string;
  state: VehicleHandover;
}
/**
 * Everything about a vehicle needed to carry on simulating it in another browser.
 */
export interface VehicleHandover {
  /**
   * Name of the vehicle definition.
   */
  vehicle: string;
  jump: number;
  /**
   * @minItems 3
   * @maxItems 3
   */
  p: [number, number, number];
  /**
   * @minItems 4
   * @maxItems 4
   */
  q: [number, number, number, number];
  /**
   * @minItems 3
   * @maxItems 3
   */
  v: [number, number, number];
  /**
   * Spin, radians a second.
   *
   * @minItems 3
   * @maxItems 3
   */
  w: [number, number, number];
  /**
   * Per wheel: sink, water, suspension length, roll (radians).
   *
   * @maxItems 12
   */
  wheels:
    | []
    | [[number, number, number, number]]
    | [[number, number, number, number], [number, number, number, number]]
    | [[number, number, number, number], [number, number, number, number], [number, number, number, number]]
    | [
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number]
      ]
    | [
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number]
      ]
    | [
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number]
      ]
    | [
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number]
      ]
    | [
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number]
      ]
    | [
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number]
      ]
    | [
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number]
      ]
    | [
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number]
      ]
    | [
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number]
      ];
  gear: number;
  low: boolean;
  rpm: number;
  /**
   * @maxItems 6
   */
  locks:
    | []
    | [boolean]
    | [boolean, boolean]
    | [boolean, boolean, boolean]
    | [boolean, boolean, boolean, boolean]
    | [boolean, boolean, boolean, boolean, boolean]
    | [boolean, boolean, boolean, boolean, boolean, boolean];
  holding: boolean;
  /**
   * Crawl control's speed, 1 the slowest; 0 or left out when it is off.
   */
  crawl?: number;
  drowned: boolean;
  /**
   * Angle of the steered wheels, radians.
   */
  steer: number;
  winch?: WinchHandover;
}
/**
 * Everything about a winch needed to carry on running it.
 */
export interface WinchHandover {
  state: 'stowed' | 'carrying' | 'hooked' | 'reeling';
  anchor?: Anchor;
  /**
   * @minItems 3
   * @maxItems 3
   */
  point: [number, number, number];
  /**
   * @minItems 3
   * @maxItems 3
   */
  end: [number, number, number];
  length: number;
  carried: number;
  reelFrom: number;
  /**
   * @minItems 3
   * @maxItems 3
   */
  reelStart: [number, number, number];
}
/**
 * The driver paused or carried on. A paused browser runs no vehicle for others: what it ran goes to a browser in the group that is not paused.
 */
export interface Pause {
  type: 'pause';
  paused: boolean;
}
/**
 * This driver shares a destination with everyone in the region (or stops sharing one, with null): it becomes their destination too.
 */
export interface Share {
  type: 'share';
  /**
   * The region it happened in.
   */
  region: string;
  destination: Destination | null;
}
/**
 * A place to drive to: a point on the map with a name.
 */
export interface Destination {
  name: string;
  /**
   * Metres east.
   */
  x: number;
  /**
   * Metres south.
   */
  z: number;
  /**
   * For a destination from the map data: peak, hut, shelter, viewpoint, lodge, camp, sight or lift.
   */
  kind?: string;
}
/**
 * This driver arrived at their destination, driving there.
 */
export interface Arrived {
  type: 'arrived';
  /**
   * The region it happened in.
   */
  region: string;
  destination: Destination;
}
