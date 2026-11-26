import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { Beams, HEADLIGHT } from './view';

const lights = (scene: THREE.Scene): THREE.SpotLight[] => scene.children.filter((o): o is THREE.SpotLight => o instanceof THREE.SpotLight);

describe('headlight beams', () => {
  it('stay in the scene, in the same order, whichever vehicle they follow or none', () => {
    const scene = new THREE.Scene();
    const beams = new Beams(scene);
    const before = scene.children.slice();
    const car = new THREE.Group();
    car.position.set(100, 5, 200);
    car.rotation.y = Math.PI / 2;
    scene.add(car);
    const lamps = [[-0.7, 1, 2], [0, 1, 2.1], [0.7, 1, 2]];

    beams.follow(car, lamps);
    const [left, right] = lights(scene);
    expect(left!.intensity).toBe(HEADLIGHT);
    // The outer lamps, in the world: forward (+z in the body) is +x after a quarter turn.
    expect(left!.position.x).toBeCloseTo(100 + 2.05);
    expect(left!.position.y).toBeCloseTo(6);
    expect(left!.position.z).toBeCloseTo(200 + 0.7);
    expect(right!.position.z).toBeCloseTo(200 - 0.7);
    expect(left!.target.position.x).toBeGreaterThan(left!.position.x + 20);

    car.visible = false;
    beams.follow(null, lamps);
    expect(lights(scene).every((l) => l.intensity === 0 && l.visible && l.parent === scene)).toBe(true);
    expect(scene.children.slice(0, before.length)).toEqual(before);
  });
});
