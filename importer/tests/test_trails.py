"""Trails: reading route relations, joining ways, cutting stretches, ascents."""

import math

import numpy as np
from osgeo import ogr

from spar_importer.osm import OsmData, Route, opl_unescape, read_routes
from spar_importer.region import Region
from spar_importer.trails import ASCENT_STEEPEST, _Near, _Roads, ascent, build_trails, cut, paths

REGION = Region("t", "T", 400000, 7010000, 20000)


def test_opl_unescape():
    assert opl_unescape("Gåsen%20%-%20%Vålåstugorna") == "Gåsen - Vålåstugorna"
    assert opl_unescape("DM%20%2%2c%5k") == "DM 2,5k"
    assert opl_unescape("100%") == "100%"


def test_read_routes_keeps_named_ones_with_their_ways_in_order():
    opl = "\n".join([
        "r1 v3 dV c0 t2020-01-01T00:00:00Z i0 u Troute=hiking,name=Kungsleden%20%(summer) Mw5@,n7@guidepost,w3@,w9@forward",
        "r2 v1 dV c0 t2020-01-01T00:00:00Z i0 u Troute=hiking Mw4@",
        "r3 v1 dV c0 t2020-01-01T00:00:00Z i0 u Troute=foot,ref=E1 Mw8@",
        "w5 v1 dV c0 t2020-01-01T00:00:00Z i0 u Thighway=path Nn1,n2",
    ])
    routes = read_routes(opl)
    assert [(r.id, r.name, r.ways) for r in routes] == [("r1", "Kungsleden (summer)", ["w5", "w3", "w9"]), ("r3", "E1", ["w8"])]


def test_paths_join_ways_drawn_either_way():
    a = ("w1", [(0.0, 0.0), (100.0, 0.0)])
    b = ("w2", [(300.0, 0.0), (200.0, 0.0), (100.0, 0.0)])  # drawn backwards
    c = ("w3", [(300.0, 0.0), (300.0, 100.0)])
    out = paths([a, b, c])
    assert len(out) == 1
    pts = out[0][1]
    assert {pts[0], pts[-1]} == {(0.0, 0.0), (300.0, 100.0)}
    assert len(pts) == 5


def test_paths_go_straight_on_at_a_junction():
    main = ("w1", [(0.0, 0.0), (1000.0, 0.0), (2000.0, 0.0)])
    branch = ("w2", [(1000.0, 0.0), (1000.0, 300.0)])
    out = paths([main, branch])
    longest = max(out, key=lambda p: len(p[1]))[1]
    assert {longest[0], longest[-1]} == {(0.0, 0.0), (2000.0, 0.0)}
    assert len(out) == 2


def test_cut_at_stops_within_two_to_eight_km():
    pieces = cut(15000, [1000, 4800, 9000, 12500])
    assert pieces[0] == (0, 4800)
    for start, end in pieces:
        assert 2000 <= end - start <= 10000
    assert pieces[-1][1] == 15000
    # No stops: equal stretches near 6 km.
    even = cut(18000, [])
    assert len(even) == 3 and all(abs(e - s - 6000) < 1 for s, e in even)
    # Short lines: one stretch, or nothing.
    assert cut(1700, []) == [(0, 1700)]
    assert cut(1200, []) == []


def test_a_short_leftover_joins_the_stretch_before():
    pieces = cut(9500, [7000])
    assert pieces == [(0, 9500)] or all(e - s >= 2000 for s, e in pieces)


def test_near_tells_a_line_along_one_kept():
    kept = _Near()
    kept.add([(0.0, 0.0), (3000.0, 0.0)])
    assert kept.share([(0.0, 5.0), (3000.0, 5.0)]) > 0.9
    assert kept.share([(0.0, 200.0), (3000.0, 200.0)]) == 0


def _line(points):
    g = ogr.Geometry(ogr.wkbLineString)
    for x, z in points:
        g.AddPoint_2D(REGION.west + x, REGION.north - z)
    return g


def test_a_route_sharing_ways_with_another_gives_no_second_trail():
    osm = OsmData()
    osm.route_ways = {"w1": _line([(1000, 1000), (5000, 1000)]), "w2": _line([(5000, 1000), (9000, 1000)])}
    osm.routes = [Route("r1", "Long route", ["w1", "w2"]), Route("r2", "Part of it", ["w1"])]
    box = ogr.CreateGeometryFromWkt(
        f"POLYGON(({REGION.west} {REGION.south},{REGION.east} {REGION.south},{REGION.east} {REGION.north},{REGION.west} {REGION.north},{REGION.west} {REGION.south}))"
    )
    places = [{"name": "Byn", "kind": "village", "x": 1000, "z": 1100}]
    trails = build_trails(osm, REGION, box, places, [], [])
    assert len(trails) == 1
    assert trails[0]["kind"] == "hiking" and trails[0]["name"] == "Long route"
    assert trails[0]["length"] == 8000


def test_ascent_climbs_a_cone_from_the_road_at_its_foot():
    spacing = 2.0
    n = 2001
    x = np.arange(n) * spacing
    xx, zz = np.meshgrid(x, x)
    r = np.hypot(xx - 2000, zz - 2000)
    # A cone 400 m high and 1200 m round: about 18° on its sides, a 40° cliff ring near the top.
    heights = 500 + np.clip(1200 - r, 0, None) * 0.33
    roads = _Roads([{"drivable": True, "points": [[0, 3600], [4000, 3600]]}])
    path = ascent(heights, spacing, None, roads, (2000.0, 2000.0))
    assert path is not None
    assert math.dist(path[-1], (2000.0, 2000.0)) < 1
    assert abs(path[0][1] - 3600) <= 15
    h = lambda p: heights[int(round(p[1] / spacing)), int(round(p[0] / spacing))]  # noqa: E731
    tan = math.tan(math.radians(ASCENT_STEEPEST))
    for a, b in zip(path, path[1:]):
        assert abs(h(b) - h(a)) <= math.dist(a, b) * tan + 1e-6


def test_ascent_goes_round_a_cliff():
    spacing = 2.0
    n = 1501
    x = np.arange(n) * spacing
    xx, zz = np.meshgrid(x, x)
    # A plateau 150 m up with a sheer south face and a gentle ramp up from the north.
    heights = np.where(zz < 1500, 650.0, 500.0)
    ramp = (zz < 1500) & (zz > 600)
    heights = np.where((zz <= 600), 500 + zz / 600 * 150, heights)
    heights = np.where(ramp, 650.0, heights)
    roads = _Roads([{"drivable": True, "points": [[0, 2000], [3000, 2000]]}, {"drivable": True, "points": [[1500, 0], [1500, 10]]}])
    path = ascent(heights, spacing, None, roads, (1500.0, 1400.0))
    assert path is not None
    # Up the northern ramp, not the cliff to the south.
    assert path[0][1] < 100
