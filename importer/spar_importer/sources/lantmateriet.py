"""Lantmäteriet Markhöjdmodell: bare-ground elevation on a 1 m grid.

Needs a manual download. Put the GeoTIFF files anywhere below data/raw/lantmateriet/ and
run the build again; they are picked up automatically and take priority where they cover
the whole area.
"""

from __future__ import annotations

from osgeo import gdal

from ..region import CRS, Region, data_dir
from . import ElevationSource


def find(region: Region, *, offline: bool) -> ElevationSource | None:
    folder = data_dir() / "raw" / "lantmateriet"
    files = sorted(p for p in folder.rglob("*") if p.suffix.lower() in (".tif", ".tiff")) if folder.exists() else []
    if not files:
        return None
    first = gdal.Open(str(files[0]))
    transform = first.GetGeoTransform()
    return ElevationSource(
        name="lantmateriet",
        label="Lantmäteriet Markhöjdmodell",
        resolution=abs(transform[1]),
        kind="terrain",
        attribution="Markhöjdmodell © Lantmäteriet",
        files=tuple(files),
        assume_crs=None if first.GetProjection() else CRS,
    )
