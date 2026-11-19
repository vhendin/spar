// What the tyres throw up: mud, turf and gravel flung back by a spinning wheel, pushed ahead
// by a locked one, kicked sideways in a slide, and water splashing through a stream. Dry
// ground gives dust instead of clods. Particles live on the CPU (a few thousand at most) and
// are drawn as camera-facing quads in two batches: solid clods and soft puffs.

import * as THREE from 'three/webgpu';
import { attribute, float, positionGeometry, uniform, uv, vec3 } from 'three/tsl';
import type { VehicleSim } from './sim';

const CLODS = 2400;
const PUFFS = 700;
const GRAVITY = 9.81;

interface Look {
  /** Colour of what is thrown, dry and soaked. */
  dry: [number, number, number];
  wet: [number, number, number];
  /** Clods per second at full strength, and how much the ground gives as dust when dry. */
  rate: number;
  dust: number;
  /** Clod size in metres. */
  size: number;
  /** Throws even when only rolling at speed (streams, wet bog). */
  splash: number;
}

const LOOKS: Record<string, Look> = {
  dirt: { dry: [0.36, 0.28, 0.2], wet: [0.17, 0.12, 0.08], rate: 220, dust: 1, size: 0.1, splash: 0 },
  bog: { dry: [0.2, 0.16, 0.1], wet: [0.09, 0.07, 0.05], rate: 300, dust: 0.2, size: 0.13, splash: 0.35 },
  grass: { dry: [0.3, 0.32, 0.17], wet: [0.17, 0.16, 0.08], rate: 130, dust: 0.3, size: 0.11, splash: 0 },
  gravel: { dry: [0.48, 0.46, 0.42], wet: [0.3, 0.29, 0.27], rate: 150, dust: 1, size: 0.08, splash: 0 },
  sand: { dry: [0.66, 0.58, 0.44], wet: [0.42, 0.36, 0.26], rate: 200, dust: 1.4, size: 0.05, splash: 0 },
  snow: { dry: [0.95, 0.97, 1], wet: [0.75, 0.77, 0.78], rate: 90, dust: 1.6, size: 0.06, splash: 0.15 },
  water: { dry: [0.72, 0.76, 0.78], wet: [0.72, 0.76, 0.78], rate: 300, dust: 0, size: 0.08, splash: 1 },
};

/** One batch of particles, packed so the live ones come first. */
export class Batch {
  readonly mesh: THREE.Mesh;
  count = 0;
  readonly pos: Float32Array;
  readonly vel: Float32Array;
  readonly life: Float32Array; // seconds left, then total
  readonly total: Float32Array;
  readonly size: Float32Array;
  readonly colour: Float32Array;
  /** Each particle's own opacity, multiplied with the fade. */
  readonly alpha: Float32Array;
  private readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly at: THREE.InstancedBufferAttribute;
  private readonly tint: THREE.InstancedBufferAttribute;

  constructor(readonly max: number, material: THREE.NodeMaterial, name: string) {
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.total = new Float32Array(max);
    this.size = new Float32Array(max);
    this.colour = new Float32Array(max * 3);
    this.alpha = new Float32Array(max);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    this.geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.at = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.tint = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('iAt', this.at);
    this.geometry.setAttribute('iTint', this.tint);
    this.geometry.instanceCount = 0;
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
  }

  add(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, rgb: [number, number, number], shade: number, alpha = 1): void {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.life[i] = this.total[i] = life;
    this.size[i] = size;
    this.alpha[i] = alpha;
    this.colour.set([rgb[0] * shade, rgb[1] * shade, rgb[2] * shade], i * 3);
  }

  /** Moves the last particle into slot i. */
  remove(i: number): void {
    const last = --this.count;
    if (i === last) return;
    this.pos.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.vel.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.colour.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.life[i] = this.life[last]!;
    this.total[i] = this.total[last]!;
    this.size[i] = this.size[last]!;
    this.alpha[i] = this.alpha[last]!;
  }

  /** Hands the live particles to the GPU; `fade` gives (size scale, alpha) from the fraction of life left. */
  upload(fade: (left: number, i: number) => [number, number]): void {
    const at = this.at.array as Float32Array;
    const tint = this.tint.array as Float32Array;
    for (let i = 0; i < this.count; i++) {
      const [grow, alpha] = fade(this.life[i]! / this.total[i]!, i);
      at[i * 4] = this.pos[i * 3]!;
      at[i * 4 + 1] = this.pos[i * 3 + 1]!;
      at[i * 4 + 2] = this.pos[i * 3 + 2]!;
      at[i * 4 + 3] = this.size[i]! * grow;
      tint[i * 4] = this.colour[i * 3]!;
      tint[i * 4 + 1] = this.colour[i * 3 + 1]!;
      tint[i * 4 + 2] = this.colour[i * 3 + 2]!;
      tint[i * 4 + 3] = alpha * this.alpha[i]!;
    }
    this.geometry.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
    if (this.count > 0) {
      this.at.addUpdateRange(0, this.count * 4);
      this.tint.addUpdateRange(0, this.count * 4);
      this.at.needsUpdate = this.tint.needsUpdate = true;
    }
  }
}

