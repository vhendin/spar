"""Packs the Yale Bright Star Catalogue (5th ed., public domain) into defs/sky/stars.bin.

Every star of magnitude 6.5 or brighter, 6 bytes each, little-endian:
  uint16 right ascension, 0..65536 for 0..360 degrees (J2000)
  int16  declination, -32767..32767 for -90..90 degrees (J2000)
  uint8  visual magnitude, (mag + 2) * 25
  uint8  colour index B-V, (bv + 0.5) * 100

The catalogue comes from http://tdc-www.harvard.edu/catalogs/bsc5.dat.gz; run once:
  python3 importer/stars.py bsc5.dat.gz defs/sky/stars.bin
"""

import gzip
import struct
import sys

FAINTEST = 6.5


def parse(line: str):
    """Right ascension and declination in degrees, magnitude and B-V; None for the few rows without a position."""
    if len(line) < 107 or not line[75:77].strip():
        return None
    ra = (int(line[75:77]) + int(line[77:79]) / 60 + float(line[79:83]) / 3600) * 15
    dec = int(line[84:86]) + int(line[86:88]) / 60 + int(line[88:90]) / 3600
    if line[83] == "-":
        dec = -dec
    mag = float(line[102:107])
    bv = float(line[109:114]) if line[109:114].strip() else 0.6
    return ra, dec, mag, bv


def clamp(v: float, lo: int, hi: int) -> int:
    return max(lo, min(hi, round(v)))


def main(source: str, target: str) -> None:
    out = bytearray()
    count = 0
    with gzip.open(source, "rt", encoding="latin-1") as f:
        for line in f:
            star = parse(line.rstrip("\n"))
            if not star or star[2] > FAINTEST:
                continue
            ra, dec, mag, bv = star
            out += struct.pack(
                "<HhBB",
                clamp(ra / 360 * 65536, 0, 65535),
                clamp(dec / 90 * 32767, -32767, 32767),
                clamp((mag + 2) * 25, 0, 255),
                clamp((bv + 0.5) * 100, 0, 255),
            )
            count += 1
    with open(target, "wb") as f:
        f.write(out)
    print(f"{count} stars, {len(out)} bytes")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
