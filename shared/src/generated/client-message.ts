// Generated from schemas/client-message.schema.json by scripts/gen-types.ts. Do not edit.

/**
 * Every message a client may send to the server.
 */
export type ClientMessage = Hello | SetWorld | Profile | State | Away | Chat | Push;

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
