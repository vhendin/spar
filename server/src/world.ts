import { atLocalHour, createRng, onDayOfYear, holdWeather, newWeather, stepWeather, type ClientMessage, type ServerMessage, type WeatherModel } from '@spar/shared';
import type { ServerConfig } from './config';

type WorldUpdate = Extract<ServerMessage, { type: 'world' }>;
type SetWorld = Extract<ClientMessage, { type: 'set_world' }>;

/** The parts of the world every player must agree on: what time it is and what the weather is doing. */
export class WorldState {
  private readonly weather: WeatherModel;
  private readonly rng;
  /** In-game seconds per real second. */
  private rate: number;
  /** The in-game instant `anchorAt` (real milliseconds) belongs to. */
  private anchorUtc: number;
  private anchorAt: number;
  private lastStep: number;

  constructor(
    private readonly config: ServerConfig,
    private readonly now: () => number = Date.now,
  ) {
    // Weather differs from session to session, but is the same for everyone in one.
    this.rng = createRng((config.seed ^ Math.floor(now() / 1000)) >>> 0);
    this.weather = newWeather(this.rng, config.weather);
    this.rate = config.dayLengthMinutes > 0 ? 86400 / (config.dayLengthMinutes * 60) : 0;
    this.anchorAt = this.lastStep = now();
    this.anchorUtc = config.startUtc;
  }

  /** The in-game instant now, as UTC milliseconds. */
  utc(): number {
    return Math.round(this.anchorUtc + (this.now() - this.anchorAt) * this.rate);
  }

  /** A player changed the clock or the weather; fields left out stay as they are. */
  set(change: SetWorld): void {
    let utc = this.utc();
    if (change.day !== undefined) utc = onDayOfYear(utc, this.config.utcOffset, change.day);
    this.anchorAt = this.now();
    this.anchorUtc = change.hour === undefined ? utc : atLocalHour(utc, this.config.utcOffset, change.hour);
    if (change.dayMinutes !== undefined) this.rate = change.dayMinutes > 0 ? 86400 / (change.dayMinutes * 60) : 0;
    if (change.weather !== undefined) holdWeather(this.weather, change.weather === 'auto' ? null : change.weather, this.rng);
  }

  /** Brings the weather up to date; call about once a second. */
  step(): void {
    const now = this.now();
    // In one-second bites, so a long pause does not turn into one giant leap.
    let owed = Math.min(600, (now - this.lastStep) / 1000);
    this.lastStep = now;
    while (owed > 0) {
      const dt = Math.min(1, owed);
      stepWeather(this.weather, dt, this.rng);
      owed -= dt;
    }
  }

  message(): WorldUpdate {
    const w = this.weather.weather;
    const round = (v: number): number => Math.round(v * 1000) / 1000;
    return {
      type: 'world',
      time: { utc: this.utc(), rate: this.rate, utcOffset: this.config.utcOffset },
      weather: { state: w.state, cloud: round(w.cloud), rain: round(w.rain), wind: round(w.wind), windDirection: round(w.windDirection), wetness: round(w.wetness) },
    };
  }
}
