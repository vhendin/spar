"""Trails to drive, made from the map: stretches of the named hiking routes and the snowmobile
trails, power-line corridors, and ascents up the named summits.

Lines are joined into a network (ways that meet at a node), walked into long paths that turn as
little as they can at each junction, clipped to the area and cut into stretches of 2–8 km at
the huts, shelters and road crossings on the way. An ascent is the shortest line a vehicle can
climb from a road to a summit: no step steeper than ASCENT_STEEPEST, none through water.
"""

from __future__ import annotations

import heapq
import math
from collections.abc import Callable

import numpy as np
from osgeo import ogr

from .osm import OsmData
from .region import Region

# Stretches: cut once longer than this, at a stop on the way if there is one.
SHORTEST, LONGEST = 2000.0, 8000.0
# Without a stop in reach, cut into equal stretches of about this.
EVEN = 6000.0
# A last stretch shorter than SHORTEST joins the one before if that stays within this...
JOINED = 10000.0
# ...and otherwise stays only if it is this long. A line no longer than ALONE is no trail.
LEFTOVER, ALONE = 1000.0, 1500.0
# A hut, shelter, lodge or camp site this close to the line is a place to cut at.
STOP_NEAR = 80.0
STOP_KINDS = ("hut", "shelter", "lodge", "camp")
# An end is named by a place of these kinds this close, else by a village within PLACE_NEAR.
END_KINDS = ("hut", "shelter", "lodge", "camp", "peak", "viewpoint")
END_NEAR, PLACE_NEAR = 200.0, 1500.0
# A stretch lying mostly (SAME_SHARE) this close to a trail already kept is the same trail.
SAME_NEAR, SAME_SHARE = 15.0, 0.7
# Points kept this close to the line.
SIMPLIFY = 3.0
# Ascents: the grid searched, how far round the summit, the steepest step and where to start.
ASCENT_CELL = 15.0
ASCENT_REACH = 5000.0
ASCENT_STEEPEST = 27.0
ASCENT_ROAD = 12.0
ASCENT_SHORTEST = 600.0
# A start must be this far from the summit and this far below it (a road to the top is no ascent).
ASCENT_FROM, ASCENT_BELOW = 500.0, 80.0
# Cells looked at before giving up on a summit.
ASCENT_BUDGET = 400_000

COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
PREFIX = {"snowmobile": "Snowmobile trail", "power": "Power line"}

Point = tuple[float, float]


def _length(points: list[Point]) -> float:
    return sum(math.dist(a, b) for a, b in zip(points, points[1:]))


def _cumulative(points: list[Point]) -> list[float]:
    out = [0.0]
    for a, b in zip(points, points[1:]):
        out.append(out[-1] + math.dist(a, b))
    return out


def _along(points: list[Point], cum: list[float], at: float) -> Point:
    """The point `at` metres along the line."""
    for k in range(1, len(points)):
        if cum[k] >= at:
            span = cum[k] - cum[k - 1]
            t = 0.0 if span == 0 else (at - cum[k - 1]) / span
            a, b = points[k - 1], points[k]
            return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
    return points[-1]


def _slice(points: list[Point], cum: list[float], start: float, end: float) -> list[Point]:
    out = [_along(points, cum, start)]
    out += [p for p, c in zip(points, cum) if start < c < end]
    out.append(_along(points, cum, end))
    return out


def _project(points: list[Point], cum: list[float], x: float, z: float) -> tuple[float, float]:
    """(distance from the line, metres along it) of the nearest point on the line."""
    best = (math.inf, 0.0)
    for k in range(len(points) - 1):
        (ax, az), (bx, bz) = points[k], points[k + 1]
        dx, dz = bx - ax, bz - az
        l2 = dx * dx + dz * dz
        t = 0.0 if l2 == 0 else min(1.0, max(0.0, ((x - ax) * dx + (z - az) * dz) / l2))
        d = math.hypot(ax + dx * t - x, az + dz * t - z)
        if d < best[0]:
            best = (d, cum[k] + t * (cum[k + 1] - cum[k]))
    return best


# --- The network: ways into long paths ------------------------------------------------------


