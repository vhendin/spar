// Generated from schemas/server-message.schema.json by scripts/gen-types.ts. Do not edit.

/**
 * Every message the server may send to a client.
 */
export type ServerMessage = Welcome | WorldUpdate | ServerError | Players | PlayerState | PlayerAway | ChatLine;

/**
 * Reply to hello: who you are and which world to load.
 */
export interface Welcome {
  type: 'welcome';
  protocol: number;
  playerId: string;
  region: string;
  seed: number;
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
}
/**
 * Another driver's vehicle now, passed on as they sent it.
 */
export interface PlayerState {
  type: 'state';
  id: string;
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
   * Per wheel, in the definition's order: steering angle (radians) and suspension length (metres).
   *
   * @maxItems 12
   */
  wheels:
    | []
    | [[number, number]]
    | [[number, number], [number, number]]
    | [[number, number], [number, number], [number, number]]
    | [[number, number], [number, number], [number, number], [number, number]]
    | [[number, number], [number, number], [number, number], [number, number], [number, number]]
    | [[number, number], [number, number], [number, number], [number, number], [number, number], [number, number]]
    | [
        [number, number],
        [number, number],
        [number, number],
        [number, number],
        [number, number],
        [number, number],
        [number, number]
      ]
    | [
        [number, number],
        [number, number],
        [number, number],
        [number, number],
        [number, number],
        [number, number],
        [number, number],
        [number, number]
      ]
    | [
        [number, number],
        [number, number],
        [number, number],
        [number, number],
        [number, number],
        [number, number],
        [number, number],
        [number, number],
        [number, number]
      ]
    | [
        [number, number],
        [number, number],
        [number, number],
        [number, number],
        [number, number],
        [number, number],
        [number, number],
        [number, number],
        [number, number],
        [number, number]
      ]
    | [
        [number, number],
        [number, number],
        [number, number],
        [number, number],
        [number, number],
        [number, number],
        [number, number],
        [number, number],
        [number, number],
        [number, number],
        [number, number]
      ]
    | [
        [number, number],
        [number, number],
        [number, number],
        [number, number],
        [number, number],
        [number, number],
        [number, number],
        [number, number],
        [number, number],
        [number, number],
        [number, number],
        [number, number]
      ];
  /**
   * Headlights on.
   */
  lights: boolean;
  /**
   * Brake lights on.
   */
  braking: boolean;
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
