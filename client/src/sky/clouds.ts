// Fair-weather clouds: puffy heaps of round blobs drifting with the wind, and the shadows
// they throw on the ground. The clouds live on a square of sky that repeats in both
// directions, so wherever the camera goes there is sky above it, and the shadows are a
// picture of that same square, so each shadow belongs to a cloud overhead.
//
// The blobs are lit like the rest of the cartoon world: a lit side, a shaded side and a
// darker belly, in the colours the sky model gives for cloud at this hour.

import * as THREE from 'three/webgpu';
import {
  Fn, cameraPosition, dot, exp, float, max, mix, normalWorld, positionWorld, pow, smoothstep, texture, uniform, vec3,
} from 'three/tsl';
import { createRng } from '@spar/shared';
import type { SkyState } from './atmosphere';

/** Side of the repeating square of sky, in metres. */
const TILE = 24000;
/** Clouds on that square; how many show depends on the cover. */
const COUNT = 200;
/** Texels per side of the shadow picture. */
const SHADOW_SIZE = 512;
/** A cloud starts to shrink away this far (as a share of half the square) from the camera. */
const EDGE = 0.8;

interface Blob {
  /** Offset from the cloud's centre on its base, in units of the cloud's size. */
  x: number;
  y: number;
  z: number;
  r: number;
}

interface Cloud {
  /** Position on the square of sky, 0..TILE. */
  x: number;
  z: number;
  /** Across, in metres, when fully grown. */
  size: number;
  /** Cover above which this cloud shows; small numbers show first. */
  rank: number;
  blobs: Blob[];
}

/** A ball whose lower part is squashed flat, so heaps of them get the flat base of a cumulus. */
function blobGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 16, 10);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) if (p.getY(i) < -0.3) p.setY(i, -0.3 + (p.getY(i) + 0.3) * 0.15);
  g.computeVertexNormals();
  return g;
}

/**
 * How much direct sunlight gets through the clouds to a point, 0..1, for any material's
 * lighting. One for the whole page, like the sky.
 */
class CloudShadow {
  readonly canvas = document.createElement('canvas');
  readonly texture: THREE.CanvasTexture;
  /** Unit vector towards the sun. */
  readonly sun = uniform(new THREE.Vector3(0, 1, 0));
  /** How far the wind has carried the clouds, in metres. */
  readonly drift = uniform(new THREE.Vector2());
  /** Height of the clouds' middle, in metres. */
  readonly height = uniform(2000);
  /** How dark a cloud's shadow is: 0 none, 1 no direct sun at all. */
  readonly strength = uniform(0);
  /** Multiplier on direct sunlight at the fragment being shaded. */
  readonly light;

  constructor() {
    this.canvas.width = this.canvas.height = SHADOW_SIZE;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.wrapS = this.texture.wrapT = THREE.RepeatWrapping;
    this.texture.flipY = false;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.generateMipmaps = true;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    // Follow the sunbeam up from the point to the cloud layer and look there.
    this.light = Fn(() => {
      const up = max(this.sun.y, 0.12);
      const at = positionWorld.xz.add(this.sun.xz.mul(this.height.sub(positionWorld.y).div(up)));
      const shade = texture(this.texture, at.sub(this.drift).div(TILE)).r;
      return float(1).sub(shade.mul(this.strength));
    })();
  }
}

export const cloudShadow = new CloudShadow();

export class Clouds {
  readonly mesh: THREE.InstancedMesh;
  private readonly clouds: Cloud[] = [];
  private readonly base: number;
  private readonly u = {
    lit: uniform(new THREE.Vector3(1, 1, 1)),
    shade: uniform(new THREE.Vector3(0.6, 0.6, 0.6)),
    sunColor: uniform(new THREE.Vector3()),
  };
  private readonly matrix = new THREE.Matrix4();
  private readonly at = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly turn = new THREE.Quaternion();
  /** The cover the shadow picture was last drawn for. */
  private drawnCover = -1;

