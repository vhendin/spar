"""The proving ground: a made-up 2 km area with one station for each thing to try.

Writes raw data as if it had been downloaded (heights as GeoTIFFs, a hand-made OpenStreetMap
file, two clear-cuts) and then builds the region with the normal importer, so everything the
game does with real areas it does here too. Stations, from north to south on the west side of
the gravel road down the middle:

- Ground strips: 30 m wide bands of every kind of ground side by side, 500 m long.
- Slopes: six grass ramps of 10° to 35°, 12 m high.
- Side slope: a bank whose sideways tilt grows from 10° to 35° along its length.
- Obstacles: a twist lane (bumps under alternate wheels), steps, ditches, a boulder field.
- Clear-cuts: young trees to push over, and a fresh cut with stumps and slash.
- Bog: a mire with a muddy track across it and forest beside it to winch from.
- Lake: a gentle beach to wade out from, a stream in, a river out (thin ice in winter).

East of the road, from the forest track south: one of each thing to find (a summer farm, a
spring, the historic places, a cairn and a pass); a waterfall on the stream into the lake and a
ford on the forest track. A little further from the road, places to camp: a shelter, a camp site
and a hut.

East of the road: a fell rising 320 m with a track spiralling to the top (snow deepens with
height), and a forest with a track through it. A cabin, a fence and a power line stand by the
road. The land around is a ring of made-up fells for the horizon.
"""

from __future__ import annotations

import datetime as dt
import json
import math
from pathlib import Path

import numpy as np
from osgeo import gdal, ogr, osr

from .region import CRS, HORIZON_MARGIN, Region, data_dir

gdal.UseExceptions()

BASE = 600.0
# Ground falls this much per metre southwards and westwards, so water drains away.
FALL, WEST_FALL = 0.003, 0.004
ROAD_X = 1050.0
# The base height holds along this easting; west of it the land falls.
FIELD_EAST = 1000.0

# Ground strips: kind, tags of the band. Roads lie on a farmland band of their own.
STRIP_X = (400.0, 900.0)
STRIP_Z0, STRIP_W = 110.0, 30.0
STRIPS: list[tuple[str, dict]] = [
    ("asphalt", {"highway": "service", "surface": "asphalt", "width": "20"}),
    ("gravel", {"highway": "service", "surface": "gravel", "width": "20"}),
    ("dirt", {"highway": "track", "surface": "dirt", "width": "20"}),
    ("grass", {"natural": "grassland"}),
    ("heath", {"natural": "heath"}),
    ("sand", {"natural": "sand"}),
    ("rock", {"natural": "bare_rock"}),
    ("scree", {"natural": "scree"}),
    ("bog", {"natural": "wetland", "wetland": "bog"}),
]

RAMP_ANGLES = (10, 15, 20, 25, 30, 35)
RAMP_Z0, RAMP_PITCH = 490.0, 50.0
RAMP_FOOT, RAMP_HEIGHT, RAMP_TOP, RAMP_HALF = 880.0, 12.0, 20.0, 10.0

BANK_X = (250.0, 800.0)
BANK_FOOT, BANK_FACE, BANK_TOP = 860.0, 14.0, 6.0

TWIST_Z, STEPS_Z, DITCH_Z = 920.0, 956.0, 991.0
LANE_X = (300.0, 600.0)
STEPS = ((320.0, 0.3), (360.0, 0.5), (400.0, 0.8), (440.0, 1.1))
DITCHES = ((330.0, 0.5, 2.0), (380.0, 1.0, 3.0), (430.0, 1.5, 4.0))
BOULDERS = (300.0, 1020.0, 700.0, 1080.0)

YOUNG_CUT = (250.0, 1120.0, 600.0, 1260.0)
FRESH_CUT = (650.0, 1120.0, 980.0, 1260.0)

BOG = (200.0, 1320.0, 720.0, 1580.0)
BOG_FOREST = (720.0, 1320.0, 990.0, 1580.0)
BOG_POOLS = ((330.0, 1390.0, 14.0), (560.0, 1360.0, 9.0), (420.0, 1530.0, 11.0), (640.0, 1500.0, 7.0))
# Field beds: crest height.
BED_HEIGHT = 0.4
# Slopes and obstacles: no beds there.
STILL = (220.0, 465.0, 910.0, 1005.0)

