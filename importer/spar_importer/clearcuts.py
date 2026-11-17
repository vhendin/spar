"""
Clear-cuts from Skogsstyrelsen's open register of performed fellings (Utförd avverkning),
found by comparing satellite images. The service is queried for the area only, so the
download is small; the result is kept in data/raw/skogsstyrelsen/<region>.geojson.
"""

from __future__ import annotations

import datetime as dt
import json
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from osgeo import ogr

from .region import Region, data_dir

SERVICE = "https://geodpags.skogsstyrelsen.se/arcgis/rest/services/Geodataportal/GeodataportalVisaUtfordavverkning/MapServer/1/query"
ATTRIBUTION = "Clear-cuts: Utförd avverkning © Skogsstyrelsen"
PAGE = 1000

# Years since felling at which the ground stops being open clear-cut, and stops being young regrowth.
OPEN_YEARS = 6
REGROWTH_YEARS = 25
# Height of young trees: metres per year after they get going a few years after planting.
GROWTH_PER_YEAR = 0.28
GROWTH_DELAY = 3

ogr.UseExceptions()


@dataclass
class Clearcut:
    id: str
    geom: ogr.Geometry
    #  Years between felling and the date the data was fetched.
    age: float


def clearcut_path(region: Region) -> Path:
    return data_dir() / "raw" / "skogsstyrelsen" / f"{region.name}.geojson"


def fetch_clearcuts(region: Region) -> Path:
    """Queries the fellings touching the area, in SWEREF 99 TM, and stores them with the fetch date."""
    features: list[dict] = []
    offset = 0
    while True:
        query = urllib.parse.urlencode(
            {
                "where": "1=1",
                "geometry": f"{region.west},{region.south},{region.east},{region.north}",
                "geometryType": "esriGeometryEnvelope",
                "inSR": 3006,
                "outSR": 3006,
                "spatialRel": "esriSpatialRelIntersects",
                "outFields": "OBJECTID,Avvdatum,Avverktyp,Arealha",
                "orderByFields": "OBJECTID",
                "resultOffset": offset,
                "resultRecordCount": PAGE,
                "f": "geojson",
            }
        )
        request = urllib.request.Request(f"{SERVICE}?{query}", headers={"User-Agent": "spar-importer"})
        with urllib.request.urlopen(request, timeout=120) as response:
            page = json.load(response)
        if "error" in page:
            raise SystemExit(f"Skogsstyrelsen's service refused the query: {page['error']}")
        batch = page.get("features", [])
        features += batch
        if len(batch) < PAGE:
            break
        offset += PAGE
    path = clearcut_path(region)
    path.parent.mkdir(parents=True, exist_ok=True)
    collection = {"type": "FeatureCollection", "fetched": dt.date.today().isoformat(), "features": features}
    path.write_text(json.dumps(collection, ensure_ascii=False) + "\n")
    return path


def load_clearcuts(path: Path) -> tuple[list[Clearcut], str]:
    """The fellings in a stored query result, with their age at the fetch date, and that date."""
    collection = json.loads(path.read_text())
    fetched = collection.get("fetched") or dt.date.today().isoformat()
    now = dt.date.fromisoformat(fetched)
    cuts = []
    for feature in collection.get("features", []):
        props = feature.get("properties") or {}
        felled = props.get("Avvdatum")
        if not feature.get("geometry") or felled is None:
            continue
        day = dt.datetime.fromtimestamp(felled / 1000, dt.UTC).date()
        geom = ogr.CreateGeometryFromJson(json.dumps(feature["geometry"]))
        if geom is None or geom.IsEmpty():
            continue
        cuts.append(Clearcut(str(props.get("OBJECTID", len(cuts))), geom, max(0.0, (now - day).days / 365.25)))
    return cuts, fetched


def find_clearcuts(region: Region, *, offline: bool) -> tuple[list[Clearcut], str | None]:
    """Clear-cuts for a region: fetched once, then read from data/raw. Empty when unavailable."""
    path = clearcut_path(region)
    if not path.exists() and not offline:
        try:
            fetch_clearcuts(region)
        except (OSError, SystemExit) as err:
            print(f"clear-cuts: Skogsstyrelsen's service is not reachable ({err}); building without them")
    if not path.exists():
        return [], None
    return load_clearcuts(path)
