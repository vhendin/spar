// Generated from schemas/server-message.schema.json by scripts/gen-types.ts. Do not edit.

/**
 * Every message the server may send to a client.
 */
export type ServerMessage =
  | Welcome
  | WorldUpdate
  | ServerError
  | Players
  | PlayerState
  | PlayerAway
  | ChatLine
  | PlayerPush
  | RoomState
  | TreeFelled
  | IceBroken
  | Towing
  | DriveFrom
  | HandoverTo
  | DestinationShared
  | ArrivedAt
  | CampState;

/**
 * Reply to hello: who you are and which world to load.
 */
export interface Welcome {
  type: 'welcome';
  protocol: number;
  playerId: string;
  region: string;
  seed: number;
  /**
   * Addresses others on the network can open to join, as the server sees its own network; left out when it cannot tell (in a container).
   */
  addresses?: string[];
}
/**
 * The game clock and the weather, which the server owns. Sent after welcome and every few seconds; clients run the clock on by themselves in between and ease towards new weather.
 */
export interface WorldUpdate {
  type: 'world';
  time: WorldTime;
  weather: WorldWeather;
}
export interface WorldTime {
  /**
   * The in-game instant now, as UTC milliseconds.
   */
  utc: number;
  /**
   * In-game seconds per real second.
   */
  rate: number;
  /**
   * Hours the region's clocks are ahead of UTC.
   */
  utcOffset: number;
  /**
   * While a night passes at a camp: the clock runs fast and stops here, UTC milliseconds.
   */
  until?: number;
}
export interface WorldWeather {
  state: 'clear' | 'overcast' | 'rain';
  /**
   * Share of the sky covered by cloud.
   */
  cloud: number;
  /**
   * Rainfall, 0 none to 1 downpour.
   */
  rain: number;
  /**
   * Wind strength, 0 calm to 1 gale.
   */
  wind: number;
  /**
   * Compass bearing the wind blows towards, degrees.
   */
  windDirection: number;
  /**
   * How wet the ground is, 0 dry to 1 soaked.
   */
  wetness: number;
}
export interface ServerError {
  type: 'error';
  code: 'bad_message' | 'protocol_mismatch';
  message: string;
}
/**
 * Everyone connected, sent whenever someone joins, leaves or changes name or colour.
 */
export interface Players {
  type: 'players';
  players: Player[];
}
export interface Player {
  id: string;
  name: string;
  color?: string;
  /**
   * The region they are in, once they have entered one.
   */
  region?: string;
}
/**
 * A vehicle now, passed on as it was sent: by its driver, or (`by`) by the browser that runs it while it is joined to another by a cable.
 */
