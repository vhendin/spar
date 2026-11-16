"""Downloads raw data into data/raw. Nothing here is needed while the game runs."""

from __future__ import annotations

import base64
import json
import math
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

from .region import HORIZON_MARGIN, Region, data_dir

GEOFABRIK_SWEDEN = "https://download.geofabrik.de/europe/sweden-latest.osm.pbf"
COPERNICUS_BUCKET = "https://copernicus-dem-30m.s3.amazonaws.com"
LANTMATERIET_STAC = "https://api.lantmateriet.se/stac-hojd/v1"
LANTMATERIET_COLLECTION = "dtm-cog"  # Markhöjdmodell, 1 m grid, 10 x 10 km GeoTIFF tiles
USER_AGENT = "spar-importer"


def download(url: str, dest: Path, *, optional: bool = False, auth: tuple[str, str] | None = None) -> bool:
    """Fetches url to dest unless it is already there. Returns False for a missing optional file."""
    if dest.exists():
        return True
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    print(f"downloading {url}")
    headers = {"User-Agent": USER_AGENT}
    if auth:
        headers["Authorization"] = "Basic " + base64.b64encode(f"{auth[0]}:{auth[1]}".encode()).decode()
    request = urllib.request.Request(url, headers=headers)
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
        if auth and err.code in (401, 403):
            raise SystemExit(
                f"Lantmäteriet refused the download ({err.code}). Check LANTMATERIET_USER and LANTMATERIET_PASSWORD "
                "in .env, and that the Geotorget account has ordered Markhöjdmodell Nedladdning."
            ) from err
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


def lantmateriet_credentials() -> tuple[str, str] | None:
    user, password = os.environ.get("LANTMATERIET_USER"), os.environ.get("LANTMATERIET_PASSWORD")
    return (user, password) if user and password else None


def stac_items(bbox: tuple[float, float, float, float]) -> list[dict]:
    """Every Markhöjdmodell tile the catalogue lists for a geographic box. Needs no login."""
    box = ",".join(f"{v:.6f}" for v in bbox)
    url: str | None = f"{LANTMATERIET_STAC}/search?collections={LANTMATERIET_COLLECTION}&bbox={box}&limit=100"
    items: list[dict] = []
    while url:
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=60) as response:
            page = json.load(response)
        items += page.get("features", [])
        url = next((link["href"] for link in page.get("links", []) if link.get("rel") == "next"), None)
        if not page.get("features"):
            break
    return items


def tiles_touching(items: list[dict], west: float, south: float, east: float, north: float) -> list[tuple[str, str]]:
    """(file name, url) of the tiles whose projected extent overlaps the box; the search itself is only approximate."""
    out = []
    for item in items:
        asset = item.get("assets", {}).get("data")
        if not asset:
            continue
        extent = asset.get("proj:bbox") or item.get("properties", {}).get("proj:bbox")
        if extent and (extent[2] <= west or extent[0] >= east or extent[3] <= south or extent[1] >= north):
            continue
        href = asset["href"]
        out.append((href.rsplit("/", 1)[-1], href))
    return sorted(set(out))


def ensure_lantmateriet(region: Region) -> list[Path]:
    """Downloads the 1 m Markhöjdmodell tiles covering the area. Needs a Geotorget login."""
    auth = lantmateriet_credentials()
    if not auth:
        return []
    pad = 64  # a little beyond the edge, for the apron
    wanted = tiles_touching(
        stac_items(region.wgs84_bbox(pad)), region.west - pad, region.south - pad, region.east + pad, region.north + pad
    )
    folder = data_dir() / "raw" / "lantmateriet"
    paths = []
    for name, url in wanted:
        download(url, folder / name, auth=auth)
        paths.append(folder / name)
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


def find_osm(region: Region, *, offline: bool) -> Path:
    """The OpenStreetMap extract for a region; downloaded and cut unless offline."""
    if not offline:
        return ensure_osm(region)
    folder = data_dir() / "raw" / "osm"
    for name in (f"{region.name}.osm.pbf", f"{region.name}.osm"):
        if (folder / name).exists():
            return folder / name
    raise SystemExit(f"No OpenStreetMap extract for {region.name} in {folder}. Run `fetch` first.")


def fetch(region: Region, *, dem: bool = True, osm: bool = True) -> None:
    if dem:
        tiles = ensure_copernicus(region)
        print(f"elevation: {len(tiles)} Copernicus tile(s) in {data_dir() / 'raw' / 'copernicus'}")
        if lantmateriet_credentials():
            tiles = ensure_lantmateriet(region)
            print(f"elevation: {len(tiles)} Lantmäteriet tile(s) in {data_dir() / 'raw' / 'lantmateriet'}")
        else:
            print("elevation: no Lantmäteriet login in .env, so the 1 m model is skipped (see .env.example)")
    if osm:
        print(f"osm: {ensure_osm(region)}")
