// Tyre tracks: a ribbon laid on the ground behind every wheel, deep and dark in bog and mud,
// faint on grass and gravel, none on rock and asphalt. Spinning and locked wheels churn
// darker marks. Tracks fade slowly and the oldest are overwritten when the store is full.
//
// All ribbons share one mesh: a ring of quads written as the wheels move, each carrying the
// time it was laid so the shader can fade it without the CPU touching it again.

import * as THREE from 'three/webgpu';
import { attribute, float, fract, mix, smoothstep, uniform } from 'three/tsl';
import type { VehicleSim } from './sim';

/** Quads in the store; at one per 40 cm per wheel that is several kilometres of driving. */
const CAPACITY = 12000;
/** Length of one quad along the track, metres. */
const STEP = 0.4;
/** Seconds a track stays before it has faded away. */
const LIFE = 900;
/** Lift above the ground, against flicker. */
const LIFT = 0.04;

interface Mark {
  /** How deep a mark the ground takes, 0..1, dry and soaked. */
  dry: number;
  wet: number;
  /** Colour of the churned ground, linear RGB. */
  color: [number, number, number];
}

const MARKS: Record<string, Mark> = {
  bog: { dry: 0.8, wet: 1, color: [0.05, 0.04, 0.025] },
  dirt: { dry: 0.45, wet: 0.85, color: [0.09, 0.065, 0.04] },
  sand: { dry: 0.5, wet: 0.7, color: [0.3, 0.24, 0.16] },
  grass: { dry: 0.3, wet: 0.6, color: [0.07, 0.075, 0.03] },
  gravel: { dry: 0.18, wet: 0.35, color: [0.17, 0.16, 0.14] },
  // Pressed snow, in the blue shadow of its own groove.
  snow: { dry: 0.9, wet: 1, color: [0.4, 0.46, 0.56] },
};

/** Where one wheel's ribbon last ended. */
interface Trail {
  left: THREE.Vector3;
  right: THREE.Vector3;
  centre: THREE.Vector3;
  along: number;
  strength: number;
}

export class Tracks {
  readonly mesh: THREE.Mesh;
  private readonly position: THREE.BufferAttribute;
  private readonly normal: THREE.BufferAttribute;
  /** x: distance along the track, y: 0..1 across it, z: time laid, w: depth. */
  private readonly mark: THREE.BufferAttribute;
  private readonly color: THREE.BufferAttribute;
  private readonly now = uniform(0);
  private next = 0;
  private dirtyFrom = -1;
  private dirtyTo = -1;
  private readonly trails: (Trail | null)[] = [];
  private readonly heading = new THREE.Vector3();
  private readonly across = new THREE.Vector3();
  private readonly up = new THREE.Vector3();

  constructor() {
    const geometry = new THREE.BufferGeometry();
    const n = CAPACITY * 4;
    this.position = new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.normal = new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.mark = new THREE.BufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.color = new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.position);
    geometry.setAttribute('normal', this.normal);
    geometry.setAttribute('mark', this.mark);
    geometry.setAttribute('color', this.color);
    const index = new Uint32Array(CAPACITY * 6);
    for (let q = 0; q < CAPACITY; q++) index.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
    geometry.setIndex(new THREE.BufferAttribute(index, 1));