export class Spray {
  readonly group = new THREE.Group();
  private readonly right = uniform(new THREE.Vector3(1, 0, 0));
  private readonly up = uniform(new THREE.Vector3(0, 1, 0));
  private readonly clods: Batch;
  private readonly puffs: Batch;
  /** Particles owed per wheel, carried between frames. */
  private owed: number[] = [];
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly o = new THREE.Vector3();
  private readonly d = new THREE.Vector3();

  constructor() {
    const at = attribute<'vec4'>('iAt', 'vec4');
    const tint = attribute<'vec4'>('iTint', 'vec4');
    const place = at.xyz.add(this.right.mul(positionGeometry.x).add(this.up.mul(positionGeometry.y)).mul(at.w));
    const r = uv().sub(0.5).length();

    // Clods: solid, lit like the ground, roughly round.
    const solid = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
    solid.positionNode = place;
    solid.colorNode = tint.rgb;
    // Facing the camera, so lit from wherever the camera looks from.
    solid.normalNode = vec3(0, 0, 1);
    solid.maskNode = r.lessThan(0.5);
    this.clods = new Batch(CLODS, solid, 'spray clods');
    this.clods.mesh.castShadow = false;

    // Dust and mist: soft and see-through, lit like the clods so they do not glow at night.
    const soft = new THREE.MeshStandardNodeMaterial({ roughness: 1, metalness: 0, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    soft.positionNode = place;
    soft.colorNode = tint.rgb;
    soft.normalNode = vec3(0, 0, 1);
    soft.opacityNode = tint.a.mul(float(1).sub(r.mul(2)).max(0).pow(1.5));
    this.puffs = new Batch(PUFFS, soft, 'spray dust');
    this.group.add(this.clods.mesh, this.puffs.mesh);
  }

  /**
   * Call every frame after the vehicle view is placed. `wetness` 0 dry to 1 soaked;
   * `groundAt` gives the terrain height so clods land.
   */
  update(dt: number, sim: VehicleSim, vehicle: THREE.Object3D, camera: THREE.Camera, wetness: number, groundAt: (x: number, z: number) => number | null): void {
    camera.updateMatrixWorld();
    this.right.value.setFromMatrixColumn(camera.matrixWorld, 0);
    this.up.value.setFromMatrixColumn(camera.matrixWorld, 1);
    if (dt > 0) {
      this.emit(dt, sim, vehicle, wetness);
      this.move(dt, groundAt);
    }
    this.clods.upload((left) => [left < 0.25 ? left * 4 : 1, 1]);
    this.puffs.upload((left) => [1 + (1 - left) * 2.5, 0.5 * left * left]);
  }

  private emit(dt: number, sim: VehicleSim, vehicle: THREE.Object3D, wetness: number): void {
    const v = sim.body.linvel();
    const radius = sim.def.wheels.radius;
    const width = sim.def.wheels.width ?? 0.3;
    const reverse = sim.drivetrain.gear < 0;
    this.q.copy(vehicle.quaternion);
    sim.wheels.forEach((wheel, i) => {
      if (!wheel.contact) return;
      const look = LOOKS[wheel.ground];
      if (!look) return; // rock and asphalt throw nothing
      const wet = Math.max(wetness, wheel.ground === 'bog' || wheel.ground === 'water' ? 1 : 0);
      const speed = Math.abs(sim.speed);
      const spin = wheel.spin > 0.05 ? wheel.spin : 0;
      const slide = Math.min(1, Math.max(0, (Math.abs(wheel.slide) - 1.5) / 4));
      const splash = look.splash * Math.min(1, speed / 8);
      const strength = spin + wheel.skid + slide + splash;
      if (strength <= 0) {
        this.owed[i] = 0;
        return;
      }
      const at = sim.wheelPosition(i);
      const side = i & 1 ? -1 : 1;
      const rgb = look.dry.map((c, k) => c + (look.wet[k]! - c) * wet) as [number, number, number];
      // Wet ground throws clods; dry ground mostly dust.
      const clodShare = 0.25 + 0.75 * wet;
      this.owed[i] = (this.owed[i] ?? 0) + strength * look.rate * dt;
      let n = Math.floor(this.owed[i]!);
      this.owed[i]! -= n;
      n = Math.min(n, 40);
      for (let k = 0; k < n; k++) {
        // Pick what threw this one, in proportion to the strengths.
        let pick = Math.random() * strength;
        let dir: number, lx: number, ly: number, lz: number, ox: number, oz: number, oy: number;
        const jitter = (): number => Math.random() * 2 - 1;
        if ((pick -= spin) < 0) {
          // Flung off the back of a spinning tyre (the front when reversing), up and away.
          dir = reverse ? 1 : -1;
          const s = (3 + Math.random() * 5) * (0.5 + spin);
          oz = dir * radius * 0.7;
          oy = radius * 0.35;
          ox = jitter() * width * 0.4;
          lx = jitter() * 1.2 + side * Math.random() * 0.8;
          ly = s * (0.45 + Math.random() * 0.45);
          lz = dir * s;
        } else if ((pick -= wheel.skid) < 0) {
          // Ploughed up ahead of a locked tyre, low and in the direction of travel.
          dir = Math.sign(sim.speed) || 1;
          const s = speed * (0.25 + Math.random() * 0.35);
          oz = dir * radius * 0.6;
          oy = 0.05;
          ox = jitter() * width * 0.5;
          lx = jitter() * 1.5 + side * Math.random() * 1.2;
          ly = 0.8 + Math.random() * 1.6;
          lz = dir * s;
        } else if (pick < slide) {
          // Scraped off sideways in a slide.
          dir = Math.sign(wheel.slide);
          oz = jitter() * radius * 0.5;
          oy = 0.05;
          ox = dir * width * 0.5;
          lx = dir * Math.abs(wheel.slide) * (0.4 + Math.random() * 0.4);
          ly = 0.8 + Math.random() * 1.8;
          lz = jitter() * 1.2;
        } else {
          // Splashed out to the side and back by a tyre rolling through water.
          oz = jitter() * radius * 0.6;
          oy = 0.05;
          ox = side * width * 0.5;
          lx = side * (1 + Math.random() * 2.5) * Math.min(1.5, speed / 6);
          ly = 1.5 + Math.random() * 2.5 * Math.min(1.5, speed / 6);
          lz = -Math.sign(sim.speed) * Math.random() * 2;
        }
        this.p.set(at.x + ox, at.y - radius + oy, at.z + oz).applyQuaternion(this.q).add(vehicle.position);
        this.d.set(lx, ly, lz).applyQuaternion(this.q);
        // Thrown from a moving vehicle: some of its own speed comes along.
        const vx = this.d.x + v.x * 0.6, vy = this.d.y + v.y * 0.6, vz = this.d.z + v.z * 0.6;
        const shade = 0.8 + Math.random() * 0.4;
        if (Math.random() < clodShare) {
          const size = look.size * (0.5 + Math.random() * 1.1);
          this.clods.add(this.p.x, this.p.y, this.p.z, vx, vy, vz, 1.2 + Math.random() * 1.2, size, rgb, shade);
        } else if (look.dust > 0 && Math.random() < look.dust * 0.5 * (1 - wet * 0.8)) {
          this.o.set(vx * 0.3, Math.abs(vy) * 0.25 + 0.3, vz * 0.3);
          this.puffs.add(this.p.x, this.p.y + 0.2, this.p.z, this.o.x, this.o.y, this.o.z, 1.2 + Math.random() * 1.4, 0.5 + Math.random() * 0.6, rgb, 1.25 * shade);
        }
        if (wheel.ground === 'water' && Math.random() < 0.3) {
          // Fine spray hanging over a splash.
          this.puffs.add(this.p.x, this.p.y + 0.3, this.p.z, vx * 0.5, vy * 0.4, vz * 0.5, 0.6 + Math.random() * 0.6, 0.5 + Math.random() * 0.5, rgb, 1);
        }
      }
    });
  }

  private move(dt: number, groundAt: (x: number, z: number) => number | null): void {
    // Clods fly, land and lie a moment before they go.
    const c = this.clods;
    const drag = Math.exp(-0.25 * dt);
    for (let i = c.count - 1; i >= 0; i--) {
      if ((c.life[i]! -= dt) <= 0) {
        c.remove(i);
        continue;
      }
      const j = i * 3;
      c.vel[j + 1]! -= GRAVITY * dt;
      c.vel[j]! *= drag;
      c.vel[j + 2]! *= drag;
      c.pos[j]! += c.vel[j]! * dt;
      c.pos[j + 1]! += c.vel[j + 1]! * dt;
      c.pos[j + 2]! += c.vel[j + 2]! * dt;
      const ground = groundAt(c.pos[j]!, c.pos[j + 2]!);
      if (ground !== null && c.pos[j + 1]! < ground + 0.02) {
        c.pos[j + 1] = ground + 0.02;
        c.vel[j] = c.vel[j + 1] = c.vel[j + 2] = 0;
        c.life[i] = Math.min(c.life[i]!, 0.5);
      }
    }
    // Dust drifts, slows and spreads.
    const p = this.puffs;
    const slow = Math.exp(-2.2 * dt);
    for (let i = p.count - 1; i >= 0; i--) {
      if ((p.life[i]! -= dt) <= 0) {
        p.remove(i);
        continue;
      }
      const j = i * 3;
      p.vel[j]! *= slow;
      p.vel[j + 1]! = p.vel[j + 1]! * slow - 0.4 * dt;
      p.vel[j + 2]! *= slow;
      p.pos[j]! += p.vel[j]! * dt;
      p.pos[j + 1]! += p.vel[j + 1]! * dt;
      p.pos[j + 2]! += p.vel[j + 2]! * dt;
    }
  }
}
