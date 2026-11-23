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
    # Not landuse=winter_sports: it outlines a whole ski area, forest between the runs
    # included. The runs themselves are cleared from piste:type (masks.clear_ski_runs).
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

# highway value -> (default surface, default width in metres, meant for motor vehicles).
# Widths are the whole driven surface with its shoulders, as on Swedish roads: two lanes
# and edges on the bigger roads, one car's width plus a bit on forest roads.
HIGHWAYS: dict[str, tuple[str, float, bool]] = {
    "motorway": ("asphalt", 11.0, True),
    "trunk": ("asphalt", 9.0, True),
    "primary": ("asphalt", 8.0, True),
    "secondary": ("asphalt", 7.0, True),
    "tertiary": ("asphalt", 6.5, True),
    "unclassified": ("gravel", 5.0, True),
    "residential": ("gravel", 5.0, True),
    "living_street": ("gravel", 4.5, True),
    "road": ("gravel", 4.5, True),
    "service": ("gravel", 3.5, True),
    "track": ("gravel", 3.2, True),
    "path": ("trail", 1.2, False),
    "footway": ("trail", 1.5, False),
    "bridleway": ("trail", 1.2, False),
    "cycleway": ("trail", 2.5, False),
}
for _kind in ("motorway", "trunk", "primary", "secondary", "tertiary"):
    HIGHWAYS[f"{_kind}_link"] = (HIGHWAYS[_kind][0], HIGHWAYS[_kind][1] - 1.5, True)

# Forest roads by grade: grade 1 is a proper gravel road for timber lorries, grade 5 two ruts.
TRACK_WIDTHS = {"grade1": 4.2, "grade2": 3.6, "grade3": 3.0, "grade4": 2.6, "grade5": 2.4}
LANE_WIDTH = 3.25

# highway value -> metres beside each edge kept clear of trees (ditch, verge, sight clearing).
# Beyond that, as far again, only young trees grow.
VERGES: dict[str, float] = {
    "motorway": 12.0, "trunk": 10.0, "primary": 8.0, "secondary": 6.0, "tertiary": 5.0,
    "unclassified": 3.5, "residential": 2.5, "living_street": 2.0, "road": 3.0,
    "service": 2.0, "track": 1.5, "path": 0.4, "footway": 0.6, "bridleway": 0.6, "cycleway": 1.0,
}
for _kind in ("motorway", "trunk", "primary", "secondary", "tertiary"):
    VERGES[f"{_kind}_link"] = VERGES[_kind]


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
    if kind == "track" and tags.get("tracktype") in TRACK_WIDTHS:
        width = TRACK_WIDTHS[tags["tracktype"]]
    try:
        lanes = int(tags["lanes"])
        if 1 <= lanes <= 8 and drivable:
            width = max(width, lanes * LANE_WIDTH + 1.0)
    except (KeyError, ValueError):
        pass
    try:
        width = min(20.0, max(0.5, float(tags["width"].replace("m", "").replace(",", ".").strip())))
    except (KeyError, ValueError):
        pass
    if tags.get("motor_vehicle") == "no" or tags.get("access") == "no":
        drivable = False
    return surface, width, drivable


# waterway value -> width in metres of the water drawn along the line
WATERWAYS: dict[str, float] = {"stream": 2.0, "river": 8.0, "canal": 5.0, "ditch": 1.0, "drain": 1.0}


# Places worth driving to, by tag: kind -> what marks it. Unnamed sights are left out.
DESTINATIONS: list[tuple[str, str, tuple[str, ...]]] = [
    ("peak", "natural", ("peak",)),
    ("hut", "tourism", ("alpine_hut", "wilderness_hut")),
    ("shelter", "amenity", ("shelter",)),
    ("viewpoint", "tourism", ("viewpoint",)),
    ("lodge", "tourism", ("hotel", "hostel", "chalet", "guest_house")),
    ("camp", "tourism", ("camp_site",)),
    ("sight", "tourism", ("attraction",)),
    ("sight", "natural", ("waterfall",)),
]


def destination_for(tags: dict) -> str | None:
    """The destination kind of a feature, or None when it is not one."""
    for kind, key, values in DESTINATIONS:
        if tags.get(key) in values:
            if kind == "sight" and not tags.get("name"):
                return None
            return kind
    return None
