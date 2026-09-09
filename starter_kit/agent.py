#!/usr/bin/env python3
"""Baseline observer agent for the Agent Observer challenge (protocol observer-v1).

The platform (or local_runner.py) talks to this script over stdin/stdout with one JSON
object per line. This baseline keeps the greedy rule used to build the example data:

  1. if the site is closed in this slot, wait;
  2. otherwise keep the candidate tiles whose program matches the current condition program;
  3. pick the one with the highest target_value * priority_factor;
  4. if none qualifies, wait.

Replace `decide()` with your own strategy. Only the Python standard library is available
when the agent runs on the platform.
"""
from __future__ import annotations

import json
import sys


def decide(state: dict, memory: dict) -> dict:
    """Return {"action": "observe", "tile_id": ..., "program": ..., "reason": ...} or {"action": "wait", ...}."""
    if not state["weather"]["is_observable"]:
        return {"action": "wait", "reason": "weather is unavailable"}
    candidates = [t for t in state["available_tiles"] if t["program_match"]]
    if not candidates:
        return {"action": "wait", "reason": "no visible tile matches the weather band"}
    best = max(candidates, key=lambda t: t["target_value"] * (0.5 + 0.5 * t["priority"] / 10.0))
    return {
        "action": "observe",
        "tile_id": best["tile_id"],
        "program": best["program"],
        "reason": "highest visible target value in the matching weather band",
    }


def main() -> None:
    memory: dict = {}
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        message = json.loads(line)
        kind = message.get("type")
        if kind == "init":
            memory["init"] = message
            continue
        if kind == "end":
            break
        if kind == "step":
            answer = decide(message, memory)
            sys.stdout.write(json.dumps(answer) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
