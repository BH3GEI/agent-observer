from __future__ import annotations

import hashlib
import sys
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

from challenge.observing_calendar import load_slots
from challenge.tile_geometry_simulator import TileGeometrySimulator
from challenge.weather_simulator import (
    WeatherEvent,
    WeatherSimulator,
    generate,
    load_config,
    load_events,
    load_forecasts,
    load_weather,
)


CONFIG = ROOT / "reference" / "config"
OUTPUT = ROOT / "reference" / "outputs" / "reference"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class WeatherSimulatorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.geometry = TileGeometrySimulator.from_files(
            OUTPUT / "tiles.csv",
            CONFIG / "tile_config.json",
            CONFIG / "calendar_config.json",
            OUTPUT / "night_calendar.csv",
            OUTPUT / "slots.csv",
        )
        cls.weather = load_weather(OUTPUT / "weather.csv")
        cls.forecasts = load_forecasts(OUTPUT / "weather_forecasts.csv")
        cls.events = load_events(OUTPUT / "weather_events.csv")
        cls.config = load_config(CONFIG / "weather_config.json")

    def test_weather_rows_exactly_match_shared_slots(self) -> None:
        slots = load_slots(OUTPUT / "slots.csv")
        self.assertEqual(len(slots), len(self.weather))
        for expected, actual in zip(slots, self.weather):
            self.assertEqual(
                (expected.slot_id, expected.night_id, expected.timestamp_utc, expected.duration_seconds),
                (actual.slot_id, actual.night_id, actual.timestamp_utc, actual.duration_seconds),
            )
            values = (actual.seeing_arcsec, actual.transparency, actual.sky_quality, actual.instrument_efficiency)
            self.assertEqual(actual.is_observable, all(value is not None for value in values))

    def test_generation_is_byte_deterministic(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            output = Path(raw)
            generate(
                CONFIG / "weather_config.json",
                OUTPUT / "night_calendar.csv",
                OUTPUT / "slots.csv",
                OUTPUT / "tiles.csv",
                output,
            )
            for name in ("weather.csv", "weather_forecasts.csv", "weather_events.csv"):
                self.assertEqual(digest(output / name), digest(OUTPUT / name))

    def test_directional_force_close_does_not_close_control_tile(self) -> None:
        base = next(item for item in self.weather if item.is_observable)
        target = next(iter(self.geometry.tiles.values()))
        control = max(
            self.geometry.tiles.values(),
            key=lambda item: abs(item.ra_deg - target.ra_deg),
        )
        event = WeatherEvent(
            "TEST", "rocket_launch", base.timestamp_utc,
            base.end_utc, "SKY_CAP_ICRS",
            {"ra_deg": target.ra_deg, "dec_deg": target.dec_deg, "radius_deg": 1.0},
            1.0, True, 1.0, 1.0, 1.0, 1.0,
        )
        runtime = WeatherSimulator(self.weather, [], [event], self.config, self.geometry)
        affected = runtime.get_effective_conditions(base.slot_id, target.tile_id)
        unaffected = runtime.get_effective_conditions(base.slot_id, control.tile_id)
        self.assertFalse(affected["is_observable"])
        self.assertTrue(unaffected["is_observable"])
        self.assertEqual(affected["active_event_ids"], ["TEST"])
        self.assertEqual(unaffected["active_event_ids"], [])

    def test_forecast_query_never_publishes_future_revision(self) -> None:
        runtime = WeatherSimulator(self.weather, self.forecasts, self.events, self.config, self.geometry)
        first_issue = min(item.issued_at_utc for item in self.forecasts)
        self.assertEqual(runtime.get_weather_forecast(first_issue - timedelta(seconds=1)), [])
        published = runtime.get_weather_forecast(first_issue)
        self.assertTrue(published)
        self.assertTrue(all(item["issued_at_utc"] <= first_issue.isoformat().replace("+00:00", "Z") for item in published))


if __name__ == "__main__":
    unittest.main()
