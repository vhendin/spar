"""Region definitions and the fixed numbers of the region format."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

from osgeo import osr

FORMAT_VERSION = 4
CRS = "EPSG:3006"  # SWEREF 99 TM
TILE_SIZE = 256  # metres, world tile used for object placement
SAMPLES = 257  # height samples per file side, edges shared with neighbours
APRON = 1  # extra samples stored around every file
ROOT_LEVEL = 3  # coarsest height level: 8 m spacing, 2048 m files
ROOT_SPAN = (SAMPLES - 1) << ROOT_LEVEL
HORIZON_SPACING = 128  # metres
HORIZON_BIOME_SPACING = 32  # metres
HORIZON_MARGIN = 15360  # metres beyond the area on every side


def data_dir() -> Path:
    return Path(os.environ.get("SPAR_DATA", "data"))


def defs_dir() -> Path:
    return Path(os.environ.get("SPAR_DEFS", "defs"))


def schemas_dir() -> Path:
    return Path(os.environ.get("SPAR_SCHEMAS", "shared/schemas"))


def load_schema(name: str) -> dict:
    return json.loads((schemas_dir() / f"{name}.schema.json").read_text())


@dataclass(frozen=True)
class Region:
    name: str
    title: str
    west: int  # easting of the west edge
    north: int  # northing of the north edge
    size: int
    generator: str | None = None  # "proving": a made-up test area, not map data

    @property
    def east(self) -> int:
        return self.west + self.size

    @property
    def south(self) -> int:
        return self.north - self.size

    def wgs84_bbox(self, margin: float = 0.0) -> tuple[float, float, float, float]:
        """(min_lon, min_lat, max_lon, max_lat) enclosing the area plus a margin in metres."""
        to_geo = _transform(CRS, "EPSG:4326")
        w, e = self.west - margin, self.east + margin
        s, n = self.south - margin, self.north + margin
        lons, lats = [], []
        steps = 8  # the edges curve in geographic coordinates, so walk along them
        for i in range(steps + 1):
            t = i / steps
            for x, y in ((w + (e - w) * t, s), (w + (e - w) * t, n), (w, s + (n - s) * t), (e, s + (n - s) * t)):
                lon, lat, _ = to_geo.TransformPoint(x, y)
                lons.append(lon)
                lats.append(lat)
        return min(lons), min(lats), max(lons), max(lats)

    def center_wgs84(self) -> tuple[float, float]:
        """(latitude, longitude) of the middle of the area."""
        lon, lat, _ = _transform(CRS, "EPSG:4326").TransformPoint(self.west + self.size / 2, self.north - self.size / 2)
        return lat, lon


def _transform(src: str, dst: str) -> osr.CoordinateTransformation:
    a, b = osr.SpatialReference(), osr.SpatialReference()
    a.SetFromUserInput(src)
    b.SetFromUserInput(dst)
    # Always x = east or longitude, y = north or latitude.
    a.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    b.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    return osr.CoordinateTransformation(a, b)


def region_from_def(d: dict) -> Region:
    import jsonschema

    jsonschema.validate(d, load_schema("region-def"))
    return Region(d["name"], d["title"], d["origin"]["easting"], d["origin"]["northing"], d["size"], d.get("generator"))


def load_region(name: str) -> Region:
    path = defs_dir() / "regions" / f"{name}.json"
    if not path.exists():
        raise SystemExit(f"No region definition at {path}")
    return region_from_def(json.loads(path.read_text()))
