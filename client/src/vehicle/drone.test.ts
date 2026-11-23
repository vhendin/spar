import { describe, expect, it } from 'vitest';
import { Drone, DRONE, type DroneControls } from './drone';

const roof = { x: 100, y: 52.5, z: 200 };
const flat = (): number => 50;
const none: DroneControls = { forward: 0, turn: 0, climb: 0 };
const ahead: DroneControls = { forward: 1, turn: 0, climb: 0 };

function fly(d: Drone, seconds: number, c: DroneControls, ground = flat): void {
  for (let t = 0; t < seconds; t += 1 / 60) d.step(1 / 60, c, roof, ground);
}

describe('scouting drone', () => {
  it('launches only from a vehicle standing still, and with charge', () => {
    const d = new Drone();
    expect(d.key(roof, 0, 5)).toMatch(/Stop/);
    expect(d.out).toBe(false);
    d.battery = 10;
    expect(d.key(roof, 0, 0)).toMatch(/charging/);
    d.battery = DRONE.battery;
    expect(d.key(roof, 0, 0.2)).toBeNull();
    expect(d.state).toBe('flying');
  });

  it('rises clear of the roof by itself, then flies where it faces', () => {
    const d = new Drone();
    d.key(roof, 0, 0);
    fly(d, 1.2, none);
    expect(d.p.y).toBeGreaterThan(roof.y + 1.5);
    fly(d, 5, ahead);
    // Facing +z, so it went that way.
    expect(d.p.z - roof.z).toBeGreaterThan(50);
    expect(Math.abs(d.p.x - roof.x)).toBeLessThan(0.01);
  });

  it('turns left with a positive turn, towards +x', () => {
    const d = new Drone();
    d.key(roof, 0, 0);
    fly(d, 0.5, { forward: 0, turn: 1, climb: 0 });
    expect(d.yaw).toBeGreaterThan(0.5);
  });

  it('keeps above the ground and under the ceiling', () => {
    const d = new Drone();
    d.key(roof, 0, 0);
    fly(d, 1.5, none);
    fly(d, 10, { forward: 0, turn: 0, climb: -1 });
    expect(d.p.y).toBeCloseTo(50 + DRONE.floor, 5);
    fly(d, 40, { forward: 0, turn: 0, climb: 1 });
    expect(d.p.y).toBeCloseTo(50 + DRONE.ceiling, 5);
    // A hill rising under it lifts it.
    fly(d, 0.1, none, () => 300);
    expect(d.p.y).toBeGreaterThanOrEqual(300 + DRONE.floor);
  });

  it('turns back at the end of its range and lands on the roof', () => {
    const d = new Drone();
    d.key(roof, 0, 0);
    fly(d, 90, ahead);
    expect(d.state).toBe('home');
    expect(d.reason).toBe('range');
    expect(d.distance(roof)).toBeLessThan(DRONE.range + 20);
    // It cannot be taken back while out of range.
    expect(d.key(roof, 0, 0)).toMatch(/range/);
    fly(d, 120, ahead);
    expect(d.state).toBe('docked');
    expect(d.p).toEqual(roof);
  });

  it('warns near the limits', () => {
    const d = new Drone();
    d.key(roof, 0, 0);
    fly(d, 1.5, none);
    expect(d.warning(roof)).toBeNull();
    d.p.z = roof.z + DRONE.range - 100;
    expect(d.warning(roof)).toBe('range');
    d.p.z = roof.z + 100;
    d.battery = d.needed(roof) + 10;
    expect(d.warning(roof)).toBe('battery');
  });

  it('comes home before the battery runs out, with some to spare', () => {
    const d = new Drone();
    d.key(roof, 0, 0);
    d.battery = 60;
    // Circling far out until the battery calls it home.
    fly(d, 30, ahead);
    for (let i = 0; i < 60 * 60 && d.state === 'flying'; i++) d.step(1 / 60, { forward: 1, turn: 0.3, climb: 0 }, roof, flat);
    expect(d.state).toBe('home');
    expect(d.reason).toBe('battery');
    for (let i = 0; i < 60 * 120 && d.out; i++) d.step(1 / 60, none, roof, flat);
    expect(d.state).toBe('docked');
    expect(d.battery).toBeGreaterThan(0);
  });

  it('sent home it can be taken back, and charges on the roof', () => {
    const d = new Drone();
    d.key(roof, 0, 0);
    fly(d, 10, ahead);
    d.key(roof, 0, 0);
    expect(d.state).toBe('home');
    expect(d.key(roof, 0, 0)).toBeNull();
    expect(d.state).toBe('flying');
    d.key(roof, 0, 0);
    for (let i = 0; i < 60 * 60 && d.out; i++) d.step(1 / 60, none, roof, flat);
    expect(d.state).toBe('docked');
    const left = d.battery;
    expect(left).toBeLessThan(DRONE.battery);
    fly(d, 1, none);
    expect(d.battery).toBeGreaterThan(left);
  });
});
