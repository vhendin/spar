"""Builds small regions from synthetic rasters; no network and no real data needed."""

import datetime
import json

import jsonschema
import numpy as np
import pytest
from osgeo import gdal, osr

from spar_importer.build_region import build_region, finest_spacing
from spar_importer.fetch import copernicus_tile_names, ensure_lantmateriet, tiles_touching
from spar_importer.region import HORIZON_MARGIN, Region, load_schema

REGION = Region("test", "Test", 400000, 7010000, 4096)


def ground(e, n):
    """A smooth landscape in SWEREF coordinates, in metres."""
    return 600 + 120 * np.sin(e / 2500.0) + 90 * np.cos(n / 1800.0) + (e - 400000) * 0.01


def write_tif(path, array, transform, epsg):
    path.parent.mkdir(parents=True, exist_ok=True)
    ds = gdal.GetDriverByName("GTiff").Create(str(path), array.shape[1], array.shape[0], 1, gdal.GDT_Float32)
    ds.SetGeoTransform(transform)
    srs = osr.SpatialReference()
    srs.ImportFromEPSG(epsg)
    ds.SetProjection(srs.ExportToWkt())
    ds.GetRasterBand(1).WriteArray(array.astype(np.float32))
    ds.FlushCache()


def write_copernicus(data):
    """One-degree geographic tiles shaped like GLO-30, filled from ground()."""
    wgs, sweref = osr.SpatialReference(), osr.SpatialReference()
    wgs.ImportFromEPSG(4326)
    sweref.ImportFromEPSG(3006)
    wgs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    sweref.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    to_sweref = osr.CoordinateTransformation(wgs, sweref)
    for name in copernicus_tile_names(REGION.wgs84_bbox(HORIZON_MARGIN + 500)):
        lat0, lon0 = int(name.split("_")[4][1:]), int(name.split("_")[6][1:])
        rows, cols = 3600, 1800  # GLO-30 at this latitude: 1" north-south, 2" east-west
        lons = lon0 + (np.arange(cols) + 0.5) / cols
        lats = lat0 + 1 - (np.arange(rows) + 0.5) / rows
        # Thin the exact transform to a coarse lattice and interpolate; plenty for a smooth test surface.
        cl, cr = np.linspace(lon0, lon0 + 1, 41), np.linspace(lat0 + 1, lat0, 41)
        pts = np.array([[to_sweref.TransformPoint(float(lo), float(la))[:2] for lo in cl] for la in cr])
        e = np.array([np.interp(lons, cl, pts[j, :, 0]) for j in range(41)])
        n = np.array([np.interp(lons, cl, pts[j, :, 1]) for j in range(41)])
        row_pos = np.interp(lats[::-1], cr[::-1], np.arange(41)[::-1])[::-1]
        j0 = np.clip(np.floor(row_pos).astype(int), 0, 39)
        t = (row_pos - j0)[:, None]
        e_full = e[j0] * (1 - t) + e[j0 + 1] * t
        n_full = n[j0] * (1 - t) + n[j0 + 1] * t
        write_tif(data / "raw/copernicus" / f"{name}.tif", ground(e_full, n_full), (lon0, 1 / cols, 0, lat0 + 1, 0, -1 / rows), 4326)


def write_lantmateriet(data, west, south, east, north):
    """A 1 m bare-ground raster in SWEREF, cells centred on half metres like the real product."""
    e = west + 0.5 + np.arange(east - west)
    n = north - 0.5 - np.arange(north - south)
    write_tif(data / "raw/lantmateriet/patch.tif", ground(e[None, :], n[:, None]), (west, 1, 0, north, 0, -1), 3006)


