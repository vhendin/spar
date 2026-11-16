import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import { formatGameTime, gameUtc, parseLocalTime } from './clock';
import { moonPosition, skyDirection, sunPosition } from './solar';
import { newWeather, stepWeather } from './weather';

// The middle of the Vålådalen–Ottsjö region.
const LAT = 63.187, LON = 13.022;
const DEG = 180 / Math.PI;
const at = (text: string): number => parseLocalTime(text, 1)!;

/** Highest and lowest sun of a day, and when it is above the horizon, sampled every two minutes. */
function day(date: string) {
  const start = at(`${date}T00:00`);
  let high = -90, low = 90, highAt = 0, rise: number | null = null, set: number | null = null, previous = -90;
  for (let minute = 0; minute <= 1440; minute += 2) {
    const e = sunPosition(start + minute * 60000, LAT, LON).elevation * DEG;
    if (e > high) { high = e; highAt = minute; }
    low = Math.min(low, e);
    if (minute > 0 && previous < -0.83 && e >= -0.83) rise = minute;
    if (minute > 0 && previous >= -0.83 && e < -0.83) set = minute;
    previous = e;
  }
  return { high, low, highAt, rise, set };
}

describe('sun', () => {
  it('stands high at midsummer noon and never sinks far at night', () => {
    const d = day('2026-06-21');
    expect(d.high).toBeCloseTo(90 - LAT + 23.44, 0);
    // Solar noon comes a few minutes after twelve on clocks one hour ahead of UTC at 13°E.
    expect(Math.abs(d.highAt - 12 * 60 - 10)).toBeLessThan(8);
    // Lowest around 3° below the horizon: light all night.
    expect(d.low).toBeGreaterThan(-4.5);
    expect(d.low).toBeLessThan(-2);
    expect(sunPosition(at('2026-06-21T12:10'), LAT, LON).azimuth * DEG).toBeCloseTo(180, 0);
  });

  it('barely clears the horizon in December, with a short day', () => {
    const d = day('2026-12-21');
    expect(d.high).toBeCloseTo(90 - LAT - 23.44, 0);
    // Sunrise about 09:40 and sunset about 14:20 by the clock.
    expect(Math.abs(d.rise! - (9 * 60 + 40))).toBeLessThan(15);
    expect(Math.abs(d.set! - (14 * 60 + 22))).toBeLessThan(15);
    expect(sunPosition(at('2026-12-21T16:00'), LAT, LON).elevation * DEG).toBeLessThan(-6); // past civil twilight by four
  });

  it('rises in the east and sets in the west at the equinox, twelve hours apart', () => {
    const d = day('2026-03-20');
    expect(d.high).toBeCloseTo(90 - LAT, 0);
    expect(Math.abs(d.set! - d.rise! - 12 * 60)).toBeLessThan(25);
    expect(sunPosition(at('2026-03-20T00:00') + d.rise! * 60000, LAT, LON).azimuth * DEG).toBeCloseTo(90, -1);
    expect(sunPosition(at('2026-03-20T00:00') + d.set! * 60000, LAT, LON).azimuth * DEG).toBeCloseTo(270, -1);
  });

  it('turns into a world direction: south at noon is +z, up is +y', () => {
    const [x, y, z] = skyDirection(sunPosition(at('2026-06-21T12:10'), LAT, LON));
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 6);
    expect(Math.abs(x)).toBeLessThan(0.03);
    expect(y).toBeGreaterThan(0.7);
    expect(z).toBeGreaterThan(0.6);
    const [ex, , ez] = skyDirection({ azimuth: Math.PI / 2, elevation: 0 });
    expect(ex).toBeCloseTo(1, 6);
    expect(ez).toBeCloseTo(0, 6);
  });
});

