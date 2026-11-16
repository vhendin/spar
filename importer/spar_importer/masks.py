"""Ground masks: land cover and road surfaces from OpenStreetMap, slope, wetness and canopy height."""

from __future__ import annotations

import heapq
import math

import numpy as np
from osgeo import gdal, ogr, osr

from .ground import BIOME_ORDER, SURFACE_ORDER, biome_id, surface_id
from .osm import OsmData
from .region import CRS

MASK_LEVELS = (1, 2, 3)  # 2, 4 and 8 m between samples
MASK_SPACING = 2
CHANNELS = [
    {"name": "biome", "kind": "class"},
    {"name": "surface", "kind": "class"},
    {"name": "road", "kind": "value", "scale": 1 / 255, "unit": "fraction"},
    {"name": "wetness", "kind": "value", "scale": 1 / 255, "unit": "fraction"},
    {"name": "canopy", "kind": "value", "scale": 0.25, "unit": "m"},
    {"name": "slope", "kind": "value", "scale": 90 / 255, "unit": "degrees"},
]
DEFAULT_TREELINE = 900.0


def _srs() -> osr.SpatialReference:
    srs = osr.SpatialReference()
    srs.SetFromUserInput(CRS)
    srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    return srs


def rasterize(shapes: list[tuple[ogr.Geometry, int]], *, west: float, north: float, spacing: float, size: int, all_touched: bool = False, dtype=gdal.GDT_Byte) -> np.ndarray:
    """
    Burns (geometry, value) pairs, in order, onto a grid of points: column i lies at easting
    west + i * spacing, row j at northing north - j * spacing. Untouched points stay 0.
    """
    target = gdal.GetDriverByName("MEM").Create("", size, size, 1, dtype)
    target.SetGeoTransform((west - spacing / 2, spacing, 0, north + spacing / 2, 0, -spacing))
    target.SetProjection(_srs().ExportToWkt())
    if shapes:
        store = gdal.GetDriverByName("MEM").Create("", 0, 0, 0, gdal.GDT_Unknown)
        layer = store.CreateLayer("shapes", _srs(), ogr.wkbUnknown)
        layer.CreateField(ogr.FieldDefn("v", ogr.OFTInteger))
        for geom, value in shapes:
            feature = ogr.Feature(layer.GetLayerDefn())
            feature.SetField("v", int(value))
            feature.SetGeometry(geom)
            layer.CreateFeature(feature)
        options = ["ATTRIBUTE=v"] + (["ALL_TOUCHED=TRUE"] if all_touched else [])
        gdal.RasterizeLayer(target, [1], layer, options=options)
    return target.GetRasterBand(1).ReadAsArray()


def biome_shapes(osm: OsmData) -> list[tuple[ogr.Geometry, int]]:
    """Land cover polygons in drawing order: by class, and large before small within a class."""
    rank = {name: i for i, name in enumerate(BIOME_ORDER)}
    areas = sorted(osm.areas, key=lambda a: (rank[a.biome], -a.geom.GetArea()))
    return [(a.geom, biome_id(a.biome)) for a in areas]


def road_shapes(osm: OsmData, min_width: float) -> list[tuple[ogr.Geometry, int]]:
    """Streams, then paths and roads in drawing order, as ribbons at least `min_width` wide."""
    stream = surface_id("stream")
    shapes = [(w.geom.Buffer(max(w.width, min_width) / 2), stream) for w in osm.waterways]
    rank = {name: i for i, name in enumerate(SURFACE_ORDER)}
    roads = sorted(osm.roads, key=lambda r: (rank[r.surface], r.width))
    return shapes + [(r.geom.Buffer(max(r.width, min_width) / 2), surface_id(r.surface)) for r in roads]


