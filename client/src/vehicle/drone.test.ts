import { describe, expect, it } from 'vitest';
import { Drone, DRONE, DRONE_RADIUS, pushOut, type DroneControls, type Obstacle } from './drone';

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

  it('is pushed out of a trunk sideways, or up over a low one', () => {
    const trunk: Obstacle = { kind: 'post', x: 0, z: 0, r: 0.3, bottom: 0, top: 20 };
    expect(pushOut({ x: 2, y: 5, z: 0 }, trunk)).toBeNull();
    const out = pushOut({ x: 0.5, y: 5, z: 0 }, trunk)!;
    expect(out.x).toBeCloseTo(0.3 + DRONE_RADIUS - 0.5, 6);
    expect(out.y).toBe(0);
    expect(pushOut({ x: 0, y: 20.2, z: 0.2 }, trunk)!.y).toBeCloseTo(20 + DRONE_RADIUS - 20.2, 6);
  });

  it('is pushed out of a turned building the shortest way', () => {
    // A long house turned a quarter: its long side runs along x in the world.
    const house: Obstacle = { kind: 'box', x: 0, y: 3, z: 0, hx: 2, hy: 3, hz: 6, yaw: Math.PI / 2 };
    expect(pushOut({ x: 0, y: 3, z: 3 }, house)).toBeNull();
    const out = pushOut({ x: 4, y: 3, z: 1.5 }, house)!;
    expect(out.z).toBeCloseTo(2 + DRONE_RADIUS - 1.5, 6);
    expect(Math.abs(out.x)).toBeLessThan(1e-9);
    expect(pushOut({ x: 0, y: 6.2, z: 0 }, house)!.y).toBeCloseTo(6 + DRONE_RADIUS - 6.2, 6);
  });

  it('stops against a trunk in its way, and climbs over it going home', () => {
    const trunk: Obstacle = { kind: 'post', x: roof.x, z: roof.z + 30, r: 0.3, bottom: 49, top: 75 };
    const solids = (): Obstacle[] => [trunk];
    const d = new Drone();
    d.key(roof, 0, 0);
    for (let t = 0; t < 1.5; t += 1 / 60) d.step(1 / 60, none, roof, flat, solids);
    for (let t = 0; t < 8; t += 1 / 60) d.step(1 / 60, ahead, roof, flat, solids);
    expect(d.p.z).toBeLessThan(trunk.z - 0.3 - DRONE_RADIUS + 0.01);
    // Out beyond it, then home: back over the trunk to the roof.
    d.p.z = roof.z + 60;
    d.p.y = 55;
    d.key(roof, 0, 0);
    for (let i = 0; i < 60 * 120 && d.out; i++) d.step(1 / 60, none, roof, flat, solids);
    expect(d.state).toBe('docked');
  });
});