    const mark = attribute<'vec4'>('mark', 'vec4');
    const age = this.now.sub(mark.z);
    const fade = float(1).sub(smoothstep(LIFE * 0.4, LIFE, age));
    // Soft edges, a deeper middle, and a chevron tread pressed into it.
    const across = mark.y.sub(0.5).abs().mul(2);
    const edge = float(1).sub(smoothstep(0.65, 1, across));
    const tread = smoothstep(0.35, 0.5, fract(mark.x.div(0.32).add(across.mul(0.45)))).mul(0.35).add(0.65);
    const material = new THREE.MeshLambertNodeMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    const rgb = attribute<'vec3'>('color', 'vec3');
    material.colorNode = mix(rgb.mul(1.6), rgb, tread);
    material.opacityNode = mark.w.mul(fade).mul(edge).mul(tread).mul(0.85).clamp(0, 1);

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'tracks';
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.receiveShadow = true;
    // Over the ground, under everything see-through.
    this.mesh.renderOrder = -10;
    geometry.setDrawRange(0, 0);
  }

  /** Call every frame after the physics; `wetness` 0 dry to 1 soaked. */
  update(sim: VehicleSim, wetness: number, now: number): void {
    const time = now / 1000;
    this.now.value = time;
    const width = (sim.def.wheels.width ?? 0.3) * 0.95;
    sim.wheels.forEach((wheel, i) => {
      const look = MARKS[wheel.ground];
      if (!wheel.contact || !look) {
        this.trails[i] = null;
        return;
      }
      const wet = wheel.ground === 'bog' ? 1 : wetness;
      const strength = Math.min(1, look.dry + (look.wet - look.dry) * wet + 0.3 * Math.min(1, wheel.spin) + 0.2 * wheel.skid);
      const p = wheel.point;
      const centre = new THREE.Vector3(p.x, p.y, p.z);
      this.up.set(wheel.normal.x, wheel.normal.y, wheel.normal.z);
      const trail = this.trails[i];
      if (!trail) {
        this.trails[i] = this.edges(centre, null, width, 0, strength);
        return;
      }
      const moved = centre.distanceTo(trail.centre);
      if (moved < STEP) return;
      // A jump (reset, teleport, airborne landing far away) starts a new ribbon.
      if (moved > STEP * 8) {
        this.trails[i] = this.edges(centre, null, width, 0, strength);
        return;
      }
      const next = this.edges(centre, trail, width, trail.along + moved, strength);
      this.lay(trail, next, look.color, time);
      this.trails[i] = next;
    });
    this.flush();
  }

  /** Forgets where the ribbons ended, after the vehicle is moved by hand. */
  break(): void {
    this.trails.length = 0;
  }

  private edges(centre: THREE.Vector3, from: Trail | null, width: number, along: number, strength: number): Trail {
    // Across the direction of travel, in the plane of the ground.
    if (from) this.heading.subVectors(centre, from.centre).normalize();
    else this.heading.set(0, 0, 1);
    this.across.crossVectors(this.up, this.heading).normalize().multiplyScalar(width / 2);
    const lift = this.up.clone().multiplyScalar(LIFT);
    const left = centre.clone().add(this.across).add(lift);
    const right = centre.clone().sub(this.across).add(lift);
    // The first edge of a ribbon is turned to match once the direction is known.
    if (from && from.along === 0) {
      from.left.copy(from.centre).add(this.across).add(lift);
      from.right.copy(from.centre).sub(this.across).add(lift);
    }
    return { left, right, centre, along, strength };
  }

  private lay(a: Trail, b: Trail, rgb: [number, number, number], time: number): void {
    const q = this.next;
    this.next = (this.next + 1) % CAPACITY;
    const v = q * 4;
    const corners: [THREE.Vector3, number, number, Trail][] = [
      [a.left, 0, a.along, a],
      [a.right, 1, a.along, a],
      [b.right, 1, b.along, b],
      [b.left, 0, b.along, b],
    ];
    corners.forEach(([p, u, along, end], k) => {
      this.position.setXYZ(v + k, p.x, p.y, p.z);
      this.normal.setXYZ(v + k, this.up.x, this.up.y, this.up.z);
      this.mark.setXYZW(v + k, along, u, time, end.strength);
      this.color.setXYZ(v + k, rgb[0], rgb[1], rgb[2]);
    });
    if (this.dirtyFrom < 0) this.dirtyFrom = q;
    // Wrapping round: upload everything rather than two pieces.
    if (q < this.dirtyFrom) {
      this.dirtyFrom = 0;
      this.dirtyTo = CAPACITY - 1;
    }
    this.dirtyTo = Math.max(this.dirtyTo, q);
    const used = Math.max(this.mesh.geometry.drawRange.count, (q + 1) * 6);
    this.mesh.geometry.setDrawRange(0, used);
  }

  private flush(): void {
    if (this.dirtyFrom < 0) return;
    const from = this.dirtyFrom * 4, count = (this.dirtyTo - this.dirtyFrom + 1) * 4;
    for (const [attr, size] of [[this.position, 3], [this.normal, 3], [this.mark, 4], [this.color, 3]] as const) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(from * size, count * size);
      attr.needsUpdate = true;
    }
    this.dirtyFrom = this.dirtyTo = -1;
  }
}
