"""Command line: `fetch <region>` downloads raw data, `build <region>` writes the game's region files."""

from __future__ import annotations

import argparse

from .region import load_region


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="importer", description="Turns raw map data into Spår region files.")
    sub = parser.add_subparsers(dest="command", required=True)

    p_fetch = sub.add_parser("fetch", help="download raw data for a region into data/raw")
    p_fetch.add_argument("region")
    p_fetch.add_argument("--only", choices=["dem", "osm", "forest"], help="fetch just elevation, OpenStreetMap or clear-cuts")

    p_build = sub.add_parser("build", help="write data/regions/<region> from the raw data")
    p_build.add_argument("region")
    p_build.add_argument("--offline", action="store_true", help="do not download anything that is missing")
    p_build.add_argument("--source", help="force one elevation source instead of the best available")

    args = parser.parse_args(argv)
    region = load_region(args.region)

    if args.command == "fetch" and region.generator:
        print(f"{region.title} is made up; there is nothing to download")
    elif args.command == "fetch":
        from .fetch import fetch

        fetch(region, dem=args.only in (None, "dem"), osm=args.only in (None, "osm"), forest=args.only in (None, "forest"))
    elif args.command == "build":
        from .build_region import build_region

        build_region(region, offline=args.offline, source_name=args.source)
