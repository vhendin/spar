"""Elevation sources. Each module offers find(region, offline) returning a source or None."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from ..region import Region


@dataclass(frozen=True)
class ElevationSource:
    name: str  # short id, usable with --source
    label: str  # name written to the region index
    resolution: float  # true ground resolution in metres
    kind: str  # "terrain" (bare ground) or "surface" (tree tops and roofs included)
    attribution: str
    files: tuple[Path, ...]
    assume_crs: str | None = None  # used for files that carry no coordinate system


def available_sources(region: Region, *, offline: bool) -> list[ElevationSource]:
    """Every source with data on disk (or downloadable), finest first."""
    from . import copernicus, lantmateriet, proving

    if region.generator:
        return proving.find(region)
    found = [m.find(region, offline=offline) for m in (lantmateriet, copernicus)]
    return sorted((s for s in found if s is not None), key=lambda s: s.resolution)
