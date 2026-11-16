"""Builds small regions from synthetic rasters; no network and no real data needed."""

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


@pytest.fixture
def data(tmp_path, monkeypatch):
    monkeypatch.setenv("SPAR_DATA", str(tmp_path))
    write_copernicus(tmp_path)
    return tmp_path


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
    assert len(index["attribution"]) == 2
    check_pyramid(folder, index)
    check_heights(folder, index, tolerance=0.1)


def test_partial_lantmateriet_is_ignored(data):
    write_lantmateriet(data, REGION.west, REGION.south, REGION.west + 1000, REGION.north)
    index = read_index(build_region(REGION, offline=True))
    assert index["heights"]["source"]["name"] == "Copernicus DEM GLO-30"
    assert len(index["attribution"]) == 1


def test_forced_source(data):
    write_lantmateriet(data, REGION.west - 20, REGION.south - 20, REGION.east + 20, REGION.north + 20)
    index = read_index(build_region(REGION, offline=True, source_name="copernicus"))
    assert index["heights"]["levels"][0]["level"] == 2


def test_no_data_is_a_clear_error(tmp_path, monkeypatch):
    monkeypatch.setenv("SPAR_DATA", str(tmp_path))
    with pytest.raises(SystemExit, match="No elevation data"):
        build_region(REGION, offline=True)


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
