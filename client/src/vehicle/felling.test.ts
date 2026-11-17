import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import type { VehicleDef } from '@spar/shared';
import { Felling, type Felled } from './felling';
import { GROUP_GROUND, GROUP_OBSTACLE, GROUP_VEHICLE, groups, VehicleSim, type VehicleInput } from './sim';

const DT = 1 / 60;
const def = JSON.parse(readFileSync(join(import.meta.dirname, '../../../defs/vehicles/tgb11.json'), 'utf8')) as VehicleDef;

beforeAll(() => RAPIER.init());

/**
 * Drives north at `kmh` (cruise control on the throttle) into a trunk `diameter` metres
 * across standing 15 m ahead. With `push`, in low range.
 */
function ram(diameter: number, kmh: number, opts: { push?: boolean } = {}) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.createCollider(RAPIER.ColliderDesc.cuboid(400, 1, 400).setTranslation(0, -1, 0).setCollisionGroups(groups(GROUP_GROUND, 0xffff)));
  const car = new VehicleSim(RAPIER, world, def, { groundAt: () => 'gravel', wetness: () => 0 });
  car.place(0, 0.05, 24, 0);
  const felling = new Felling(RAPIER, car.body);
  const desc = felling.listen(RAPIER.ColliderDesc.cylinder(3, diameter / 2).setTranslation(0, 2.6, 15), RAPIER)
    .setCollisionGroups(groups(GROUP_OBSTACLE, GROUP_VEHICLE));
  const trunk = world.createCollider(desc);
  felling.track(trunk, { key: 'tree', diameter });
  if (opts.push) car.toggleRange();

  const fell: Felled[] = [];
  let before = 0, after = NaN;
  const speed = () => Math.hypot(car.body.linvel().x, car.body.linvel().z);
  for (let s = 0; s < 60 * 12; s++) {
    const z = car.body.translation().z;
    const input: VehicleInput = { throttle: car.speed * 3.6 < kmh ? 1 : 0, brake: 0, steer: 0, handbrake: false };
    if (z > 18) before = speed();
    car.step(input, DT);
    felling.before();
    world.step(felling.events);
    for (const f of felling.after(DT)) {
      fell.push(f);
      world.removeCollider(f.collider, false);
      after = speed();
    }
  }
  return { fell, before, after, z: car.body.translation().z, speed: car.speed };
}

describe('trees in the way', () => {
  it('flattens a sapling at walking pace and barely notices', () => {
    const r = ram(0.06, 5);
    expect(r.fell).toHaveLength(1);
    expect(r.z).toBeLessThan(12); // drove on past it
    expect(r.after).toBeGreaterThan(r.before * 0.8);
    expect(r.fell[0]!.dz).toBeLessThan(-0.9); // fell the way the vehicle went, north
  });

  it('snaps a 15 cm trunk at 20 km/h, losing some speed', () => {
    const r = ram(0.15, 20);
    expect(r.fell).toHaveLength(1);
    expect(r.after).toBeLessThan(r.before * 0.95);
    expect(r.after).toBeGreaterThan(r.before * 0.4);
  });

  it('is stopped by the same trunk at a crawl, but can push it over in low range', () => {
    const crawl = ram(0.15, 3);
    expect(crawl.fell).toHaveLength(0);
    expect(crawl.z).toBeGreaterThan(15);
    const pushed = ram(0.15, 3, { push: true });
    expect(pushed.fell).toHaveLength(1);
  });

  it('is stopped dead by a grown tree, however fast', () => {
    const r = ram(0.4, 50);
    expect(r.fell).toHaveLength(0);
    expect(r.z).toBeGreaterThan(15);
  });
});
