"""Ground classes: ids from defs/ground.json and how OpenStreetMap tags map onto them."""

from __future__ import annotations

import json
from functools import lru_cache

import jsonschema

from .region import defs_dir, load_schema


@lru_cache(maxsize=1)
def ground_classes() -> dict:
    classes = json.loads((defs_dir() / "ground.json").read_text())
    jsonschema.validate(classes, load_schema("ground-classes"))
    return classes


def biome_id(name: str) -> int:
    return next(c["id"] for c in ground_classes()["biomes"] if c["name"] == name)


def surface_id(name: str) -> int:
    return next(c["id"] for c in ground_classes()["surfaces"] if c["name"] == name)


# Land cover polygons. Later entries are drawn over earlier ones where polygons overlap.
BIOME_ORDER = ["heath", "grassland", "scrub", "forest", "farmland", "built_up", "wetland", "sand", "scree", "bare_rock", "water"]

BIOME_TAGS: dict[tuple[str, str], str] = {
    ("landuse", "forest"): "forest",
    ("natural", "wood"): "forest",
    ("natural", "wetland"): "wetland",
    ("natural", "heath"): "heath",
    ("natural", "fell"): "heath",
    ("natural", "tundra"): "heath",
    ("natural", "grassland"): "grassland",
    ("landuse", "meadow"): "grassland",
    ("landuse", "grass"): "grassland",
    ("landuse", "winter_sports"): "grassland",
    ("leisure", "pitch"): "grassland",
    ("leisure", "park"): "grassland",
    ("natural", "scrub"): "scrub",
    ("natural", "bare_rock"): "bare_rock",
    ("natural", "scree"): "scree",
    ("natural", "shingle"): "scree",
    ("natural", "sand"): "sand",
    ("natural", "beach"): "sand",
    ("natural", "water"): "water",
    ("waterway", "riverbank"): "water",
    ("landuse", "reservoir"): "water",
    ("landuse", "farmland"): "farmland",
    ("landuse", "farmyard"): "farmland",
    ("landuse", "orchard"): "farmland",
    ("landuse", "residential"): "built_up",
    ("landuse", "industrial"): "built_up",
    ("landuse", "commercial"): "built_up",
    ("landuse", "retail"): "built_up",
    ("landuse", "quarry"): "bare_rock",
}


def biome_for(tags: dict) -> str | None:
    for key in ("natural", "landuse", "waterway", "leisure"):
        name = BIOME_TAGS.get((key, tags.get(key, "")))
        if name:
            return name
    return None


# Narrow features: streams, paths and roads. Later entries are drawn over earlier ones.
SURFACE_ORDER = ["pool", "stream", "trail", "boardwalk", "dirt", "gravel", "asphalt"]

# highway value -> (default surface, default width in metres, meant for motor vehicles)
HIGHWAYS: dict[str, tuple[str, float, bool]] = {
    "motorway": ("asphalt", 8.0, True),
    "trunk": ("asphalt", 7.5, True),
    "primary": ("asphalt", 7.0, True),
    "secondary": ("asphalt", 6.5, True),
    "tertiary": ("asphalt", 6.0, True),
    "unclassified": ("gravel", 4.5, True),
    "residential": ("gravel", 4.0, True),
    "living_street": ("gravel", 4.0, True),
    "road": ("gravel", 4.0, True),
    "service": ("gravel", 3.0, True),
    "track": ("gravel", 2.8, True),
    "path": ("trail", 1.2, False),
    "footway": ("trail", 1.2, False),
    "bridleway": ("trail", 1.2, False),
    "cycleway": ("trail", 1.5, False),
}
for _kind in ("motorway", "trunk", "primary", "secondary", "tertiary"):
    HIGHWAYS[f"{_kind}_link"] = HIGHWAYS[_kind]

SURFACE_TAGS: dict[str, str] = {
    **dict.fromkeys(["asphalt", "paved", "concrete", "concrete:plates", "concrete:lanes", "paving_stones", "sett", "chipseal"], "asphalt"),
    **dict.fromkeys(["gravel", "fine_gravel", "compacted", "pebblestone", "unpaved"], "gravel"),
    **dict.fromkeys(["dirt", "ground", "earth", "mud", "grass", "sand", "rock"], "dirt"),
    **dict.fromkeys(["wood", "metal"], "boardwalk"),
}


def road_for(tags: dict) -> tuple[str, float, bool] | None:
    """(surface, width, drivable) for a highway way, or None when it is not drawn."""
    kind = tags.get("highway")
    if kind not in HIGHWAYS:
        return None
    # Winter-only routes leave no mark on summer ground.
    if tags.get("snowmobile") == "designated" or tags.get("winter_road") == "yes" or tags.get("ice_road") == "yes":
        return None
    surface, width, drivable = HIGHWAYS[kind]
    tagged = SURFACE_TAGS.get(tags.get("surface", ""))
    if drivable:
        if tagged in ("asphalt", "gravel", "dirt"):
            surface = tagged
        elif kind == "track" and tags.get("tracktype") in ("grade3", "grade4", "grade5"):
            surface = "dirt"
    elif tagged == "boardwalk" or tags.get("bridge") == "boardwalk":
        surface = "boardwalk"
    try:
        width = min(12.0, max(0.5, float(tags["width"].replace("m", "").replace(",", ".").strip())))
    except (KeyError, ValueError):
        pass
    if tags.get("motor_vehicle") == "no" or tags.get("access") == "no":
        drivable = False
    return surface, width, drivable


# waterway value -> width in metres of the water drawn along the line
WATERWAYS: dict[str, float] = {"stream": 2.0, "river": 8.0, "canal": 5.0, "ditch": 1.0, "drain": 1.0}