def paths(lines: list[tuple[str, list[Point]]]) -> list[tuple[str, list[Point]]]:
    """Joins lines that meet at their points into long paths: each starts from the longest edge
    not yet taken and goes on at either end along the edge that turns least. Returns (id of the
    first line taken, points)."""
    key = lambda p: (round(p[0], 1), round(p[1], 1))  # noqa: E731
    uses: dict[tuple, int] = {}
    for _, pts in lines:
        for p in {key(p) for p in pts}:
            uses[p] = uses.get(p, 0) + 1
    # Split each line where another meets it, so junctions are ends of edges.
    edges: list[tuple[str, list[Point]]] = []
    for lid, pts in lines:
        piece = [pts[0]]
        for p in pts[1:]:
            piece.append(p)
            if uses[key(p)] > 1 and p is not pts[-1]:
                edges.append((lid, piece))
                piece = [p]
        if len(piece) >= 2:
            edges.append((lid, piece))
    edges = [(lid, pts) for lid, pts in edges if _length(pts) > 0]
    at: dict[tuple, list[int]] = {}
    for n, (_, pts) in enumerate(edges):
        at.setdefault(key(pts[0]), []).append(n)
        at.setdefault(key(pts[-1]), []).append(n)
    lengths = [_length(pts) for _, pts in edges]
    used = [False] * len(edges)

    def heading(a: Point, b: Point) -> float:
        return math.atan2(b[0] - a[0], b[1] - a[1])

    def extend(path: list[Point]) -> None:
        """Goes on from the end of the path while some edge carries on."""
        while True:
            end = path[-1]
            came = heading(path[-2], end)
            best, best_turn, flip = None, math.inf, False
            for n in at.get(key(end), []):
                if used[n]:
                    continue
                pts = edges[n][1]
                rev = key(pts[0]) != key(end)
                nxt = pts[-2] if rev else pts[1]
                turn = abs((heading(end, nxt) - came + math.pi) % (2 * math.pi) - math.pi)
                if turn < best_turn:
                    best, best_turn, flip = n, turn, rev
            if best is None:
                return
            used[best] = True
            pts = edges[best][1]
            path.extend((pts[::-1] if flip else pts)[1:])

    out = []
    for n in sorted(range(len(edges)), key=lambda n: (-lengths[n], edges[n][0])):
        if used[n]:
            continue
        used[n] = True
        path = list(edges[n][1])
        extend(path)
        path.reverse()
        extend(path)
        path.reverse()
        out.append((edges[n][0], path))
    return out


# --- Cutting into stretches -----------------------------------------------------------------


def cut(length: float, stops: list[float], shortest: float = SHORTEST, longest: float = LONGEST) -> list[tuple[float, float]]:
    """Where to cut a line `length` long into stretches: at the stops (metres along) where it
    can, else evenly. Returns (start, end) of each stretch."""
    if length < ALONE:
        return []
    out: list[tuple[float, float]] = []
    start = 0.0
    while length - start > longest:
        within = [s for s in stops if start + shortest < s <= start + longest and length - s >= LEFTOVER]
        if within:
            # The stop nearest the middle of the allowed span.
            at = min(within, key=lambda s: abs(s - (start + (shortest + longest) / 2)))
        else:
            n = math.ceil((length - start) / EVEN)
            at = start + (length - start) / n
        out.append((start, at))
        start = at
    rest = length - start
    if rest >= shortest or not out:
        out.append((start, length))
    elif out[-1][1] - out[-1][0] + rest <= JOINED:
        out[-1] = (out[-1][0], length)
    elif rest >= LEFTOVER:
        out.append((start, length))
    return out


