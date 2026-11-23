"""vectors.json: roads, waterways, lake outlines, places and spawn points in local metres."""

from __future__ import annotations

import math
import zlib

from collections.abc import Callable

from osgeo import ogr

from .clearcuts import Clearcut
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


def _polygons(geom: ogr.Geometry | None) -> list[ogr.Geometry]:
    """The polygons inside a geometry of any kind."""
    if geom is None or geom.IsEmpty():
        return []
    kind = ogr.GT_Flatten(geom.GetGeometryType())
    if kind == ogr.wkbPolygon:
        return [geom]
    if kind in (ogr.wkbMultiPolygon, ogr.wkbGeometryCollection):
        return [p for i in range(geom.GetGeometryCount()) for p in _polygons(geom.GetGeometryRef(i))]
    return []


def _number(text: str | None) -> float | None:
    """The leading number of a tag value such as "6", "6.5 m" or "2;3"."""
    if not text:
        return None
    head = text.split(";")[0].replace(",", ".").replace("m", "").strip()
    try:
        return float(head)
    except ValueError:
        return None


def _hash(text: str) -> int:
    return zlib.crc32(text.encode())


def buildings(osm: OsmData, region: Region) -> list[dict]:
    """Footprints of the buildings standing inside the area, with what is known about their height and roof."""
    out = []
    for b in osm.buildings:
        for n, polygon in enumerate(_polygons(b.geom)):
            if polygon.GetArea() < 4:
                continue
            centre = polygon.Centroid()
            if not (region.west < centre.GetX() < region.east and region.south < centre.GetY() < region.north):
                continue
            ring = polygon.GetGeometryRef(0)
            outline = _local(region, ring.Simplify(0.25) or ring)
            if len(outline) > 2 and outline[0] == outline[-1]:
                outline.pop()
            if len(outline) < 3:
                continue
            entry: dict = {"id": b.id if n == 0 else f"{b.id}.{n}", "kind": b.tags.get("building", "yes"), "outline": outline}
            levels, height = _number(b.tags.get("building:levels")), _number(b.tags.get("height"))
            if levels and 0 < levels < 30:
                entry["levels"] = levels
            if height and 1 < height < 120:
                entry["height"] = height
            if b.tags.get("roof:shape"):
                entry["roof"] = b.tags["roof:shape"]
            out.append(entry)
    return out


def power_lines(osm: OsmData, region: Region, box: ogr.Geometry) -> list[dict]:
    """
    Overhead lines. Every point of a mapped power line is a tower or pole, so the points are
    kept as they are; one point beyond the edge is kept at each end for the wires to run on.
    """
    out = []
    for line in osm.power:
        if not line.geom.Intersects(box):
            continue
        for part in _lines(line.geom):
            points = _local(region, part)
            inside = [0 <= x <= region.size and 0 <= z <= region.size for x, z in points]
            keep = [i for i in range(len(points)) if inside[i] or (i > 0 and inside[i - 1]) or (i + 1 < len(points) and inside[i + 1])]
            if len(keep) < 2:
                continue
            entry: dict = {"id": line.id, "kind": line.tags["power"], "points": [points[i] for i in keep]}
            volts = [_number(v) for v in line.tags.get("voltage", "").split(";")]
            volts = [v for v in volts if v]
            if volts:
                entry["voltage"] = round(max(volts) / 1000, 1)
            out.append(entry)
    return out


# Drag lifts are often tagged only drag_lift, with the kind of hanger given elsewhere.
DRAG_HANGERS = {"t-bar": "t-bar", "t_bar": "t-bar", "j-bar": "j-bar", "j_bar": "j-bar", "platter": "platter", "button": "platter"}


def lifts(osm: OsmData, region: Region, box: ogr.Geometry) -> list[dict]:
    """
    Ski lifts and gondolas, from end station to end station. Points between the ends are
    towers where the map has them; the game adds more where the ground needs them. One point
    beyond the edge is kept at each end, as for power lines.
    """
    out = []
    for lift in osm.lifts:
        if not lift.geom.Intersects(box):
            continue
        kind = lift.tags["aerialway"]
        if kind == "drag_lift":
            kind = DRAG_HANGERS.get(lift.tags.get("piste:lift") or lift.tags.get("type") or "", kind)
        for n, part in enumerate(_lines(lift.geom)):
            points = _local(region, part)
            inside = [0 <= x <= region.size and 0 <= z <= region.size for x, z in points]
            keep = [i for i in range(len(points)) if inside[i] or (i > 0 and inside[i - 1]) or (i + 1 < len(points) and inside[i + 1])]
            if len(keep) < 2:
                continue
            entry: dict = {"id": lift.id if n == 0 else f"{lift.id}.{n}", "kind": kind, "points": [points[i] for i in keep]}
            name = lift.tags.get("name") or lift.tags.get("ref")
            if name:
                entry["name"] = name
            seats = _number(lift.tags.get("aerialway:occupancy") or lift.tags.get("chairs"))
            if seats and 1 <= seats <= 40:
                entry["occupancy"] = int(seats)
            out.append(entry)
    return out


