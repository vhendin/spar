// The next checkpoint on a trail: a white pole beside the line with a strip of orange flagging
// tape tied at the top, streaming in the wind. Only one stands at a time, where the driver is
// heading next; nothing else in the world changes for a trail. A soft orange column of light
// stands on it so it can be found from a few hundred metres off, faint once you are close.

import * as THREE from 'three/webgpu';
import { float, positionLocal, smoothstep, uniform } from 'three/tsl';

const POLE = 2.2;
const RIBBON = 0.9;
const SEGMENTS = 8;
/** Beside the line, to the right as driven, metres. */
const SIDE = 3;
/** The column of light over the pole, metres. */
const LIGHT = 45;
const LIGHT_COLOR = 0xff7a3a;
/** The checkpoint's mark on the compass, as CSS. */
export const CHECKPOINT_COLOR = '#ff7a3a';

export class TrailFlag {
  readonly group = new THREE.Group();
  private readonly ribbon: THREE.BufferGeometry;
  private t = 0;
  private readonly light: THREE.Mesh;
  /** 1 seen from afar, faint close by. */
  private readonly far = uniform(1);

  constructor() {
    this.group.name = 'trail flag';
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.035, POLE, 6).translate(0, POLE / 2, 0),
      new THREE.MeshStandardNodeMaterial({ color: 0xe8e6df, roughness: 0.7 }),
    );
    this.ribbon = new THREE.PlaneGeometry(RIBBON, 0.07, SEGMENTS, 1).translate(RIBBON / 2, POLE - 0.1, 0);
    const tape = new THREE.Mesh(
      this.ribbon,
      new THREE.MeshStandardNodeMaterial({ color: 0xff5a2a, emissive: 0x6a1a08, roughness: 0.6, side: THREE.DoubleSide }),
    );
    tape.frustumCulled = false;
    const column = new THREE.CylinderGeometry(0.7, 0.7, LIGHT, 12, 1, true).translate(0, LIGHT / 2, 0);
    const glow = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
    glow.color = new THREE.Color(LIGHT_COLOR);
    // Strongest at the foot, gone at the top.
    glow.opacityNode = float(1).sub(smoothstep(0, LIGHT, positionLocal.y)).mul(0.6).mul(this.far);
    this.light = new THREE.Mesh(column, glow);
    this.light.name = 'checkpoint light';
    this.light.frustumCulled = false;
    this.group.add(pole, tape, this.light);
    this.group.visible = false;
  }

  /** Stands at a checkpoint (x, z, heading in degrees, the ground height there), or is taken away. */
  place(at: { x: number; z: number; heading: number } | null, ground = 0): void {
    this.group.visible = !!at;
    if (!at) return;
    const h = (at.heading * Math.PI) / 180;
    // Forward is (sin h, −cos h); right of it (cos h, sin h).
    this.group.position.set(at.x + Math.cos(h) * SIDE, ground - 0.1, at.z + Math.sin(h) * SIDE);
  }

  /**
   * Call every frame: the tape streams downwind, fluttering (`windX`, `windZ` in m/s), and the
   * light is kept a few pixels wide however far the camera (`eye`) is.
   */
  update(dt: number, windX: number, windZ: number, eye: THREE.Vector3): void {
    if (!this.group.visible) return;
    this.t += dt;
    const p0 = this.group.position;
    const far = Math.hypot(eye.x - p0.x, eye.z - p0.z);
    const wide = Math.max(1, far / 350);
    this.light.scale.set(wide, Math.max(1, far / 600), wide);
    this.far.value = THREE.MathUtils.smoothstep(far, 15, 80) * 0.8 + 0.2;
    const wind = Math.hypot(windX, windZ);
    // The tape turns to point downwind (the group is not turned, so this is world space).
    this.group.children[1]!.rotation.y = wind > 0.1 ? Math.atan2(-windZ, windX) : 0.6;
    const droop = Math.max(0.15, 1 - wind / 6);
    const p = this.ribbon.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const u = (i % (SEGMENTS + 1)) / SEGMENTS;
      const top = i <= SEGMENTS ? 0.035 : -0.035;
      const along = u * RIBBON;
      // Hangs down when the air is still, streams out and flutters in a wind.
      const flutter = Math.sin(this.t * (6 + wind) - u * 7) * 0.06 * u * (0.3 + Math.min(1, wind / 4));
      p.setXYZ(i, along * (1 - droop * 0.6), POLE - 0.1 + top - along * droop * 0.9, flutter);
    }
    p.needsUpdate = true;
    this.ribbon.computeVertexNormals();
  }
}