# Map features in local metres (x east, z south of the north-west corner).
LAKE = [(1000, 1000), (1400, 1000), (1400, 1400), (1000, 1400)]
FOREST = [(0, 2000), (2000, 2000), (2000, 4096), (0, 4096)]
BOG = [(2500, 500), (3000, 500), (3000, 900), (2500, 900)]
OSM_WAYS = [
    (LAKE + LAKE[:1], {"natural": "water", "water": "lake", "name": "Testsjön"}),
    (FOREST + FOREST[:1], {"landuse": "forest"}),
    (BOG + BOG[:1], {"natural": "wetland", "wetland": "bog"}),
    ([(100, 3000), (2000, 3000), (3900, 3000)], {"highway": "unclassified", "surface": "asphalt", "name": "Testvägen"}),
    ([(2000, 100), (2000, 3900)], {"highway": "track", "tracktype": "grade4"}),
    ([(300, 300), (900, 900)], {"highway": "path"}),
    ([(300, 900), (900, 300)], {"highway": "path", "snowmobile": "designated"}),
    ([(3000, 100), (3500, 2000)], {"waterway": "stream"}),
    ([(2200, 2950), (2210, 2950), (2210, 2956), (2200, 2956), (2200, 2950)], {"building": "house", "building:levels": "2"}),
    ([(100, 2500), (400, 2500), (700, 2520)], {"power": "minor_line", "voltage": "20000"}),
    ([(1800, 3100), (2300, 3100), (2300, 3400), (1800, 3400), (1800, 3100)], {"landuse": "farmland"}),
]
FELLED = {"fresh": ((1700, 2700, 1900, 2900), "2025-06-01"), "young": ((800, 2300, 1000, 2500), "2012-06-01")}


def write_clearcuts(data, region=REGION):
    """A stored Skogsstyrelsen query: one felling last year, one fourteen years ago."""
    features = []
    for n, ((x0, z0, x1, z1), day) in enumerate(FELLED.values(), start=1):
        ring = [[region.west + x, region.north - z] for x, z in ((x0, z0), (x1, z0), (x1, z1), (x0, z1), (x0, z0))]
        felled = int(datetime.datetime.fromisoformat(day).replace(tzinfo=datetime.UTC).timestamp() * 1000)
        features.append({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [ring]}, "properties": {"OBJECTID": n, "Avvdatum": felled}})
    path = data / "raw/skogsstyrelsen" / f"{region.name}.geojson"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"type": "FeatureCollection", "fetched": "2026-11-17", "features": features}))


def write_osm(data, region=REGION):
    """A hand-made OpenStreetMap file with one of each kind of feature the importer reads."""
    sweref, wgs = osr.SpatialReference(), osr.SpatialReference()
    sweref.ImportFromEPSG(3006)
    wgs.ImportFromEPSG(4326)
    sweref.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    wgs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    to_geo = osr.CoordinateTransformation(sweref, wgs)
    nodes, ways, ids = [], [], {}

    def node(x, z, tags=None):
        if (x, z) not in ids or tags:
            lon, lat, _ = to_geo.TransformPoint(region.west + x, region.north - z)
            ids[(x, z)] = len(nodes) + 1
            inner = "".join(f'<tag k="{k}" v="{v}"/>' for k, v in (tags or {}).items())
            nodes.append(f'<node id="{len(nodes) + 1}" version="1" lat="{lat:.7f}" lon="{lon:.7f}">{inner}</node>')
        return ids[(x, z)]

    for points, tags in OSM_WAYS:
        refs = "".join(f'<nd ref="{node(x, z)}"/>' for x, z in points)
        inner = "".join(f'<tag k="{k}" v="{v}"/>' for k, v in tags.items())
        ways.append(f'<way id="{len(ways) + 1}" version="1">{refs}{inner}</way>')
    node(2100, 2900, {"place": "hamlet", "name": "Testby"})
    node(3300, 600, {"natural": "peak", "name": "Testtoppen", "ele": "912"})
    node(3600, 3400, {"natural": "peak", "ele": "870 m"})
    node(2100, 1500, {"tourism": "viewpoint"})
    node(2150, 2950, {"amenity": "shelter"})
    node(900, 900, {"tourism": "attraction"})  # unnamed sight: left out
    path = data / "raw/osm" / f"{region.name}.osm"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('<?xml version="1.0" encoding="UTF-8"?><osm version="0.6">' + "".join(nodes) + "".join(ways) + "</osm>")


@pytest.fixture
def data(tmp_path, monkeypatch):
    monkeypatch.setenv("SPAR_DATA", str(tmp_path))
    write_copernicus(tmp_path)
    write_osm(tmp_path)
    write_clearcuts(tmp_path)
    return tmp_path


def read_mask(folder, index, level, x, y):
    m = index["masks"]
    raw = np.fromfile(folder / m["path"].format(level=level, x=x, y=y), dtype=np.uint8)
    planes = raw.reshape(len(m["channels"]), m["samples"], m["samples"])
    return {c["name"]: planes[i] for i, c in enumerate(m["channels"])}


