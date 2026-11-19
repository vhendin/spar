"""The proving ground's made-up land: stations have the shapes they promise."""

import math

import numpy as np
import pytest

from spar_importer import proving as pg
from spar_importer.osm import load_osm
from spar_importer.region import Region

REGION = Region("proving", "Proving ground", 381000, 7031000, 2048, "proving")


def h(x, z):
    return float(pg.heights(np.array(x, dtype=float), np.array(z, dtype=float), REGION.size))


def test_ramps_climb_at_their_angles():
    for i, angle in enumerate(pg.RAMP_ANGLES):
        zc = pg.RAMP_Z0 + i * pg.RAMP_PITCH
        run = pg.RAMP_HEIGHT / math.tan(math.radians(angle))
        # Measured over the middle of the climb, against the land's own gentle fall.
        a, b = pg.RAMP_FOOT - 0.2 * run, pg.RAMP_FOOT - 0.8 * run
        rise = (h(b, zc) - h(a, zc)) - pg.WEST_FALL * (b - a)
        assert math.degrees(math.atan(rise / (a - b))) == pytest.approx(angle, abs=0.3)


def test_side_slope_tilt_grows_along_the_bank():
    z0, z1 = pg.BANK_FOOT - 3, pg.BANK_FOOT - 11
    tilts = []
    for x in (300.0, 525.0, 760.0):
        tilt = math.degrees(math.atan((h(x, z1) - h(x, z0) - pg.FALL * (z0 - z1)) / (z0 - z1)))
        tilts.append(tilt)
    expected = [10 + 25 * (x - pg.BANK_X[0]) / (pg.BANK_X[1] - pg.BANK_X[0]) for x in (300.0, 525.0, 760.0)]
    assert np.allclose(tilts, expected, atol=0.5)


def test_lake_is_flat_and_below_its_shores():
    x = np.linspace(pg.LAKE[0] + 5, pg.LAKE[2] - 5, 40)
    z = np.linspace(pg.LAKE[1] + 5, pg.LAKE[3] - 5, 40)
    inside = pg.heights(x[None, :], z[:, None], REGION.size)
    assert np.all(inside == pg.LAKE_LEVEL)
    # Every shore stands clear of the water a few metres out, so the lake does not spread.
    for px, pz in ((pg.LAKE[0] - 8, 1800), (pg.LAKE[2] + 30, 1800), (500, pg.LAKE[1] - 8), (500, pg.LAKE[3] + 8)):
        assert h(px, pz) > pg.LAKE_LEVEL + 0.3


def test_fell_track_climbs_steadily():
    track = pg.fell_track()
    worst = 0.0
    for (x0, z0), (x1, z1) in zip(track, track[1:]):
        run = math.hypot(x1 - x0, z1 - z0)
        if run > 0.5:
            worst = max(worst, abs(h(x1, z1) - h(x0, z0)) / run)
    assert worst < 0.16
    top = track[-1]
    assert math.hypot(top[0] - pg.FELL_X, top[1] - pg.FELL_Z) < 25


def test_map_reads_back(tmp_path):
    path = tmp_path / "proving.osm"
    pg.write_osm(path, REGION)
    osm = load_osm(path)
    names = {r.tags.get("name") for r in osm.roads}
    assert {"Asphalt strip", "Gravel strip", "Dirt strip", "Proving road", "Fell track", "Bog track", "Forest track"} <= names
    biomes = {a.biome for a in osm.areas}
    assert {"farmland", "grassland", "heath", "sand", "bare_rock", "scree", "wetland", "water", "forest"} <= biomes
    # The field is one area with the heath, grass, forest and clear-cut stations cut out of it.
    field = [a for a in osm.areas if a.biome == "farmland"]
    assert len(field) == 1 and field[0].geom.GetGeometryRef(0).GetGeometryCount() > 1
    assert len([p for p in osm.places if p.kind == "hamlet"]) == 10
    assert {p.kind for p in osm.pois} == {"peak", "viewpoint"}
