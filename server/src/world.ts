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
  /** While a night passes at a camp: where the clock stops, when, and its pace before and after. */
  private night: { until: number; endsAt: number; rate: number } | null = null;

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
    this.settle();
    const utc = Math.round(this.anchorUtc + (this.now() - this.anchorAt) * this.rate);
    return this.night ? Math.min(this.night.until, utc) : utc;
  }

  /** True while a night passes at a camp. */
  get resting(): boolean {
    this.settle();
    return this.night !== null;
  }

  /**
   * A night at a camp: the clock runs from now to `until` (UTC milliseconds) over `ms` real
   * milliseconds, then goes on at its old pace.
   */
  passNight(until: number, ms: number): void {
    const utc = this.utc();
    if (until <= utc || ms <= 0) return;
    const rate = this.night?.rate ?? this.rate;
    this.anchorAt = this.now();
    this.anchorUtc = utc;
    this.night = { until, endsAt: this.anchorAt + ms, rate };
    this.rate = (until - utc) / ms;
  }

  /** Ends the night at once, at its dawn. */
  wake(): void {
    if (this.night) this.night.endsAt = Math.min(this.night.endsAt, this.now());
    this.settle();
  }

  /** Once the night's time is up, the clock stands at its dawn and runs at its old pace. */
  private settle(): void {
    const n = this.night;
    if (!n || this.now() < n.endsAt) return;
    this.anchorAt = n.endsAt;
    this.anchorUtc = n.until;
    this.rate = n.rate;
    this.night = null;
  }

  /** A player changed the clock or the weather; fields left out stay as they are. */
  set(change: SetWorld): void {
    let utc = this.utc();
    // A change to the clock ends a night being passed, where it has got to.
    if (this.night) {
      this.rate = this.night.rate;
      this.night = null;
    }
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
      time: { utc: this.utc(), rate: this.rate, utcOffset: this.config.utcOffset, ...(this.night ? { until: this.night.until } : {}) },
      weather: { state: w.state, cloud: round(w.cloud), rain: round(w.rain), wind: round(w.wind), windDirection: round(w.windDirection), wetness: round(w.wetness) },
    };
  }
}
