#!/usr/bin/env python3
"""Generate deterministic weather and tile CSV files for local testing (seeded)."""

from __future__ import annotations

import argparse
import csv
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional, Sequence

import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from scorer import Tile, WeatherSlot, load_config  # noqa: E402


def write_csv(path: Path, fields, rows) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def make_weather(seed: int, n_nights: int, slots_per_night: int, slot_seconds: int):
    rng = random.Random(seed + 1000)
    first_night = datetime(2026, 10, 2, 2, 0, 0, tzinfo=timezone.utc)
    weather = []
    rows = []
    for night in range(n_nights):
        night_start = first_night + timedelta(days=night)
        for slot in range(slots_per_night):
            phase = slot / max(slots_per_night - 1, 1)
            if phase < 0.45:
                sky_base = 1.05
            elif phase < 0.78:
                sky_base = 2.65
            else:
                sky_base = 5.15
            seeing = max(0.65, rng.gauss(1.10, 0.16))
            transparency = min(0.99, max(0.35, rng.gauss(0.86, 0.08)))
            sky = max(0.75, sky_base + rng.uniform(-0.22, 0.28))
            is_observable = not (night == 0 and slot == slots_per_night // 2)
            timestamp = night_start + timedelta(seconds=slot * slot_seconds)
            slot_id = f"N{night + 1:02d}-S{slot + 1:03d}"
            night_id = f"N{night + 1:02d}"
            item = WeatherSlot(
                slot_id=slot_id,
                night_id=night_id,
                timestamp_utc=timestamp,
                duration_seconds=slot_seconds,
                seeing_arcsec=seeing,
                transparency=transparency,
                sky_brightness=sky,
                is_observable=is_observable,
            )
            weather.append(item)
            rows.append(
                {
                    "slot_id": slot_id,
                    "night_id": night_id,
                    "timestamp_utc": timestamp.isoformat().replace("+00:00", "Z"),
                    "duration_seconds": slot_seconds,
                    "seeing_arcsec": f"{seeing:.4f}",
                    "transparency": f"{transparency:.4f}",
                    "sky_brightness": f"{sky:.4f}",
                    "is_observable": str(is_observable).lower(),
                }
            )
    return weather, rows


def make_tiles(seed: int, n_tiles: int):
    rng = random.Random(seed)
    tiles = {}
    rows = []
    exposure_choices = (450, 600, 900, 1200, 1350)
    programs = ("DARK", "BRIGHT", "BACKUP")
    for index in range(n_tiles):
        ra = rng.uniform(0.0, 360.0)
        dec = rng.uniform(-5.0, 65.0)
        program = programs[index % len(programs)]
        if program == "DARK":
            targets = {
                "LRG": rng.randint(650, 1500),
                "ELG": rng.randint(1000, 2600),
                "QSO": rng.randint(120, 520),
                "BGS": 0,
            }
        elif program == "BRIGHT":
            targets = {
                "LRG": rng.randint(0, 220),
                "ELG": rng.randint(0, 180),
                "QSO": rng.randint(0, 60),
                "BGS": rng.randint(1700, 4200),
            }
        else:
            targets = {
                "LRG": 0,
                "ELG": 0,
                "QSO": rng.randint(0, 35),
                "BGS": rng.randint(600, 1500),
            }
        density_proxy = targets["LRG"] + targets["ELG"] + 1.7 * targets["QSO"] + 0.45 * targets["BGS"]
        priority = min(10.0, max(0.0, 1.0 + 9.0 * density_proxy / 5000.0 + rng.uniform(-0.5, 0.5)))
        tile_id = str(200000 + index)
        tile = Tile(
            tile_id=tile_id,
            ra_deg=ra,
            dec_deg=dec,
            program=program,
            region=int(ra // 45.0),
            priority=priority,
            nominal_exptime_seconds=rng.choice(exposure_choices),
            targets=targets,
        )
        tiles[tile_id] = tile
        rows.append(
            {
                "tile_id": tile_id,
                "ra_deg": f"{ra:.6f}",
                "dec_deg": f"{dec:.6f}",
                "program": program,
                "region": tile.region,
                "priority": f"{priority:.4f}",
                "nominal_exptime_seconds": tile.nominal_exptime_seconds,
                "n_lrg": targets["LRG"],
                "n_elg": targets["ELG"],
                "n_qso": targets["QSO"],
                "n_bgs": targets["BGS"],
            }
        )
    return tiles, rows


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Generate deterministic scorer example data.")
    parser.add_argument("--seed", type=int, default=11)
    parser.add_argument("--output-dir", type=Path, default=Path("."))
    parser.add_argument("--n-nights", type=int, default=2)
    parser.add_argument("--slots-per-night", type=int, default=12)
    parser.add_argument("--n-tiles", type=int, default=72)
    parser.add_argument("--config", type=Path, default=Path(__file__).with_name("score_config.json"))
    args = parser.parse_args(argv)
    if args.n_nights <= 0 or args.slots_per_night <= 0 or args.n_tiles <= 0:
        parser.error("n-nights, slots-per-night, and n-tiles must be positive")

    config = load_config(args.config)
    weather, weather_rows = make_weather(args.seed, args.n_nights, args.slots_per_night, config.slot_seconds)
    tiles, tile_rows = make_tiles(args.seed, args.n_tiles)

    write_csv(
        args.output_dir / "weather.csv",
        (
            "slot_id",
            "night_id",
            "timestamp_utc",
            "duration_seconds",
            "seeing_arcsec",
            "transparency",
            "sky_brightness",
            "is_observable",
        ),
        weather_rows,
    )
    write_csv(
        args.output_dir / "tiles.csv",
        (
            "tile_id",
            "ra_deg",
            "dec_deg",
            "program",
            "region",
            "priority",
            "nominal_exptime_seconds",
            "n_lrg",
            "n_elg",
            "n_qso",
            "n_bgs",
        ),
        tile_rows,
    )
    print(f"wrote {len(weather_rows)} weather rows and {len(tile_rows)} tiles to {args.output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
