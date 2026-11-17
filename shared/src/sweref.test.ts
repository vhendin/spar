import { describe, expect, it } from 'vitest';
import { fromSweref, toSweref } from './sweref';

// Reference points converted with GDAL (EPSG:4326 to EPSG:3006).
const POINTS = [
  { lat: 63.399, lon: 13.08, easting: 404088, northing: 7031483 },
  { lat: 59.3005, lon: 18.099, easting: 676450, northing: 6577618 },
];

describe('SWEREF 99 TM', () => {
  it('matches GDAL to the metre', () => {
    for (const p of POINTS) {
      const g = toSweref(p.lat, p.lon);
      expect(Math.abs(g.easting - p.easting)).toBeLessThan(1);
      expect(Math.abs(g.northing - p.northing)).toBeLessThan(1);
    }
  });

  it('goes back to where it came from', () => {
    for (const p of POINTS) {
      const back = fromSweref(p.easting, p.northing);
      const again = toSweref(back.lat, back.lon);
      expect(again.easting).toBeCloseTo(p.easting, 3);
      expect(again.northing).toBeCloseTo(p.northing, 3);
    }
  });
});
