import * as THREE from 'three/webgpu';
import { createRng } from '@spar/shared';

const SKY = 0x9db8c8;

/**
 * Placeholder world for step 1: a flat ground with a metre grid and scattered blocks.
 * World axes: X east, Y up, Z south. One unit is one metre.
 */
export function buildTestScene(seed: number): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 200, 1500);

  scene.add(new THREE.HemisphereLight(0xcfe3f0, 0x3a3a2c, 1.2));
  const sun = new THREE.DirectionalLight(0xfff1dd, 2.2);
  sun.position.set(300, 500, 200);
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x4d5a3c, roughness: 1 }),
  );
  scene.add(ground);

  // One line every 10 m, so distances and speed are easy to judge.
  const grid = new THREE.GridHelper(4000, 400, 0x2c3324, 0x3f4a32);
  grid.position.y = 0.02;
  scene.add(grid);

  // Blocks standing in for trees; placement comes from the server's seed.
  const rng = createRng(seed);
  const count = 600;
  const blocks = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
    new THREE.MeshStandardMaterial({ roughness: 0.9 }),
    count,
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const x = rng.range(-1000, 1000);
    const z = rng.range(-1000, 1000);
    const width = rng.range(1, 4);
    const height = rng.range(4, 22);
    q.setFromAxisAngle(up, rng.range(0, Math.PI * 2));
    m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(width, height, width));
    blocks.setMatrixAt(i, m);
    blocks.setColorAt(i, color.setHSL(rng.range(0.22, 0.36), 0.35, rng.range(0.18, 0.34)));
  }
  scene.add(blocks);

  return scene;
}