  /** `ground` is the highest ground in the region; the cloud base sits well above it. */
  constructor(ground: number, seed: number) {
    this.base = ground + 950;
    const rng = createRng(seed ^ 0x5c10d);
    let blobs = 0;
    for (let i = 0; i < COUNT; i++) {
      const size = rng.range(700, 1800) * (rng.float() < 0.15 ? 1.5 : 1);
      const cloud: Cloud = { x: rng.float() * TILE, z: rng.float() * TILE, size, rank: (i + rng.float()) / COUNT, blobs: [] };
      // A big round heart, then smaller heaps around it, lower towards the edges.
      cloud.blobs.push({ x: 0, y: 0, z: 0, r: rng.range(0.32, 0.4) });
      const around = 4 + rng.int(5);
      const spin = rng.float() * Math.PI * 2;
      for (let b = 0; b < around; b++) {
        const a = spin + (b / around) * Math.PI * 2 + rng.range(-0.3, 0.3);
        const d = rng.range(0.22, 0.42);
        const r = rng.range(0.16, 0.28) * (1 - d * 0.6);
        cloud.blobs.push({ x: Math.cos(a) * d, y: 0, z: Math.sin(a) * d * rng.range(0.6, 1), r });
      }
      // A tower or two on top.
      const tops = 1 + rng.int(2);
      for (let b = 0; b < tops; b++) cloud.blobs.push({ x: rng.range(-0.12, 0.12), y: rng.range(0.12, 0.2), z: rng.range(-0.1, 0.1), r: rng.range(0.18, 0.26) });
      this.clouds.push(cloud);
      blobs += cloud.blobs.length;
    }
    cloudShadow.height.value = this.base + 250;

    const u = this.u;
    const material = new THREE.MeshBasicNodeMaterial({ fog: true });
    material.colorNode = Fn(() => {
      const n = normalWorld;
      const sun = cloudShadow.sun;
      // Soft cartoon light: a broad lit side, a shaded side and a darker belly.
      const lit = smoothstep(-0.3, 0.55, dot(n, sun));
      const belly = smoothstep(-0.8, 0.35, n.y);
      const body = mix(u.shade.mul(0.82), u.lit, lit.mul(0.65).add(belly.mul(0.35)));
      // The rims of a cloud between you and the sun shine.
      const view = positionWorld.sub(cameraPosition).normalize();
      const rim = pow(float(1).sub(dot(n, view.negate()).abs()), 3).mul(pow(max(dot(view, sun), 0), 6));
      const c = body.add(u.sunColor.mul(rim).mul(0.25));
      return vec3(1).sub(exp(c.mul(-1.25)));
    })();

    this.mesh = new THREE.InstancedMesh(blobGeometry(), material, blobs);
    this.mesh.name = 'clouds';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // After the sky dome, before anything see-through.
    this.mesh.renderOrder = -900;
  }

  /** How grown a cloud is at this cover, 0 gone to 1 full size. */
  private grown(cloud: Cloud, cover: number): number {
    const reach = cover * 1.12 - 0.04;
    const t = Math.min(1, Math.max(0, (reach - cloud.rank) / 0.12));
    return t * t * (3 - 2 * t);
  }

  update(state: SkyState, cover: number, drift: THREE.Vector2, camera: THREE.Vector3): void {
    const u = this.u;
    u.lit.value.fromArray(state.cloudLit);
    u.shade.value.fromArray(state.cloudShade);
    u.sunColor.value.fromArray(state.sunColor);
    cloudShadow.sun.value.fromArray(state.sun);
    cloudShadow.drift.value.copy(drift);
    // Under a closed deck the sun is already veiled; the patches are for broken cloud.
    cloudShadow.strength.value = 0.85 * (1 - THREE.MathUtils.smoothstep(cover, 0.62, 0.92));

    const half = TILE / 2;
    let i = 0;
    // Clouds are stored thinnest cover first, so the ones showing are always the first few.
    for (const cloud of this.clouds) {
      const g = this.grown(cloud, cover);
      if (g <= 0) break;
      // Where the cloud is now, brought to within half a square of the camera.
      const dx = THREE.MathUtils.euclideanModulo(cloud.x + drift.x - camera.x + half, TILE) - half;
      const dz = THREE.MathUtils.euclideanModulo(cloud.z + drift.y - camera.z + half, TILE) - half;
      const edge = Math.max(Math.abs(dx), Math.abs(dz)) / half;
      const s = cloud.size * Math.sqrt(g) * Math.min(1, Math.max(0, (1 - edge) / (1 - EDGE)));
      for (const b of cloud.blobs) {
        const r = b.r * s;
        this.at.set(camera.x + dx + b.x * s, this.base + b.y * s + 0.26 * r, camera.z + dz + b.z * s);
        this.scale.set(r, r * 0.85, r);
        this.matrix.compose(this.at, this.turn, this.scale);
        this.mesh.setMatrixAt(i++, this.matrix);
      }
    }
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;

    if (Math.abs(cover - this.drawnCover) > 0.01) this.drawShadows(cover);
  }

  /** Paints each cloud's footprint on the shadow picture of the square. */
  private drawShadows(cover: number): void {
    this.drawnCover = cover;
    const ctx = cloudShadow.canvas.getContext('2d')!;
    const k = SHADOW_SIZE / TILE;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, SHADOW_SIZE, SHADOW_SIZE);
    for (const cloud of this.clouds) {
      const g = this.grown(cloud, cover);
      if (g <= 0) continue;
      const s = cloud.size * Math.sqrt(g);
      for (const b of cloud.blobs) {
        const r = b.r * s * 1.05 * k;
        const x = (cloud.x + b.x * s) * k;
        const z = (cloud.z + b.z * s) * k;
        // Drawn again across the edges, so the picture repeats without seams.
        for (const ox of [-SHADOW_SIZE, 0, SHADOW_SIZE]) {
          for (const oz of [-SHADOW_SIZE, 0, SHADOW_SIZE]) {
            const cx = x + ox, cz = z + oz;
            if (cx + r < 0 || cx - r > SHADOW_SIZE || cz + r < 0 || cz - r > SHADOW_SIZE) continue;
            const grad = ctx.createRadialGradient(cx, cz, 0, cx, cz, r);
            grad.addColorStop(0, 'rgba(255,255,255,1)');
            grad.addColorStop(0.65, 'rgba(255,255,255,0.85)');
            grad.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(cx, cz, r, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
    cloudShadow.texture.needsUpdate = true;
  }
}
