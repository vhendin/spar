"""Reads an OpenStreetMap extract into classified geometries in the region's coordinate system."""

from __future__ import annotations

import json
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from osgeo import ogr, osr

from .ground import WATERWAYS, biome_for, road_for
from .region import CRS

ogr.UseExceptions()


@dataclass
class Area:
    biome: str
    geom: ogr.Geometry
    id: str
    tags: dict


@dataclass
class Road:
    id: str
    kind: str
    surface: str
    width: float
    drivable: bool
    geom: ogr.Geometry
    tags: dict


@dataclass
class Waterway:
    id: str
    kind: str
    width: float
    geom: ogr.Geometry
    tags: dict


@dataclass
class Place:
    name: str
    kind: str
    easting: float
    northing: float


@dataclass
class Feature:
    """A building outline, power line or barrier line: kept with its tags for the vectors."""

    id: str
    geom: ogr.Geometry
    tags: dict


POWER_LINES = ("line", "minor_line")
BARRIERS = ("fence", "wall", "retaining_wall")


@dataclass
class OsmData:
    areas: list[Area] = field(default_factory=list)
    roads: list[Road] = field(default_factory=list)
    waterways: list[Waterway] = field(default_factory=list)
    places: list[Place] = field(default_factory=list)
    buildings: list[Feature] = field(default_factory=list)
    power: list[Feature] = field(default_factory=list)
    barriers: list[Feature] = field(default_factory=list)


def load_osm(path: Path) -> OsmData:
    """Everything the importer uses from an extract (.osm.pbf or .osm), projected to metres."""
    geo, projected = osr.SpatialReference(), osr.SpatialReference()
    geo.SetFromUserInput("EPSG:4326")
    projected.SetFromUserInput(CRS)
    geo.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    projected.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    to_metres = osr.CoordinateTransformation(geo, projected)

    data = OsmData()
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "features.geojsonseq"
        subprocess.run(
            ["osmium", "export", "--overwrite", "--add-unique-id=type_id", "-f", "geojsonseq", "-o", str(out), str(path)],
            check=True,
            stderr=subprocess.DEVNULL,
        )
        with open(out, encoding="utf-8") as lines:
            for line in lines:
                line = line.strip("\x1e\n ")
                if not line:
                    continue
                feature = json.loads(line)
                tags = feature.get("properties") or {}
                kind = feature["geometry"]["type"]
                # A closed way comes out both as a line and as a polygon; take each feature
                # only in the shape its tags are about.
                fid = str(feature.get("id", ""))
                if kind in ("Polygon", "MultiPolygon"):
                    biome = biome_for(tags)
                    if biome:
                        data.areas.append(Area(biome, _geometry(feature, to_metres), fid, tags))
                    if tags.get("building") not in (None, "no") and tags.get("location") != "underground":
                        data.buildings.append(Feature(fid, _geometry(feature, to_metres), tags))
                elif kind == "LineString" and tags.get("power") in POWER_LINES and tags.get("location") not in ("underground", "underwater"):
                    data.power.append(Feature(fid, _geometry(feature, to_metres), tags))
                elif kind == "LineString" and tags.get("barrier") in BARRIERS:
                    data.barriers.append(Feature(fid, _geometry(feature, to_metres), tags))
                elif kind == "LineString":
                    road = road_for(tags)
                    if road:
                        surface, width, drivable = road
                        data.roads.append(
                            Road(str(feature.get("id", "")), tags["highway"], surface, width, drivable, _geometry(feature, to_metres), tags)
                        )
                    elif tags.get("waterway") in WATERWAYS and tags.get("tunnel") not in ("yes", "culvert"):
                        way = tags["waterway"]
                        data.waterways.append(Waterway(str(feature.get("id", "")), way, WATERWAYS[way], _geometry(feature, to_metres), tags))
                elif kind == "Point" and tags.get("place") and tags.get("name"):
                    x, y, _ = to_metres.TransformPoint(*feature["geometry"]["coordinates"][:2])
                    data.places.append(Place(tags["name"], tags["place"], x, y))
    return data


def _geometry(feature: dict, to_metres: osr.CoordinateTransformation) -> ogr.Geometry:
    geom = ogr.CreateGeometryFromJson(json.dumps(feature["geometry"]))
    geom.Transform(to_metres)
    return geom