class _Near:
    """The kept trails' segments in a grid, for telling whether a new one lies along them."""

    def __init__(self, cell: float = 50.0):
        self.cell = cell
        self.grid: dict[tuple[int, int], list[tuple[Point, Point]]] = {}

    def add(self, points: list[Point]) -> None:
        for a, b in zip(points, points[1:]):
            cells = set()
            steps = max(1, math.ceil(math.dist(a, b) / self.cell))
            for s in range(steps + 1):
                x = a[0] + (b[0] - a[0]) * s / steps
                z = a[1] + (b[1] - a[1]) * s / steps
                cells.add((math.floor(x / self.cell), math.floor(z / self.cell)))
            for c in cells:
                self.grid.setdefault(c, []).append((a, b))

    def close(self, x: float, z: float, reach: float) -> bool:
        cx, cz = math.floor(x / self.cell), math.floor(z / self.cell)
        for i in (-1, 0, 1):
            for j in (-1, 0, 1):
                for (ax, az), (bx, bz) in self.grid.get((cx + i, cz + j), ()):
                    dx, dz = bx - ax, bz - az
                    l2 = dx * dx + dz * dz
                    t = 0.0 if l2 == 0 else min(1.0, max(0.0, ((x - ax) * dx + (z - az) * dz) / l2))
                    if math.hypot(ax + dx * t - x, az + dz * t - z) <= reach:
                        return True
        return False

    def share(self, points: list[Point], reach: float = SAME_NEAR, step: float = 20.0) -> float:
        """How much of the line lies within `reach` of what is kept, 0 to 1."""
        cum = _cumulative(points)
        n = max(1, int(cum[-1] / step))
        near = sum(self.close(*_along(points, cum, cum[-1] * k / n), reach) for k in range(n + 1))
        return near / (n + 1)


# --- Naming ---------------------------------------------------------------------------------


def _end_name(x: float, z: float, places: list[dict], destinations: list[dict]) -> tuple[str, bool]:
    """A name for one end of a trail, and whether it is a name rather than a compass bearing."""
    stops = [d for d in destinations if d["kind"] in END_KINDS and math.hypot(d["x"] - x, d["z"] - z) <= END_NEAR]
    if stops:
        return min(stops, key=lambda d: math.hypot(d["x"] - x, d["z"] - z))["name"], True
    named = [p for p in places if p["kind"] != "locality"] or places
    if not named:
        return "", False
    near = min(named, key=lambda p: math.hypot(p["x"] - x, p["z"] - z))
    dx, dz = x - near["x"], z - near["z"]
    distance = math.hypot(dx, dz)
    if distance <= PLACE_NEAR:
        return near["name"], True
    bearing = math.degrees(math.atan2(dx, -dz)) % 360
    return f"{distance / 1000:.1f} km {COMPASS[round(bearing / 45) % 8]} of {near['name']}", False


def _name(kind: str, route: str | None, points: list[Point], whole: bool, number: int, places: list[dict], destinations: list[dict]) -> str:
    """A trail's name from its route (for hiking) and what lies at its ends. `number` counts the
    route's stretches with no name at either end, for "Platåleden, stretch 2"."""
    a, a_named = _end_name(*points[0], places, destinations)
    b, b_named = _end_name(*points[-1], places, destinations)
    if kind == "hiking":
        if whole:
            return route or "Hiking route"
        if a_named and b_named and a != b:
            return f"{route}: {a} – {b}"
        if a_named or b_named:
            return f"{route} by {a if a_named else b}"
        return f"{route}, stretch {number}"
    prefix = PREFIX[kind]
    if not a or not b:
        return prefix
    if a == b:
        return f"{prefix} at {a}" if a_named else f"{prefix} {a}"
    return f"{prefix}: {a} – {b}"


# --- Lines: clipping, stops, stretches ------------------------------------------------------


def _local_parts(region: Region, box: ogr.Geometry, points: list[Point]) -> list[list[Point]]:
    """A line in the area's own coordinates (SWEREF) clipped to the area, in local metres."""
    line = ogr.Geometry(ogr.wkbLineString)
    for x, y in points:
        line.AddPoint_2D(x, y)
    clipped = line.Intersection(box)
    out = []
    for part in _lines(clipped):
        pts = [(part.GetX(i) - region.west, region.north - part.GetY(i)) for i in range(part.GetPointCount())]
        if len(pts) >= 2:
            out.append(pts)
    return out


def _lines(geom: ogr.Geometry | None) -> list[ogr.Geometry]:
    if geom is None or geom.IsEmpty():
        return []
    kind = ogr.GT_Flatten(geom.GetGeometryType())
    if kind == ogr.wkbLineString:
        return [geom]
    if kind in (ogr.wkbMultiLineString, ogr.wkbGeometryCollection):
        return [line for i in range(geom.GetGeometryCount()) for line in _lines(geom.GetGeometryRef(i))]
    return []


