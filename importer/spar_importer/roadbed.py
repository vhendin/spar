"""
Road beds: built roads are level across and smooth along, which the elevation model only
roughly shows at 1 m. Under every drivable road the ground is set to the average height of
the road nearby, and a band beside it blends back into the natural ground.
"""

from __future__ import annotations

import numpy as np
from osgeo import gdal

from .masks import rasterize
from .osm import OsmData

# Metres around each point whose road heights are averaged: wide enough to level even a wide
# road across, short enough to keep the shape of hills and not mix most hairpin bends.
REACH = 8.0
# Metres beside the road over which it blends back into the ground.
BLEND = 3.0
# Processed in squares of this many samples, to keep memory modest on large areas.
CHUNK = 1024


def _box(a: np.ndarray, r: int) -> np.ndarray:
    """Sum over a (2r+1)² square around every cell, edges cut off."""
    out = a.astype(np.float64)
    for axis in (0, 1):
        c = np.cumsum(np.pad(out, [(r + 1, r) if i == axis else (0, 0) for i in range(2)]), axis=axis)
        hi = np.take(c, np.arange(2 * r + 1, c.shape[axis]), axis=axis)
        lo = np.take(c, np.arange(0, c.shape[axis] - 2 * r - 1), axis=axis)
        out = hi - lo
    return out


def _distance(core: np.ndarray, spacing: float, limit: float) -> np.ndarray:
    """Metres from every cell to the nearest road cell, up to `limit`."""
    rows, cols = core.shape
    driver = gdal.GetDriverByName("MEM")
    src = driver.Create("", cols, rows, 1, gdal.GDT_Byte)
    src.GetRasterBand(1).WriteArray(core.astype(np.uint8))
    dst = driver.Create("", cols, rows, 1, gdal.GDT_Float32)
    gdal.ComputeProximity(
        src.GetRasterBand(1), dst.GetRasterBand(1), ["VALUES=1", "DISTUNITS=PIXEL", f"MAXDIST={limit / spacing + 1}", f"NODATA={limit / spacing + 1}"]
    )
    return dst.GetRasterBand(1).ReadAsArray() * spacing


def level_roads(grid: np.ndarray, osm: OsmData, *, west: float, north: float, spacing: float) -> int:
    """
    Levels the ground under drivable roads in place. `grid` holds heights with column i at
    easting west + i * spacing and row j at northing north - j * spacing. Returns the cells changed.
    """
    roads = [r for r in osm.roads if r.drivable]
    if not roads:
        return 0
    reach = max(1, int(round(REACH / spacing)))
    pad = reach + int(np.ceil(BLEND / spacing)) + 1
    rows, cols = grid.shape
    changed = 0
    for r0 in range(0, rows, CHUNK):
        for c0 in range(0, cols, CHUNK):
            # A square window with a margin, so averages near the chunk's edge see the road beyond.
            w_r0, w_c0 = max(0, r0 - pad), max(0, c0 - pad)
            side = CHUNK + 2 * pad
            w_west, w_north = west + w_c0 * spacing, north - w_r0 * spacing
            core = rasterize(
                [(r.geom.Buffer(r.width / 2), 1) for r in roads], west=w_west, north=w_north, spacing=spacing, size=side, all_touched=True
            ) > 0
            core = core[: rows - w_r0, : cols - w_c0]
            if not core.any():
                continue
            window = grid[w_r0 : w_r0 + core.shape[0], w_c0 : w_c0 + core.shape[1]]
            weight = _box(core, reach)
            with np.errstate(invalid="ignore", divide="ignore"):
                bed = (_box(np.where(core, window, 0.0), reach) / weight).astype(np.float32)
            distance = _distance(core, spacing, BLEND)
            t = np.clip(distance / BLEND, 0, 1)
            t = t * t * (3 - 2 * t)  # smooth start and end of the blend
            near = (weight > 0) & (distance < BLEND)
            new = np.where(near, bed * (1 - t) + window * t, window)
            # Only this chunk's own cells; the margin belongs to its neighbours.
            i0, j0 = r0 - w_r0, c0 - w_c0
            i1, j1 = min(i0 + CHUNK, new.shape[0]), min(j0 + CHUNK, new.shape[1])
            own = (slice(i0, i1), slice(j0, j1))
            changed += int((new[own] != window[own]).sum())
            grid[r0 : r0 + (i1 - i0), c0 : c0 + (j1 - j0)] = new[own]
    return changed
