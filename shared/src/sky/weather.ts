// The weather: three states the server moves between, and the smoothly changing numbers
// the clients draw from. Pure functions; the server owns the state and the random numbers.

import type { Rng } from '../rng';

export type WeatherState = 'clear' | 'overcast' | 'rain';

export interface Weather {
  state: WeatherState;
  /** Share of the sky covered by cloud, 0..1. */
  cloud: number;
  /** Rainfall, 0 none to 1 downpour. */
  rain: number;
  /** Wind strength, 0 calm to 1 gale, and the compass bearing it blows towards, degrees. */
  wind: number;
  windDirection: number;
  /** How wet the ground is, 0 dry to 1 soaked. Lags behind the rain. */
  wetness: number;
}

export interface WeatherModel {
  weather: Weather;
  /** Where cloud, rain and wind are heading. */
  target: { cloud: number; rain: number; wind: number; windDirection: number };
  /** Seconds left before the state is reconsidered. */
  remaining: number;
  /** A state the weather is pinned to, if any. */
  fixed: WeatherState | null;
}

/** Seconds a state lasts, least and most. */
const DURATION: Record<WeatherState, [number, number]> = { clear: [240, 600], overcast: [150, 420], rain: [120, 360] };
/** What may follow each state, with relative chances. */
const NEXT: Record<WeatherState, [WeatherState, number][]> = {
  clear: [['clear', 1], ['overcast', 2]],
  overcast: [['clear', 1], ['rain', 1]],
  rain: [['overcast', 3], ['rain', 1]],
};
/** Seconds for cloud, rain and wind to cover about two thirds of the way to a new target. */
const BLEND = 25;
/** Seconds of steady heavy rain to soak the ground, and of dry weather to dry it. */
const SOAK = 90;
const DRY = 420;

function aim(state: WeatherState, rng: Rng, windDirection: number): WeatherModel['target'] {
  const turned = (windDirection + rng.range(-40, 40) + 360) % 360;
  switch (state) {
    case 'clear':
      return { cloud: rng.range(0.05, 0.3), rain: 0, wind: rng.range(0.1, 0.35), windDirection: turned };
    case 'overcast':
      return { cloud: rng.range(0.75, 0.95), rain: 0, wind: rng.range(0.25, 0.5), windDirection: turned };
    case 'rain':
      return { cloud: 1, rain: rng.range(0.45, 1), wind: rng.range(0.4, 0.75), windDirection: turned };
  }
}

/** Weather at the start of a session. `fixed` pins it to one state for good. */
export function newWeather(rng: Rng, fixed: WeatherState | null = null): WeatherModel {
  const state = fixed ?? 'clear';
  const target = aim(state, rng, rng.range(0, 360));
  return {
    weather: { state, ...target, wetness: state === 'rain' ? 1 : 0 },
    target,
    remaining: rng.range(...DURATION[state]),
    fixed,
  };
}

/** Advances the weather by dt seconds. */
export function stepWeather(model: WeatherModel, dt: number, rng: Rng): void {
  const w = model.weather;
  model.remaining -= dt;
  if (model.remaining <= 0) {
    if (!model.fixed) {
      const options = NEXT[w.state];
      let pick = rng.float() * options.reduce((sum, [, chance]) => sum + chance, 0);
      w.state = options.find(([, chance]) => (pick -= chance) < 0)?.[0] ?? options[0]![0];
    }
    model.target = aim(w.state, rng, w.windDirection);
    model.remaining = rng.range(...DURATION[w.state]);
  }

  const k = 1 - Math.exp(-dt / BLEND);
  w.cloud += (model.target.cloud - w.cloud) * k;
  // Rain waits for the cloud to close in, and stops before it breaks up.
  w.rain += (model.target.rain * Math.max(0, Math.min(1, (w.cloud - 0.7) / 0.25)) - w.rain) * k;
  w.wind += (model.target.wind - w.wind) * k;
  const turn = ((model.target.windDirection - w.windDirection + 540) % 360) - 180;
  w.windDirection = (w.windDirection + turn * k + 360) % 360;
  w.wetness = Math.max(0, Math.min(1, w.wetness + (w.rain > 0.05 ? (w.rain * dt) / SOAK : -dt / DRY)));
}
