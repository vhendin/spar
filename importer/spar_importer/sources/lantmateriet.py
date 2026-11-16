"""Lantmäteriet Markhöjdmodell: bare-ground elevation on a 1 m grid.

Free (CC BY 4.0) but the files need a Geotorget login. With LANTMATERIET_USER and
LANTMATERIET_PASSWORD set, the tiles covering the area are downloaded automatically.
GeoTIFF files placed by hand anywhere below data/raw/lantmateriet/ work too. The model
takes priority over coarser sources when it covers the whole area.
"""

from __future__ import annotations

from osgeo import gdal

from ..fetch import ensure_lantmateriet
from ..region import CRS, Region, data_dir
from . import ElevationSource


def find(region: Region, *, offline: bool) -> ElevationSource | None:
    if not offline:
        ensure_lantmateriet(region)
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
        attribution="Markhöjdmodell © Lantmäteriet, CC BY 4.0",
        files=tuple(files),
        assume_crs=None if first.GetProjection() else CRS,
    )
