"""Copernicus DEM GLO-30: global, 30 m, free to download without an account.

It is a surface model, so forest canopy and buildings are part of the height. Used as the
fallback for the area itself and always for the distant horizon.
"""

from __future__ import annotations

from ..fetch import copernicus_tile_names, ensure_copernicus
from ..region import HORIZON_MARGIN, Region, data_dir
from . import ElevationSource


def find(region: Region, *, offline: bool) -> ElevationSource | None:
    if offline:
        folder = data_dir() / "raw" / "copernicus"
        names = copernicus_tile_names(region.wgs84_bbox(HORIZON_MARGIN + 500))
        files = [folder / f"{n}.tif" for n in names if (folder / f"{n}.tif").exists()]
    else:
        files = ensure_copernicus(region)
    if not files:
        return None
    return ElevationSource(
        name="copernicus",
        label="Copernicus DEM GLO-30",
        resolution=30.0,
        kind="surface",
        attribution=(
            "Copernicus DEM GLO-30 © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, "
            "provided under COPERNICUS by the European Union and ESA"
        ),
        files=tuple(files),
    )
