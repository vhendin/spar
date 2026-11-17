// Grass and low shrubs the vehicle drives over are pressed flat the way it went, and rise
// again over a couple of minutes. A small picture of the ground around the vehicle holds how
// flattened each patch is and which way it lies; the plants' vertex shader reads it.
//
// The picture wraps: a spot in the world always lands on the same texel, so moving the
// window only means clearing the rows and columns that come into it.

import * as THREE from 'three/webgpu';
import type { VehicleSim } from '../vehicle/sim';

/** Texels per side, and metres per texel: a window 128 m across. */
export const TRAMPLE_SIZE = 256;
export const TRAMPLE_CELL = 0.5;
/** Seconds for flattened plants to stand back up halfway. */
const RECOVER = 70;
/** Seconds between fades of the whole picture. */
const FADE_EVERY = 0.5;

export class Trample {
  readonly texture: THREE.DataTexture;
  /** World position (x, z) of the window's middle, for the shader. */
  readonly centre = new THREE.Vector2();
  private readonly data: Uint8Array;
  private cx = 0;
  private cz = 0;
  private started = false;
  private sinceFade = 0;
  private changed = false;
  private readonly forward = new THREE.Vector3();
  private readonly side = new THREE.Vector3();

  constructor() {
    this.data = new Uint8Array(TRAMPLE_SIZE * TRAMPLE_SIZE * 4);
    this.texture = new THREE.DataTexture(this.data, TRAMPLE_SIZE, TRAMPLE_SIZE, THREE.RGBAFormat);
    this.texture.wrapS = this.texture.wrapT = THREE.RepeatWrapping;
    this.texture.magFilter = this.texture.minFilter = THREE.LinearFilter;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.needsUpdate = true;
  }

  /** Call every frame with the vehicle; `dt` 0 while paused. */
  update(dt: number, sim: VehicleSim, group: THREE.Object3D): void {
    const p = group.position;
    this.follow(p.x, p.z);
    if (dt > 0) {
      this.sinceFade += dt;
      if (this.sinceFade >= FADE_EVERY) {
        this.fade(Math.pow(0.5, this.sinceFade / RECOVER));
        this.sinceFade = 0;
      }
    }
    const v = sim.body.linvel();
    const speed = Math.hypot(v.x, v.z);
    this.forward.set(0, 0, 1).applyQuaternion(group.quaternion);
    // Plants lie the way the vehicle moves; when it barely moves, the way it faces.
    const dx = speed > 0.5 ? v.x / speed : this.forward.x * Math.sign(sim.speed || 1);
    const dz = speed > 0.5 ? v.z / speed : this.forward.z * Math.sign(sim.speed || 1);
    const half = (sim.def.wheels.width ?? 0.3) * 0.9 + 0.35;
    for (const wheel of sim.wheels) {
      if (!wheel.contact) continue;
      this.press(wheel.point.x, wheel.point.z, half, 1, dx, dz);
    }
    // Under the body, between and around the wheels, plants are bent but not crushed.
    const f = this.forward;
    this.side.set(f.z, 0, -f.x);
    const box = sim.def.chassis.box;
    const length = box.size[2]! / 2, width = box.size[0]! / 2;
    const cz = box.center[2]!;
    if (sim.wheels.some((w) => w.contact)) {
      for (let a = -length; a <= length; a += 0.6) {
        for (let b = -width; b <= width; b += 0.6) {
          this.press(p.x + f.x * (a + cz) + this.side.x * b, p.z + f.z * (a + cz) + this.side.z * b, 0.45, 0.75, dx, dz);
        }
      }
    }
    if (this.changed) {
      this.texture.needsUpdate = true;
      this.changed = false;
    }
  }

  /** Flattens plants within `radius` metres of a point to at least `amount`, lying along (dx, dz). */
  private press(x: number, z: number, radius: number, amount: number, dx: number, dz: number): void {
    const r = Math.ceil(radius / TRAMPLE_CELL);
    const ix = Math.floor(x / TRAMPLE_CELL), iz = Math.floor(z / TRAMPLE_CELL);
    const level = Math.round(amount * 255);
    const gx = Math.round((dx * 0.5 + 0.5) * 255), gz = Math.round((dz * 0.5 + 0.5) * 255);
    for (let j = -r; j <= r; j++) {
      for (let i = -r; i <= r; i++) {
        if ((i * i + j * j) * TRAMPLE_CELL * TRAMPLE_CELL > radius * radius) continue;
        const at = this.texel(ix + i, iz + j);
        if (this.data[at]! >= level) continue;
        this.data[at] = level;
        this.data[at + 1] = gx;
        this.data[at + 2] = gz;
        this.data[at + 3] = 255;
        this.changed = true;
      }
    }
  }

  private texel(i: number, j: number): number {
    const n = TRAMPLE_SIZE;
    return ((((j % n) + n) % n) * n + (((i % n) + n) % n)) * 4;
  }

  /** Lets everything stand up a bit. */
  private fade(keep: number): void {
    const d = this.data;
    let any = false;
    for (let k = 0; k < d.length; k += 4) {
      if (d[k] === 0) continue;
      d[k] = Math.floor(d[k]! * keep);
      any = true;
    }
    if (any) this.changed = true;
  }

  /** Moves the window to centre on (x, z), clearing what comes into it. */
  private follow(x: number, z: number): void {
    const n = TRAMPLE_SIZE;
    const cx = Math.floor(x / TRAMPLE_CELL), cz = Math.floor(z / TRAMPLE_CELL);
    this.centre.set(x, z);
    if (!this.started || Math.abs(cx - this.cx) >= n || Math.abs(cz - this.cz) >= n) {
      this.data.fill(0);
      this.changed = true;
    } else {
      // Columns, then rows, that were outside the old window and are inside the new one.
      for (let i = Math.min(cx, this.cx) - n / 2; i < Math.max(cx, this.cx) + n / 2; i++) {
        const before = i >= this.cx - n / 2 && i < this.cx + n / 2;
        const now = i >= cx - n / 2 && i < cx + n / 2;
        if (now && !before) this.clear(i, true);
      }
      for (let j = Math.min(cz, this.cz) - n / 2; j < Math.max(cz, this.cz) + n / 2; j++) {
        const before = j >= this.cz - n / 2 && j < this.cz + n / 2;
        const now = j >= cz - n / 2 && j < cz + n / 2;
        if (now && !before) this.clear(j, false);
      }
    }
    this.started = true;
    this.cx = cx;
    this.cz = cz;
  }

  private clear(k: number, column: boolean): void {
    for (let m = 0; m < TRAMPLE_SIZE; m++) {
      const at = column ? this.texel(k, m) : this.texel(m, k);
      this.data[at] = 0;
    }
    this.changed = true;
  }
}
