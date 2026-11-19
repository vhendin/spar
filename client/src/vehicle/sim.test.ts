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
function setup(
  name: string,
  opts: { slope?: number; ground?: (x: number, z: number) => string; soft?: (x: number, z: number) => number; water?: (x: number, z: number) => number; wet?: number; ice?: number; snow?: number } = {},
) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  const tilt = ((opts.slope ?? 0) * Math.PI) / 360;
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(400, 1, 400)
      .setTranslation(0, -Math.cos(tilt * 2), -Math.sin(tilt * 2))
      .setRotation({ x: Math.sin(tilt), y: 0, z: 0, w: Math.cos(tilt) })
      .setCollisionGroups(groups(GROUP_GROUND, 0xffff)),
  );
  const holes: { x: number; z: number }[] = [];
  const probe: GroundProbe = {
    groundAt: opts.ground ?? (() => 'gravel'),
    wetness: () => opts.wet ?? 0,
    softness: opts.soft ?? (() => 0),
    waterDepth: opts.water ?? (() => 0),
    iceAt: (x, z) => (holes.some((h) => Math.hypot(x - h.x, z - h.z) < 3.5) ? 0 : (opts.ice ?? 0)),
    breakIce: (x, z) => void holes.push({ x, z }),
    snowAt: () => opts.snow ?? 0,
  };
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
  return { world, car, run, tiltOf, holes };
}