LAKE = (250.0, 1670.0, 850.0, 1930.0)
LAKE_LEVEL = BASE - FALL * LAKE[1] - WEST_FALL * (FIELD_EAST - LAKE[0]) - 1.2

# Things to find by the road: (z, tags).
FINDS: list[tuple[float, dict]] = [
    (1140, {"place": "isolated_dwelling", "name": "Proving fäbod"}),
    (1250, {"natural": "spring"}),
    (1330, {"historic": "boundary_stone"}),
    (1400, {"historic": "memorial", "name": "Proving memorial"}),
    (1480, {"historic": "aircraft_wreck"}),
    (1560, {"historic": "mine"}),
    (1640, {"historic": "ruins"}),
    (1710, {"historic": "tomb"}),
    (1770, {"man_made": "cairn"}),
    (1840, {"mountain_pass": "yes", "name": "Proving pass"}),
]

# Places to spend a night at, a little further from the road than the finds: (z, tags).
CAMPS: list[tuple[float, dict]] = [
    (1200, {"amenity": "shelter", "shelter_type": "lean_to", "name": "Proving shelter"}),
    (1450, {"tourism": "camp_site", "name": "Proving camp site"}),
    (1700, {"tourism": "wilderness_hut", "name": "Proving hut"}),
]

FELL_X, FELL_Z, FELL_R, FELL_H = 1540.0, 540.0, 480.0, 320.0
FOREST = (1150.0, 1100.0, 2000.0, 1990.0)
FIELD = (60.0, 60.0, FIELD_EAST, 1990.0)


def _smooth(t):
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3 - 2 * t)


def _box_distance(x, z, box):
    """Distance outside a rectangle (x0, z0, x1, z1); 0 inside."""
    x0, z0, x1, z1 = box
    dx = np.maximum(np.maximum(x0 - x, x - x1), 0)
    dz = np.maximum(np.maximum(z0 - z, z - z1), 0)
    return np.hypot(dx, dz)


def _inside(x, z, box):
    return (x >= box[0]) & (x <= box[2]) & (z >= box[1]) & (z <= box[3])


def _ramp_profile(x, angle):
    """Height along a ramp: rises westwards from its foot, a flat top, then a gentle 12° down."""
    up = RAMP_HEIGHT / math.tan(math.radians(angle))
    down = RAMP_HEIGHT / math.tan(math.radians(12))
    d = RAMP_FOOT - x
    rise = np.clip(d / up, 0, 1) * RAMP_HEIGHT
    fall = np.clip(1 - (d - up - RAMP_TOP) / down, 0, 1) * RAMP_HEIGHT
    return np.where(d < 0, 0.0, np.minimum(rise, fall))


