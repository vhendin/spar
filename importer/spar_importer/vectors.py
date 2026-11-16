"""vectors.json: roads, waterways, lake outlines, places and spawn points in local metres."""

from __future__ import annotations

import math

from osgeo import ogr

from .osm import OsmData
from .region import Region

SPAWN_PLACES = ("village", "hamlet", "town", "suburb")


def _box(region: Region) -> ogr.Geometry:
    ring = ogr.Geometry(ogr.wkbLinearRing)
    for x, y in ((region.west, region.south), (region.east, region.south), (region.east, region.north), (region.west, region.north), (region.west, region.south)):
        ring.AddPoint_2D(x, y)
    box = ogr.Geometry(ogr.wkbPolygon)
    box.AddGeometry(ring)
    return box


def _lines(geom: ogr.Geometry | None) -> list[ogr.Geometry]:
    """The line strings inside a geometry of any kind."""
    if geom is None or geom.IsEmpty():
        return []
    kind = ogr.GT_Flatten(geom.GetGeometryType())
    if kind == ogr.wkbLineString:
        return [geom] if geom.GetPointCount() >= 2 else []
    if kind in (ogr.wkbMultiLineString, ogr.wkbGeometryCollection):
        return [line for i in range(geom.GetGeometryCount()) for line in _lines(geom.GetGeometryRef(i))]
    return []


def _local(region: Region, line: ogr.Geometry) -> list[list[float]]:
    points = []
    for i in range(line.GetPointCount()):
        x, y = line.GetX(i), line.GetY(i)
        point = [round(x - region.west, 1), round(region.north - y, 1)]
        if not points or points[-1] != point:
            points.append(point)
    return points


def _clipped(region: Region, box: ogr.Geometry, geom: ogr.Geometry, tolerance: float) -> list[list[list[float]]]:
    parts = []
    for line in _lines(geom.Intersection(box)):
        points = _local(region, line.Simplify(tolerance) or line)
        if len(points) >= 2:
            parts.append(points)
    return parts


def build_vectors(osm: OsmData, region: Region, levels: dict[str, float]) -> dict:
    box = _box(region)
    roads, drivable_points = [], []
    for road in osm.roads:
        parts = _clipped(region, box, road.geom, 0.3)
        for n, points in enumerate(parts):
            entry = {
                "id": road.id if len(parts) == 1 else f"{road.id}.{n}",
                "kind": road.kind,
                "surface": road.surface,
                "width": road.width,
                "drivable": road.drivable,
                "points": points,
            }
            if road.tags.get("bridge") not in (None, "no"):
                entry["bridge"] = True
            if road.tags.get("name"):
                entry["name"] = road.tags["name"]
            roads.append(entry)
            if road.drivable:
                for a, b in zip(points, points[1:]):
                    drivable_points.append((a[0], a[1], b[0], b[1], entry["id"]))

    waterways = []
    for way in osm.waterways:
        parts = _clipped(region, box, way.geom, 0.5)
        for n, points in enumerate(parts):
            entry = {"id": way.id if len(parts) == 1 else f"{way.id}.{n}", "kind": way.kind, "points": points}
            if way.tags.get("name"):
                entry["name"] = way.tags["name"]
            waterways.append(entry)

    lakes = []
    for area in osm.areas:
        if area.id not in levels:
            continue
        clipped = area.geom.Intersection(box)
        if clipped is None or clipped.IsEmpty():
            continue
        polygons = [clipped] if ogr.GT_Flatten(clipped.GetGeometryType()) == ogr.wkbPolygon else [
            clipped.GetGeometryRef(i) for i in range(clipped.GetGeometryCount())
        ]
        for n, polygon in enumerate(polygons):
            if ogr.GT_Flatten(polygon.GetGeometryType()) != ogr.wkbPolygon or polygon.GetGeometryCount() == 0:
                continue
            ring = polygon.GetGeometryRef(0)
            outline = _local(region, ring.Simplify(1.0) or ring)
            if len(outline) < 4:
                continue
            entry = {"id": area.id if len(polygons) == 1 else f"{area.id}.{n}", "level": round(levels[area.id], 2), "outline": outline}
            if area.tags.get("name"):
                entry["name"] = area.tags["name"]
            lakes.append(entry)

    places = [
        {"name": p.name, "kind": p.kind, "x": round(p.easting - region.west, 1), "z": round(region.north - p.northing, 1)}
        for p in osm.places
        if region.west <= p.easting <= region.east and region.south <= p.northing <= region.north
    ]

    return {"roads": roads, "waterways": waterways, "lakes": lakes, "places": places, "spawns": _spawns(places, drivable_points, region)}


def _nearest_on_roads(x: float, z: float, segments: list[tuple]) -> tuple[float, float, float, str, float] | None:
    best = None
    for ax, az, bx, bz, road in segments:
        dx, dz = bx - ax, bz - az
        length2 = dx * dx + dz * dz
        t = 0.0 if length2 == 0 else min(1.0, max(0.0, ((x - ax) * dx + (z - az) * dz) / length2))
        px, pz = ax + dx * t, az + dz * t
        distance = math.hypot(px - x, pz - z)
        if best is None or distance < best[4]:
            # Heading: 0 = north (towards -z), 90 = east (+x).
            best = (px, pz, math.degrees(math.atan2(dx, -dz)) % 360, road, distance)
    return best


def _spawns(places: list[dict], segments: list[tuple], region: Region) -> list[dict]:
    """A start point on the nearest drivable road for each settlement, then one near the middle."""
    wanted = [(p["name"], p["x"], p["z"]) for p in places if p["kind"] in SPAWN_PLACES]
    wanted.append(("Centre", region.size / 2, region.size / 2))
    spawns, seen = [], set()
    for name, x, z in wanted:
        hit = _nearest_on_roads(x, z, segments)
        if hit is None or (name != "Centre" and hit[4] > 1500):
            continue
        key = (round(hit[0]), round(hit[1]))
        if key in seen:
            continue
        seen.add(key)
        spawns.append({"name": name, "x": round(hit[0], 1), "z": round(hit[1], 1), "heading": round(hit[2], 1), "road": hit[3]})
    return spawns
