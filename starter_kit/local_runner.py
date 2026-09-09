#!/usr/bin/env python3
"""Run an observer agent locally through the observer-v1 protocol and score it.

Usage:
  python3 local_runner.py --agent agent.py --weather weather.csv --tiles tiles.csv \
      --config score_config.json --out run_output

Writes run_output/decisions.csv and run_output/score_report.json and prints the score.
This uses the same protocol.py and scorer.py as the platform, so local and platform
results agree for the same weather scenario.
"""
from __future__ import annotations

import argparse
import csv
import json
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import protocol  # noqa: E402
import scorer  # noqa: E402


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Run and score an observer agent locally.")
    parser.add_argument("--agent", type=Path, required=True, help="agent script (run with the current Python)")
    parser.add_argument("--weather", type=Path, required=True)
    parser.add_argument("--tiles", type=Path, required=True)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--out", type=Path, default=Path("run_output"))
    parser.add_argument("--step-timeout", type=float, default=20.0)
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args(argv)

    cfg = scorer.load_config(args.config)
    weather = scorer.load_weather(args.weather, cfg)
    tiles = scorer.load_tiles(args.tiles)
    engine = scorer.ScoreEngine(cfg, weather, tiles)
    raw_config = json.loads(args.config.read_text(encoding="utf-8"))
    args.out.mkdir(parents=True, exist_ok=True)

    proc = subprocess.Popen([sys.executable, "-u", str(args.agent)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            text=True, encoding="utf-8", bufsize=1)

    def send(msg: dict) -> None:
        proc.stdin.write(json.dumps(msg) + "\n")
        proc.stdin.flush()

    rows = []
    started = time.monotonic()
    send(protocol.build_init(cfg, raw_config, tiles, {"slug": "local", "n_slots": len(weather)}, {"step_timeout_seconds": args.step_timeout}))
    step = 0
    last = None
    try:
        while True:
            state = protocol.build_step(engine, step, last)
            if state is None:
                break
            send(state)
            line = proc.stdout.readline()
            if not line:
                raise SystemExit("agent exited before answering step %d" % step)
            answer = protocol.parse_answer(line)
            decision, warning = protocol.normalise_decision(answer, step, state["now"]["slot_id"], tiles)
            if warning and not args.quiet:
                print("warning:", warning, file=sys.stderr)
            last = protocol.apply_and_record(engine, decision)
            rows.append(protocol.decision_row(decision))
            if not args.quiet:
                print(f"step {step:4d} {decision.slot_id} {decision.action:7s} {decision.tile_id:8s} {last['message']:>12s} +{last['science_score'] or 0:.1f}")
            step += 1
        engine.finish()
        try:
            send({"type": "end", "summary": {"steps": step}})
        except (BrokenPipeError, OSError):
            pass
    finally:
        try:
            proc.stdin.close()
        except Exception:
            pass
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()

    decisions_path = args.out / "decisions.csv"
    with decisions_path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(protocol.DECISION_FIELDS))
        writer.writeheader()
        writer.writerows(rows)
    report = scorer.score_files(args.weather, args.tiles, decisions_path, args.config)
    (args.out / "score_report.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"score": report["score"], "science_score": report["science_score"], "completed_tiles": report["completed_tiles"],
                      "invalid_actions": report["invalid_actions"], "total_waste_seconds": report["total_waste_seconds"],
                      "steps": step, "seconds": round(time.monotonic() - started, 2), "decisions": str(decisions_path)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
