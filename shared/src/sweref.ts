// SWEREF 99 TM (EPSG:3006), the Swedish grid regions are laid out in, to and from latitude and
// longitude. Gauss–Krüger formulas as Lantmäteriet publishes them, on the GRS 80 ellipsoid;
// good to well under a millimetre, far more than choosing an area needs.

const A = 6378137;
const F = 1 / 298.257222101;
const LON0 = 15;
const K0 = 0.9996;
const FALSE_EASTING = 500000;

const E2 = F * (2 - F);
const N = F / (2 - F);
const AROOF = (A / (1 + N)) * (1 + (N * N) / 4 + (N ** 4) / 64);
const RAD = Math.PI / 180;

/** Easting and northing in metres for a latitude and longitude in degrees. */
export function toSweref(lat: number, lon: number): { easting: number; northing: number } {
  const a = E2;
  const b = (5 * E2 ** 2 - E2 ** 3) / 6;
  const c = (104 * E2 ** 3 - 45 * E2 ** 4) / 120;
  const d = (1237 * E2 ** 4) / 1260;
  const b1 = N / 2 - (2 * N * N) / 3 + (5 * N ** 3) / 16 + (41 * N ** 4) / 180;
  const b2 = (13 * N * N) / 48 - (3 * N ** 3) / 5 + (557 * N ** 4) / 1440;
  const b3 = (61 * N ** 3) / 240 - (103 * N ** 4) / 140;
  const b4 = (49561 * N ** 4) / 161280;
  const phi = lat * RAD;
  const dl = (lon - LON0) * RAD;
  const s = Math.sin(phi);
  const conf = phi - s * Math.cos(phi) * (a + b * s ** 2 + c * s ** 4 + d * s ** 6);
  const xi = Math.atan(Math.tan(conf) / Math.cos(dl));
  const eta = Math.atanh(Math.cos(conf) * Math.sin(dl));
  const northing =
    K0 * AROOF * (xi + b1 * Math.sin(2 * xi) * Math.cosh(2 * eta) + b2 * Math.sin(4 * xi) * Math.cosh(4 * eta) +
      b3 * Math.sin(6 * xi) * Math.cosh(6 * eta) + b4 * Math.sin(8 * xi) * Math.cosh(8 * eta));
  const easting =
    K0 * AROOF * (eta + b1 * Math.cos(2 * xi) * Math.sinh(2 * eta) + b2 * Math.cos(4 * xi) * Math.sinh(4 * eta) +
      b3 * Math.cos(6 * xi) * Math.sinh(6 * eta) + b4 * Math.cos(8 * xi) * Math.sinh(8 * eta)) + FALSE_EASTING;
  return { easting, northing };
}

/** Latitude and longitude in degrees for an easting and northing in metres. */
export function fromSweref(easting: number, northing: number): { lat: number; lon: number } {
  const d1 = N / 2 - (2 * N * N) / 3 + (37 * N ** 3) / 96 - (N ** 4) / 360;
  const d2 = (N * N) / 48 + (N ** 3) / 15 - (437 * N ** 4) / 1440;
  const d3 = (17 * N ** 3) / 480 - (37 * N ** 4) / 840;
  const d4 = (4397 * N ** 4) / 161280;
  const as = E2 + E2 ** 2 + E2 ** 3 + E2 ** 4;
  const bs = -(7 * E2 ** 2 + 17 * E2 ** 3 + 30 * E2 ** 4) / 6;
  const cs = (224 * E2 ** 3 + 889 * E2 ** 4) / 120;
  const ds = -(4279 * E2 ** 4) / 1260;
  const xi = northing / (K0 * AROOF);
  const eta = (easting - FALSE_EASTING) / (K0 * AROOF);
  const xp = xi - d1 * Math.sin(2 * xi) * Math.cosh(2 * eta) - d2 * Math.sin(4 * xi) * Math.cosh(4 * eta) -
    d3 * Math.sin(6 * xi) * Math.cosh(6 * eta) - d4 * Math.sin(8 * xi) * Math.cosh(8 * eta);
  const ep = eta - d1 * Math.cos(2 * xi) * Math.sinh(2 * eta) - d2 * Math.cos(4 * xi) * Math.sinh(4 * eta) -
    d3 * Math.cos(6 * xi) * Math.sinh(6 * eta) - d4 * Math.cos(8 * xi) * Math.sinh(8 * eta);
  const conf = Math.asin(Math.sin(xp) / Math.cosh(ep));
  const dl = Math.atan(Math.sinh(ep) / Math.cos(xp));
  const s = Math.sin(conf);
  const phi = conf + s * Math.cos(conf) * (as + bs * s ** 2 + cs * s ** 4 + ds * s ** 6);
  return { lat: phi / RAD, lon: LON0 + dl / RAD };
}
