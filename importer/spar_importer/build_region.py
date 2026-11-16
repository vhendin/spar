"""Builds data/regions/<name>/ from raw data: height pyramid, horizon grid and index.json."""

from __future__ import annotations

import json
import math
import shutil
from pathlib import Path

import jsonschema
import numpy as np
from osgeo import gdal

from .region import (
    APRON,
    CRS,
    FORMAT_VERSION,
    HORIZON_MARGIN,
    HORIZON_SPACING,
    ROOT_LEVEL,
    SAMPLES,
    TILE_SIZE,
    Region,
    data_dir,
    load_schema,
)
from .sources import ElevationSource, available_sources

gdal.UseExceptions()

HEIGHT_PATH = "heights/L{level}/{x}_{y}.bin"
HORIZON_PATH = "horizon.bin"
# Height steps tried in order; the first that fits the elevation range in 16 bits is used.
SCALES = (0.01, 0.02, 0.05, 0.1, 0.2, 0.5)


def warp_to_grid(source: ElevationSource, *, west: float, north: float, spacing: float, width: int, height: int) -> np.ndarray:
    """
    Resamples a source onto a grid of points: column i lies at easting west + i * spacing and
    row j at northing north - j * spacing. Points without data come back as NaN.
    """
    if source.resolution > spacing * 1.5:
        resample = "cubicspline"  # enlarging: smooth, no overshoot
    elif source.resolution < spacing / 1.5:
        resample = "average"  # shrinking: use every source sample
    else:
        resample = "bilinear"
    vrt = gdal.BuildVRT("", [str(f) for f in source.files])
    half = spacing / 2
    result = gdal.Warp(
        "",
        vrt,
        format="MEM",
        srcSRS=source.assume_crs,
        dstSRS=CRS,
        # GDAL thinks in cells; put each grid point at the centre of a cell.
        outputBounds=(west - half, north - (height - 1) * spacing - half, west + (width - 1) * spacing + half, north + half),
        width=width,
        height=height,
        resampleAlg=resample,
        outputType=gdal.GDT_Float32,
        dstNodata=float("nan"),
        warpOptions=["INIT_DEST=NO_DATA"],
        multithread=True,
    )
    return result.GetRasterBand(1).ReadAsArray()


def layered_grid(sources: list[ElevationSource], **grid) -> np.ndarray:
    """Fills a grid from the first source, then from each next one wherever points are still empty."""
    out: np.ndarray | None = None
    for source in sources:
        layer = warp_to_grid(source, **grid)
        out = layer if out is None else np.where(np.isnan(out), layer, out)
        if not np.isnan(out).any():
            break
    assert out is not None
    return out


def coverage(source: ElevationSource, region: Region) -> float:
    """Share of the area this source has data for, checked on a coarse grid."""
    n = region.size // 32 + 1
    grid = warp_to_grid(source, west=region.west, north=region.north, spacing=32, width=n, height=n)
    return float(np.isfinite(grid).mean())


def finest_spacing(resolution: float) -> int:
    """Largest power of two not above a quarter of the source resolution, between 1 and 8 m."""
    spacing = 1
    while spacing * 2 <= resolution / 4 and spacing * 2 <= 1 << ROOT_LEVEL:
        spacing *= 2
    return spacing


def encoding_for(values: np.ndarray) -> dict:
    low, high = float(np.min(values)), float(np.max(values))
    offset = math.floor(low) - 1
    for scale in SCALES:
        if (high - offset) / scale <= 65535:
            return {"type": "uint16-le", "offset": offset, "scale": scale}
    raise SystemExit(f"Elevation range {low:.0f}–{high:.0f} m is too large to store")


def encode(values: np.ndarray, enc: dict) -> np.ndarray:
    return np.rint((values - enc["offset"]) / enc["scale"]).astype("<u2")


def choose_sources(region: Region, *, offline: bool, source_name: str | None) -> tuple[ElevationSource, list[ElevationSource]]:
    """Returns the primary source (finest one covering the whole area) and the fill order."""
    sources = available_sources(region, offline=offline)
    if source_name:
        sources = [s for s in sources if s.name == source_name]
    if not sources:
        raise SystemExit("No elevation data found. Run `fetch` first, or drop files into data/raw/.")
    for i, source in enumerate(sources):
        share = coverage(source, region)
        if share >= 0.999:
            # Fill from the primary first, then from coarser sources where it has gaps.
            return source, sources[i:]
        print(f"{source.label} covers only {share:.0%} of the area; not used")
    raise SystemExit("No elevation source covers the whole area.")


