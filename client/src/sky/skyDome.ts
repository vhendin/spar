// The sky as a dome around the camera: scattering, sun, moon with its phase, stars that
// turn with the hours, and drifting cloud. Per-pixel twin of atmosphere.ts.

import * as THREE from 'three/webgpu';
import {
  Fn, dot, exp, float, floor, fract, max, mix, mx_fractal_noise_float, normalize, positionLocal, sin, smoothstep, sqrt, uniform, vec3,
} from 'three/tsl';
import { AIR, HAZE, HAZE_FORWARD, type SkyState } from './atmosphere';

/** Apparent radius of the sun and moon discs, in degrees; drawn larger than life to read well. */
const SUN_RADIUS = 0.9;
const MOON_RADIUS = 1.6;

export class SkyDome {
  readonly mesh: THREE.Mesh;
  private readonly u = {
    sun: uniform(new THREE.Vector3(0, 1, 0)),
    moon: uniform(new THREE.Vector3(0, -1, 0)),
    sunColor: uniform(new THREE.Vector3()),
    sunHigh: uniform(new THREE.Vector3()),
    twilight: uniform(new THREE.Vector3()),
    afterglow: uniform(new THREE.Vector3()),
    night: uniform(new THREE.Vector3()),
    cloudLit: uniform(new THREE.Vector3()),
    cloudShade: uniform(new THREE.Vector3()),
    cloud: uniform(0),
    starlight: uniform(0),
    /** Turns a view direction into the frame the stars are fixed in. */
    stars: uniform(new THREE.Matrix3()),
    /** How far the clouds have drifted, in their own plane. */
    drift: uniform(new THREE.Vector2()),
  };

  constructor(radius: number) {
    const u = this.u;
    const d = normalize(positionLocal);
    const y = max(d.y, 0);
    const mass = float(1).div(y.add(0.06));
    const mu = dot(d, u.sun);

    const air = float(0.375).mul(mu.mul(mu).add(1));
    const g = HAZE_FORWARD;
    const haze = float((1 - g * g) / (4 * Math.PI))
      .div(float(1 + g * g).sub(mu.mul(2 * g)).pow(1.5))
      .mul(float(1).sub(exp(mass.mul(-HAZE))));
    const scattered = vec3(1).sub(exp(vec3(...AIR).mul(mass).negate()));
    const flat = d.xz.length().mul(u.sun.xz.length()).max(0.0001);
    const towards = dot(d.xz, u.sun.xz).div(flat);
    const glow = exp(float(1).sub(towards).mul(-2.2)).mul(exp(y.mul(-5)));
    const clear = mix(u.sunColor, u.sunHigh, smoothstep(0, 0.55, y))
      .mul(scattered.mul(air).add(haze))
      .add(u.twilight.mul(float(0.45).add(float(1).sub(y).mul(0.55))))
      .add(u.afterglow.mul(glow))
      .add(u.night.mul(float(1).add(float(1).sub(y).mul(1.5))));

    // Sun: a disc with a soft rim, dimmed like its light.
    const sunEdge = Math.cos(THREE.MathUtils.degToRad(SUN_RADIUS));
    const sunDisc = smoothstep(sunEdge, sunEdge + 0.00012, mu).mul(smoothstep(-0.02, 0.02, d.y));

    // Moon: a ball lit by the sun, so its phase comes out by itself.
    const moonSize = Math.sin(THREE.MathUtils.degToRad(MOON_RADIUS));
    const off = d.sub(u.moon.mul(dot(d, u.moon))).div(moonSize);
    const r2 = dot(off, off);
    const facing = off.sub(u.moon.mul(sqrt(max(float(1).sub(r2), 0))));
    const onMoon = smoothstep(1, 0.92, r2).mul(smoothstep(0.9, 1, dot(d, u.moon))).mul(smoothstep(-0.02, 0.03, d.y));
    const moonLight = max(dot(facing, u.sun), 0).mul(0.85).add(0.012);
    const moonColor = vec3(0.95, 0.93, 0.86).mul(moonLight).mul(1.6);

    // Stars: the sky is cut into small cells; a few of them hold a star.
    const turned = u.stars.mul(d).mul(170);
    const cell = floor(turned);
    const seed = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))).mul(43758.5453));
    const within = fract(turned).sub(0.5).length();
    const star = smoothstep(0.991, 1, seed).mul(smoothstep(0.32, 0.05, within)).mul(u.starlight).mul(smoothstep(0, 0.12, d.y));
    const starColor = mix(vec3(1, 0.86, 0.7), vec3(0.75, 0.85, 1), fract(seed.mul(91.7))).mul(star).mul(1.4);

    // The moon's dark side shows the sky behind it by day and hides the stars by night.
    const heavens = clear.add(u.sunColor.mul(sunDisc).mul(6)).add(starColor.mul(float(1).sub(onMoon)));
    const withMoon = heavens.add(moonColor.mul(onMoon));

    // Clouds on a flat ceiling, seen ever more edge-on towards the horizon.
    const ceiling = d.xz.div(y.add(0.16)).mul(0.9).add(u.drift);
    const lumps = mx_fractal_noise_float(vec3(ceiling.x, ceiling.y, u.drift.x.mul(0.15)), 4, 2.1, 0.5).mul(0.5).add(0.5);
    const threshold = float(1.02).sub(u.cloud.mul(1.14));
    const cover = smoothstep(threshold, threshold.add(0.32), lumps);
    // Towards the horizon gaps close up, as they do when looking along a cloud layer.
    const dens = mix(cover, max(cover, u.cloud), float(1).sub(smoothstep(0, 0.2, d.y)).mul(0.8)).mul(smoothstep(-0.01, 0.03, d.y).mul(0.3).add(0.7));
    const body = mix(u.cloudShade, u.cloudLit, smoothstep(threshold, threshold.add(0.7), lumps).oneMinus().mul(0.75).add(0.25));
    // The sun shows through thin cloud as a bright patch.
    const through = u.sunColor.mul(exp(float(1).sub(mu).mul(-60))).mul(0.25).mul(float(1).sub(u.cloud.mul(0.85)));
    const sky = mix(withMoon, body.add(through), dens.mul(0.97));

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false });
    material.colorNode = Fn(() => vec3(1).sub(exp(sky.mul(-1.25))))();
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), material);
    this.mesh.name = 'sky';
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
  }

  /**
   * `starTurn` rotates view directions into the stars' frame; `drift` is how far the wind
   * has carried the clouds; the dome is kept centred on the camera.
   */
  update(state: SkyState, starTurn: THREE.Matrix3, drift: THREE.Vector2, camera: THREE.Vector3): void {
    const u = this.u;
    u.sun.value.fromArray(state.sun);
    u.moon.value.fromArray(state.moon);
    u.sunColor.value.fromArray(state.sunColor);
    u.sunHigh.value.fromArray(state.sunHigh);
    u.twilight.value.fromArray(state.twilight);
    u.afterglow.value.fromArray(state.afterglow);
    u.night.value.fromArray(state.night);
    u.cloudLit.value.fromArray(state.cloudLit);
    u.cloudShade.value.fromArray(state.cloudShade);
    u.cloud.value = state.cloud;
    u.starlight.value = state.starlight;
    u.stars.value.copy(starTurn);
    u.drift.value.copy(drift);
    this.mesh.position.copy(camera);
    this.mesh.updateMatrix();
  }
}
