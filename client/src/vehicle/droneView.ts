// How the scouting drone looks: a small grey quadcopter with spinning rotors, a camera under
// its nose and a blinking light, leaning into the way it flies. Used for our own drone and
// for the others'.

import * as THREE from 'three/webgpu';

/** Seconds between blinks, and how long each lasts. */
const BLINK_EVERY = 1.1;
const BLINK_FOR = 0.12;
/** Radians of lean per metre a second, and the most. */
const LEAN = 0.035;
const MOST_LEAN = 0.45;

export class DroneView {
  readonly group = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly rotors: THREE.Mesh[] = [];
  private readonly light: THREE.Mesh;
  private readonly lightMaterial: THREE.MeshBasicMaterial;
  private clock = Math.random() * BLINK_EVERY;
  private readonly lean = new THREE.Vector2();

  constructor(color = 0x3c3f42) {
    const shell = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.2 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1c1d, roughness: 0.6 });
    const blade = new THREE.MeshBasicMaterial({ color: 0x202224, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
    const hull = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.3), shell);
    hull.castShadow = true;
    this.body.add(hull);
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.025, 0.32), dark);
      arm.position.set(sx * 0.11, 0.01, sz * 0.11);
      arm.rotation.y = Math.atan2(sx, sz);
      arm.castShadow = true;
      const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.05, 10), dark);
      motor.position.set(sx * 0.22, 0.03, sz * 0.22);
      const rotor = new THREE.Mesh(new THREE.CircleGeometry(0.13, 20), blade);
      rotor.rotation.x = -Math.PI / 2;
      rotor.position.set(sx * 0.22, 0.06, sz * 0.22);
      this.rotors.push(rotor);
      this.body.add(arm, motor, rotor);
    }
    const camera = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), dark);
    camera.position.set(0, -0.05, 0.13);
    this.lightMaterial = new THREE.MeshBasicMaterial({ color: 0xff3a2a });
    this.light = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), this.lightMaterial);
    this.light.position.set(0, 0.05, -0.15);
    this.body.add(camera, this.light);
    // A little larger than life, so it is seen from a distance.
    this.body.scale.setScalar(1.5);
    this.group.add(this.body);
  }

  /** Where it is, facing `yaw` (0 along +z), moving at `v`; `spinning` false on the roof. */
  update(dt: number, p: { x: number; y: number; z: number }, yaw: number, v: { x: number; z: number }, spinning: boolean): void {
    this.group.position.set(p.x, p.y, p.z);
    this.group.rotation.set(0, yaw, 0);
    // Leaning into its motion: forward tips the nose down.
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const ahead = v.x * s + v.z * c, side = v.x * c - v.z * s;
    const want = (x: number): number => Math.max(-MOST_LEAN, Math.min(MOST_LEAN, x * LEAN));
    const k = Math.min(1, dt * 5);
    this.lean.x += (want(ahead) - this.lean.x) * k;
    this.lean.y += (want(side) - this.lean.y) * k;
    this.body.rotation.set(this.lean.x, 0, -this.lean.y);
    for (const r of this.rotors) r.visible = spinning;
    this.clock = (this.clock + dt) % BLINK_EVERY;
    this.light.visible = !spinning || this.clock < BLINK_FOR;
    this.lightMaterial.color.setHex(spinning ? 0xff3a2a : 0x5a1410);
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    this.group.removeFromParent();
  }
}
