import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import type { VehicleDef } from '@spar/shared';
import { pushForce } from './felling';
import type { Anchor } from './obstacles';
import { GROUP_GROUND, GROUP_OBSTACLE, groups, VehicleSim, type VehicleInput } from './sim';
import { hookPoint, Winch, type WinchControls } from './winch';

const load = (name: string) => JSON.parse(readFileSync(join(import.meta.dirname, `../../../defs/vehicles/${name}.json`), 'utf8')) as VehicleDef;
const DT = 1 / 60;
const idle: VehicleInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
const none: WinchControls = { pull: false, slack: false };

beforeAll(() => RAPIER.init());

/** Height of the sloping ground at a point `z` metres along. */
const rise = (slope: number, z: number) => -z * Math.tan((slope * Math.PI) / 180);

const tree = (key: string, x: number, y: number, z: number, diameter: number): Anchor => ({ key, kind: 'tree', x, y, z, radius: diameter / 2, diameter });

/** A vehicle facing north (-z) on ground rising `slope` degrees that way, with the given anchors around. */
function setup(anchors: Anchor[], slope = 0) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  const tilt = (slope * Math.PI) / 360;
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(400, 1, 400)
      .setTranslation(0, -Math.cos(tilt * 2), -Math.sin(tilt * 2))
      .setRotation({ x: Math.sin(tilt), y: 0, z: 0, w: Math.cos(tilt) })
      .setCollisionGroups(groups(GROUP_GROUND, 0xffff)),
  );
  const car = new VehicleSim(RAPIER, world, load('tgb11'), { groundAt: () => 'dirt', wetness: () => 0 });
  car.place(0, 0.05, 0, 0);
  const felled = new Set<string>();
  const winch = new Winch(car, {
    anchorsNear: (x, z, r) => anchors.filter((a) => !felled.has(a.key) && Math.hypot(a.x - x, a.z - z) <= r),
    standing: (key) => !felled.has(key),
  });
  winch.onGiveWay = (a) => felled.add(a.key);
  const run = (seconds: number, controls: WinchControls = none, input: Partial<VehicleInput> = {}) => {
    for (let s = 0; s < Math.round(seconds / DT); s++) {
      car.step({ ...idle, ...input }, DT);
      winch.step(DT, controls);
      world.step();
    }
  };
  return { world, car, winch, run, felled };
}

describe('winch', () => {
  it('offers what is ahead and in reach, not what is behind or too far', () => {
    const { winch, run } = setup([tree('ahead', 2, 0.6, -15, 0.4), tree('behind', 0, 0.6, 12, 0.4), tree('far', 0, 0.6, -60, 0.4)]);
    run(1);
    winch.choose();
    expect(winch.choices.map((a) => a.key)).toEqual(['ahead']);
  });

  it('carries the cable out, then pulls the vehicle to the anchor', () => {
    const { car, winch, run } = setup([tree('pine', 0, 0.6, -20, 0.45)]);
    run(1);
    winch.toggle();
    winch.toggle();
    expect(winch.state).toBe('carrying');
    run(2);
    expect(winch.state).toBe('hooked');
    expect(winch.events).toContain('hooked');
    const z0 = car.body.translation().z;
    run(12, { pull: true, slack: false });
    const moved = z0 - car.body.translation().z;
    // About the winch's speed with no load, less a little for rolling.
    expect(moved).toBeGreaterThan(3);
    expect(winch.tension).toBeGreaterThan(0);
    expect(winch.tension).toBeLessThan(car.def.winch!.pull * 1.2);
  });

  it('pulls the vehicle up a steep slope and holds it there', () => {
    const slope = 32;
    const { car, winch, run } = setup([tree('spruce', 0, rise(slope, -25) + 0.6, -25, 0.5)], slope);
    run(1);
    winch.choose();
    winch.hookOn();
    run(3);
    expect(winch.state).toBe('hooked');
    const z0 = car.body.translation().z;
    run(10, { pull: true, slack: false });
    // Up the slope it goes, the winch working hard but within what it can do.
    expect(z0 - car.body.translation().z).toBeGreaterThan(1.5);
    expect(winch.load).toBeGreaterThan(0.25);
    expect(winch.load).toBeLessThan(1.15);
    // Letting go of the winch: the cable holds it where it is.
    const z1 = car.body.translation().z;
    run(3);
    expect(Math.abs(car.body.translation().z - z1)).toBeLessThan(0.3);
  });

  it('stalls when asked to pull more than it can', () => {
    const { world, winch, run } = setup([tree('pine', 0, 0.6, -20, 0.45)]);
    // A wall just in front: the vehicle cannot come any closer.
    world.createCollider(RAPIER.ColliderDesc.cuboid(3, 1.5, 0.5).setTranslation(0, 1.5, -4).setCollisionGroups(groups(GROUP_OBSTACLE, 0xffff)));
    run(1);
    winch.choose();
    winch.hookOn();
    run(2);
    run(8, { pull: true, slack: false });
    expect(winch.load).toBeGreaterThan(0.95);
    expect(winch.drum).toBeLessThan(0.05);
  });

  it('pulls a thin tree over and comes free', () => {
    const slope = 32;
    const { winch, run, felled } = setup([tree('birch', 0, rise(slope, -18) + 0.6, -18, 0.12)], slope);
    expect(pushForce(0.12)).toBeLessThan(load('tgb11').winch!.pull);
    run(1);
    winch.choose();
    winch.hookOn();
    run(3);
    run(10, { pull: true, slack: false });
    expect(felled.has('birch')).toBe(true);
    expect(winch.events).toContain('gaveWay');
    expect(['reeling', 'stowed']).toContain(winch.state);
  });

  it('pays out, unhooks and winds back in', () => {
    const { winch, run } = setup([tree('pine', 0, 0.6, -20, 0.45)]);
    run(1);
    winch.choose();
    winch.hookOn();
    run(2);
    const before = winch.length;
    run(2, { pull: false, slack: true });
    expect(winch.length).toBeGreaterThan(before + 2);
    winch.toggle();
    expect(winch.state).toBe('reeling');
    run(3);
    expect(winch.state).toBe('stowed');
  });

  it('goes round the near side of a building', () => {
    const p = hookPoint({ key: 'barn', kind: 'object', x: 10, y: 1, z: 0, radius: 0, diameter: 0, box: { hx: 4, hz: 2, yaw: 0 } }, { x: 0, y: 1, z: 0 });
    expect(p.x).toBeCloseTo(6);
    expect(p.z).toBeCloseTo(0);
    const turned = hookPoint({ key: 'barn', kind: 'object', x: 10, y: 1, z: 0, radius: 0, diameter: 0, box: { hx: 4, hz: 2, yaw: Math.PI / 2 } }, { x: 0, y: 1, z: 0 });
    expect(turned.x).toBeCloseTo(8);
  });
});
