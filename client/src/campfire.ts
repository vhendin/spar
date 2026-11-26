// What a night at a camp looks like: the fire in the ring lit, with flames, sparks, smoke and a
// warm glow on the ground; at a hut or lodge its windows glowing and smoke from the chimney.
// No real lights (adding one would rebuild every material's shader): flames and windows glow
// by themselves and the ground's glow is a soft disc. Only while a night is passed, and while
// the fire burns down after.

import * as THREE from 'three/webgpu';
import { attribute, float, positionGeometry, uniform, uv, vec3 } from 'three/tsl';
import type { Spot } from './features/mesh';
import { Batch } from './vehicle/spray';

const FLAMES = 160;
const SPARKS = 120;
const SMOKE = 220;
/** Seconds the fire takes to burn down to nothing once the night is over. */
const BURN_DOWN = 12;

const FLAME: [number, number, number] = [1.6, 0.62, 0.16];
const EMBER: [number, number, number] = [1.4, 0.32, 0.06];
const SMOKE_GREY: [number, number, number] = [0.42, 0.42, 0.43];
const WINDOW = new THREE.Color(1.5, 0.78, 0.36);

export class Campfire {
  readonly group = new THREE.Group();
  private readonly right = uniform(new THREE.Vector3(1, 0, 0));
  private readonly up = uniform(new THREE.Vector3(0, 1, 0));
  private readonly flames: Batch;
  private readonly sparks: Batch;
  private readonly smoke: Batch;
  private readonly glow: THREE.Mesh;
  private readonly glowStrength = uniform(0);
  private readonly windowStrength = uniform(0);
  private readonly windowMaterial: THREE.MeshBasicNodeMaterial;
  private windows: THREE.Mesh | null = null;
  private fires: Spot[] = [];
  private chimneys: Spot[] = [];
  /** 1 burning well, falling to 0 once the night is over. */
  private burning = 0;
  private lit = false;
  private owed = { flame: 0, spark: 0, smoke: 0, chimney: 0 };
  private t = 0;

  constructor() {
    this.group.name = 'campfire';
    const at = attribute<'vec4'>('iAt', 'vec4');
    const tint = attribute<'vec4'>('iTint', 'vec4');
    const place = at.xyz.add(this.right.mul(positionGeometry.x).add(this.up.mul(positionGeometry.y)).mul(at.w));
    const r = uv().sub(0.5).length();

    // Flames and sparks shine by themselves, added onto what is behind.
    const shine = (): THREE.MeshBasicNodeMaterial => {
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      m.positionNode = place;
      m.colorNode = tint.rgb;
      m.opacityNode = tint.a.mul(float(1).sub(r.mul(2)).max(0).pow(1.6));
      return m;
    };
    this.flames = new Batch(FLAMES, shine(), 'camp flames');
    this.sparks = new Batch(SPARKS, shine(), 'camp sparks');
    // Smoke is lit like everything else, so it is dark at night and pale at dawn.
    const soft = new THREE.MeshStandardNodeMaterial({ roughness: 1, metalness: 0, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    soft.positionNode = place;
    soft.colorNode = tint.rgb;
    soft.normalNode = vec3(0, 0, 1);
    soft.opacityNode = tint.a.mul(float(1).sub(r.mul(2)).max(0).pow(1.5));
    this.smoke = new Batch(SMOKE, soft, 'camp smoke');

    // The fire's light on the ground round it: a soft warm disc.
    const disc = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const fall = float(1).sub(uv().sub(0.5).length().mul(2)).max(0);
    disc.colorNode = vec3(1, 0.45, 0.14);
    disc.opacityNode = fall.mul(fall).mul(this.glowStrength);
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2), disc);
    this.glow.name = 'camp glow';
    this.glow.visible = false;
    this.glow.renderOrder = 1;

    this.windowMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    this.windowMaterial.colorNode = vec3(WINDOW.r, WINDOW.g, WINDOW.b).mul(this.windowStrength);
    this.group.add(this.flames.mesh, this.sparks.mesh, this.smoke.mesh, this.glow);
    this.group.visible = false;
  }

  /** True while anything is still burning or drifting. */
  get active(): boolean {
    return this.group.visible;
  }

  /** Lights the fires and windows of a place: fire rings, chimneys and windows from its spots. */
  light(spots: Spot[]): void {
    this.clear();
    this.fires = spots.filter((s) => s.kind === 'fire');
    this.chimneys = spots.filter((s) => s.kind === 'chimney');
    const windows = spots.filter((s) => s.kind === 'window');
    if (windows.length) {
      const positions: number[] = [];
      const index: number[] = [];
      for (const w of windows) {
        const nx = w.nx ?? 0, nz = w.nz ?? 1;
        // Across the window, level: the normal turned a quarter.
        const ax = -nz, az = nx;
        const hw = (w.w ?? 1) / 2, hh = (w.h ?? 1) / 2;
        const base = positions.length / 3;
        for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) positions.push(w.x + ax * hw * u, w.y + hh * v, w.z + az * hw * u);
        index.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      g.setIndex(index);
      g.computeBoundingSphere();
      this.windows = new THREE.Mesh(g, this.windowMaterial);
      this.windows.name = 'camp windows';
      this.group.add(this.windows);
    }
    const f = this.fires[0];
    this.glow.visible = !!f;
    if (f) this.glow.position.set(f.x, f.y + 0.06, f.z);
    this.lit = true;
    this.burning = 1;
    this.group.visible = true;
  }

