from __future__ import annotations

import sys
import unittest
from dataclasses import replace
from datetime import timedelta
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

from challenge.scoring_core import ChallengeScorer, Decision
from challenge.weather_simulator import weather_quality


def complete_start(scorer: ChallengeScorer, tile_id: str, lower=None, upper=None):
    tile = scorer.tiles[tile_id]
    for index, slot in enumerate(scorer.slots[:-1]):
        start = slot.timestamp_utc
        if (lower is not None and start < lower) or (upper is not None and start >= upper):
            continue
        remaining = tile.nominal_exptime_seconds
        cursor = index
        okay = True
        while remaining > 0:
            current = scorer.slots[cursor]
            if current.night_id != slot.night_id or not scorer._tile_legal(tile, current.timestamp_utc):
                okay = False
                break
            weather = scorer.weather.get_effective_conditions(current.slot_id, tile_id)
            if not weather["is_observable"]:
                okay = False
                break
            remaining -= min(remaining, current.duration_seconds)
            cursor += 1
        if okay:
            return index
    raise AssertionError(f"no complete opportunity found for {tile_id}")


class ScoringCoreTests(unittest.TestCase):
    def test_lunar_quality_scales_science_and_program_band(self) -> None:
        scorer = ChallengeScorer.from_files(ROOT / "reference")
        selected = None
        for tile in scorer.tiles.values():
            if tile.nominal_exptime_seconds != 450:
                continue
            for index, slot in enumerate(scorer.slots):
                if not scorer._tile_legal(tile, slot.timestamp_utc):
                    continue
                conditions = scorer.weather.get_effective_conditions(
                    slot.slot_id, tile.tile_id
                )
                if not conditions["is_observable"]:
                    continue
                midpoint = slot.timestamp_utc + timedelta(seconds=225)
                geometry = scorer.geometry.get_tile_geometry(tile.tile_id, midpoint)
                atmospheric = weather_quality(
                    conditions, float(geometry["airmass"]), scorer.weather.config
                )
                if 0.65 <= atmospheric < 1.6:
                    selected = tile, index, atmospheric
                    break
            if selected:
                break
        self.assertIsNotNone(selected)
        tile, index, atmospheric = selected
        original_geometry = scorer.geometry.get_tile_geometry

        def lunar_stressed_geometry(tile_id, moment):
            result = original_geometry(tile_id, moment)
            result["lunar_quality_factor"] = 0.25
            return result

        scorer.geometry.get_tile_geometry = lunar_stressed_geometry
        scorer.slot_index = index
        action = scorer.apply_decision(
            Decision(
                "LUNAR",
                scorer.slots[index].slot_id,
                "observe",
                tile.tile_id,
                "BACKUP",
                "",
                "combined lunar quality test",
            )
        )
        self.assertEqual(action["outcome"], "completed")
        self.assertEqual(len(action["segments"]), 1)
        segment = action["segments"][0]
        self.assertAlmostEqual(segment["atmospheric_quality"], atmospheric, places=6)
        self.assertEqual(segment["lunar_quality_factor"], 0.25)
        self.assertAlmostEqual(
            segment["combined_quality"], atmospheric * 0.25, places=6
        )
        self.assertEqual(segment["quality_band"], "BACKUP")
        self.assertTrue(segment["program_matched"])
        self.assertGreater(action["base_science_score"], 0.0)

    def test_cross_slot_exposure_and_second_action_in_same_slot(self) -> None:
        scorer = ChallengeScorer.from_files(ROOT / "reference")
        tile = next(item for item in scorer.tiles.values() if item.nominal_exptime_seconds > 900)
        index = complete_start(scorer, tile.tile_id)
        scorer.slot_index = index
        first = scorer.apply_decision(Decision("D1", scorer.slots[index].slot_id, "observe", tile.tile_id, "DARK", "", "cross-slot test"))
        self.assertEqual(first["outcome"], "completed")
        self.assertGreaterEqual(len(first["segments"]), 2)
        current = scorer.current_slot()
        self.assertIsNotNone(current)
        self.assertGreater(scorer.offset_seconds, 0)
        second = scorer.apply_decision(Decision("D2", current.slot_id, "wait", "", "", "", "same-slot second action"))
        self.assertEqual(second["outcome"], "wait")

    def test_site_closed_observe_is_unsafe_and_consumes_slot(self) -> None:
        scorer = ChallengeScorer.from_files(ROOT / "reference")
        closed = next(index for index, item in enumerate(scorer.weather.weather) if not item.is_observable)
        scorer.slot_index = closed
        slot = scorer.current_slot()
        tile = next(iter(scorer.tiles.values()))
        action = scorer.apply_decision(Decision("D1", slot.slot_id, "observe", tile.tile_id, "BACKUP", "", "unsafe test"))
        self.assertEqual(action["outcome"], "unsafe_observation")
        self.assertEqual(action["penalty"], scorer.config["penalties"]["unsafe_observation"])
        self.assertEqual(scorer.slot_index, closed + 1)

    def test_request_tagged_revisit_has_no_duplicate_science(self) -> None:
        scorer = ChallengeScorer.from_files(ROOT / "reference")
        request = next(iter(scorer.requests.values()))
        tile_id = next(iter(scorer.request_tiles[request.request_id]))
        index = complete_start(scorer, tile_id, request.available_from_utc, request.deadline_utc)
        scorer.slot_index = index
        scorer.completed_tiles.add(tile_id)
        action = scorer.apply_decision(Decision("D1", scorer.slots[index].slot_id, "observe", tile_id, "BRIGHT", request.request_id, "request revisit"))
        self.assertEqual(action["outcome"], "completed")
        self.assertEqual(action["base_science_score"], 0.0)
        self.assertEqual(scorer.request_visits[(request.request_id, tile_id)], 1)

    def test_global_cutoff_does_not_synthesize_future_wait(self) -> None:
        scorer = ChallengeScorer.from_files(ROOT / "reference")
        first = scorer.apply_decision(Decision("D1", scorer.slots[0].slot_id, "wait", "", "", "", "one committed action"))
        self.assertEqual(first["outcome"], "wait")
        report = scorer.finalize("global_wallclock_expired")
        self.assertEqual(report["termination_reason"], "global_wallclock_expired")
        self.assertEqual(report["final_cursor"]["slot_index"], 1)
        self.assertEqual(scorer.wait_seconds["explicit"], scorer.slots[0].duration_seconds)
        self.assertNotIn("future_unprocessed", scorer.wait_seconds)

    def test_expired_request_without_any_legal_slot_is_excused(self) -> None:
        scorer = ChallengeScorer.from_files(ROOT / "reference")
        source = next(iter(scorer.requests.values()))
        daytime_start = scorer.slots[0].end_utc + timedelta(hours=1)
        impossible = replace(
            source,
            request_id="IMPOSSIBLE",
            issued_at_utc=scorer.slots[0].timestamp_utc,
            available_from_utc=daytime_start,
            deadline_utc=daytime_start + timedelta(hours=1),
            required_tile_count=1,
        )
        tile_id = next(iter(scorer.tiles))
        scorer.requests = {impossible.request_id: impossible}
        scorer.request_tiles = {impossible.request_id: {tile_id: 1}}
        scorer.slot_index = next(
            index
            for index, slot in enumerate(scorer.slots)
            if slot.timestamp_utc > impossible.deadline_utc
        )
        report = scorer.finalize()
        self.assertEqual(report["requests"][0]["status"], "excused_unobservable")
        self.assertEqual(report["requests"][0]["penalty"], 0.0)


if __name__ == "__main__":
    unittest.main()
