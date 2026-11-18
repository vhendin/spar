// Where the sun and moon stand in the sky, from the date, time and place. Low-precision
// formulas (good to a fraction of a degree), which is plenty for lighting a landscape.

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
/** Tilt of the Earth's axis. */
const OBLIQUITY = RAD * 23.4397;

export interface SkyPosition {
  /** Compass bearing in radians: 0 north, π/2 east. */
  azimuth: number;
  /** Radians above the horizon; negative when below it. */
  elevation: number;
}

export interface MoonPosition extends SkyPosition {
  /** Share of the disc that is lit, 0 new to 1 full. */
  illumination: number;
}

/** Days since the start of 2000, from a UTC instant in milliseconds. */
const daysSince2000 = (utcMs: number): number => utcMs / DAY_MS - 0.5 + J1970 - J2000;

const rightAscension = (l: number, b: number): number => Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(b) * Math.sin(OBLIQUITY), Math.cos(l));
const declination = (l: number, b: number): number => Math.asin(Math.sin(b) * Math.cos(OBLIQUITY) + Math.cos(b) * Math.sin(OBLIQUITY) * Math.sin(l));

function sunCoords(d: number): { ra: number; dec: number } {
  const m = RAD * (357.5291 + 0.98560028 * d);
  const centre = RAD * (1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m));
  const l = m + centre + RAD * 102.9372 + Math.PI;
  return { ra: rightAscension(l, 0), dec: declination(l, 0) };
}

function moonCoords(d: number): { ra: number; dec: number; distance: number } {
  const l = RAD * (218.316 + 13.176396 * d);
  const m = RAD * (134.963 + 13.064993 * d);
  const f = RAD * (93.272 + 13.22935 * d);
  const longitude = l + RAD * 6.289 * Math.sin(m);
  const latitude = RAD * 5.128 * Math.sin(f);
  return { ra: rightAscension(longitude, latitude), dec: declination(longitude, latitude), distance: 385001 - 20905 * Math.cos(m) };
}

/** How far the stars have turned: the sidereal angle at a longitude (degrees east). */
export function siderealAngle(utcMs: number, longitude: number): number {
  return RAD * (280.16 + 360.9856235 * daysSince2000(utcMs)) + RAD * longitude;
}

function toHorizon(utcMs: number, latitude: number, longitude: number, ra: number, dec: number): SkyPosition {
  const phi = RAD * latitude;
  const h = siderealAngle(utcMs, longitude) - ra;
  const elevation = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(h));
  // Measured from south towards west; turn it into a compass bearing.
  const fromSouth = Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return { azimuth: (fromSouth + Math.PI + 2 * Math.PI) % (2 * Math.PI), elevation };
}

/**
 * Where a point fixed among the stars stands at a UTC instant, from its right ascension and
 * declination in degrees (J2000 is close enough).
 */
export function starPosition(utcMs: number, latitude: number, longitude: number, ra: number, dec: number): SkyPosition {
  return toHorizon(utcMs, latitude, longitude, RAD * ra, RAD * dec);
}

/** The Milky Way's plane: its north pole, and the direction of the galaxy's centre (in Sagittarius). */
export const GALACTIC_POLE = { ra: 192.86, dec: 27.13 };
export const GALACTIC_CENTRE = { ra: 266.4, dec: -28.94 };

/** The sun at a UTC instant (milliseconds) seen from a latitude and longitude in degrees. */
export function sunPosition(utcMs: number, latitude: number, longitude: number): SkyPosition {
  const { ra, dec } = sunCoords(daysSince2000(utcMs));
  return toHorizon(utcMs, latitude, longitude, ra, dec);
}

export function moonPosition(utcMs: number, latitude: number, longitude: number): MoonPosition {
  const d = daysSince2000(utcMs);
  const sun = sunCoords(d);
  const moon = moonCoords(d);
  const sunDistance = 149598000;
  const apart = Math.acos(Math.sin(sun.dec) * Math.sin(moon.dec) + Math.cos(sun.dec) * Math.cos(moon.dec) * Math.cos(sun.ra - moon.ra));
  const phase = Math.atan2(sunDistance * Math.sin(apart), moon.distance - sunDistance * Math.cos(apart));
  return { ...toHorizon(utcMs, latitude, longitude, moon.ra, moon.dec), illumination: (1 + Math.cos(phase)) / 2 };
}

/**
 * A sky position as a unit vector in the game's world: x east, y up, z south.
 */
export function skyDirection(p: SkyPosition): [number, number, number] {
  const flat = Math.cos(p.elevation);
  return [Math.sin(p.azimuth) * flat, Math.sin(p.elevation), -Math.cos(p.azimuth) * flat];
}
