// Generated from schemas/client-message.schema.json by scripts/gen-types.ts. Do not edit.

/**
 * Every message a client may send to the server.
 */
export type ClientMessage = Hello | SetWorld | Profile | State | Away | Chat;

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
 * This driver's vehicle now.
 */
export interface State {
  type: 'state';
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
