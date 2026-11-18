// The real stars: the Yale Bright Star Catalogue as packed by importer/stars.py into
// defs/sky/stars.bin, 6 bytes a star (right ascension, declination, magnitude, colour).

export interface Star {
  /** Right ascension and declination, degrees (J2000). */
  ra: number;
  dec: number;
  /** Visual magnitude: smaller is brighter; about 6.5 is the faintest the eye sees. */
  mag: number;
  /** Colour index B-V: below 0 blue-white, around 0.6 like the sun, above 1.4 red. */
  bv: number;
}

const BYTES = 6;

export function decodeStars(data: ArrayBuffer): Star[] {
  const view = new DataView(data);
  const stars: Star[] = [];
  for (let at = 0; at + BYTES <= data.byteLength; at += BYTES) {
    stars.push({
      ra: (view.getUint16(at, true) / 65536) * 360,
      dec: (view.getInt16(at + 2, true) / 32767) * 90,
      mag: view.getUint8(at + 4) / 25 - 2,
      bv: view.getUint8(at + 5) / 100 - 0.5,
    });
  }
  return stars;
}