FIELD_FENCE_LANDUSE = ("farmland", "meadow")
OSM_FENCE_KINDS = {"split_rail": "roundpole", "rails": "roundpole", "wood": "roundpole", "log": "roundpole"}


def fences(osm: OsmData, region: Region, box: ogr.Geometry) -> list[dict]:
    """
    Mapped fences and walls, and fences around fields and meadows, which the map rarely
    draws: roundpole fences (gärdesgårdar) or wire, chosen by the field's id, with gaps
    where roads and paths pass.
    """
    out = []
    for barrier in osm.barriers:
        kind = "stone_wall" if barrier.tags["barrier"] in ("wall", "retaining_wall") else OSM_FENCE_KINDS.get(barrier.tags.get("fence_type", ""), "wire")
        for n, points in enumerate(_clipped(region, box, barrier.geom, 0.3)):
            out.append({"id": barrier.id if n == 0 else f"{barrier.id}.{n}", "kind": kind, "points": points})

    gaps = [r.geom.Buffer(r.width / 2 + 3) for r in osm.roads] + [w.geom.Buffer(3) for w in osm.waterways]
    gaps += [b.geom.Buffer(2) for b in osm.buildings]
    gap_boxes = [g.GetEnvelope() for g in gaps]
    for area in osm.areas:
        if area.tags.get("landuse") not in FIELD_FENCE_LANDUSE or area.tags.get("fence") == "no" or not area.geom.Intersects(box):
            continue
        min_e, max_e, min_n, max_n = area.geom.GetEnvelope()
        edge = area.geom.Boundary()
        for gap, (g0, g1, g2, g3) in zip(gaps, gap_boxes):
            if g1 < min_e or g0 > max_e or g3 < min_n or g2 > max_n:
                continue
            edge = edge.Difference(gap)
        kind = "roundpole" if _hash(area.id) % 10 < 6 else "wire"
        for n, points in enumerate(_clipped(region, box, edge, 0.5)):
            length = sum(math.dist(a, b) for a, b in zip(points, points[1:]))
            if length >= 8:
                out.append({"id": f"field{area.id}.{n}", "kind": kind, "points": points})
    return out


# Log piles wait by the road for a year or two after felling.
LOG_PILE_YEARS = 3
LOG_PILE_REACH = 250


def log_piles(cuts: list[Clearcut], region: Region, segments: list[tuple]) -> list[dict]:
    """A pile of logs at the roadside nearest each fresh clear-cut, on the side facing it."""
    out = []
    for cut in cuts:
        if cut.age > LOG_PILE_YEARS:
            continue
        centre = cut.geom.Centroid()
        x, z = centre.GetX() - region.west, region.north - centre.GetY()
        hit = _nearest_on_roads(x, z, segments)
        if hit is None or hit[4] > LOG_PILE_REACH:
            continue
        px, pz, heading, road, _ = hit
        # Step off the road towards the clear-cut.
        a = math.radians(heading)
        right = (math.cos(a), math.sin(a))  # heading 0 is -z, so its right hand is +x
        side = 1 if (x - px) * right[0] + (z - pz) * right[1] >= 0 else -1
        off = 5.5
        sx, sz = px + right[0] * side * off, pz + right[1] * side * off
        if not (0 < sx < region.size and 0 < sz < region.size):
            continue
        out.append({"id": f"logs{cut.id}", "kind": "log_pile", "x": round(sx, 1), "z": round(sz, 1), "heading": round(heading, 1), "road": road})
    return out


def build_vectors(
    osm: OsmData,
    region: Region,
    levels: dict[str, float],
    clearcuts: list[Clearcut] | None = None,
    ground: Callable[[float, float], float] | None = None,
) -> dict:
    """`ground(x, z)` gives the height at a point of the area; without it lifts are taken to be
    drawn from the bottom up, as OpenStreetMap asks."""
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

    return {
        "roads": roads,
        "waterways": waterways,
        "lakes": lakes,
        "places": places,
        "destinations": destinations(osm, region, places) + lift_tops(osm, region, places, ground),
        "spawns": _spawns(places, drivable_points, region),
        "buildings": buildings(osm, region),
        "powerLines": power_lines(osm, region, box),
        "lifts": lifts(osm, region, box),
        "fences": fences(osm, region, box),
        "objects": log_piles(clearcuts or [], region, drivable_points),
    }


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


