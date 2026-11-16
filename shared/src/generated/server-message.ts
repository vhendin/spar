// Generated from schemas/server-message.schema.json by scripts/gen-types.ts. Do not edit.

/**
 * Every message the server may send to a client.
 */
export type ServerMessage = Welcome | WorldUpdate | ServerError;

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