def mask_at(folder, index, level, x, z):
    """Channel values at a local position, as {name: byte}."""
    lv = next(v for v in index["masks"]["levels"] if v["level"] == level)
    fx, fz = int(x // lv["span"]), int(z // lv["span"])
    planes = read_mask(folder, index, level, fx, fz)
    i, j = round((x - fx * lv["span"]) / lv["spacing"]), round((z - fz * lv["span"]) / lv["spacing"])
    return {name: int(plane[j, i]) for name, plane in planes.items()}


def class_id(index, kind, name):
    return next(c["id"] for c in index["masks"][kind] if c["name"] == name)


def read_index(folder):
    index = json.loads((folder / "index.json").read_text())
    jsonschema.validate(index, load_schema("region-index"))
    return index


def read_file(folder, index, level, x, y):
    h = index["heights"]
    side = h["samples"] + 2 * h["apron"]
    raw = np.fromfile(folder / h["path"].format(level=level, x=x, y=y), dtype="<u2")
    assert raw.size == side * side
    return raw.reshape(side, side)


def metres(raw, enc):
    return enc["offset"] + raw.astype(np.float64) * enc["scale"]


def check_pyramid(folder, index):
    """Shared edges, aprons and levels must agree bit for bit."""
    h = index["heights"]
    a, s = h["apron"], h["samples"]
    for lv in h["levels"]:
        level, count = lv["level"], lv["count"]
        assert lv["span"] * count == index["size"]
        for y in range(count):
            for x in range(count):
                f = read_file(folder, index, level, x, y)
                if x + 1 < count:
                    right = read_file(folder, index, level, x + 1, y)
                    assert np.array_equal(f[:, a + s - 1], right[:, a]), "east edge"
                    assert np.array_equal(f[:, a + s], right[:, a + 1]), "east apron"
                if y + 1 < count:
                    below = read_file(folder, index, level, x, y + 1)
                    assert np.array_equal(f[a + s - 1, :], below[a, :]), "south edge"
                    assert np.array_equal(f[a + s], below[a + 1]), "south apron"
    # A coarser file is every second sample of the four finer files below it.
    for fine, coarse in zip(h["levels"], h["levels"][1:]):
        c = read_file(folder, index, coarse["level"], 0, 0)[a : a + s, a : a + s]
        f00 = read_file(folder, index, fine["level"], 0, 0)[a : a + s, a : a + s]
        f11 = read_file(folder, index, fine["level"], 1, 1)[a : a + s, a : a + s]
        half = (s - 1) // 2
        assert np.array_equal(c[: half + 1, : half + 1], f00[::2, ::2])
        assert np.array_equal(c[half:, half:], f11[::2, ::2])


def check_heights(folder, index, tolerance):
    h = index["heights"]
    a, s = h["apron"], h["samples"]
    for lv in h["levels"]:
        x = y = lv["count"] - 1
        got = metres(read_file(folder, index, lv["level"], x, y)[a : a + s, a : a + s], h["encoding"])
        e = REGION.west + x * lv["span"] + np.arange(s) * lv["spacing"]
        n = REGION.north - y * lv["span"] - np.arange(s) * lv["spacing"]
        assert np.abs(got - ground(e[None, :], n[:, None])).max() < tolerance


def test_copernicus_only(data):
    folder = build_region(REGION, offline=True)
    index = read_index(folder)
    assert [lv["level"] for lv in index["heights"]["levels"]] == [2, 3]
    assert index["heights"]["source"]["kind"] == "surface"
    assert index["origin"] == {"easting": REGION.west, "northing": REGION.north}
    assert 62 < index["center"]["latitude"] < 64 and 12 < index["center"]["longitude"] < 14
    check_pyramid(folder, index)
    check_heights(folder, index, tolerance=1.0)
    assert index["heights"]["min"] < index["heights"]["max"]


def test_horizon_meets_area(data):
    folder = build_region(REGION, offline=True)
    index = read_index(folder)
    hz = index["horizon"]
    grid = np.fromfile(folder / hz["path"], dtype="<u2").reshape(hz["samples"], hz["samples"])
    assert (hz["samples"] - 1) * hz["spacing"] == index["size"] + 2 * hz["margin"]
    h = index["heights"]
    a = h["apron"]
    root = h["levels"][-1]
    tile = metres(read_file(folder, index, root["level"], 0, 0)[a:, a:], h["encoding"])
    step = hz["spacing"] // root["spacing"]
    k = hz["margin"] // hz["spacing"]
    corner = metres(grid[k : k + 5, k : k + 5], hz["encoding"])
    assert np.abs(corner - tile[: 5 * step : step, : 5 * step : step]).max() <= hz["encoding"]["scale"] + h["encoding"]["scale"]
    # Far corner of the horizon still follows the landscape.
    far = metres(grid[0, 0], hz["encoding"])
    assert abs(far - ground(REGION.west - hz["margin"], REGION.north + hz["margin"])) < 5


def test_lantmateriet_takes_over_when_it_covers_the_area(data):
    write_lantmateriet(data, REGION.west - 20, REGION.south - 20, REGION.east + 20, REGION.north + 20)
    folder = build_region(REGION, offline=True)
    index = read_index(folder)
    assert [lv["level"] for lv in index["heights"]["levels"]] == [0, 1, 2, 3]
    assert index["heights"]["source"] == {"name": "Lantmäteriet Markhöjdmodell", "resolution": 1.0, "kind": "terrain"}
    assert len(index["attribution"]) == 4  # Lantmäteriet, Copernicus, OpenStreetMap, Skogsstyrelsen
    check_pyramid(folder, index)
    check_heights(folder, index, tolerance=0.1)


def test_partial_lantmateriet_is_ignored(data):
    write_lantmateriet(data, REGION.west, REGION.south, REGION.west + 1000, REGION.north)
    index = read_index(build_region(REGION, offline=True))
    assert index["heights"]["source"]["name"] == "Copernicus DEM GLO-30"
    assert len(index["attribution"]) == 3  # Copernicus, OpenStreetMap, Skogsstyrelsen


def test_forced_source(data):
    write_lantmateriet(data, REGION.west - 20, REGION.south - 20, REGION.east + 20, REGION.north + 20)
    index = read_index(build_region(REGION, offline=True, source_name="copernicus"))
    assert index["heights"]["levels"][0]["level"] == 2


def test_no_data_is_a_clear_error(tmp_path, monkeypatch):
    monkeypatch.setenv("SPAR_DATA", str(tmp_path))
    with pytest.raises(SystemExit, match="No elevation data"):
        build_region(REGION, offline=True)


def test_missing_osm_is_a_clear_error(tmp_path, monkeypatch):
    monkeypatch.setenv("SPAR_DATA", str(tmp_path))
    write_copernicus(tmp_path)
    with pytest.raises(SystemExit, match="No OpenStreetMap extract"):
        build_region(REGION, offline=True)


def test_masks_follow_the_map(data):
    folder = build_region(REGION, offline=True)
    index = read_index(folder)
    assert index["formatVersion"] == 4
    assert [lv["level"] for lv in index["masks"]["levels"]] == [1, 2, 3]
    assert [c["name"] for c in index["masks"]["channels"]] == ["biome", "surface", "road", "wetness", "canopy", "slope"]
    biome = lambda name: class_id(index, "biomes", name)  # noqa: E731
    surface = lambda name: class_id(index, "surfaces", name)  # noqa: E731

    for level in (1, 2, 3):
        assert mask_at(folder, index, level, 1200, 1200)["biome"] == biome("water"), level
        assert mask_at(folder, index, level, 800, 3500)["biome"] == biome("forest"), level
        assert mask_at(folder, index, level, 2752, 704)["biome"] == biome("wetland"), level
        # Roads stay unbroken at every level, even though they are narrower than a coarse sample.
        assert mask_at(folder, index, level, 1000, 3000)["surface"] == surface("asphalt"), level
        assert mask_at(folder, index, level, 2000, 1504)["surface"] == surface("dirt"), level
        assert mask_at(folder, index, level, 3000, 2000)["surface"] == surface("none"), level
        assert mask_at(folder, index, level, 1000, 3000)["road"] == 255, level
        assert mask_at(folder, index, level, 3000, 2000)["road"] == 0, level

    # Coverage falls off across the road's edge instead of stepping: the road is 4.5 m wide.
    across = [mask_at(folder, index, 1, 1000, 3000 + dz)["road"] for dz in (0, 2, 4, 6)]
    assert across[0] == 255 and across[-1] == 0 and 0 < across[1] < 255, across
    assert across == sorted(across, reverse=True)

    fine = mask_at(folder, index, 1, 600, 600)
    assert fine["surface"] == surface("trail")
    assert mask_at(folder, index, 3, 600, 600)["surface"] == surface("none")  # footpaths fade out at distance
    assert mask_at(folder, index, 1, 400, 800)["surface"] == surface("none")  # winter-only route is not drawn
    stream = mask_at(folder, index, 1, 3250, 1050)
    assert stream["surface"] == surface("stream") and stream["wetness"] == 255
    assert mask_at(folder, index, 3, 3252, 1052)["surface"] == surface("stream")  # streams stay visible far away

    lake, forest, bog = (mask_at(folder, index, 1, *p) for p in ((1200, 1200), (800, 3500), (2752, 704)))
    assert lake["wetness"] == 255 and lake["canopy"] == 0
    assert bog["wetness"] >= 178 and bog["canopy"] == 0
    assert 12 <= forest["canopy"] <= 120  # 3 to 30 m in quarter metres
    # Unmapped ground was given a land cover, never left unknown.
    assert mask_at(folder, index, 1, 3500, 3500)["biome"] in (biome("forest"), biome("heath"))
    # Slope matches the synthetic landscape.
    e, n, d = REGION.west + 3000.0, REGION.north - 2000.0, 1.0
    rise = np.hypot((ground(e + d, n) - ground(e - d, n)) / 2, (ground(e, n + d) - ground(e, n - d)) / 2)
    assert abs(mask_at(folder, index, 1, 3000, 2000)["slope"] * 90 / 255 - np.degrees(np.arctan(rise))) < 1.0

    hb = index["horizon"]["biome"]
    grid = np.fromfile(folder / hb["path"], dtype=np.uint8).reshape(hb["samples"], hb["samples"])
    k = index["horizon"]["margin"] // hb["spacing"]
    assert grid[k + 1200 // hb["spacing"], k + 1200 // hb["spacing"]] == biome("water")
    assert 0 not in grid
    assert any("OpenStreetMap" in a for a in index["attribution"])
    assert any("Skogsstyrelsen" in a for a in index["attribution"])

    # Clear-cuts from the register: open ground last year's, a young stand the older one's.
    fresh, young = mask_at(folder, index, 1, 1800, 2800), mask_at(folder, index, 1, 900, 2400)
    assert fresh["biome"] == biome("clearcut") and fresh["canopy"] == 0
    assert young["biome"] == biome("regrowth")
    assert 1.5 <= young["canopy"] * 0.25 <= 5.0  # about 14 years of growth
    # The power line runs through a cleared strip in the forest.
    assert mask_at(folder, index, 1, 250, 2500)["canopy"] * 0.25 <= 1.25
    assert mask_at(folder, index, 1, 250, 2540)["canopy"] * 0.25 > 3


def test_vectors(data):
    folder = build_region(REGION, offline=True)
    index = read_index(folder)
    vectors = json.loads((folder / index["vectors"]["path"]).read_text())
    jsonschema.validate(vectors, load_schema("region-vectors"))

    road = next(r for r in vectors["roads"] if r.get("name") == "Testvägen")
    assert road["surface"] == "asphalt" and road["drivable"] and road["points"][0] == [100.0, 3000.0]
    assert {r["kind"] for r in vectors["roads"]} == {"unclassified", "track", "path"}
    assert sum(r["kind"] == "path" for r in vectors["roads"]) == 1
    assert not next(r for r in vectors["roads"] if r["kind"] == "path")["drivable"]
    assert [w["kind"] for w in vectors["waterways"]] == ["stream"]

    (lake,) = vectors["lakes"]
    assert lake["name"] == "Testsjön"
    centre = ground(REGION.west + 1200.0, REGION.north - 1200.0)
    assert abs(lake["level"] - centre) < 15
    assert vectors["places"] == [{"name": "Testby", "kind": "hamlet", "x": 2100.0, "z": 2900.0}]

    names = {d["name"]: d for d in vectors["destinations"]}
    assert set(names) == {"Testtoppen", "Summit 870 m", "Viewpoint 1.4 km N of Testby", "Shelter at Testby"}, names
    assert names["Testtoppen"]["kind"] == "peak" and names["Testtoppen"]["ele"] == 912
    assert names["Testtoppen"]["x"] == 3300.0 and names["Testtoppen"]["z"] == 600.0
    assert [d["kind"] for d in vectors["destinations"]] == ["peak", "peak", "shelter", "viewpoint"]

    (house,) = vectors["buildings"]
    assert house["kind"] == "house" and house["levels"] == 2 and len(house["outline"]) == 4
    (line,) = vectors["powerLines"]
    assert line["kind"] == "minor_line" and line["voltage"] == 20 and line["points"] == [[100.0, 2500.0], [400.0, 2500.0], [700.0, 2520.0]]
    # The field gets a fence all round, with a gap where the track crosses it.
    fences = [f for f in vectors["fences"] if f["id"].startswith("field")]
    assert fences and all(f["kind"] in ("roundpole", "wire") for f in fences)
    xs = [p[0] for f in fences for p in f["points"]]
    assert min(xs) == 1800 and max(xs) == 2300
    crossing = [(a, b) for f in fences for a, b in zip(f["points"], f["points"][1:]) if min(a[0], b[0]) < 2000 < max(a[0], b[0])]
    assert not crossing, crossing
    # Logs wait beside the road nearest the fresh clear-cut, not the old one.
    (pile,) = vectors["objects"]
    assert pile["kind"] == "log_pile" and pile["id"] == "logs1"
    assert abs(pile["z"] - 2994.5) < 1 or abs(pile["x"] - 1994.5) < 1.5, pile

    spawn = vectors["spawns"][0]
    assert spawn["name"] == "Testby" and spawn["road"] == road["id"]
    assert abs(spawn["x"] - 2100) < 1 and abs(spawn["z"] - 3000) < 1
    assert spawn["heading"] in (90.0, 270.0)


def test_bog_pools_fill_hollows_in_mires():
    from spar_importer.ground import biome_id, surface_id
    from spar_importer.masks import bog_pools

    n = 80
    heights = np.full((n, n), 500.0, dtype=np.float32)
    yy, xx = np.mgrid[0:n, 0:n]
    hollow = (xx - 30) ** 2 + (yy - 40) ** 2 < 36
    heights[hollow] -= 0.4
    dry = (xx - 60) ** 2 + (yy - 40) ** 2 < 36
    heights[dry] -= 0.4
    biome = np.full((n, n), biome_id("wetland"), dtype=np.uint8)
    biome[:, 50:] = biome_id("forest")
    surface = np.zeros((n, n), dtype=np.uint8)
    road = np.zeros((n, n), dtype=np.float32)
    bog_pools(biome, surface, road, heights, np.zeros((n, n), dtype=np.float32))
    assert surface[40, 30] == surface_id("pool") and road[40, 30] > 0.5
    # Only in the mire, and not on the level ground around the hollow.
    assert surface[40, 60] == 0 and surface[10, 10] == 0


def test_flow_gathers_in_valleys():
    from spar_importer.masks import flow_accumulation

    # A tilted trough: everything drains to the middle column and out at the bottom row.
    rows, cols = 40, 41
    c = np.arange(cols)[None, :]
    r = np.arange(rows)[:, None]
    h = np.abs(c - 20) * 1.0 + (rows - r) * 0.5
    acc = flow_accumulation(h)
    assert acc.shape == h.shape
    assert acc[rows - 2, 20] > 0.5 * rows * cols  # most of the grid passes the outlet
    assert acc[5, 2] < 20  # a hillside cell collects little
    # A closed hollow does not swallow the flow.
    h2 = h.copy()
    h2[18:22, 18:22] -= 5
    assert flow_accumulation(h2)[rows - 2, 20] > 0.5 * rows * cols


def test_tile_names_and_spacing():
    assert copernicus_tile_names((12.6, 63.05, 13.3, 63.4)) == [
        "Copernicus_DSM_COG_10_N63_00_E012_00_DEM",
        "Copernicus_DSM_COG_10_N63_00_E013_00_DEM",
    ]
    assert copernicus_tile_names((-0.5, -0.5, 0.5, 0.5))[0] == "Copernicus_DSM_COG_10_S01_00_W001_00_DEM"
    assert [finest_spacing(r) for r in (0.5, 1, 2, 10, 30, 90)] == [1, 1, 1, 2, 4, 8]


def test_lantmateriet_tiles_are_chosen_by_projected_extent():
    def item(name, w, s):
        return {"assets": {"data": {"href": f"https://example.invalid/mhm/{name}.tif", "proj:bbox": [w, s, w + 10000, s + 10000]}}}

    items = [item("m700_39", 390000, 7000000), item("m700_40", 400000, 7000000), item("m701_39", 390000, 7010000),
             item("m701_40", 400000, 7010000), item("m702_39", 390000, 7020000), item("m700_41", 410000, 7000000)]
    got = tiles_touching(items, 395360, 7002864, 405600, 7013104)
    assert [name for name, _ in got] == ["m700_39.tif", "m700_40.tif", "m701_39.tif", "m701_40.tif"]
    # An item without a projected extent is kept rather than silently dropped.
    assert tiles_touching([{"assets": {"data": {"href": "https://example.invalid/x.tif"}}}], 0, 0, 1, 1) == [("x.tif", "https://example.invalid/x.tif")]


def test_no_login_means_no_lantmateriet_download(tmp_path, monkeypatch):
    monkeypatch.setenv("SPAR_DATA", str(tmp_path))
    monkeypatch.delenv("LANTMATERIET_USER", raising=False)
    monkeypatch.delenv("LANTMATERIET_PASSWORD", raising=False)
    assert ensure_lantmateriet(REGION) == []


def test_sea_is_large_low_water_only():
    from spar_importer.masks import sea_cells

    heights = np.full((200, 200), 12.0, dtype=np.float32)
    heights[:, :80] = 0.1  # a bay along one side: 80 × 200 cells of 2 m, 6.4 ha
    heights[150:155, 150:155] = 0.2  # a small hollow inland, 100 m²
    sea = sea_cells(heights, 2.0)
    assert sea[:, :80].all()
    assert not sea[:, 80:].any()


def test_roads_get_verges_by_size():
    from osgeo import ogr
    from spar_importer.ground import road_for
    from spar_importer.masks import clear_verges
    from spar_importer.osm import OsmData, Road

    assert road_for({"highway": "primary"})[1] >= 7.5
    assert road_for({"highway": "track", "tracktype": "grade1"})[1] > road_for({"highway": "track", "tracktype": "grade4"})[1]
    assert road_for({"highway": "unclassified", "lanes": "2"})[1] >= 7.5

    def road(kind: str, northing: float) -> Road:
        line = ogr.CreateGeometryFromWkt(f"LINESTRING (0 {northing}, 400 {northing})")
        surface, width, drivable = road_for({"highway": kind})
        return Road(kind, kind, surface, width, drivable, line, {"highway": kind})

    osm = OsmData.__new__(OsmData)
    osm.roads = [road("primary", 300.0), road("path", 100.0)]
    canopy = np.full((201, 201), 20.0, dtype=np.float32)
    clear_verges(osm, canopy, west=0, north=400, spacing=2, size=201)
    row = lambda northing: int((400 - northing) / 2)  # noqa: E731
    assert canopy[row(300 + 4 + 7), 100] == 0  # inside the main road's verge
    assert canopy[row(300 + 4 + 12), 100] <= 4  # young trees only, a bit further out
    assert canopy[row(300 + 40), 100] == 20.0
    assert canopy[row(100 + 3), 100] == 20.0  # a path has trees close by


def test_road_beds_are_level_across_and_blend_out():
    from osgeo import ogr
    from spar_importer.osm import OsmData, Road
    from spar_importer.roadbed import level_roads

    # Ground tilted across an east-west road, plus bumps along it.
    rows = np.arange(100, dtype=np.float32)[:, None]
    grid = np.repeat(rows * 0.2, 100, axis=1)  # 0.2 m per metre, rising southwards
    grid[48:53, ::7] += 0.5
    line = ogr.CreateGeometryFromWkt("LINESTRING (-10 50, 110 50)")  # northing 50 = row 50
    osm = OsmData.__new__(OsmData)
    osm.roads = [Road("r", "primary", "asphalt", 8.0, True, line, {"highway": "primary"})]
    before = grid.copy()
    level_roads(grid, osm, west=0, north=100, spacing=1)
    road = grid[47:54, 10:90]
    assert np.ptp(road[:, 40]) < 0.15  # level across
    assert road.std(axis=1).max() < 0.1  # the bumps are smoothed out along it
    assert np.allclose(grid[:40], before[:40]) and np.allclose(grid[61:], before[61:])  # the ground beyond is untouched
