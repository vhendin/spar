import { describe, expect, it } from 'vitest';
import { isServerMessage } from '@spar/shared/validate';
import { loadConfig } from './config';
import { WorldState } from './world';

describe('WorldState', () => {
  it('runs the game clock at the configured pace', () => {
    let now = 1_000_000;
    const config = loadConfig({ START_TIME: '2026-06-21T22:00', DAY_LENGTH_MINUTES: '24' });
    const world = new WorldState(config, () => now);
    const start = world.message();
    expect(isServerMessage(start)).toBe(true);
    expect(start.time.utc).toBe(Date.UTC(2026, 5, 21, 21, 0)); // 22:00 on clocks an hour ahead of UTC
    expect(start.time.rate).toBe(60);
    now += 60_000; // a real minute is an in-game hour
    expect(world.message().time.utc).toBe(Date.UTC(2026, 5, 21, 22, 0));
  });

  it('can stop the clock and pin the weather', () => {
    let now = 0;
    const world = new WorldState(loadConfig({ DAY_LENGTH_MINUTES: '0', WEATHER: 'overcast' }), () => now);
    const before = world.message();
    now += 3_600_000;
    world.step();
    const after = world.message();
    expect(after.time.utc).toBe(before.time.utc);
    expect(after.time.rate).toBe(0);
    expect(after.weather.state).toBe('overcast');
    expect(after.weather.cloud).toBeGreaterThan(0.7);
    expect(isServerMessage(after)).toBe(true);
  });

  it('lets players move to another day of the year, keeping the time of day', () => {
    const world = new WorldState(loadConfig({ START_TIME: '2026-08-15T09:00', DAY_LENGTH_MINUTES: '0' }), () => 0);
    world.set({ type: 'set_world', day: 32 });
    expect(world.message().time.utc).toBe(Date.UTC(2026, 1, 1, 8, 0)); // 1 February, 09:00 local
    world.set({ type: 'set_world', day: 196, hour: 14 });
    expect(world.message().time.utc).toBe(Date.UTC(2026, 6, 15, 13, 0)); // 15 July, 14:00 local
  });

  it('lets players set the time of day, clock speed and weather', () => {
    let now = 0;
    const world = new WorldState(loadConfig({ START_TIME: '2026-08-15T21:30', DAY_LENGTH_MINUTES: '30' }), () => now);
    now += 60_000;
    world.set({ type: 'set_world', hour: 12.5, dayMinutes: 0, weather: 'rain' });
    const noon = world.message();
    expect(noon.time.utc).toBe(Date.UTC(2026, 7, 15, 11, 30)); // same day, 12:30 local
    expect(noon.time.rate).toBe(0);
    expect(noon.weather.state).toBe('rain');
    expect(noon.weather.rain).toBeGreaterThan(0.4);
    now += 3_600_000;
    world.step();
    expect(world.message().time.utc).toBe(noon.time.utc);
    expect(world.message().weather.state).toBe('rain');

    world.set({ type: 'set_world', dayMinutes: 1440, weather: 'auto' });
    now += 60_000;
    expect(world.message().time.utc).toBe(noon.time.utc + 60_000); // real time
    expect(isServerMessage(world.message())).toBe(true);
  });

  it('changes the weather as time passes', () => {
    let now = 0;
    const world = new WorldState(loadConfig({}), () => now);
    const states = new Set<string>();
    for (let minute = 0; minute < 240; minute++) {
      now += 60_000;
      world.step();
      states.add(world.message().weather.state);
    }
    expect(states.size).toBeGreaterThan(1);
  });

  it('reads the addresses to tell, comma separated', () => {
    expect(loadConfig({ ADDRESS: ' https://spar.example.se ,, http://192.168.1.20:8080' }).addresses).toEqual(['https://spar.example.se', 'http://192.168.1.20:8080']);
    expect(loadConfig({ ADDRESS: '' })).not.toHaveProperty('addresses');
  });

  it('refuses nonsense settings', () => {
    expect(() => loadConfig({ START_TIME: 'noon' })).toThrow(/START_TIME/);
    expect(() => loadConfig({ WEATHER: 'snow' })).toThrow(/WEATHER/);
    expect(() => loadConfig({ DAY_LENGTH_MINUTES: '-3' })).toThrow(/DAY_LENGTH_MINUTES/);
  });
});
