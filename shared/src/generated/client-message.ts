// Generated from schemas/client-message.schema.json by scripts/gen-types.ts. Do not edit.

/**
 * Every message a client may send to the server.
 */
export type ClientMessage = Hello | SetWorld;

/**
 * First message on a new connection.
 */
export interface Hello {
  type: 'hello';
  protocol: number;
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
   * Real minutes one in-game day takes from now on; 0 stops the clock, 1440 is real time.
   */
  dayMinutes?: number;
  /**
   * A state to hold the weather in, or auto to let it change by itself.
   */
  weather?: 'auto' | 'clear' | 'overcast' | 'rain';
}
