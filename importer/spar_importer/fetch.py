"""Downloads raw data into data/raw. Nothing here is needed while the game runs."""

from __future__ import annotations

import math
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

from .region import HORIZON_MARGIN, Region, data_dir

GEOFABRIK_SWEDEN = "https://download.geofabrik.de/europe/sweden-latest.osm.pbf"
COPERNICUS_BUCKET = "https://copernicus-dem-30m.s3.amazonaws.com"
USER_AGENT = "spar-importer"


def download(url: str, dest: Path, *, optional: bool = False) -> bool:
    """Fetches url to dest unless it is already there. Returns False for a missing optional file."""
    if dest.exists():
        return True
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    print(f"downloading {url}")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=60) as response, open(part, "wb") as out:
            total = int(response.headers.get("Content-Length") or 0)
            done, shown = 0, -1
            while chunk := response.read(1 << 20):
                out.write(chunk)
                done += len(chunk)
                tenth = done * 10 // total if total else -1
                if tenth != shown and total > (50 << 20):
                    shown = tenth
                    print(f"  {done >> 20} of {total >> 20} MB")
    except urllib.error.HTTPError as err:
        part.unlink(missing_ok=True)
        if optional and err.code in (403, 404):
            return False
        raise SystemExit(f"Download failed ({err.code}): {url}") from err
    part.rename(dest)
    return True


def copernicus_tile_names(bbox: tuple[float, float, float, float]) -> list[str]:
    """Names of the one-degree GLO-30 tiles touching a (min_lon, min_lat, max_lon, max_lat) box."""
    min_lon, min_lat, max_lon, max_lat = bbox
    names = []
    for lat in range(math.floor(min_lat), math.floor(max_lat) + 1):
        for lon in range(math.floor(min_lon), math.floor(max_lon) + 1):
            ns = f"{'N' if lat >= 0 else 'S'}{abs(lat):02d}"
            ew = f"{'E' if lon >= 0 else 'W'}{abs(lon):03d}"
            names.append(f"Copernicus_DSM_COG_10_{ns}_00_{ew}_00_DEM")
    return names


def ensure_copernicus(region: Region) -> list[Path]:
    """Downloads the GLO-30 tiles covering the area and its horizon. Sea tiles do not exist."""
    folder = data_dir() / "raw" / "copernicus"
    paths = []
    for name in copernicus_tile_names(region.wgs84_bbox(HORIZON_MARGIN + 500)):
        dest = folder / f"{name}.tif"
        if download(f"{COPERNICUS_BUCKET}/{name}/{name}.tif", dest, optional=True):
            paths.append(dest)
    return paths


def ensure_osm(region: Region) -> Path:
    """Downloads the Sweden extract once and cuts out the area with its horizon margin."""
    folder = data_dir() / "raw" / "osm"
    country = folder / "sweden-latest.osm.pbf"
    download(GEOFABRIK_SWEDEN, country)
    extract = folder / f"{region.name}.osm.pbf"
    box = ",".join(f"{v:.6f}" for v in region.wgs84_bbox(HORIZON_MARGIN))
    stamp = folder / f"{region.name}.bbox"
    if extract.exists() and stamp.exists() and stamp.read_text() == box:
        return extract
    print(f"cutting {extract.name} out of {country.name}")
    subprocess.run(
        ["osmium", "extract", "--bbox", box, "--strategy", "smart", "--overwrite", "-o", str(extract), str(country)],
        check=True,
        stdout=sys.stdout,
        stderr=sys.stderr,
    )
    stamp.write_text(box)
    return extract


def fetch(region: Region, *, dem: bool = True, osm: bool = True) -> None:
    if dem:
        tiles = ensure_copernicus(region)
        print(f"elevation: {len(tiles)} Copernicus tile(s) in {data_dir() / 'raw' / 'copernicus'}")
    if osm:
        print(f"osm: {ensure_osm(region)}")