KIND_NAMES = {
    "peak": "Summit",
    "hut": "Hut",
    "shelter": "Shelter",
    "viewpoint": "Viewpoint",
    "lodge": "Lodge",
    "camp": "Camp site",
    "sight": "Sight",
    "lift": "Lift top",
}
COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]


def destinations(osm: OsmData, region: Region, places: list[dict]) -> list[dict]:
    """Summits, huts, shelters, viewpoints and the like inside the area. Those without a name
    are named by what they are and where: "Viewpoint 1.2 km NE of Ottsjö", "Summit 1285 m"."""
    out, seen = [], set()
    for poi in osm.pois:
        if not (region.west <= poi.easting <= region.east and region.south <= poi.northing <= region.north):
            continue
        x, z = round(poi.easting - region.west, 1), round(region.north - poi.northing, 1)
        # The same hut mapped as a point and an outline, or two shelters on one spot.
        key = (poi.kind, round(x / 25), round(z / 25))
        if key in seen:
            continue
        seen.add(key)
        name = poi.name or _unnamed(poi.kind, poi.ele, x, z, places)
        entry = {"id": poi.id, "kind": poi.kind, "name": name, "x": x, "z": z}
        if poi.ele is not None:
            entry["ele"] = round(poi.ele)
        out.append(entry)
    out.sort(key=lambda d: (list(KIND_NAMES).index(d["kind"]), d["name"]))
    return out


# Which lift names a top shared by several: the big ones first.
LIFT_RANK = ("cable_car", "gondola", "mixed_lift", "chair_lift")
# Lift tops closer than this are one place: several lifts ending on the same shoulder.
LIFT_TOP_MERGE = 40.0


def lift_tops(osm: OsmData, region: Region, places: list[dict], ground: Callable[[float, float], float] | None) -> list[dict]:
    """The upper station of every lift inside the area: "Top of VM6:an", or "Lift top at Åre"
    for one with neither name nor number."""
    tops = []
    for lift in osm.lifts:
        for n, part in enumerate(_lines(lift.geom)):
            points = _local(region, part)
            ends = [e for e in (points[0], points[-1]) if 0 <= e[0] <= region.size and 0 <= e[1] <= region.size]
            if len(ends) == 2 and ground is not None:
                top = max(ends, key=lambda e: ground(e[0], e[1]))
            elif ends and ends[-1] is points[-1]:
                # Only one end inside, or no heights: lifts are drawn from the bottom up.
                top = points[-1]
            else:
                continue
            x, z = round(top[0], 1), round(top[1], 1)
            kind = lift.tags["aerialway"]
            rank = LIFT_RANK.index(kind) if kind in LIFT_RANK else len(LIFT_RANK)
            # A lift known only by its number or letter on the piste map: "Top of lift 6".
            label = lift.tags.get("name") or (f"lift {lift.tags['ref']}" if lift.tags.get("ref") else None)
            entry = {"id": lift.id if n == 0 else f"{lift.id}.{n}", "kind": "lift", "name": f"Top of {label}" if label else "", "x": x, "z": z}
            if ground is not None:
                entry["ele"] = round(ground(x, z))
            tops.append((rank, not label, entry))
    out: list[dict] = []
    for _, _, entry in sorted(tops, key=lambda t: (t[0], t[1], t[2]["id"])):
        if any(math.hypot(d["x"] - entry["x"], d["z"] - entry["z"]) < LIFT_TOP_MERGE for d in out):
            continue
        if not entry["name"]:
            entry["name"] = _unnamed("lift", None, entry["x"], entry["z"], places)
        out.append(entry)
    # Two lifts of the same name (each resort has its Barnliften): told apart by height, as the
    # logbook knows places by name.
    counts: dict[str, int] = {}
    for d in out:
        counts[d["name"]] = counts.get(d["name"], 0) + 1
    for d in out:
        if counts[d["name"]] > 1 and "ele" in d:
            d["name"] = f"{d['name']} ({d['ele']} m)"
    out.sort(key=lambda d: d["name"])
    return out


def _unnamed(kind: str, ele: float | None, x: float, z: float, places: list[dict]) -> str:
    what = KIND_NAMES[kind]
    if kind == "peak" and ele is not None:
        return f"{what} {round(ele)} m"
    named = [p for p in places if p["kind"] != "locality"] or places
    if not named:
        return what
    near = min(named, key=lambda p: math.hypot(p["x"] - x, p["z"] - z))
    dx, dz = x - near["x"], z - near["z"]
    distance = math.hypot(dx, dz)
    if distance < 400:
        return f"{what} at {near['name']}"
    # Heading: 0 north (towards -z), 90 east.
    bearing = math.degrees(math.atan2(dx, -dz)) % 360
    return f"{what} {distance / 1000:.1f} km {COMPASS[round(bearing / 45) % 8]} of {near['name']}"