def _features(x, z):
    """Everything built into the land, in metres above the sloping base."""
    h = np.zeros(np.broadcast(x, z).shape)

    for i, angle in enumerate(RAMP_ANGLES):
        zc = RAMP_Z0 + i * RAMP_PITCH
        across = np.maximum(np.abs(z - zc) - RAMP_HALF, 0)
        h = np.maximum(h, _ramp_profile(x, angle) - across)

    # Side slope: a face rising northwards, its tilt growing from west to east.
    t = np.clip((x - BANK_X[0]) / (BANK_X[1] - BANK_X[0]), 0, 1)
    tilt = np.tan(np.radians(10 + 25 * t))
    top = BANK_FACE * tilt
    face = np.clip((BANK_FOOT - z) * tilt, 0, top)
    back_edge = BANK_FOOT - BANK_FACE - BANK_TOP
    back = np.clip(top - (back_edge - z), 0, top)
    bank = np.where(z >= back_edge, face, back)
    ends = np.minimum(_smooth((x - BANK_X[0] + 20) / 20), np.clip(1 - (x - BANK_X[1]) / (3 * top + 1e-6), 0, 1))
    h = np.maximum(h, bank * ends)

    lane = _smooth((LANE_X[1] + 10 - x) / 10) * _smooth((x - LANE_X[0] + 10) / 10)
    # Twist: bumps under the left wheels where the right ones dip, and the other way round.
    side = np.clip((z - TWIST_Z) / 1.0, -1, 1) * _smooth((6 - np.abs(z - TWIST_Z)) / 2)
    h += 0.45 * np.sin(2 * np.pi * (x - LANE_X[0]) / 10) * side * lane
    across = _smooth((6 - np.abs(z - STEPS_Z)) / 1)
    for x0, rise in STEPS:
        block = _smooth((x - x0) / 1.0) * _smooth((x0 + 7 - x) / 1.0)
        h += rise * block * across
    across = _smooth((6 - np.abs(z - DITCH_Z)) / 1)
    for x0, depth, width in DITCHES:
        u = np.clip(np.abs(x - x0) / (width / 2), 0, 1)
        h -= depth * 0.5 * (1 + np.cos(np.pi * u)) * across

    # Bog: low tussocks, and a few hollows where pools stand.
    bog = _inside(x, z, BOG) * _smooth(np.minimum(np.minimum(x - BOG[0], BOG[2] - x), np.minimum(z - BOG[1], BOG[3] - z)) / 10)
    tussocks = 0.08 * np.sin(x / 1.9) * np.sin(z / 2.3)
    h += bog * tussocks
    for px, pz, radius in BOG_POOLS:
        u = np.clip(np.hypot(x - px, z - pz) / radius, 0, 1)
        h -= 0.8 * 0.5 * (1 + np.cos(np.pi * u))

    # Fields drain through shallow beds: a crest down the middle of each ground strip and every
    # 30 m beyond, the furrows falling west with the land. Without them the flat field reads as soaked.
    # The slopes and obstacles stay exactly flat.
    calm = _smooth(_box_distance(x, z, STILL) / 20)
    field = _inside(x, z, FIELD) * _smooth(np.minimum(np.minimum(x - FIELD[0], FIELD[2] - x), np.minimum(z - FIELD[1], FIELD[3] - z)) / 20)
    beds = BED_HEIGHT * 0.5 * (1 + np.cos(2 * np.pi * (z - STRIP_Z0 - STRIP_W / 2) / STRIP_W))
    away = _smooth(np.minimum(_box_distance(x, z, BOG), _box_distance(x, z, LAKE)) / 15)
    h += field * calm * away * beds

    r = np.hypot(x - FELL_X, z - FELL_Z)
    h += np.where(r < FELL_R, FELL_H * 0.5 * (1 + np.cos(np.pi * r / FELL_R)), 0.0)
    return h


def _ring(x, z, size):
    """Made-up fells around the area, rising a couple of kilometres out."""
    r = np.hypot(x - size / 2, z - size / 2)
    a = np.arctan2(z - size / 2, x - size / 2)
    ridges = 0.55 + 0.25 * np.sin(3 * a + r / 2100) + 0.2 * np.sin(7 * a - r / 900) * np.cos(r / 1500)
    return _smooth((r - 1800) / 5000) * 650 * ridges


def heights(x, z, size: int):
    """Ground height in metres at local x (east) and z (south) of the north-west corner."""
    x, z = np.asarray(x, dtype=np.float64), np.asarray(z, dtype=np.float64)
    reach = (-HORIZON_MARGIN, size + HORIZON_MARGIN)
    base = BASE - FALL * np.clip(z, *reach) - WEST_FALL * (FIELD_EAST - np.clip(x, *reach))
    land = base + _features(x, z) + _ring(x, z, size)
    # The lake: a flat bed at its level, shores rising over 60 m on the beach (east) and 12 m elsewhere.
    d = _box_distance(x, z, LAKE)
    width = np.where(x > LAKE[2], 60.0, 12.0)
    shore = _smooth(d / width)
    return np.where(d <= 0, LAKE_LEVEL, LAKE_LEVEL + (land - LAKE_LEVEL) * shore)