def build_region(region: Region, *, offline: bool = False, source_name: str | None = None) -> Path:
    primary, sources = choose_sources(region, offline=offline, source_name=source_name)
    spacing = finest_spacing(primary.resolution)
    finest_level = spacing.bit_length() - 1
    print(f"elevation from {primary.label} ({primary.resolution:g} m), finest grid {spacing} m")

    # One grid for the whole area at the finest spacing, with a margin wide enough for the
    # apron of the coarsest level. Every level is cut from this grid, so levels and
    # neighbouring files agree exactly where they share points.
    margin = (APRON << ROOT_LEVEL) // spacing
    n = region.size // spacing + 1
    side = n + 2 * margin
    grid = layered_grid(
        sources,
        west=region.west - margin * spacing,
        north=region.north + margin * spacing,
        spacing=spacing,
        width=side,
        height=side,
    )
    if np.isnan(grid).any():
        raise SystemExit("Elevation data has holes inside the area.")
    area = grid[margin : margin + n, margin : margin + n]
    enc = encoding_for(grid)
    packed = encode(grid, enc)

    out = data_dir() / "regions" / f"{region.name}.tmp"
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)

    levels = []
    for level in range(finest_level, ROOT_LEVEL + 1):
        step = (1 << level) // spacing  # fine-grid points per sample at this level
        span = (SAMPLES - 1) << level
        count = region.size // span
        folder = out / f"heights/L{level}"
        folder.mkdir(parents=True)
        for y in range(count):
            for x in range(count):
                r0 = margin + y * (SAMPLES - 1) * step - APRON * step
                c0 = margin + x * (SAMPLES - 1) * step - APRON * step
                stop = (SAMPLES + 2 * APRON - 1) * step + 1
                packed[r0 : r0 + stop : step, c0 : c0 + stop : step].tofile(folder / f"{x}_{y}.bin")
        levels.append({"level": level, "spacing": 1 << level, "span": span, "count": count})
        print(f"  level {level}: {count * count} file(s) at {1 << level} m")

    # Horizon: coarse grid reaching beyond the area. Inside and on the edge of the area it
    # repeats the area's own heights so the two surfaces meet.
    h_n = (region.size + 2 * HORIZON_MARGIN) // HORIZON_SPACING + 1
    horizon = layered_grid(
        sources,
        west=region.west - HORIZON_MARGIN,
        north=region.north + HORIZON_MARGIN,
        spacing=HORIZON_SPACING,
        width=h_n,
        height=h_n,
    )
    a = HORIZON_MARGIN // HORIZON_SPACING
    inner = area[:: HORIZON_SPACING // spacing, :: HORIZON_SPACING // spacing]
    horizon[a : a + inner.shape[0], a : a + inner.shape[1]] = inner
    if np.isnan(horizon).any():
        missing = float(np.isnan(horizon).mean())
        raise SystemExit(f"No elevation data for {missing:.0%} of the horizon. Run `fetch` to get the Copernicus tiles.")
    h_enc = encoding_for(horizon)
    encode(horizon, h_enc).tofile(out / HORIZON_PATH)

    latitude, longitude = region.center_wgs84()
    index = {
        "formatVersion": FORMAT_VERSION,
        "name": region.name,
        "title": region.title,
        "crs": CRS,
        "origin": {"easting": region.west, "northing": region.north},
        "size": region.size,
        "tileSize": TILE_SIZE,
        "center": {"latitude": round(latitude, 6), "longitude": round(longitude, 6)},
        "heights": {
            "path": HEIGHT_PATH,
            "samples": SAMPLES,
            "apron": APRON,
            "levels": levels,
            "encoding": enc,
            "min": round(float(area.min()), 2),
            "max": round(float(area.max()), 2),
            "source": {"name": primary.label, "resolution": primary.resolution, "kind": primary.kind},
        },
        "horizon": {
            "path": HORIZON_PATH,
            "samples": h_n,
            "spacing": HORIZON_SPACING,
            "margin": HORIZON_MARGIN,
            "encoding": h_enc,
        },
        "attribution": list(dict.fromkeys(s.attribution for s in sources)),
    }
    jsonschema.validate(index, load_schema("region-index"))
    (out / "index.json").write_text(json.dumps(index, indent=2, ensure_ascii=False) + "\n")

    final = data_dir() / "regions" / region.name
    shutil.rmtree(final, ignore_errors=True)
    out.rename(final)
    print(f"wrote {final} (elevation {index['heights']['min']}–{index['heights']['max']} m)")
    return final
