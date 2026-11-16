// A small model of the sky's colour: sunlight thinned and reddened by the air it crosses,
// scattered blue by the air and white by haze, with twilight, night and cloud on top.
// The same sums are done per pixel in skyDome.ts; this file does them on the CPU for the
// few colours the rest of the scene needs (sun, ambient light, fog).

export type Rgb = [number, number, number];

/** How strongly a unit of air scatters red, green and blue (blue most), and haze scatters all. */
export const AIR: Rgb = [0.0464, 0.108, 0.265];
export const HAZE = 0.026;
/** Haze throws light forwards: 0 evenly, towards 1 a tight glow round the sun. */
export const HAZE_FORWARD = 0.76;
/** Brightness of sunlight before the air gets at it. */
export const SUN_POWER = 5.5;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
export const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const luminance = (c: Rgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** How much air a ray crosses, 1-ish straight up and many times that along the horizon. `y` is the ray's upward component. */
export const airMass = (y: number): number => 1 / (Math.max(y, 0) + 0.06);

/**
 * Colour of direct sunlight after crossing the air, for a sun whose direction has upward
 * component `sunY`. `share` is how much of that air counts: 1 at the ground, less for
 * light that reaches the high air overhead by a shorter, thinner path.
 */
export function sunlight(sunY: number, share = 1): Rgb {
  // Below the horizon the light has ever more air to cross and soon gives out.
  const mass = sunY >= 0 ? airMass(sunY) : airMass(0) - sunY * 160;
  return AIR.map((air) => Math.exp(-(air + HAZE) * mass * 0.9 * share)) as Rgb;
}

/** Everything about the sky at one moment that does not depend on where you look. */
export interface SkyState {
  sun: Rgb; // unit vector towards the sun
  moon: Rgb;
  /** Sunlight colour times its power: as it lights the air near the horizon, and the air overhead. */
  sunColor: Rgb;
  sunHigh: Rgb;
  /** Glow of the high air after sunset: overhead colour and the band over the sunken sun. */
  twilight: Rgb;
  afterglow: Rgb;
  night: Rgb;
  /** Cloud colour on its lit and its shaded parts. */
  cloudLit: Rgb;
  cloudShade: Rgb;
  /** 0 clear to 1 overcast. */
  cloud: number;
  /** 1 in the dead of night, 0 by day: how well stars show. */
  starlight: number;
  /** 0..1 share of the moon's disc that is lit. */
  moonPhase: number;
}

export function skyState(sun: Rgb, moon: Rgb, moonPhase: number, cloud: number, rain: number): SkyState {
  const sunY = sun[1];
  const direct = sunlight(sunY);
  // Twilight lasts while the sun is within 18° below the horizon; brightest just after it sets.
  const dusk = smoothstep(-0.31, 0.02, sunY);
  const low = smoothstep(-0.2, -0.02, sunY) * (1 - smoothstep(0.0, 0.25, sunY));
  const day = smoothstep(-0.08, 0.12, sunY);
  const moonUp = smoothstep(-0.05, 0.15, moon[1]) * moonPhase;

  const lit: Rgb = [0.92 * day * (0.4 + 0.6 * direct[0]), 0.92 * day * (0.35 + 0.65 * direct[1]), 0.95 * day * (0.3 + 0.7 * direct[2])];
  const duskLit: Rgb = [0.1 * dusk + 0.012 + 0.03 * moonUp, 0.11 * dusk + 0.014 + 0.035 * moonUp, 0.15 * dusk + 0.02 + 0.045 * moonUp];
  const cloudLit: Rgb = [Math.max(lit[0], duskLit[0]), Math.max(lit[1], duskLit[1]), Math.max(lit[2], duskLit[2])];
  // Thick rain cloud is dark underneath.
  const shade = 0.62 - 0.3 * rain;
  return {
    sun,
    moon,
    sunColor: direct.map((c) => c * SUN_POWER) as Rgb,
    // Overhead the sky stays blue at sunset: the light up there has crossed far less air.
    sunHigh: sunlight(sunY, 0.22).map((c) => c * SUN_POWER * smoothstep(-0.12, 0.02, sunY)) as Rgb,
    twilight: [0.012 * dusk * dusk, 0.03 * dusk * dusk, 0.09 * dusk * dusk],
    afterglow: [0.55 * low, 0.24 * low, 0.07 * low],
    night: [0.0022 + 0.004 * moonUp, 0.0036 + 0.006 * moonUp, 0.008 + 0.011 * moonUp],
    cloudLit,
    cloudShade: cloudLit.map((c) => c * shade) as Rgb,
    cloud,
    starlight: (1 - smoothstep(-0.26, -0.1, sunY)) * (1 - 0.7 * moonUp),
    moonPhase,
  };
}

/** Squeezes unbounded light into what a screen can show. */
export const tone = (c: Rgb): Rgb => c.map((v) => 1 - Math.exp(-v * 1.25)) as Rgb;

/** Colour of the clear sky in a direction (unit vector), before tone mapping and without clouds. */
export function clearSky(d: Rgb, s: SkyState): Rgb {
  const y = Math.max(d[1], 0);
  const mass = airMass(y);
  const mu = d[0] * s.sun[0] + d[1] * s.sun[1] + d[2] * s.sun[2];
  const air = 0.375 * (1 + mu * mu);
  const g = HAZE_FORWARD;
  const haze = ((1 - g * g) / (4 * Math.PI * (1 + g * g - 2 * g * mu) ** 1.5)) * (1 - Math.exp(-HAZE * mass));
  // The afterglow hangs low, on the side where the sun went down.
  const flat = Math.hypot(d[0], d[2]) * Math.hypot(s.sun[0], s.sun[2]) || 1;
  const towards = (d[0] * s.sun[0] + d[2] * s.sun[2]) / flat;
  const glow = Math.exp(-(1 - towards) * 2.2) * Math.exp(-y * 5);
  const high = smoothstep(0, 0.55, y);
  const out: Rgb = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    out[c] =
      (s.sunColor[c]! + (s.sunHigh[c]! - s.sunColor[c]!) * high) * ((1 - Math.exp(-AIR[c]! * mass)) * air + haze) +
      s.twilight[c]! * (0.45 + 0.55 * (1 - y)) +
      s.afterglow[c]! * glow +
      s.night[c]! * (1 + (1 - y) * 1.5);
  }
  return out;
}

/** The sky's overall colour in a direction with the cloud cover mixed in, ready for the screen. */
export function skyColor(d: Rgb, s: SkyState): Rgb {
  const cloud = mix(s.cloudShade, s.cloudLit, 0.6);
  return tone(mix(clearSky(d, s), cloud, s.cloud * 0.92));
}