def fell_track(step: float = 4.0, grade: float = 0.12) -> list[tuple[float, float]]:
    """A track spiralling up the fell from its west foot at a steady grade, to near the top."""
    def climb(r):  # |dh/dr| of the fell's cosine shape
        return FELL_H * math.pi / (2 * FELL_R) * math.sin(math.pi * min(r, FELL_R) / FELL_R)

    r, a = FELL_R + 10, math.pi
    points = [(FELL_X + r * math.cos(a), FELL_Z + r * math.sin(a))]
    while r > 18:
        inward = min(1.0, grade / max(climb(r), 1e-6))
        r -= step * inward
        a -= step * math.sqrt(1 - inward * inward) / max(r, 1.0)
        points.append((FELL_X + r * math.cos(a), FELL_Z + r * math.sin(a)))
    return [(round(px, 1), round(pz, 1)) for px, pz in points[:: 2] + points[-1:]]


def _rect(box) -> list[tuple[float, float]]:
    x0, z0, x1, z1 = box
    return [(x0, z0), (x1, z0), (x1, z1), (x0, z1), (x0, z0)]


def _strip_box(i: int):
    z0 = STRIP_Z0 + i * STRIP_W
    return (STRIP_X[0], z0, STRIP_X[1], z0 + STRIP_W)