def _crossings(points: list[Point], cum: list[float], roads: "_Roads") -> list[float]:
    """Metres along the line where it crosses a drivable road."""
    out = []
    for k in range(len(points) - 1):
        (ax, az), (bx, bz) = points[k], points[k + 1]
        for (cx, cz), (dx, dz) in roads.near_segment(ax, az, bx, bz):
            r = (bx - ax, bz - az)
            s = (dx - cx, dz - cz)
            den = r[0] * s[1] - r[1] * s[0]
            if den == 0:
                continue
            t = ((cx - ax) * s[1] - (cz - az) * s[0]) / den
            u = ((cx - ax) * r[1] - (cz - az) * r[0]) / den
            if 0 <= t <= 1 and 0 <= u <= 1:
                out.append(cum[k] + t * (cum[k + 1] - cum[k]))
    return out


class _Roads:
    """The drivable roads' segments in a grid."""

    def __init__(self, roads: list[dict], cell: float = 100.0):
        self.cell = cell
        self.grid: dict[tuple[int, int], list[tuple[Point, Point]]] = {}
        for r in roads:
            if not r.get("drivable"):
                continue
            p = r["points"]
            for a, b in zip(p, p[1:]):
                a, b = (a[0], a[1]), (b[0], b[1])
                for c in self._cells(*a, *b):
                    self.grid.setdefault(c, []).append((a, b))

    def _cells(self, ax: float, az: float, bx: float, bz: float) -> set[tuple[int, int]]:
        x0, x1 = sorted((ax, bx))
        z0, z1 = sorted((az, bz))
        return {
            (i, j)
            for i in range(math.floor(x0 / self.cell), math.floor(x1 / self.cell) + 1)
            for j in range(math.floor(z0 / self.cell), math.floor(z1 / self.cell) + 1)
        }

    def near_segment(self, ax: float, az: float, bx: float, bz: float) -> set[tuple[Point, Point]]:
        out: set[tuple[Point, Point]] = set()
        for c in self._cells(ax, az, bx, bz):
            out.update(self.grid.get(c, ()))
        return out

    def segments(self):
        seen = set()
        for segs in self.grid.values():
            for s in segs:
                if s not in seen:
                    seen.add(s)
                    yield s


def _simplified(points: list[Point]) -> list[list[float]]:
    line = ogr.Geometry(ogr.wkbLineString)
    for x, z in points:
        line.AddPoint_2D(x, z)
    simple = line.Simplify(SIMPLIFY) or line
    out: list[list[float]] = []
    for i in range(simple.GetPointCount()):
        p = [round(simple.GetX(i), 1), round(simple.GetY(i), 1)]
        if not out or out[-1] != p:
            out.append(p)
    return out


def _stretches(
    kind: str,
    lines: list[tuple[str, list[Point]]],
    region: Region,
    box: ogr.Geometry,
    roads: _Roads,
    places: list[dict],
    destinations: list[dict],
    kept: _Near,
    route: str | None = None,
    stops: list[dict] | None = None,
) -> list[dict]:
    """The trails of one kind (or one route) from its lines, in SWEREF. `destinations` name
    the ends; `stops` (all the destinations, named or not) are where to cut."""
    stops_at = [d for d in (destinations if stops is None else stops) if d["kind"] in STOP_KINDS]
    pieces = []
    for lid, path in paths(lines):
        for part in _local_parts(region, box, path):
            cum = _cumulative(part)
            at = [a for d in stops_at for dist, a in [_project(part, cum, d["x"], d["z"])] if dist <= STOP_NEAR]
            at += _crossings(part, cum, roads)
            for start, end in cut(cum[-1], sorted(at)):
                if end - start < (ALONE if start == 0 and end == cum[-1] else LEFTOVER):
                    continue
                pieces.append((lid, _slice(part, cum, start, end)))
    out = []
    numbers: dict[str, int] = {}
    for lid, pts in pieces:
        if kept.share(pts) > SAME_SHARE:
            continue
        kept.add(pts)
        n = numbers[lid] = numbers.get(lid, 0) + 1
        out.append((lid, n, pts))
    trails = []
    unnamed = 0
    for lid, n, pts in out:
        if kind == "hiking" and len(out) > 1 and not (_end_name(*pts[0], places, destinations)[1] or _end_name(*pts[-1], places, destinations)[1]):
            unnamed += 1
        name = _name(kind, route, pts, len(out) == 1, unnamed, places, destinations)
        trails.append({"id": f"{kind}:{lid}:{n}", "kind": kind, "name": name, "points": _simplified(pts), "length": round(_length(pts))})
    return trails