def road_planes(osm: OsmData, *, west: float, north: float, size: int) -> tuple[np.ndarray, np.ndarray]:
    """
    Surface class and coverage (0..1) of roads, paths and streams on the 2 m grid. They are
    drawn at 1 m first, so coverage says how much of each sample's surroundings they fill;
    the game turns that into smooth edges instead of 2 m steps.
    """
    fine = rasterize(road_shapes(osm, 2.0), west=west, north=north, spacing=MASK_SPACING / 2, size=2 * (size - 1) + 1)
    p = np.pad((fine > 0).astype(np.uint16), 1, mode="edge")
    rows = p[:-2] + 2 * p[1:-1] + p[2:]
    coverage = ((rows[:, :-2] + 2 * rows[:, 1:-1] + rows[:, 2:])[::2, ::2] / 16).astype(np.float32)
    return _pool_surface(fine, drop_footpaths=False), coverage


def lake_levels(osm: OsmData, heights2: np.ndarray, **grid) -> tuple[list, np.ndarray, dict[str, float]]:
    """
    Standing water from the map: the lake areas, a raster holding each lake's number
    (1-based, 0 elsewhere) and each lake's water level, the median ground height inside it.
    """
    lakes = [a for a in osm.areas if a.biome == "water" and a.tags.get("water") not in ("river", "stream", "canal")]
    labels = rasterize([(a.geom, i + 1) for i, a in enumerate(lakes)], dtype=gdal.GDT_Int32, **grid)
    flat = labels.ravel()
    inside = np.flatnonzero(flat)
    ids, heights = flat[inside].astype(np.int64), heights2.ravel()[inside]
    order = np.lexsort((heights, ids))
    ids, heights = ids[order], heights[order]
    starts = np.flatnonzero(np.r_[True, ids[1:] != ids[:-1]]) if ids.size else np.array([], dtype=int)
    ends = np.r_[starts[1:], ids.size]
    levels = {lakes[int(ids[a]) - 1].id: float(heights[(a + b) // 2]) for a, b in zip(starts, ends)}
    return lakes, labels, levels


def reconcile_lakes(biome: np.ndarray, heights2: np.ndarray, lakes: list, labels: np.ndarray, levels: dict[str, float], *, west: float, north: float, spacing: float) -> None:
    """
    Moves lake shores to where the ground says they are. Mapped outlines are often rough,
    while the elevation model is flat exactly where there is water: ground well above the
    lake's level is taken out of the lake, and ground at its level next to it is added.
    """
    water = biome_id("water")
    size = biome.shape[0]
    pad = 60
    for number, lake in enumerate(lakes, start=1):
        level = levels.get(lake.id)
        if level is None or lake.geom.GetArea() < 10000:
            continue
        min_e, max_e, min_n, max_n = lake.geom.GetEnvelope()
        c0 = max(0, int((min_e - west) / spacing) - pad)
        c1 = min(size, int((max_e - west) / spacing) + pad + 1)
        r0 = max(0, int((north - max_n) / spacing) - pad)
        r1 = min(size, int((north - min_n) / spacing) + pad + 1)
        if c0 >= c1 or r0 >= r1:
            continue
        window = (slice(r0, r1), slice(c0, c1))
        ground, cover = heights2[window], biome[window]
        mapped = labels[window] == number
        dry = mapped & (ground > level + 0.6)
        cover[dry] = 0
        lake_cells = mapped & ~dry
        open_ground = (ground <= level + 0.12) & (cover != water)
        grown = lake_cells.copy()
        for _ in range(pad):
            spread = np.zeros_like(grown)
            spread[1:] |= grown[:-1]
            spread[:-1] |= grown[1:]
            spread[:, 1:] |= grown[:, :-1]
            spread[:, :-1] |= grown[:, 1:]
            new = spread & open_ground & ~grown
            if not new.any():
                break
            grown |= new
        cover[grown] = water


def estimate_treeline(biome: np.ndarray, heights: np.ndarray) -> float:
    """Elevation that 98 % of mapped forest lies below, or a default when little forest is mapped."""
    forest = heights[biome == biome_id("forest")]
    if forest.size < 2000:
        return DEFAULT_TREELINE
    return float(np.percentile(forest[:: max(1, forest.size // 200000)], 98))


def fill_unknown(biome: np.ndarray, heights: np.ndarray, treeline: float) -> None:
    """Unmapped ground becomes forest below the treeline and heath above it."""
    unknown = biome == 0
    biome[unknown & (heights <= treeline)] = biome_id("forest")
    biome[unknown & (heights > treeline)] = biome_id("heath")


def resize_bilinear(a: np.ndarray, rows: int, cols: int) -> np.ndarray:
    y = np.linspace(0, a.shape[0] - 1, rows)
    x = np.linspace(0, a.shape[1] - 1, cols)
    y0 = np.clip(np.floor(y).astype(int), 0, a.shape[0] - 2)
    x0 = np.clip(np.floor(x).astype(int), 0, a.shape[1] - 2)
    ty = (y - y0).astype(np.float32)[:, None]
    tx = (x - x0).astype(np.float32)[None, :]
    upper, lower = a[y0], a[y0 + 1]
    top = upper[:, x0] * (1 - tx) + upper[:, x0 + 1] * tx
    bottom = lower[:, x0] * (1 - tx) + lower[:, x0 + 1] * tx
    return (top * (1 - ty) + bottom * ty).astype(np.float32)


def slope_degrees(heights: np.ndarray, spacing: float) -> np.ndarray:
    d_row, d_col = np.gradient(heights, spacing)
    return np.degrees(np.arctan(np.hypot(d_row, d_col))).astype(np.float32)


def flow_accumulation(heights: np.ndarray) -> np.ndarray:
    """
    Number of cells draining through each cell. Water is routed by flooding the grid from
    its edges inward, lowest cell first, so hollows fill and spill instead of trapping flow.
    """
    rows, cols = heights.shape
    width = cols + 2  # one closed ring around the grid saves bounds checks
    z = np.full((rows + 2, width), np.inf)
    z[1:-1, 1:-1] = heights
    level = z.ravel().tolist()
    closed = bytearray(np.isinf(z).ravel().astype(np.uint8).tobytes())
    receiver = [-1] * len(level)
    heap: list[tuple[float, int]] = []
    for r in range(1, rows + 1):
        for c in (1, cols) if 1 < r < rows else range(1, cols + 1):
            cell = r * width + c
            if not closed[cell]:
                closed[cell] = 1
                heap.append((level[cell], cell))
    heapq.heapify(heap)
    neighbours = (-width - 1, -width, -width + 1, -1, 1, width - 1, width, width + 1)
    order: list[int] = []
    push, pop = heapq.heappush, heapq.heappop
    while heap:
        height, cell = pop(heap)
        order.append(cell)
        for step in neighbours:
            other = cell + step
            if not closed[other]:
                closed[other] = 1
                receiver[other] = cell
                # A cell reached from a higher one sits in a hollow: raise it a hair so it drains.
                if level[other] <= height:
                    level[other] = height + 1e-5
                push(heap, (level[other], other))

    # The flood gives every cell a way out. Where a cell has a lower neighbour on the filled
    # surface, send its water down the steepest one instead, which follows the land better.
    filled = np.array(level).reshape(rows + 2, width)
    inner = filled[1:-1, 1:-1]
    cells = np.arange(filled.size).reshape(filled.shape)[1:-1, 1:-1]
    best_drop = np.zeros(inner.shape)
    steepest = np.full(inner.shape, -1, dtype=np.int64)
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            if dr == 0 and dc == 0:
                continue
            drop = (inner - filled[1 + dr : rows + 1 + dr, 1 + dc : cols + 1 + dc]) / math.hypot(dr, dc)
            better = drop > best_drop
            best_drop[better] = drop[better]
            steepest[better] = (cells + dr * width + dc)[better]
    downhill = steepest >= 0
    targets = np.array(receiver, dtype=np.int64)
    targets[cells[downhill]] = steepest[downhill]
    receiver = targets.tolist()

    count = [1.0] * len(level)
    for cell in reversed(order):
        to = receiver[cell]
        if to >= 0:
            count[to] += count[cell]
    return np.array(count, dtype=np.float32).reshape(rows + 2, width)[1:-1, 1:-1]


def wetness_index(heights2: np.ndarray, slope2: np.ndarray, biome: np.ndarray) -> np.ndarray:
    """
    0..1 wetness on the 2 m grid: the topographic wetness index (how much ground drains
    through a spot against how steeply it drains away), computed at 8 m, eased off on
    slopes, and raised where the map shows wetland or water.
    """
    coarse = heights2[::4, ::4].astype(np.float64)
    cell = MASK_SPACING * 4
    area = flow_accumulation(coarse) * cell  # catchment per metre of contour
    tan_slope = np.maximum(np.tan(np.radians(slope_degrees(coarse.astype(np.float32), cell))), 0.005)
    twi = np.log(area / tan_slope)
    index = _blur(np.clip((twi - 6.0) / 8.0, 0, 1))
    wet = resize_bilinear(index, *heights2.shape)
    wet *= 0.5 + 0.5 * np.clip(1 - slope2 / 8.0, 0, 1)
    wetland = biome == biome_id("wetland")
    wet[wetland] = np.maximum(wet[wetland], 0.7) * 0.3 + 0.7
    wet[biome == biome_id("water")] = 1.0
    return wet


def smooth_noise(rows: int, cols: int, cell: int, seed: int) -> np.ndarray:
    """Repeatable values in 0..1 that vary smoothly over about `cell` samples."""
    rng = np.random.default_rng(seed)
    lattice = rng.random((rows // cell + 2, cols // cell + 2), dtype=np.float32)
    return resize_bilinear(lattice, rows, cols)


def canopy_estimate(biome: np.ndarray, heights: np.ndarray, wetness: np.ndarray, treeline: float) -> np.ndarray:
    """
    Tree height in metres guessed from land cover: forest is tall in the valleys and shrinks
    towards the treeline and on wet ground; scrub is low. A stand-in until measured tree
    heights are imported.
    """
    rows, cols = biome.shape
    stand = smooth_noise(rows, cols, 80, 1)  # about 160 m: one forest stand
    patch = smooth_noise(rows, cols, 12, 2)  # about 24 m: groups of trees
    climb = np.clip((heights - (treeline - 350)) / 350, 0, 1)
    tall = (18 - 13 * climb) * (0.7 + 0.45 * stand + 0.15 * patch) * (1 - 0.5 * wetness)
    canopy = np.zeros((rows, cols), dtype=np.float32)
    forest = biome == biome_id("forest")
    canopy[forest] = tall[forest]
    scrub = biome == biome_id("scrub")
    canopy[scrub] = (1.2 + 1.8 * patch)[scrub]
    return canopy


def _blur(a: np.ndarray) -> np.ndarray:
    """1-2-1 smoothing in both directions, edges repeated."""
    p = np.pad(a.astype(np.float32), 1, mode="edge")
    rows = (p[:-2] + 2 * p[1:-1] + p[2:]) / 4
    return (rows[:, :-2] + 2 * rows[:, 1:-1] + rows[:, 2:]) / 4


def _neighbourhood_count(mask: np.ndarray) -> np.ndarray:
    p = np.pad(mask.astype(np.uint8), 1, mode="edge")
    total = np.zeros(mask.shape, dtype=np.uint8)
    for dr in range(3):
        for dc in range(3):
            total += p[dr : dr + mask.shape[0], dc : dc + mask.shape[1]]
    return total


def _pool_surface(surface: np.ndarray, *, drop_footpaths: bool) -> np.ndarray:
    """Every second sample, each taking the most important surface among itself and its neighbours."""
    rank = np.zeros(256, dtype=np.uint8)
    back = np.zeros(256, dtype=np.uint8)
    for i, name in enumerate(SURFACE_ORDER, start=1):
        if drop_footpaths and name in ("trail", "boardwalk"):
            continue
        rank[surface_id(name)] = i
        back[i] = surface_id(name)
    return back[_pool_max(rank[surface])]


def _pool_max(a: np.ndarray) -> np.ndarray:
    """Every second sample, each the largest value among itself and its neighbours."""
    p = np.pad(a, 1, mode="edge")
    best = np.zeros(a.shape, dtype=a.dtype)
    for dr in range(3):
        for dc in range(3):
            np.maximum(best, p[dr : dr + a.shape[0], dc : dc + a.shape[1]], out=best)
    return best[::2, ::2]


def halve(planes: dict[str, np.ndarray], *, drop_footpaths: bool) -> dict[str, np.ndarray]:
    """
    The next coarser level: every second sample. Quantities are smoothed first; a road
    survives if it touches the kept sample's neighbourhood, so thin roads stay unbroken.
    """
    out = {}
    for name in ("wetness", "canopy", "slope"):
        out[name] = _blur(planes[name])[::2, ::2]
    water = biome_id("water")
    biome = planes["biome"][::2, ::2].copy()
    biome[_neighbourhood_count(planes["biome"] == water)[::2, ::2] >= 4] = water
    out["biome"] = biome

    out["surface"] = _pool_surface(planes["surface"], drop_footpaths=drop_footpaths)
    # Keep coverage whole where the road is kept, so a thin road does not fade with distance.
    out["road"] = np.where(out["surface"] > 0, _pool_max(planes["road"]), 0).astype(np.float32)
    return out


def to_bytes(planes: dict[str, np.ndarray]) -> np.ndarray:
    """Stacks the channels in file order as bytes: shape (channels, rows, cols)."""
    stack = []
    for channel in CHANNELS:
        plane = planes[channel["name"]]
        if channel["kind"] == "value":
            plane = np.clip(np.rint(plane / channel["scale"]), 0, 255)
        stack.append(plane.astype(np.uint8))
    return np.stack(stack)


def build_planes(osm: OsmData, heights2: np.ndarray, *, west: float, north: float) -> tuple[dict[str, np.ndarray], float, dict[str, float]]:
    """All mask channels on the 2 m grid of the area, the treeline elevation and lake levels by id."""
    size = heights2.shape[0]
    grid = dict(west=west, north=north, spacing=MASK_SPACING, size=size)
    biome = rasterize(biome_shapes(osm), **grid)
    lakes, labels, levels = lake_levels(osm, heights2, **grid)
    reconcile_lakes(biome, heights2, lakes, labels, levels, west=west, north=north, spacing=MASK_SPACING)
    del labels
    treeline = estimate_treeline(biome, heights2)
    fill_unknown(biome, heights2, treeline)
    surface, road = road_planes(osm, west=west, north=north, size=size)
    slope = slope_degrees(heights2, MASK_SPACING)
    wetness = wetness_index(heights2, slope, biome)
    wetness[surface == surface_id("stream")] = 1.0
    canopy = canopy_estimate(biome, heights2, wetness, treeline)
    planes = {"biome": biome, "surface": surface, "road": road, "wetness": wetness, "canopy": canopy, "slope": slope}
    return planes, treeline, levels


def horizon_biome(osm: OsmData, heights: np.ndarray, treeline: float, *, west: float, north: float, spacing: int) -> np.ndarray:
    """Land cover for the distant terrain: polygons only, on a coarse grid."""
    size = heights.shape[0]
    biome = rasterize(biome_shapes(osm), west=west, north=north, spacing=spacing, size=size)
    wide = [(w.geom.Buffer(spacing / 2), biome_id("water")) for w in osm.waterways if w.kind == "river"]
    rivers = rasterize(wide, west=west, north=north, spacing=spacing, size=size, all_touched=True)
    biome[rivers > 0] = biome_id("water")
    fill_unknown(biome, heights, treeline)
    return biome


def level_info(level: int, size: int, samples: int) -> dict:
    span = (samples - 1) << level
    return {"level": level, "spacing": 1 << level, "span": span, "count": math.ceil(size / span)}
