// Time of day and weather made visible: drives the sky dome, the sun or moon light, the
// ambient light, the fog and the rain from the clock and weather the server sends.

import * as THREE from 'three/webgpu';
import { Fn, abs, cameraPosition, exp, float, mix, output, positionWorld, rangeFogFactor, select, uniform, vec4 } from 'three/tsl';
import {
  formatGameTime, gameUtc, moonPosition, siderealAngle, skyDirection, sunPosition,
  type GameClock, type RegionIndex, type ServerMessage, type Weather,
} from '@spar/shared';
import { luminance, skyColor, skyState, smoothstep, sunlight, type Rgb, type SkyState } from './atmosphere';
import { Clouds, cloudShadow } from './clouds';
import { Rain } from './rain';
import { SkyDome } from './skyDome';

type WorldUpdate = Extract<ServerMessage, { type: 'world' }>;

/** Sun strength on a clear day with the sun well up; the rest of the scene was tuned to this. */
const SUN_INTENSITY = 3.3;
const SUN_REFERENCE = luminance(sunlight(0.6));
const AMBIENT = 0.7;
/** Half-width of the square around the focus that gets shadows, in metres. */
const SHADOW_REACH = 70;
/** Strongest wind, in m/s, for moving rain. */
const GALE = 22;
/** Mist lies in the valleys: thickest at this height above the region's lowest ground, thinning upwards over each further MIST_THICKNESS metres. */
const MIST_FLOOR = 90;
const MIST_THICKNESS = 60;
/** Mist density at its floor, per metre, when it is at its thickest. */
const MIST_DENSITY = 0.006;

export interface EnvironmentOptions {
  shadows: boolean;
  /** Texels per side of the sun's shadow map. */
  shadowMapSize?: number;
  /** Freeze the clock at this in-game instant (UTC ms) instead of following the server. */
  fixedUtc: number | null;
  /** Use this weather instead of the server's. */
  fixedWeather: Weather | null;
}

export class Environment {
  /** Current weather, eased towards the server's latest word. */
  readonly weather: Weather = { state: 'clear', cloud: 0.15, rain: 0, wind: 0.2, windDirection: 90, wetness: 0 };
  /** Radians above the horizon. */
  sunElevation = 0.5;
  /** Brightness of the scene's light relative to a clear day, for things that carry baked light. */
  daylight = 1;
  /** True when it is dark enough to want headlights. */
  dark = false;
  /** Unit vector the wind blows towards (x east, y south), for vegetation and rain. */
  readonly windVector = new THREE.Vector2(1, 0);
  /** 0 no mist to 1 thick valley mist. */
  mist = 0;
  /**
   * The colour grade for this hour and weather: a tint multiplied over the picture,
   * a saturation multiplier, and how much the darkest parts are lifted.
   */
  readonly grade = { tint: new THREE.Vector3(1, 1, 1), saturation: 1, lift: 0 };

  private readonly dome: SkyDome;
  private readonly rain = new Rain();
  private readonly sun = new THREE.DirectionalLight(0xffffff, SUN_INTENSITY);
  private readonly ambient = new THREE.HemisphereLight(0xffffff, 0x4a4636, AMBIENT);
  private readonly fog = {
    color: uniform(new THREE.Color(0x9db8c8)),
    near: uniform(2500),
    far: uniform(30000),
    mistColor: uniform(new THREE.Color(0xd0d8dc)),
    mistDensity: uniform(0),
  };
  private readonly clouds: Clouds;
  /** How far the wind has carried the sky's clouds: in the dome's units, and in metres. */
  private readonly drift = new THREE.Vector2();
  private readonly cloudDrift = new THREE.Vector2();
  private readonly starTurn = new THREE.Matrix3();
  private readonly pole: THREE.Vector3;
  private clock: GameClock;
  private target: Weather | null = null;
  private first = true;
  private utc = 0;
  private readonly sunRadiance;

