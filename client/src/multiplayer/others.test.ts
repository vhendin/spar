import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three/webgpu';
import { beforeAll, describe, expect, it } from 'vitest';
import { pushOn, type Pushed } from './others';

beforeAll(() => RAPIER.init());

describe('pushOn', () => {
  it('measures the push our body gives another vehicle that only its driver can move', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    // Ours: two tonnes rolling east at 5 m/s; theirs: still, 4 m ahead, moved only by their snapshots.
    const ours = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1, 0).setLinvel(5, 0, 0));
    const mine = world.createCollider(RAPIER.ColliderDesc.cuboid(1, 1, 1).setMass(2000), ours);
    const theirs = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(4, 1, 0));
    world.createCollider(RAPIER.ColliderDesc.cuboid(1, 1, 1), theirs);

    const pushed: Pushed = { push: new THREE.Vector3(), pushAt: new THREE.Vector3(), pushWeight: 0 };
    for (let i = 0; i < 60; i++) {
      world.step();
      pushOn(world, theirs, new Set([mine.handle]), pushed);
    }
    // Pushed east, about as hard as it took to stop us (2000 kg × 5 m/s), at the faces that met.
    expect(pushed.push.x).toBeGreaterThan(5000);
    expect(pushed.push.x).toBeLessThan(25000);
    expect(Math.abs(pushed.push.y) + Math.abs(pushed.push.z)).toBeLessThan(pushed.push.x * 0.05);
    const at = pushed.pushAt.clone().divideScalar(pushed.pushWeight);
    expect(at.x).toBeCloseTo(3, 0);
    // Our body bounced off: it is not going through.
    expect(ours.translation().x).toBeLessThan(2.1);

    // Colliders that are not ours push nothing.
    const none: Pushed = { push: new THREE.Vector3(), pushAt: new THREE.Vector3(), pushWeight: 0 };
    world.step();
    pushOn(world, theirs, new Set([-1]), none);
    expect(none.pushWeight).toBe(0);
  });
});