describe('moon', () => {
  it('is full and new on the right dates', () => {
    // Full moon 15 December 2024 09:02 UTC, new moon 30 December 2024 22:27 UTC.
    expect(moonPosition(Date.UTC(2024, 11, 15, 9, 2), LAT, LON).illumination).toBeGreaterThan(0.98);
    expect(moonPosition(Date.UTC(2024, 11, 30, 22, 27), LAT, LON).illumination).toBeLessThan(0.02);
    const half = moonPosition(Date.UTC(2024, 11, 8, 15, 27), LAT, LON).illumination; // first quarter
    expect(half).toBeGreaterThan(0.4);
    expect(half).toBeLessThan(0.6);
  });

  it('stands opposite the sun when full', () => {
    const t = Date.UTC(2024, 11, 15, 23, 0);
    const moon = moonPosition(t, LAT, LON), sun = sunPosition(t, LAT, LON);
    expect(sun.elevation).toBeLessThan(0);
    expect(moon.elevation * DEG).toBeGreaterThan(40); // a winter full moon rides high
    const apart = Math.abs(((moon.azimuth - sun.azimuth) * DEG + 540) % 360 - 180);
    expect(apart).toBeGreaterThan(150);
  });
});

describe('clock', () => {
  it('reads and writes local time', () => {
    expect(at('2026-08-15T09:00')).toBe(Date.UTC(2026, 7, 15, 8, 0));
    expect(formatGameTime(at('2026-08-15T09:42'), 1)).toBe('Sat 15 Aug 09:42');
    expect(parseLocalTime('yesterday', 1)).toBeNull();
    expect(parseLocalTime('2026-08-15 09:00:30', 1)).toBe(Date.UTC(2026, 7, 15, 8, 0, 30));
  });

  it('runs at the server\'s rate from the last word received', () => {
    const clock = { utc: 1000000, rate: 48, utcOffset: 1, at: 5000 };
    expect(gameUtc(clock, 5000)).toBe(1000000);
    expect(gameUtc(clock, 6000)).toBe(1048000); // one real second is 48 game seconds
  });
});

describe('weather', () => {
  it('starts clear and dry, and stays within bounds whatever happens', () => {
    const rng = createRng(5);
    const model = newWeather(rng);
    expect(model.weather.state).toBe('clear');
    expect(model.weather.rain).toBe(0);
    const seen = new Set<string>();
    for (let s = 0; s < 6 * 3600; s++) {
      stepWeather(model, 1, rng);
      const w = model.weather;
      seen.add(w.state);
      for (const v of [w.cloud, w.rain, w.wind, w.wetness]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(w.windDirection).toBeGreaterThanOrEqual(0);
      expect(w.windDirection).toBeLessThan(360);
      if (w.rain > 0.05) expect(w.cloud).toBeGreaterThan(0.7); // no rain from a blue sky
    }
    expect([...seen].sort()).toEqual(['clear', 'overcast', 'rain']);
  });

  it('is the same for the same random numbers', () => {
    const run = (seed: number) => {
      const rng = createRng(seed);
      const model = newWeather(rng);
      for (let s = 0; s < 3000; s++) stepWeather(model, 1, rng);
      return JSON.stringify(model.weather);
    };
    expect(run(9)).toBe(run(9));
    expect(run(9)).not.toBe(run(10));
  });

  it('changes gradually', () => {
    const rng = createRng(3);
    const model = newWeather(rng);
    let previous = { ...model.weather };
    for (let s = 0; s < 4000; s++) {
      stepWeather(model, 1, rng);
      expect(Math.abs(model.weather.cloud - previous.cloud)).toBeLessThan(0.05);
      expect(Math.abs(model.weather.rain - previous.rain)).toBeLessThan(0.05);
      previous = { ...model.weather };
    }
  });

  it('soaks the ground in rain and dries it afterwards, when pinned to a state', () => {
    const rng = createRng(1);
    const rain = newWeather(rng, 'rain');
    rain.weather.wetness = 0;
    for (let s = 0; s < 600; s++) stepWeather(rain, 1, rng);
    expect(rain.weather.state).toBe('rain');
    expect(rain.weather.rain).toBeGreaterThan(0.4);
    expect(rain.weather.wetness).toBe(1);

    const clear = newWeather(rng, 'clear');
    clear.weather.wetness = 1;
    for (let s = 0; s < 200; s++) stepWeather(clear, 1, rng);
    expect(clear.weather.wetness).toBeGreaterThan(0.3);
    for (let s = 0; s < 400; s++) stepWeather(clear, 1, rng);
    expect(clear.weather.wetness).toBe(0);
    expect(clear.weather.state).toBe('clear');
  });
});