  /** The night is over: the fire burns down and the windows go dark over a few seconds. */
  burnDown(): void {
    this.lit = false;
  }

  /** Call every frame; `dark` 0 in daylight to 1 at night dims the glow by day. */
  update(dt: number, camera: THREE.Camera, dark: number, windX: number, windZ: number): void {
    if (!this.group.visible) return;
    this.t += dt;
    camera.updateMatrixWorld();
    this.right.value.setFromMatrixColumn(camera.matrixWorld, 0);
    this.up.value.setFromMatrixColumn(camera.matrixWorld, 1);
    if (!this.lit) this.burning = Math.max(0, this.burning - dt / BURN_DOWN);
    const b = this.burning;
    const flicker = 0.8 + 0.12 * Math.sin(this.t * 13.1) + 0.08 * Math.sin(this.t * 23.7 + 1.3);
    this.glowStrength.value = 0.6 * b * flicker * (0.25 + 0.75 * dark);
    this.windowStrength.value = Math.min(1, b * 1.5) * (0.15 + 0.85 * dark);
    if (this.windows) this.windows.visible = this.windowStrength.value > 0.01;

    const rnd = (a: number, c: number): number => a + Math.random() * (c - a);
    for (const f of this.fires) {
      this.owed.flame += dt * 90 * b;
      while (this.owed.flame >= 1) {
        this.owed.flame--;
        const a = Math.random() * Math.PI * 2, d = Math.random() * 0.25;
        const ember = Math.random() < 1 - b;
        this.flames.add(f.x + Math.cos(a) * d, f.y + 0.1, f.z + Math.sin(a) * d, rnd(-0.1, 0.1), rnd(0.5, 1.1) * b, rnd(-0.1, 0.1), rnd(0.35, 0.7), rnd(0.25, 0.45) * (0.5 + b * 0.5), ember ? EMBER : FLAME, rnd(0.8, 1.2), 0.8);
      }
      this.owed.spark += dt * 10 * b;
      while (this.owed.spark >= 1) {
        this.owed.spark--;
        this.sparks.add(f.x, f.y + 0.3, f.z, rnd(-0.4, 0.4), rnd(1.2, 2.6), rnd(-0.4, 0.4), rnd(1, 2.2), rnd(0.03, 0.06), EMBER, rnd(1, 1.6));
      }
      this.owed.smoke += dt * 6 * Math.max(b, 0.3 * (b > 0 ? 1 : 0));
      while (this.owed.smoke >= 1) {
        this.owed.smoke--;
        this.smoke.add(f.x, f.y + 0.8, f.z, rnd(-0.1, 0.1), rnd(0.5, 0.8), rnd(-0.1, 0.1), rnd(5, 8), rnd(0.5, 0.8), SMOKE_GREY, rnd(0.8, 1.1), 0.35);
      }
    }
    for (const c of this.chimneys) {
      this.owed.chimney += dt * 4 * b;
      while (this.owed.chimney >= 1) {
        this.owed.chimney--;
        this.smoke.add(c.x, c.y + 0.1, c.z, rnd(-0.05, 0.05), rnd(0.5, 0.9), rnd(-0.05, 0.05), rnd(6, 9), rnd(0.35, 0.55), SMOKE_GREY, rnd(0.8, 1.1), 0.4);
      }
    }
    this.move(this.flames, dt, 0, 0, 0.4);
    this.move(this.sparks, dt, windX * 0.3, windZ * 0.3, -0.6);
    this.move(this.smoke, dt, windX * 0.6, windZ * 0.6, 0);
    this.flames.upload((left) => [0.4 + left * 0.6, left]);
    this.sparks.upload((left) => [1, Math.min(1, left * 2)]);
    this.smoke.upload((left) => [1 + (1 - left) * 4, 0.45 * Math.min(1, left * 1.5) * Math.min(1, (1 - left) * 6)]);
    if (b <= 0 && this.flames.count + this.sparks.count + this.smoke.count === 0) this.clear();
  }

  /** Moves a batch on: drift towards the wind, and `lift` m/s² up (negative falls). */
  private move(batch: Batch, dt: number, wx: number, wz: number, lift: number): void {
    for (let i = batch.count - 1; i >= 0; i--) {
      batch.life[i]! -= dt;
      if (batch.life[i]! <= 0) {
        batch.remove(i);
        continue;
      }
      const k = i * 3;
      batch.vel[k] = batch.vel[k]! + (wx - batch.vel[k]!) * Math.min(1, dt * 0.5);
      batch.vel[k + 1] = batch.vel[k + 1]! + lift * dt;
      batch.vel[k + 2] = batch.vel[k + 2]! + (wz - batch.vel[k + 2]!) * Math.min(1, dt * 0.5);
      batch.pos[k] = batch.pos[k]! + batch.vel[k]! * dt;
      batch.pos[k + 1] = batch.pos[k + 1]! + batch.vel[k + 1]! * dt;
      batch.pos[k + 2] = batch.pos[k + 2]! + batch.vel[k + 2]! * dt;
    }
  }

  /** Puts everything out at once. */
  clear(): void {
    for (const b of [this.flames, this.sparks, this.smoke]) {
      b.count = 0;
      b.upload(() => [1, 1]);
    }
    if (this.windows) {
      this.group.remove(this.windows);
      this.windows.geometry.dispose();
      this.windows = null;
    }
    this.fires = [];
    this.chimneys = [];
    this.burning = 0;
    this.lit = false;
    this.glow.visible = false;
    this.group.visible = false;
  }
}
