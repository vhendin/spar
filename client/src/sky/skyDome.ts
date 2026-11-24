// The sky as a dome around the camera: scattering, sun, moon with its phase and its halo,
// stars that turn with the hours, the Milky Way, the northern lights and drifting cloud.
// Per-pixel twin of atmosphere.ts.

import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, attribute, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, dot, exp, float, floor, fract, fwidth, max, mix, mx_fractal_noise_float, mx_noise_float, normalize,
  positionLocal, screenCoordinate, screenSize, sin, smoothstep, sqrt, uniform, varying, vec2, vec3, vec4,
} from 'three/tsl';
import { AIR, HAZE, HAZE_FORWARD, type SkyState } from './atmosphere';

/** Apparent radius of the sun and moon discs, in degrees; drawn larger than life to read well. */
const SUN_RADIUS = 0.9;
const MOON_RADIUS = 1.6;
/** Steps through the height of the aurora's curtains. */
const AURORA_STEPS = 18;
/** Earth's radius in km, for how far off a curtain low on the horizon really is. */
const EARTH = 6371;

type Node = THREE.Node<'float'>;
type Vec3 = THREE.Node<'vec3'>;

/** A pseudo-random number 0..1 for a cell of space, different for each `salt`. */
const cellHash = (cell: Vec3, salt: number): Node => fract(sin(dot(cell, vec3(12.9898 + salt, 78.233 - salt * 0.7, 37.719 + salt * 1.3))).mul(43758.5453));