  constructor(
    scene: THREE.Scene,
    private readonly index: RegionIndex,
    private readonly options: EnvironmentOptions,
    farPlane: number,
  ) {
    this.dome = new SkyDome(farPlane * 0.9);
    this.clouds = new Clouds(index.heights.max, 0x5a4);
    scene.add(this.dome.mesh, this.clouds.mesh, this.rain.mesh, this.ambient, this.sun, this.sun.target);
    scene.fog = null;
    scene.fogNode = this.fogNode(index.heights.min + MIST_FLOOR);
    scene.background = null;
    // Sunlight passes the clouds before it reaches anything; its colour is set each frame.
    this.sunRadiance = uniform(new THREE.Color());
    // three's light nodes read `colorNode` from the light when it is set; the types leave it out.
    (this.sun as THREE.DirectionalLight & { colorNode?: THREE.Node }).colorNode = this.sunRadiance.mul(cloudShadow.light);

    if (options.shadows) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(options.shadowMapSize ?? 2048, options.shadowMapSize ?? 2048);
      const cam = this.sun.shadow.camera;
      cam.left = cam.bottom = -SHADOW_REACH;
      cam.right = cam.top = SHADOW_REACH;
      cam.near = 20;
      cam.far = 700;
      this.sun.shadow.bias = -0.0006;
      this.sun.shadow.normalBias = 0.06;
    }
    // The stars turn about the celestial pole: due north, as high as the latitude.
    const lat = THREE.MathUtils.degToRad(index.center.latitude);
    this.pole = new THREE.Vector3(0, Math.sin(lat), -Math.cos(lat));
    this.clock = { utc: options.fixedUtc ?? Date.UTC(2026, 7, 15, 8), rate: 0, utcOffset: 1, at: performance.now() };
    if (options.fixedWeather) Object.assign(this.weather, options.fixedWeather);
  }

  /** Takes the server's word on time and weather. */
  setWorld(update: WorldUpdate, now: number): void {
    if (this.options.fixedUtc === null) this.clock = { ...update.time, at: now };
    else this.clock.utcOffset = update.time.utcOffset;
    if (!this.options.fixedWeather) {
      this.target = update.weather;
      if (this.first) Object.assign(this.weather, update.weather);
    }
    this.first = false;
  }

  /** The time of day on the region's clocks, in hours 0..24. */
  localHour(): number {
    const day = 86400000;
    return ((((this.utc + this.clock.utcOffset * 3600000) % day) + day) % day) / 3600000;
  }

  /** The month on the region's clocks, 0 January to 11 December. */
  month(): number {
    return new Date(this.utc + this.clock.utcOffset * 3600000).getUTCMonth();
  }

  /** In-game seconds per real second. */
  get rate(): number {
    return this.clock.rate;
  }

  /** True when the URL froze the clock or the weather, so the server's changes do not show. */
  get frozen(): boolean {
    return this.options.fixedUtc !== null || this.options.fixedWeather !== null;
  }

  /** "Sat 15 Aug 09:42 · overcast · wind 6 m/s". */
  describe(): string {
    const w = this.weather;
    const sky = w.rain > 0.05 ? (w.rain > 0.6 ? 'heavy rain' : 'rain') : w.cloud > 0.6 ? 'overcast' : w.cloud > 0.3 ? 'some cloud' : 'clear';
    return `${formatGameTime(this.utc, this.clock.utcOffset)} · ${sky} · wind ${(w.wind * GALE).toFixed(0)} m/s${w.wetness > 0.2 ? ' · wet ground' : ''}`;
  }

  /**
   * Call every frame. `now` is performance.now(), `dt` seconds since the last frame;
   * `focus` is what the shadows should surround (the vehicle, or the camera when flying).
   */
  update(now: number, dt: number, camera: THREE.Vector3, focus: THREE.Vector3): void {
    const w = this.weather;
    if (this.target) {
      const k = 1 - Math.exp(-dt / 2.5);
      w.state = this.target.state;
      w.cloud += (this.target.cloud - w.cloud) * k;
      w.rain += (this.target.rain - w.rain) * k;
      w.wind += (this.target.wind - w.wind) * k;
      w.wetness += (this.target.wetness - w.wetness) * k;
      const turn = ((this.target.windDirection - w.windDirection + 540) % 360) - 180;
      w.windDirection = (w.windDirection + turn * k + 360) % 360;
    }
    const bearing = THREE.MathUtils.degToRad(w.windDirection);
    this.windVector.set(Math.sin(bearing), -Math.cos(bearing));
    this.drift.addScaledVector(this.windVector, dt * (0.004 + 0.02 * w.wind));

    this.utc = gameUtc(this.clock, now);
    const { latitude, longitude } = this.index.center;
    const sunAt = sunPosition(this.utc, latitude, longitude);
    const moonAt = moonPosition(this.utc, latitude, longitude);
    const sun = skyDirection(sunAt) as Rgb;
    const moon = skyDirection(moonAt) as Rgb;
    this.sunElevation = sunAt.elevation;
    const state = skyState(sun, moon, moonAt.illumination, w.cloud, w.rain);

    this.starTurn.setFromMatrix4(new THREE.Matrix4().makeRotationAxis(this.pole, -siderealAngle(this.utc, longitude)));
    // The puffy clouds take over from the dome's painted ones until the cover closes up.
    this.dome.update({ ...state, cloud: smoothstep(0.35, 1, w.cloud) * 0.95 }, this.starTurn, this.drift, camera);
    this.cloudDrift.addScaledVector(this.windVector, dt * (2 + w.wind * GALE * 1.5));
    this.clouds.update(state, w.cloud, this.cloudDrift, camera);
    this.mist = this.mistiness(THREE.MathUtils.radToDeg(sunAt.elevation));
    this.fog.mistDensity.value = MIST_DENSITY * this.mist;
    this.grading(state.sun[1]);
    this.rain.update(camera, w.rain, this.windVector.x * w.wind * GALE, this.windVector.y * w.wind * GALE);
    this.light(state, moonAt.illumination, focus);
  }

  /**
   * Distance haze plus valley mist. The mist thins exponentially with height, so the amount
   * a sight line passes through is worked out exactly from where it starts and ends.
   */
  private fogNode(floor: number): THREE.Node<'vec4'> {
    const f = this.fog;
    return Fn(() => {
      const haze = rangeFogFactor(f.near, f.far);
      const toward = positionWorld.sub(cameraPosition);
      const length = toward.length();
      const rise = toward.y.div(MIST_THICKNESS);
      // Share of the sight line's length at the camera's density: (1 - e^-rise) / rise.
      const spread = select(abs(rise).lessThan(1e-3), float(1), float(1).sub(exp(rise.negate())).div(rise));
      const atCamera = exp(cameraPosition.y.sub(floor).div(-MIST_THICKNESS).min(30).max(-4));
      const mist = float(1).sub(exp(f.mistDensity.mul(length).mul(atCamera).mul(spread).negate()));
      const hazed = mix(output.rgb, f.color, haze);
      return vec4(mix(hazed, f.mistColor, mist.min(0.97)), output.a);
    })();
  }

  /** How misty the valleys are: thick after a still, damp night, burnt off by the sun and blown away by wind. */
  private mistiness(sunDegrees: number): number {
    const w = this.weather;
    const hour = this.localHour();
    const morning = hour >= 2 && hour < 13 ? 1 - smoothstep(3, 14, sunDegrees) : 0;
    const evening = hour >= 13 || hour < 2 ? (1 - smoothstep(-3, 6, sunDegrees)) * 0.55 : 0;
    const damp = 0.5 + 0.5 * Math.max(w.wetness, w.cloud * 0.6);
    const calm = 1 - smoothstep(0.25, 0.6, w.wind);
    return Math.max(morning, evening) * damp * calm * (1 - 0.6 * w.rain);
  }

  /** Warm low sun, blue night, grey rain: the picture's grade for this moment. */
  private grading(sunY: number): void {
    const w = this.weather;
    const g = this.grade;
    // Golden hour: the sun within about 12° of the horizon, strongest just above it.
    const golden = smoothstep(-0.06, 0.03, sunY) * (1 - smoothstep(0.08, 0.22, sunY)) * (1 - 0.8 * w.cloud);
    const night = 1 - smoothstep(-0.2, -0.02, sunY);
    const grey = Math.max(w.rain, smoothstep(0.55, 1, w.cloud) * 0.6);
    g.tint.set(1 + 0.1 * golden - 0.12 * night, 1 + 0.02 * golden - 0.05 * night, 1 - 0.1 * golden + 0.1 * night);
    // A little richer than life suits the cartoon world, less so when it is grey or dark.
    g.saturation = 1.15 - 0.15 * grey - 0.25 * night + 0.1 * golden;
    g.lift = 0.012 * night;
  }

  private light(state: SkyState, moonPhase: number, focus: THREE.Vector3): void {
    const w = this.weather;
    const sunY = state.sun[1];
    const veil = 1 - 0.93 * w.cloud ** 1.3;
    const direct = sunlight(sunY);
    const sunPower = (SUN_INTENSITY * luminance(direct) * smoothstep(-0.03, 0.05, sunY) * veil) / SUN_REFERENCE;
    const moonPower = 0.16 * moonPhase * smoothstep(-0.02, 0.15, state.moon[1]) * veil;

    // One light does for both: the sun while it is up, the moon after.
    const bySun = sunPower >= moonPower;
    const from = bySun ? state.sun : state.moon;
    const peak = Math.max(direct[0], direct[1], direct[2], 1e-6);
    if (bySun) this.sun.color.setRGB(direct[0] / peak, direct[1] / peak, direct[2] / peak);
    else this.sun.color.setRGB(0.62, 0.72, 1);
    this.sun.intensity = Math.max(sunPower, moonPower);
    this.sunRadiance.value.copy(this.sun.color).multiplyScalar(this.sun.intensity);
    this.sun.target.position.copy(focus);
    this.sun.position.set(focus.x + from[0] * 300, focus.y + from[1] * 300, focus.z + from[2] * 300);

    const day = smoothstep(-0.16, 0.12, sunY);
    const moonUp = moonPhase * smoothstep(-0.05, 0.15, state.moon[1]);
    const overhead = skyColor([0, 1, 0], state);
    const top = Math.max(overhead[0], overhead[1], overhead[2], 1e-6);
    // Keep some of the sky's tint, but never so blue that the ground looks dyed.
    this.ambient.color.setRGB(0.55 + 0.45 * (overhead[0] / top), 0.55 + 0.45 * (overhead[1] / top), 0.55 + 0.45 * (overhead[2] / top));
    this.ambient.groundColor.setRGB(0.3, 0.28, 0.22);
    this.ambient.intensity = 0.05 + 0.06 * moonUp + AMBIENT * day * (1 + 0.4 * w.cloud) * (1 - 0.3 * w.rain);

    // Fog takes the colour of the sky low down, to either side of the sun.
    const side = Math.hypot(state.sun[0], state.sun[2]) || 1;
    const across: Rgb = [-state.sun[2] / side, 0.04, state.sun[0] / side];
    const a = skyColor(across, state);
    const b = skyColor([-across[0], 0.04, -across[2]], state);
    const fogColor = this.fog.color.value.setRGB((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    const murk = Math.min(1, w.rain * 0.85 + Math.max(0, w.cloud - 0.6) * 0.5);
    this.fog.near.value = 2500 + (120 - 2500) * murk;
    this.fog.far.value = 30000 + (4200 - 30000) * murk;
    // Mist is paler than the distance, and catches the low sun.
    const glow = smoothstep(-0.05, 0.1, sunY) * (1 - 0.7 * w.cloud);
    const lightness = 0.04 + 0.9 * day;
    this.fog.mistColor.value.setRGB(
      (fogColor.r * 0.55 + 0.45 * lightness) * (1 + 0.12 * glow),
      (fogColor.g * 0.55 + 0.45 * lightness) * (1 + 0.04 * glow),
      (fogColor.b * 0.55 + 0.45 * lightness) * (1 - 0.06 * glow),
    );

    this.daylight = Math.min(1.2, (this.sun.intensity / SUN_INTENSITY) * 0.65 + (this.ambient.intensity / AMBIENT) * 0.4);
    this.dark = this.daylight < 0.32 || w.rain > 0.5;
  }
}