def map_features() -> tuple[list[tuple[list, dict]], list[tuple[list[list], dict]], list[tuple[float, float, dict]]]:
    """Ways (points, tags), multipolygons (rings, tags) and tagged nodes, in local metres."""
    ways: list[tuple[list, dict]] = []
    nodes: list[tuple[float, float, dict]] = []
    # Ground that would otherwise be filled in as forest, under everything on the west side.
    # Farmland is drawn over heath, grassland and forest, so those stations are cut out of it.
    holes = [YOUNG_CUT, FRESH_CUT, BOG_FOREST] + [_strip_box(i) for i, (_, t) in enumerate(STRIPS) if t.get("natural") in ("grassland", "heath")]

    for i, (kind, tags) in enumerate(STRIPS):
        box = _strip_box(i)
        zc = (box[1] + box[3]) / 2
        if "highway" in tags:
            ways.append(([(STRIP_X[0], zc), (STRIP_X[1], zc)], {**tags, "name": f"{kind.capitalize()} strip"}))
        else:
            ways.append((_rect(box), tags))
    ways.append((_rect(BOULDERS), {"natural": "scree"}))
    ways.append((_rect(YOUNG_CUT), {"landuse": "forest"}))
    ways.append((_rect(FRESH_CUT), {"landuse": "forest"}))
    ways.append((_rect(BOG), {"natural": "wetland", "wetland": "bog"}))
    ways.append((_rect(BOG_FOREST), {"landuse": "forest"}))
    ways.append(([(ROAD_X, 1400), (720, 1430), (450, 1480), (200, 1500)], {"highway": "track", "tracktype": "grade5", "surface": "mud", "name": "Bog track"}))
    ways.append((_rect(LAKE), {"natural": "water", "water": "lake", "name": "Proving lake"}))
    ways.append((_rect((LAKE[2], 1700, LAKE[2] + 50, 1900)), {"natural": "beach"}))
    ways.append(([(500, 1560), (505, 1620), (500, 1670)], {"waterway": "stream"}))
    ways.append(([(250, 1800), (150, 1810), (0, 1825)], {"waterway": "river"}))
    ways.append((_rect(FOREST), {"landuse": "forest"}))
    # Forest up the fell's south side to about 780 m, which sets the treeline there.
    inner = FELL_R / math.pi * math.acos(2 * 180 / FELL_H - 1)
    arc = [math.pi * k / 24 for k in range(25)]
    slope = [(FELL_X + FELL_R * math.cos(a), FELL_Z + FELL_R * math.sin(a)) for a in arc]
    slope += [(FELL_X + inner * math.cos(a), FELL_Z + inner * math.sin(a)) for a in reversed(arc)]
    ways.append(([(round(px, 1), round(pz, 1)) for px, pz in slope + slope[:1]], {"landuse": "forest"}))

    ways.append(([(ROAD_X, 40), (ROAD_X, 2008)], {"highway": "unclassified", "surface": "gravel", "name": "Proving road"}))
    ways.append(([(ROAD_X, 1300), (1900, 1300), (1900, 1900), (ROAD_X, 1900)], {"highway": "track", "tracktype": "grade4", "name": "Forest track"}))
    track = fell_track()
    ways.append((track, {"highway": "track", "tracktype": "grade3", "name": "Fell track"}))
    ways.append(([(ROAD_X + 15, 40), (ROAD_X + 15, 2008)], {"power": "minor_line", "voltage": "20000"}))
    ways.append((_rect((ROAD_X - 50, 170, ROAD_X - 40, 178)), {"building": "cabin"}))
    ways.append(([(ROAD_X - 20, 150), (ROAD_X - 70, 150), (ROAD_X - 70, 200), (ROAD_X - 20, 200)], {"barrier": "fence", "fence_type": "split_rail"}))

    stations = [
        ("Ground strips", 245),
        ("Slopes", 615),
        ("Side slope", 845),
        ("Obstacles", 990),
        ("Clear-cuts", 1190),
        ("Bog", 1450),
        ("Lake", 1800),
    ]
    for name, z in stations:
        nodes.append((ROAD_X - 10, z, {"place": "hamlet", "name": name}))
    nodes.append((1500, 1600, {"place": "hamlet", "name": "Forest"}))
    nodes.append((ROAD_X + 10, track[0][1], {"place": "hamlet", "name": "Fell foot"}))
    nodes.append((FELL_X, FELL_Z, {"place": "hamlet", "name": "Fell top"}))
    nodes.append((FELL_X, FELL_Z, {"natural": "peak", "name": "Proving fell", "ele": str(round(BASE - FALL * FELL_Z + WEST_FALL * (FELL_X - FIELD_EAST) + FELL_H))}))
    for name, x, z in (
        ("End of the strips", STRIP_X[0] - 20, 245),
        ("Top of the 35° ramp", RAMP_FOOT - RAMP_HEIGHT / math.tan(math.radians(35)) - RAMP_TOP / 2, RAMP_Z0 + 5 * RAMP_PITCH),
        ("Far side of the bog", BOG[0] + 20, 1400),
        ("Lake shore", LAKE[2] + 30, 1800),
    ):
        nodes.append((x, z, {"tourism": "viewpoint", "name": name}))
    # Things to find, one of each, in a row east of the road between it and the forest; a
    # waterfall on the stream into the lake, and a ford on the forest track.
    for z, tags in FINDS:
        nodes.append((ROAD_X + 24, z, tags))
    for z, tags in CAMPS:
        nodes.append((ROAD_X + 62, z, tags))
    nodes.append((503, 1610, {"waterway": "waterfall"}))
    nodes.append((1300, 1300, {"ford": "yes"}))

    field = ogr.CreateGeometryFromWkt(_wkt(_rect(FIELD)))
    for box in holes:
        field = field.Difference(ogr.CreateGeometryFromWkt(_wkt(_rect(box))))
    polygons = [field.GetGeometryRef(i) for i in range(field.GetGeometryCount())] if field.GetGeometryType() == ogr.wkbMultiPolygon else [field]
    multis = []
    for poly in polygons:
        rings = [[(round(p[0], 1), round(p[1], 1)) for p in poly.GetGeometryRef(k).GetPoints()] for k in range(poly.GetGeometryCount())]
        multis.append((rings, {"landuse": "farmland", "fence": "no"}))
    return ways, multis, nodes


def _wkt(points) -> str:
    return "POLYGON((" + ",".join(f"{x} {z}" for x, z in points) + "))"


