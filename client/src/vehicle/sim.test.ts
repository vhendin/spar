import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import type { VehicleDef } from '@spar/shared';
import { GROUP_GROUND, groups, VehicleSim, type GroundProbe, type VehicleInput } from './sim';

const load = (name: string) => JSON.parse(readFileSync(join(import.meta.dirname, `../../../defs/vehicles/${name}.json`), 'utf8')) as VehicleDef;
const DT = 1 / 60;
const idle: VehicleInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };

beforeAll(() => RAPIER.init());

/** A world with a big flat slab tilted `slope` degrees, rising towards -z (the way a vehicle placed at heading 0 faces). */
function setup(name: string, opts: { slope?: number; ground?: (x: number, z: number) => string } = {}) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  const tilt = ((opts.slope ?? 0) * Math.PI) / 360;
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(400, 1, 400)
      .setTranslation(0, -Math.cos(tilt * 2), -Math.sin(tilt * 2))
      .setRotation({ x: Math.sin(tilt), y: 0, z: 0, w: Math.cos(tilt) })
      .setCollisionGroups(groups(GROUP_GROUND, 0xffff)),
  );
  const probe: GroundProbe = { groundAt: opts.ground ?? (() => 'gravel'), wetness: () => 0 };
  const car = new VehicleSim(RAPIER, world, load(name), probe);
  car.place(0, 0.05, 0, 0);
  const run = (seconds: number, input: Partial<VehicleInput> = {}) => {
    for (let s = 0; s < Math.round(seconds / DT); s++) {
      car.step({ ...idle, ...input }, DT);
      world.step();
    }
  };
  const tiltOf = () => {
    const r = car.body.rotation();
    // Angle between the body's up axis and the world's.
    return Math.acos(Math.min(1, 1 - 2 * (r.x * r.x + r.z * r.z)));
  };
  return { world, car, run, tiltOf };
}

describe.each(['tgb11', 'tgb13'])('%s', (name) => {
  it('settles on its wheels at the height the definition says', () => {
    const { car, run, tiltOf } = setup(name);
    run(3);
    const p = car.body.translation();
    expect(Math.abs(p.y)).toBeLessThan(0.04);
    expect(tiltOf()).toBeLessThan(0.03);
    expect(car.wheels.length).toBe(car.def.axles.length * 2);
    expect(car.wheels.every((w) => w.contact)).toBe(true);
    const carried = car.wheels.reduce((sum, w) => sum + w.load, 0);
    expect(carried / (car.def.chassis.mass * 9.81)).toBeCloseTo(1, 1);
    // Standing still with nobody on the pedals, it stays put.
    expect(car.holding).toBe(true);
    expect(Math.hypot(p.x, p.z)).toBeLessThan(0.05);
  });

  it('accelerates through the gears, then brakes to a stop', () => {
    const { car, run } = setup(name);
    run(1);
    run(10, { throttle: 1 });
    expect(car.speed * 3.6).toBeGreaterThan(45);
    expect(car.speed * 3.6).toBeLessThan(110);
    expect(car.drivetrain.gear).toBeGreaterThanOrEqual(3);
    expect(car.body.translation().z).toBeLessThan(-60); // heading 0 is north, towards -z
    // From there it should stop within a few seconds; holding the pedal on would then reverse.
    let seconds = 0;
    while (car.speed > 0.5 && seconds < 8) {
      run(0.1, { brake: 1 });
      seconds += 0.1;
    }
    expect(seconds).toBeGreaterThan(1);
    expect(seconds).toBeLessThan(5);
  });

  it('steers left and right without tipping over', () => {
    for (const steer of [1, -1]) {
      const { car, run, tiltOf } = setup(name);
      run(1);
      run(3, { throttle: 0.6 });
      run(3, { throttle: 0.4, steer });
      const r = car.body.rotation();
      const yaw = Math.atan2(2 * (r.w * r.y + r.x * r.z), 1 - 2 * (r.y * r.y + r.x * r.x));
      // Placed with yaw 180°; steering left turns it further, right turns it back.
      const turned = Math.atan2(Math.sin(yaw - Math.PI), Math.cos(yaw - Math.PI));
      expect(Math.sign(turned)).toBe(steer);
      expect(Math.abs(turned)).toBeGreaterThan(0.5);
      expect(tiltOf()).toBeLessThan(0.25);
      // Left of north is west: -x.
      expect(Math.sign(car.body.translation().x)).toBe(-steer);
    }
  });

  it('reverses when the brake is held from a standstill, and goes forward again', () => {
    const { car, run } = setup(name);
    run(1);
    run(3, { brake: 1 });
    expect(car.drivetrain.gear).toBe(-1);
    expect(car.speed).toBeLessThan(-1.5);
    expect(car.body.translation().z).toBeGreaterThan(1);
    run(5, { throttle: 1 });
    expect(car.drivetrain.gear).toBeGreaterThan(0);
    expect(car.speed).toBeGreaterThan(1.5);
  });

  it('climbs a 25° hill on gravel but spins on a slippery one', () => {
    const climb = (ground: string) => {
      const { car, run } = setup(name, { slope: 25, ground: () => ground });
      car.toggleRange();
      run(1.5);
      const start = car.body.translation().y;
      run(6, { throttle: 1 });
      return { gained: car.body.translation().y - start, car };
    };
    const gravel = climb('gravel');
    expect(gravel.car.drivetrain.range).toBe('low');
    expect(gravel.gained).toBeGreaterThan(3);
    const slick = climb('water');
    expect(slick.gained).toBeLessThan(0.5);
    expect(slick.car.wheels.some((w) => w.spin > 0.2)).toBe(true);
  });

  it('holds on a hill with the handbrake, and with nobody on the pedals', () => {
    const { car, run } = setup(name, { slope: 15 });
    run(2, { handbrake: true });
    const a = car.body.translation();
    run(4);
    const b = car.body.translation();
    expect(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)).toBeLessThan(0.3);
  });
});

describe('differential locks', () => {
  /** Left wheels on something slippery, right wheels on asphalt, up a hill too steep for the slippery side's grip alone. */
  const splitGrip = (locked: boolean) => {
    const { car, run } = setup('tgb11', { slope: 20, ground: (x) => (x < 0 ? 'water' : 'asphalt') });
    if (locked) car.def.axles.forEach((_, a) => car.toggleLock(a));
    car.toggleRange();
    run(1.5);
    const start = car.body.translation().y;
    run(5, { throttle: 1 });
    return car.body.translation().y - start;
  };

  it('get the vehicle up where open differentials leave it spinning', () => {
    const open = splitGrip(false);
    const locked = splitGrip(true);
    expect(open).toBeLessThan(0.5);
    expect(locked).toBeGreaterThan(1.5);
  });
});
