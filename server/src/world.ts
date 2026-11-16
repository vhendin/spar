import { createRng, newWeather, stepWeather, type ServerMessage, type WeatherModel } from '@spar/shared';
import type { ServerConfig } from './config';

type WorldUpdate = Extract<ServerMessage, { type: 'world' }>;

/** The parts of the world every player must agree on: what time it is and what the weather is doing. */
export class WorldState {
  private readonly weather: WeatherModel;
  private readonly rng;
  private readonly rate: number;
  private readonly startedAt: number;
  private lastStep: number;

  constructor(
    private readonly config: ServerConfig,
    private readonly now: () => number = Date.now,
  ) {
    // Weather differs from session to session, but is the same for everyone in one.
    this.rng = createRng((config.seed ^ Math.floor(now() / 1000)) >>> 0);
    this.weather = newWeather(this.rng, config.weather);
    this.rate = config.dayLengthMinutes > 0 ? 86400 / (config.dayLengthMinutes * 60) : 0;
    this.startedAt = this.lastStep = now();
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
      time: { utc: Math.round(this.config.startUtc + (this.now() - this.startedAt) * this.rate), rate: this.rate, utcOffset: this.config.utcOffset },
      weather: { state: w.state, cloud: round(w.cloud), rain: round(w.rain), wind: round(w.wind), windDirection: round(w.windDirection), wetness: round(w.wetness) },
    };
  }
}