# --- Ascents --------------------------------------------------------------------------------


def ascent(
    heights: np.ndarray,
    spacing: float,
    water: np.ndarray | None,
    roads: _Roads,
    top: Point,
    cell: float = ASCENT_CELL,
    reach: float = ASCENT_REACH,
    steepest: float = ASCENT_STEEPEST,
) -> list[Point] | None:
    """The shortest line from a drivable road up to `top` (local metres) with no step steeper
    than `steepest` degrees and none through water; from the road to the top, or None."""
    n = int(2 * reach / cell) + 1
    x0, z0 = top[0] - reach, top[1] - reach
    xs = x0 + np.arange(n) * cell
    zs = z0 + np.arange(n) * cell
    last = heights.shape[0] - 1
    ci = np.clip(np.round(xs / spacing).astype(int), 0, heights.shape[1] - 1)
    ri = np.clip(np.round(zs / spacing).astype(int), 0, last)
    h = heights[np.ix_(ri, ci)].astype(np.float64)
    inside = (xs[None, :] >= 0) & (xs[None, :] <= (heights.shape[1] - 1) * spacing) & (zs[:, None] >= 0) & (zs[:, None] <= last * spacing)
    blocked = ~inside
    if water is not None:
        blocked |= water[np.ix_(ri, ci)]
    # Cells on a drivable road.
    road = np.zeros((n, n), dtype=bool)
    for (ax, az), (bx, bz) in roads.segments():
        if max(ax, bx) < x0 - cell or min(ax, bx) > x0 + n * cell or max(az, bz) < z0 - cell or min(az, bz) > z0 + n * cell:
            continue
        steps = max(1, math.ceil(math.dist((ax, az), (bx, bz)) / (cell / 3)))
        t = np.linspace(0, 1, steps + 1)
        px, pz = ax + (bx - ax) * t, az + (bz - az) * t
        ii = np.round((pz - z0) / cell).astype(int)
        jj = np.round((px - x0) / cell).astype(int)
        ok = (ii >= 0) & (ii < n) & (jj >= 0) & (jj < n)
        road[ii[ok], jj[ok]] = True
    grow = max(0, round(ASCENT_ROAD / cell))
    for _ in range(grow):
        road[1:, :] |= road[:-1, :]
        road[:-1, :] |= road[1:, :]
        road[:, 1:] |= road[:, :-1]
        road[:, :-1] |= road[:, 1:]
    centre = n // 2
    top_h = h[centre, centre]
    tan = math.tan(math.radians(steepest))
    hf, blocked_f, road_f = h.ravel(), blocked.ravel(), road.ravel()
    steps8 = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
    moves = [(di * n + dj, cell * math.hypot(di, dj), di, dj) for di, dj in steps8]
    dist = np.full(n * n, np.inf)
    came = np.full(n * n, -1, dtype=np.int64)
    start = centre * n + centre
    dist[start] = 0.0
    queue = [(0.0, start)]
    looked = 0
    found = -1
    from_far = (ASCENT_FROM / cell) ** 2
    while queue:
        d, k = heapq.heappop(queue)
        if d > dist[k]:
            continue
        looked += 1
        if looked > ASCENT_BUDGET:
            break
        i, j = divmod(k, n)
        if road_f[k] and (i - centre) ** 2 + (j - centre) ** 2 >= from_far and top_h - hf[k] >= ASCENT_BELOW:
            found = k
            break
        hk = hf[k]
        for off, run, di, dj in moves:
            ni, nj = i + di, j + dj
            if ni < 0 or nj < 0 or ni >= n or nj >= n:
                continue
            m = k + off
            if blocked_f[m] or abs(hf[m] - hk) > run * tan:
                continue
            nd = d + run
            if nd < dist[m]:
                dist[m] = nd
                came[m] = k
                heapq.heappush(queue, (nd, m))
    if found < 0:
        return None
    path = []
    k = found
    while k >= 0:
        i, j = divmod(int(k), n)
        path.append((x0 + j * cell, z0 + i * cell))
        k = came[k]
    path[-1] = top
    return path


