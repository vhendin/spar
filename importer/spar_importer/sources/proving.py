"""Heights for a made-up area: a fine grid over the area and a coarse one for the horizon."""

from __future__ import annotations

from ..proving import source_dir
from ..region import CRS, Region
from . import ElevationSource


def find(region: Region) -> list[ElevationSource]:
    folder = source_dir(region)
    found = []
    for name, resolution in (("area", 1.0), ("horizon", 64.0)):
        path = folder / f"{name}.tif"
        if path.exists():
            found.append(
                ElevationSource(
                    name=f"proving-{name}",
                    label="Proving ground (made up)",
                    resolution=resolution,
                    kind="terrain",
                    attribution="Proving ground: made-up terrain",
                    files=(path,),
                    assume_crs=CRS,
                )
            )
    return found