export interface PlayerState {
  type: 'state';
  id: string;
  vehicle: VehicleSnapshot;
  /**
   * The player whose browser sent it, when not the vehicle's own driver.
   */
  by?: string;
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
  /**
   * The driver's scouting drone while it is out: position (metres) and facing (radians, 0 along +z). Left out while it sits on the roof.
   *
   * @minItems 4
   * @maxItems 4
   */
  drone?: [number, number, number, number];
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
 * Another driver's vehicle has left the road.
 */
export interface PlayerAway {
  type: 'away';
  id: string;
}
/**
 * A line of chat; without `from` it is the server telling everyone something (a player joined, the weather was changed).
 */
export interface ChatLine {
  type: 'chat';
  /**
   * Player id of the sender.
   */
  from?: string;
  /**
   * The sender's name when it was said.
   */
  name?: string;
  text: string;
}
/**
 * Another vehicle pushed against one this browser runs (`to`); apply it to that body.
 */
export interface PlayerPush {
  type: 'push';
  from: string;
  /**
   * Impulse on our vehicle, newton-seconds, world frame.
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
  /**
   * The player whose vehicle was pushed.
   */
  to: string;
}
/**
 * What has changed in a region this session: sent to a driver entering it.
 */
export interface RoomState {
  type: 'room';
  /**
   * The region it happened in.
   */
  region: string;
  felled: FelledTree[];
  /**
   * @maxItems 8
   */
  holes:
    | []
    | [IceHole]
    | [IceHole, IceHole]
    | [IceHole, IceHole, IceHole]
    | [IceHole, IceHole, IceHole, IceHole]
    | [IceHole, IceHole, IceHole, IceHole, IceHole]
    | [IceHole, IceHole, IceHole, IceHole, IceHole, IceHole]
    | [IceHole, IceHole, IceHole, IceHole, IceHole, IceHole, IceHole]
    | [IceHole, IceHole, IceHole, IceHole, IceHole, IceHole, IceHole, IceHole];
  /**
   * The destination shared in the region, and by whom; left out when there is none.
   */
  shared?: {
    destination: Destination;
    by: string;
  };
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
 * Another driver knocked a tree down.
 */
export interface TreeFelled {
  type: 'felled';
  /**
   * The region it happened in.
   */
  region: string;
  tree: FelledTree;
}
/**
 * Another driver broke through the ice.
 */
export interface IceBroken {
  type: 'ice_hole';
  /**
   * The region it happened in.
   */
  region: string;
  hole: IceHole;
}
/**
 * Every cable between two drivers' vehicles, and which browser runs each vehicle that is not run by its own driver's. Sent to everyone on every change, and in answer to `cable`.
 */
export interface Towing {
  type: 'towing';
  cables: {
    /**
     * The player whose vehicle's winch it is.
     */
    from: string;
    /**
     * The player whose vehicle it is hooked to.
     */
    to: string;
  }[];
  runs: {
    vehicle: string;
    /**
     * The player whose browser runs it.
     */
    by: string;
  }[];
  /**
   * The last `cable` message from this browser the list takes into account; 0 for none.
   */
  ack: number;
}
/**
 * The controls of a driver whose vehicle this browser runs.
 */
export interface DriveFrom {
  type: 'drive';
  from: string;
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
   * Air suspension's key, once: a level higher or lower.
   */
  ride?: 'up' | 'down';
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
 * A vehicle this browser runs from now on, as the browser that ran it left it.
 */
export interface HandoverTo {
  type: 'handover';
  from: string;
  /**
   * The player whose vehicle it is.
   */
  vehicle: string;
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
  /**
   * Air suspension's chosen level; the normal one if left out.
   */
  ride?: number;
  /**
   * Metres the air suspension has the body above its normal height right now.
   */
  lift?: number;
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
 * Another driver shared a destination with everyone in the region, or stopped sharing it (null).
 */
export interface DestinationShared {
  type: 'share';
  /**
   * The region it happened in.
   */
  region: string;
  destination: Destination | null;
  by: string;
}
/**
 * Another driver arrived at their destination.
 */
export interface ArrivedAt {
  type: 'arrived';
  /**
   * The region it happened in.
   */
  region: string;
  destination: Destination;
  id: string;
}
/**
 * How a camp stands: players waiting by the fire for everyone near to agree, the night passing, morning, or given up. To everyone in the region.
 */
export interface CampState {
  type: 'camp';
  /**
   * The region it happens in.
   */
  region: string;
  place: CampPlace;
  state: 'waiting' | 'night' | 'morning' | 'over';
  /**
   * Players who have agreed to camp.
   */
  ready: string[];
  /**
   * Players near the fire who have not yet agreed.
   */
  waiting: string[];
  /**
   * When the rest ends, UTC milliseconds.
   */
  until?: number;
  /**
   * Whether the rest ends at a sunrise, or after 8 hours with the sun up all day or down all day.
   */
  ended?: 'dawn' | 'never_set' | 'never_rose';
}
/**
 * A place to camp: a shelter, camp site, hut or lodge from the region's destinations.
 */
export interface CampPlace {
  /**
   * The destination's OpenStreetMap id.
   */
  id: string;
  name: string;
  /**
   * shelter, camp, hut or lodge.
   */
  kind: string;
  /**
   * Metres east.
   */
  x: number;
  /**
   * Metres south.
   */
  z: number;
}