def ascents(
    osm: OsmData,
    region: Region,
    destinations: list[dict],
    roads: _Roads,
    heights: np.ndarray,
    spacing: float,
    water: np.ndarray | None,
    ground: Callable[[float, float], float],
) -> list[dict]:
    """One ascent for each summit with a name of its own."""
    named = {p.id for p in osm.pois if p.kind == "peak" and p.name}
    out = []
    for d in destinations:
        if d["kind"] != "peak" or d["id"] not in named:
            continue
        path = ascent(heights, spacing, water, roads, (d["x"], d["z"]))
        if not path or _length(path) < ASCENT_SHORTEST:
            continue
        points = _simplified(_smooth(path))
        out.append({
            "id": f"ascent:{d['id']}:1",
            "kind": "ascent",
            "name": f"Ascent of {d['name']}",
            "points": points,
            "length": round(_length([(p[0], p[1]) for p in points])),
            "climb": round(ground(*path[-1]) - ground(*path[0])),
        })
    return out


def _smooth(path: list[Point]) -> list[Point]:
    """Rounds the grid's corners off once (Chaikin), keeping the ends."""
    if len(path) < 3:
        return path
    out = [path[0]]
    for a, b in zip(path, path[1:]):
        out.append((0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]))
        out.append((0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]))
    out.append(path[-1])
    return out


# --- All of them ----------------------------------------------------------------------------


def _unique(trails: list[dict]) -> None:
    counts: dict[str, int] = {}
    for t in trails:
        n = counts[t["name"]] = counts.get(t["name"], 0) + 1
        if n > 1:
            t["name"] = f"{t['name']} ({n})"


def _points(geom: ogr.Geometry) -> list[list[Point]]:
    return [[(line.GetX(i), line.GetY(i)) for i in range(line.GetPointCount())] for line in _lines(geom) if line.GetPointCount() >= 2]


def build_trails(
    osm: OsmData,
    region: Region,
    box: ogr.Geometry,
    places: list[dict],
    destinations: list[dict],
    roads: list[dict],
    ground: Callable[[float, float], float] | None = None,
    heights: np.ndarray | None = None,
    spacing: float = 2.0,
    water: np.ndarray | None = None,
) -> list[dict]:
    """Every trail of the area, sorted by kind and name."""
    road_grid = _Roads(roads)
    trails: list[dict] = []
    # Ends are named only by places with names of their own, not "Shelter 1.1 km N of Ottsjö".
    own = {p.id for p in osm.pois if p.name}
    named = [d for d in destinations if d["id"] in own]

    kept = _Near()
    # Routes with the most of their ways mapped first, so a long route keeps its name where a
    # shorter one runs along it.
    routes = sorted(osm.routes, key=lambda r: (-sum(1 for w in r.ways if w in osm.route_ways), r.id))
    for r in routes:
        lines = [(r.id, pts) for w in r.ways if w in osm.route_ways for pts in _points(osm.route_ways[w])]
        if lines:
            trails += _stretches("hiking", lines, region, box, road_grid, places, named, kept, route=r.name, stops=destinations)

    snow = [(f.id, pts) for f in osm.snowmobile for pts in _points(f.geom)]
    trails += _stretches("snowmobile", snow, region, box, road_grid, places, named, _Near(), stops=destinations)

    power = [(f.id, pts) for f in osm.power for pts in _points(f.geom)]
    trails += _stretches("power", power, region, box, road_grid, places, named, _Near(), stops=destinations)

    if heights is not None and ground is not None:
        trails += ascents(osm, region, destinations, road_grid, heights, spacing, water, ground)

    order = ["hiking", "snowmobile", "power", "ascent"]
    trails.sort(key=lambda t: (order.index(t["kind"]), t["name"], t["id"]))
    _unique(trails)
    return trails