describe.each(['tgb11', 'tgb13', 'ltb4'])('%s', (name) => {
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

describe('soft ground', () => {
  const bog = { ground: () => 'bog', soft: () => 1 };

  it('stays on top of firm ground', () => {
    const { car, run } = setup('tgb11');
    run(1);
    run(4, { throttle: 0.5 });
    expect(Math.max(...car.wheels.map((w) => w.sink))).toBe(0);
  });

  it('settles into a bog and crawls through it in low range', () => {
    const { car, run } = setup('tgb11', bog);
    car.toggleRange();
    car.def.axles.forEach((_, a) => car.toggleLock(a));
    run(1);
    run(12, { throttle: 0.35 });
    const sink = Math.max(...car.wheels.map((w) => w.sink));
    expect(sink).toBeGreaterThan(0.08);
    expect(sink).toBeLessThan(0.25);
    expect(car.body.translation().z).toBeLessThan(-8);
  });

  it('digs itself in when the wheels are spun in the rain, and crawls out with the locks in', () => {
    const { car, run } = setup('tgb11', { ...bog, wet: 1 });
    run(1);
    run(8, { throttle: 1 });
    // With open differentials the wheels with the least weight spin, and dig far deeper than rolling settles them.
    expect(Math.max(...car.wheels.map((w) => w.sink))).toBeGreaterThan(0.22);
    // Dug in, it goes nowhere on open differentials.
    let z = car.body.translation().z;
    run(4, { throttle: 1 });
    expect(Math.abs(car.body.translation().z - z)).toBeLessThan(0.5);
    // In low range with the differentials locked all four wheels pull, and it crawls out.
    car.toggleRange();
    car.def.axles.forEach((_, a) => car.toggleLock(a));
    z = car.body.translation().z;
    run(10, { throttle: 1 });
    expect(car.body.translation().z).toBeLessThan(z - 2);
  });
});

describe('water', () => {
  /** Water from 6 m ahead, deepening by a metre every 4 m to `deepest`. */
  const ford = (deepest: number) => (_x: number, z: number) => Math.max(0, Math.min(deepest, (-z - 6) * 0.25));

  it('fords shallow water, slowed by it, and comes out the other side', () => {
    // 0.5 m deep from 8 m to 30 m ahead, with sloping banks.
    const across = (_x: number, z: number) => Math.max(0, Math.min(0.5, (-z - 6) * 0.25, (34 - -z) * 0.25));
    const { car, run } = setup('tgb11', { water: across });
    run(1);
    let deepest = 0, lowest = 0, slowest = Infinity;
    for (let s = 0; s < 14 * 60 && car.body.translation().z > -45; s++) {
      run(1 / 60, { throttle: 0.6 });
      deepest = Math.max(deepest, car.wading);
      lowest = Math.min(lowest, car.body.translation().y);
      if (car.wading > 0.45) slowest = Math.min(slowest, car.speed);
    }
    expect(car.drowned).toBe(false);
    expect(deepest).toBeGreaterThan(0.45);
    // Down on the bed, half a metre below the surface.
    expect(lowest).toBeLessThan(-0.4);
    expect(car.body.translation().z).toBeLessThan(-45);
    // Out again, back up on dry ground.
    run(2, { throttle: 0.3 });
    expect(car.wading).toBe(0);
    expect(Math.abs(car.body.translation().y)).toBeLessThan(0.1);
    expect(slowest).toBeLessThan(8);
  });

  it('drowns its engine in water deeper than it can wade, and starts again on dry land', () => {
    const { car, run } = setup('tgb11', { water: ford(1.4) });
    run(1);
    run(10, { throttle: 0.6 });
    expect(car.drowned).toBe(true);
    expect(car.drivetrain.rpm).toBe(0);
    // Pulled out (put on dry ground), it dries and goes again.
    car.place(0, 0.05, 30, 0);
    car.drowned = true;
    run(DRY_SECONDS);
    expect(car.drowned).toBe(false);
  });
});

const DRY_SECONDS = 4;

describe('lake ice', () => {
  /** A lake 1.4 m deep from 6 m ahead, its bed level with the ground: ice, if any, is the ground. */
  const lake = { water: (_x: number, z: number) => (-z > 6 ? 1.4 : 0), ground: (_x: number, z: number) => (-z > 6 ? 'water' : 'gravel') };

  it('drives across thick ice without getting wet, but it is slippery', () => {
    const { car, run, holes } = setup('tgb11', { ...lake, ice: 0.5 });
    run(1);
    run(6, { throttle: 0.6 });
    expect(car.body.translation().z).toBeLessThan(-15);
    expect(holes.length).toBe(0);
    expect(car.wading).toBe(0);
    expect(car.wheels.every((w) => w.ground === 'ice')).toBe(true);
    // Braking from speed on ice takes far longer than on gravel.
    const stopping = (opts: object) => {
      const s = setup('tgb11', opts);
      s.run(1);
      s.run(8, { throttle: 0.5 });
      const from = s.car.body.translation().z, speed = s.car.speed;
      for (let t = 0; t < 10 && s.car.speed > 0.3; t += 0.05) s.run(0.05, { brake: 1 });
      return { distance: Math.abs(s.car.body.translation().z - from), speed };
    };
    const onIce = stopping({ ground: () => 'ice' });
    const onGravel = stopping({});
    expect(onIce.distance / onIce.speed ** 2).toBeGreaterThan((onGravel.distance / onGravel.speed ** 2) * 2);
  });

  it('breaks through thin ice into the water below', () => {
    const { car, run, holes } = setup('tgb11', { ...lake, ice: 0.1 });
    run(1);
    run(8, { throttle: 0.6 });
    expect(holes.length).toBeGreaterThan(0);
    expect(car.wading).toBeGreaterThan(0.6);
    expect(car.drowned).toBe(true);
  });

  it('carries a light vehicle where a heavy one goes through', () => {
    const cross = (name: string) => {
      const { car, run, holes } = setup(name, { ...lake, ice: 0.16 });
      run(1);
      run(6, { throttle: 0.5 });
      return { broke: holes.length > 0, wet: car.wading > 0.3, needed: car.iceNeeded };
    };
    const light = cross('ltb4'), heavy = cross('tgb11');
    expect(light.needed).toBeLessThan(0.16);
    expect(heavy.needed).toBeGreaterThan(0.16);
    expect(light.broke || light.wet).toBe(false);
    expect(heavy.broke && heavy.wet).toBe(true);
  });
});

describe('snow', () => {
  it('drives easily on a thin layer, gripping less than on gravel', () => {
    const { car, run } = setup('tgb11', { snow: 0.12 });
    run(1);
    run(8, { throttle: 0.6 });
    expect(car.wheels.every((w) => w.ground === 'snow')).toBe(true);
    expect(car.body.translation().z).toBeLessThan(-40);
    expect(Math.max(...car.wheels.map((w) => w.sink))).toBeLessThan(0.08);
  });

  it('slows down the deeper it is, and on a slope deep snow takes low range and the locks', () => {
    const drive = (snow: number, slope: number, crawl: boolean) => {
      const { car, run } = setup('tgb11', { snow, slope });
      if (crawl) {
        car.toggleRange();
        car.def.axles.forEach((_, a) => car.toggleLock(a));
      }
      run(1);
      run(10, { throttle: 1 });
      return { gone: -car.body.translation().z, sink: Math.max(...car.wheels.map((w) => w.sink)) };
    };
    // On the flat it goes in any depth, more slowly the deeper.
    const shallow = drive(0.3, 0, false), deep = drive(0.75, 0, false), deeper = drive(1.2, 0, false);
    expect(deeper.gone).toBeGreaterThan(20);
    expect(deeper.gone).toBeLessThan(deep.gone);
    expect(deep.gone).toBeLessThan(shallow.gone);
    expect(deep.sink).toBeGreaterThan(0.06);
    expect(deep.sink).toBeLessThan(0.15);
    // A 10° slope in deep snow: low range with the locks in climbs it.
    expect(drive(1.2, 10, true).gone).toBeGreaterThan(8);
  });

  it('lies on thick lake ice, which then grips better than bare ice', () => {
    const lake = { water: () => 1.4, ground: () => 'water', ice: 0.5 };
    const onSnow = setup('tgb11', { ...lake, snow: 0.1 });
    onSnow.run(1);
    expect(onSnow.car.wheels.every((w) => w.ground === 'snow')).toBe(true);
    expect(onSnow.car.wading).toBe(0);
    const bare = setup('tgb11', lake);
    bare.run(1);
    expect(bare.car.wheels.every((w) => w.ground === 'ice')).toBe(true);
    expect(onSnow.car.wheels[0]!.grip).toBeGreaterThan(bare.car.wheels[0]!.grip);
  });
});

describe('throttle on a key', () => {
  const drive = (ground: string, digital: boolean) => {
    const { car, run } = setup('tgb11', { ground: () => ground });
    run(1);
    let spin = 0;
    const steps = 6 * 60;
    for (let s = 0; s < steps; s++) {
      run(1 / 60, { throttle: 1, digital });
      spin += Math.max(...car.wheels.map((w) => w.spin)) / steps;
    }
    return { speed: car.speed, spin };
  };

  it('comes in at once on firm ground', () => {
    const key = drive('gravel', true), pedal = drive('gravel', false);
    expect(key.speed).toBeGreaterThan(pedal.speed * 0.95);
  });

  it('is eased in and feathered on ice, so the tyres spin far less', () => {
    const key = drive('ice', true), pedal = drive('ice', false);
    expect(key.spin).toBeLessThan(pedal.spin * 0.5);
    expect(key.speed).toBeGreaterThan(pedal.speed * 0.8);
    expect(key.speed).toBeGreaterThan(3);
  });
});