def write_osm(path: Path, region: Region) -> None:
    sweref, wgs = osr.SpatialReference(), osr.SpatialReference()
    sweref.SetFromUserInput(CRS)
    wgs.SetFromUserInput("EPSG:4326")
    sweref.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    wgs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    to_geo = osr.CoordinateTransformation(sweref, wgs)
    nodes, ways, relations, ids = [], [], [], {}

    def tag_xml(tags):
        return "".join(f'<tag k="{k}" v="{v}"/>' for k, v in tags.items())

    def node(x, z, tags=None):
        if (x, z) in ids and not tags:
            return ids[(x, z)]
        lon, lat, _ = to_geo.TransformPoint(region.west + x, region.north - z)
        n = len(nodes) + 1
        nodes.append(f'<node id="{n}" version="1" lat="{lat:.8f}" lon="{lon:.8f}">{tag_xml(tags or {})}</node>')
        if not tags:
            ids[(x, z)] = n
        return n

    def way(points, tags):
        refs = "".join(f'<nd ref="{node(x, z)}"/>' for x, z in points)
        ways.append(f'<way id="{len(ways) + 1}" version="1">{refs}{tag_xml(tags)}</way>')
        return len(ways)

    features, multis, points = map_features()
    for pts, tags in features:
        way(pts, tags)
    for rings, tags in multis:
        members = "".join(f'<member type="way" ref="{way(ring, {})}" role="{"outer" if k == 0 else "inner"}"/>' for k, ring in enumerate(rings))
        relations.append(f'<relation id="{len(relations) + 1}" version="1">{members}{tag_xml({**tags, "type": "multipolygon"})}</relation>')
    for x, z, tags in points:
        node(x, z, tags)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6" generator="spar proving ground">\n' + "\n".join(nodes + ways + relations) + "\n</osm>\n")


def _write_tif(path: Path, region: Region, west: float, north: float, spacing: float, n: int) -> None:
    """Heights on an n×n grid of cells `spacing` wide, the first cell's corner at (west, north)."""
    centres = (np.arange(n) + 0.5) * spacing
    x = (west - region.west) + centres[None, :]
    z = (region.north - north) + centres[:, None]
    path.parent.mkdir(parents=True, exist_ok=True)
    ds = gdal.GetDriverByName("GTiff").Create(str(path), n, n, 1, gdal.GDT_Float32, ["COMPRESS=DEFLATE", "PREDICTOR=3", "TILED=YES"])
    ds.SetGeoTransform((west, spacing, 0, north, 0, -spacing))
    srs = osr.SpatialReference()
    srs.SetFromUserInput(CRS)
    ds.SetProjection(srs.ExportToWkt())
    band = ds.GetRasterBand(1)
    rows = max(1, (1 << 19) // n)  # write in bands of rows to keep memory down
    for r0 in range(0, n, rows):
        band.WriteArray(heights(x, z[r0 : r0 + rows], region.size).astype(np.float32), 0, r0)
    ds.FlushCache()


def source_dir(region: Region) -> Path:
    return data_dir() / "raw" / "proving" / region.name


def prepare(region: Region, today: dt.date | None = None) -> None:
    """Writes the raw files the importer reads for a proving ground region."""
    folder = source_dir(region)
    margin = 64
    _write_tif(folder / "area.tif", region, region.west - margin, region.north + margin, 1.0, region.size + 2 * margin)
    reach = HORIZON_MARGIN + 1024
    _write_tif(folder / "horizon.tif", region, region.west - reach, region.north + reach, 64.0, (region.size + 2 * reach) // 64)
    write_osm(data_dir() / "raw" / "osm" / f"{region.name}.osm", region)

    today = today or dt.date.today()
    cuts = []
    for n, (box, years) in enumerate(((YOUNG_CUT, 12), (FRESH_CUT, 1)), start=1):
        felled = dt.datetime(today.year - years, 6, 1, tzinfo=dt.UTC)
        ring = [[region.west + x, region.north - z] for x, z in _rect(box)]
        cuts.append({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [ring]}, "properties": {"OBJECTID": n, "Avvdatum": int(felled.timestamp() * 1000)}})
    path = data_dir() / "raw" / "skogsstyrelsen" / f"{region.name}.geojson"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"type": "FeatureCollection", "fetched": today.isoformat(), "features": cuts}))