export interface NightSky {
  /** Unit vectors in the world: the Milky Way's pole and the galaxy's centre. */
  galacticPole: THREE.Vector3;
  galacticCentre: THREE.Vector3;
  /** How bright the northern lights are as seen from here, 0..1, with dark and cloud allowed for. */
  aurora: number;
  /** How far north of the viewer the curtains hang, in km; less when they are strong. */
  auroraReach: number;
  /** Seconds, for the stars' twinkle and the curtains' slow motion. */
  time: number;
  /** Colour of moonlight after the air, 1 at its brightest channel: orange when the moon is low. */
  moonTint: THREE.Color;
}

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
    moonPhase: uniform(0),
    moonTint: uniform(new THREE.Vector3(1, 1, 1)),
    /** Turns a view direction into the frame the stars are fixed in. */
    stars: uniform(new THREE.Matrix3()),
    /** And back: the stars' frame into the world. */
    starsToWorld: uniform(new THREE.Matrix3()),
    galacticPole: uniform(new THREE.Vector3(0, 1, 0)),
    galacticCentre: uniform(new THREE.Vector3(1, 0, 0)),
    aurora: uniform(0),
    auroraReach: uniform(300),
    time: uniform(0),
    /** How far the clouds have drifted, in their own plane. */
    drift: uniform(new THREE.Vector2()),
  };

  /** The catalogue's stars, once they are loaded; drawn just over the dome. */
  readonly stars = new THREE.Mesh(new THREE.BufferGeometry());
  private readonly radius: number;

  /** Low down, faint light has a lot of air to get through. */
  private clearing(d: Vec3): Node {
    return exp(float(1).div(max(d.y, 0).add(0.06)).mul(-0.035));
  }

  /** The moon's disc: where it is, and where on the ball each direction meets it. */
  private moonDisc(d: Vec3) {
    const u = this.u;
    const moonSize = Math.sin(THREE.MathUtils.degToRad(MOON_RADIUS));
    const toMoon = dot(d, u.moon);
    const off = d.sub(u.moon.mul(toMoon)).div(moonSize);
    const r2 = dot(off, off);
    const facing = off.sub(u.moon.mul(sqrt(max(float(1).sub(r2), 0))));
    const onMoon = smoothstep(1, 0.9, r2).mul(smoothstep(0.9, 1, toMoon)).mul(smoothstep(-0.02, 0.03, d.y));
    return { toMoon, facing, onMoon };
  }

  /** The painted cloud layer: how thick it is in a direction, and the noise it comes from. */
  private cloudLayer(d: Vec3) {
    const u = this.u;
    const y = max(d.y, 0);
    // Clouds on a flat ceiling, seen ever more edge-on towards the horizon.
    const ceiling = d.xz.div(y.add(0.16)).mul(0.9).add(u.drift);
    const lumps = mx_fractal_noise_float(vec3(ceiling.x, ceiling.y, u.drift.x.mul(0.15)), 4, 2.1, 0.5).mul(0.5).add(0.5);
    const threshold = float(1.02).sub(u.cloud.mul(1.14));
    const cover = smoothstep(threshold, threshold.add(0.32), lumps);
    // Towards the horizon gaps close up, as they do when looking along a cloud layer.
    const dens = mix(cover, max(cover, u.cloud), float(1).sub(smoothstep(0, 0.2, d.y)).mul(0.8)).mul(smoothstep(-0.01, 0.03, d.y).mul(0.3).add(0.7));
    return { lumps, threshold, dens };
  }

  constructor(radius: number) {
    this.radius = radius;
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
    material.colorNode = Fn(() => {
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
      const clearing = this.clearing(d);

      // Sun: a disc with a soft rim, dimmed like its light.
      const sunEdge = Math.cos(THREE.MathUtils.degToRad(SUN_RADIUS));
      const sunDisc = smoothstep(sunEdge, sunEdge + 0.00012, mu).mul(smoothstep(-0.02, 0.02, d.y));

      // Moon: a ball lit by the sun, so its phase comes out by itself, with darker seas on it.
      const { toMoon, facing, onMoon } = this.moonDisc(d);
      const seas = smoothstep(-0.05, 0.3, mx_fractal_noise_float(facing.mul(2.3).add(vec3(3.1, 0, 1.7)), 3, 2.2, 0.55));
      const pits = smoothstep(0.35, 0.6, mx_noise_float(facing.mul(9))).mul(0.12);
      const albedo = float(1).sub(seas.mul(0.36)).sub(pits);
      const moonLight = max(dot(facing, u.sun), 0).mul(0.85).mul(albedo).add(0.012);
      const moonColor = vec3(0.95, 0.93, 0.86).mul(u.moonTint).mul(moonLight).mul(1.6);
      // The air round the moon lit up by it: a tight glow and a wide one, stronger in haze.
      const away = float(1).sub(toMoon);
      const moonUp = smoothstep(-0.03, 0.05, u.moon.y).mul(u.moonPhase);
      const halo = u.moonTint
        .mul(exp(away.mul(-900)).mul(0.22).add(exp(away.mul(-40)).mul(0.018)).add(exp(away.mul(-6)).mul(0.004)))
        .mul(moonUp);

      // The real stars are drawn on their own (see setStars). Here only the grain of stars too
      // faint to see one by one, along the Milky Way: each sits somewhere in a cell of a grid
      // fixed to the sky, and is never drawn smaller than about a pixel.
      const sd = u.stars.mul(d);
      const across = dot(d, u.galacticPole);
      const band = exp(across.div(0.2).pow(2).negate());
      const core = smoothstep(-0.7, 1, dot(d, u.galacticCentre));
      const starlight = u.starlight.mul(smoothstep(-0.01, 0.1, d.y)).mul(clearing);
      const twinkle = float(0.25).add(float(1).sub(smoothstep(0, 0.45, y)).mul(0.6));
      const stars = vec3(0).toVar();
      const layer = (scale: number, chance: Node, pixels: number, power: number, salt: number): void => {
        const p = sd.mul(scale);
        const cell = floor(p);
        const h = cellHash(cell, salt);
        const centre = cell.add(0.5).add(vec3(fract(h.mul(13.1)), fract(h.mul(71.7)), fract(h.mul(151.3))).sub(0.5).mul(0.5));
        // A star is a point: its size on screen is a pixel or two, however far one zooms.
        const pixel = max(fwidth(p).x, max(fwidth(p).y, fwidth(p).z));
        const dist = p.sub(centre).length().div(pixel.mul(pixels));
        const there = smoothstep(float(1).sub(chance), float(1).sub(chance).add(0.0005), h);
        const magnitude = fract(h.mul(91.7)).pow(2).mul(0.8).add(0.2);
        const flicker = float(1).add(sin(u.time.mul(fract(h.mul(7.3)).mul(9).add(6)).add(h.mul(400))).mul(twinkle).mul(0.4));
        const warm = fract(h.mul(37.3));
        const colour = mix(vec3(1, 0.8, 0.62), vec3(0.72, 0.84, 1), warm).mul(smoothstep(0.1, 0.4, warm).mul(0.4).add(0.6)).add(0.12);
        // A bright core and, for the brightest, a little glow round it.
        const shape = exp(dist.mul(dist).mul(-1.6)).add(exp(dist.mul(-1.2)).mul(0.08));
        stars.addAssign(colour.mul(shape).mul(there).mul(magnitude).mul(flicker).mul(power));
      };
      layer(240, band.mul(0.035).add(core.mul(band).mul(0.025)), 1, 0.3, 2);

      // The Milky Way: a band of haze, brightest towards the galaxy's centre, split by dark dust.
      const sky3 = sd.mul(5);
      const clumps = mx_fractal_noise_float(sky3, 4, 2.0, 0.55).mul(0.5).add(0.5);
      const rift = exp(across.add(mx_noise_float(sky3.mul(0.6)).mul(0.05)).div(0.045).pow(2).negate()).mul(smoothstep(-0.3, 0.6, dot(d, u.galacticCentre)));
      const milky = vec3(0.85, 0.88, 1)
        .mul(band.mul(clumps.mul(0.7).add(0.3)).mul(core.mul(0.6).add(0.4)))
        .mul(float(1).sub(rift.mul(0.75)))
        .mul(0.045);
      const heavens = stars.add(milky).mul(starlight);

      // The northern lights: curtains hanging 100 to 300 km up, lit green at their foot and
      // red higher up, rippling along their length. Followed up through their height.
      const aurora = vec3(0).toVar();
      If(u.aurora.greaterThan(0.002).and(d.y.greaterThan(-0.02)), () => {
        const jitter = fract(sin(dot(screenCoordinate.xy, vec2(12.9898, 78.233))).mul(43758.5453));
        const dy = max(d.y, -0.02);
        const flatLen = d.xz.length().max(0.0001);
        const t = u.time.mul(0.02);
        Loop(AURORA_STEPS, ({ i }) => {
          const h = float(i).add(jitter).div(AURORA_STEPS).pow(1.6).mul(220).add(92);
          // How far along the ground the ray reaches that height, with the Earth curving away.
          const s = sqrt(dy.mul(dy).add(h.mul(2 / EARTH))).sub(dy).mul(EARTH);
          const p = d.xz.div(flatLen).mul(s);
          const along = p.x;
          const line = u.auroraReach.negate()
            .add(mx_noise_float(vec2(along.div(420), t)).mul(130))
            .add(mx_noise_float(vec2(along.div(110), t.mul(2.7).add(5))).mul(35));
          const second = line.sub(70).add(mx_noise_float(vec2(along.div(260), t.mul(1.6).add(11))).mul(40));
          const curtain = exp(p.y.sub(line).div(14).pow(2).negate()).add(exp(p.y.sub(second).div(20).pow(2).negate()).mul(0.45));
          const rays = mx_noise_float(vec2(along.div(5), t.mul(9))).mul(0.5).add(0.5).pow(1.5).mul(0.8).add(0.2);
          const foot = smoothstep(92, 104, h);
          const green = vec3(0.12, 1, 0.42).mul(exp(h.sub(104).div(-45)));
          const red = vec3(0.85, 0.12, 0.42).mul(smoothstep(150, 240, h)).mul(0.22);
          aurora.addAssign(green.add(red).mul(curtain).mul(rays).mul(foot));
        });
        aurora.assign(aurora.mul(u.aurora).mul(clearing).mul(0.06));
      });

      // The moon's dark side shows the sky behind it by day and hides the stars by night.
      const behind = float(1).sub(onMoon);
      const lit = clear.add(u.sunColor.mul(sunDisc).mul(6)).add(heavens.add(aurora).mul(behind)).add(halo);
      const withMoon = lit.add(moonColor.mul(onMoon));

      const { lumps, threshold, dens } = this.cloudLayer(d);
      const body = mix(u.cloudShade, u.cloudLit, smoothstep(threshold, threshold.add(0.7), lumps).oneMinus().mul(0.75).add(0.25));
      // The sun and moon show through thin cloud as bright patches.
      const thin = float(1).sub(u.cloud.mul(0.85));
      const through = u.sunColor.mul(exp(float(1).sub(mu).mul(-60))).mul(0.25).mul(thin)
        .add(u.moonTint.mul(exp(away.mul(-50)).mul(0.12).add(exp(away.mul(-400)).mul(0.5))).mul(moonUp).mul(thin));
      const sky = mix(withMoon, body.add(through), dens.mul(0.97));
      return vec3(1).sub(exp(sky.mul(-1.25)));
    })();
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), material);
    this.mesh.name = 'sky';
    // Drawn after everything solid, depth-tested, so its cloud noise is worked out only
    // where the sky shows, not under all the ground (it was most of the sky's GPU time).
    this.mesh.renderOrder = 1000;
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.stars.name = 'stars';
    this.stars.renderOrder = -999;
    this.stars.frustumCulled = false;
    this.stars.matrixAutoUpdate = false;
    this.stars.visible = false;
  }

  /**
   * Puts up the real stars. `dirs` holds each star's direction in the frame the sky turns in
   * (see `update`'s `starTurn`), `mags` its magnitude and `colours` its colour, RGB.
   */
  setStars(dirs: Float32Array, mags: Float32Array, colours: Float32Array): void {
    const n = mags.length;
    const dir = new Float32Array(n * 12), corner = new Float32Array(n * 8), colour = new Float32Array(n * 12), look = new Float32Array(n * 12);
    const index = new Uint32Array(n * 6);
    const corners = [-1, -1, 1, -1, 1, 1, -1, 1];
    for (let i = 0; i < n; i++) {
      const mag = mags[i]!;
      // Each magnitude is 2.5 times fainter than the last; squeezed a little so the faint ones still show.
      const flux = Math.exp(-0.78 * (mag - 1.2));
      const size = 1.1 + Math.min(4.5, Math.max(0, 3 - mag)) * 0.6;
      const peak = Math.min(2.2, flux);
      // A different twinkle for each star.
      const phase = (Math.sin(i * 12.9898) * 43758.5453) % 1;
      for (let k = 0; k < 4; k++) {
        const v = i * 4 + k;
        dir.set(dirs.subarray(i * 3, i * 3 + 3), v * 3);
        corner.set(corners.slice(k * 2, k * 2 + 2), v * 2);
        colour.set(colours.subarray(i * 3, i * 3 + 3), v * 3);
        look.set([peak, size, phase], v * 3);
      }
      index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(dir, 3));
    g.setAttribute('dir', new THREE.BufferAttribute(dir, 3));
    g.setAttribute('corner', new THREE.BufferAttribute(corner, 2));
    g.setAttribute('starColour', new THREE.BufferAttribute(colour, 3));
    g.setAttribute('look', new THREE.BufferAttribute(look, 3));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    this.stars.geometry.dispose();
    this.stars.geometry = g;

    const u = this.u;
    // Tested against depth, so hills and trees in front hide them.
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false });
    const w = u.starsToWorld.mul(attribute<'vec3'>('dir', 'vec3'));
    const lookAttr = attribute<'vec3'>('look', 'vec3');
    const cornerAttr = attribute<'vec2'>('corner', 'vec2');
    // Seen or not, worked out once per star: dark enough, above the horizon, not behind the moon or cloud.
    const twinkle = float(0.25).add(float(1).sub(smoothstep(0, 0.45, max(w.y, 0))).mul(0.6));
    const flicker = float(1).add(sin(u.time.mul(fract(lookAttr.z.mul(7.3)).mul(9).add(6)).add(lookAttr.z.mul(400))).mul(twinkle).mul(0.35));
    const seen = u.starlight
      .mul(smoothstep(-0.01, 0.1, w.y))
      .mul(this.clearing(w))
      .mul(float(1).sub(this.moonDisc(w).onMoon))
      .mul(float(1).sub(this.cloudLayer(w).dens.mul(0.97)));
    const bright = varying(lookAttr.x.mul(seen).mul(flicker));
    const at = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(cameraPosition.add(w.mul(this.radius * 0.95)), 1)));
    // Each star a little square a few pixels across, whatever the zoom.
    const spread = cornerAttr.mul(lookAttr.y.mul(2.5)).mul(2).div(screenSize).mul(at.w);
    material.vertexNode = vec4(at.xy.add(spread), at.z, at.w);
    const r = cornerAttr.length().mul(2.5);
    const shape = exp(r.mul(r).mul(-0.9)).add(exp(r.mul(-1.6)).mul(0.05));
    material.colorNode = vec4(varying(attribute<'vec3'>('starColour', 'vec3')).mul(shape).mul(bright), 1);
    this.stars.material = material;
    this.stars.visible = true;
  }

  /**
   * `starTurn` rotates view directions into the stars' frame; `drift` is how far the wind
   * has carried the clouds; the dome is kept centred on the camera.
   */
  update(state: SkyState, starTurn: THREE.Matrix3, drift: THREE.Vector2, camera: THREE.Vector3, night: NightSky): void {
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
    u.moonPhase.value = state.moonPhase;
    u.moonTint.value.set(night.moonTint.r, night.moonTint.g, night.moonTint.b);
    u.stars.value.copy(starTurn);
    u.starsToWorld.value.copy(starTurn).transpose();
    u.galacticPole.value.copy(night.galacticPole);
    u.galacticCentre.value.copy(night.galacticCentre);
    u.aurora.value = night.aurora;
    u.auroraReach.value = night.auroraReach;
    u.time.value = night.time;
    u.drift.value.copy(drift);
    this.mesh.position.copy(camera);
    this.mesh.updateMatrix();
  }
}

