/**
 * Leaderboard metrics derived from a scorer report — port of
 * `derive_metrics(report, n_tiles)` from legacy/fastapi/app/services/scoring.py.
 *
 * The stage-one `score` is authoritative; completion and uniformity are
 * informational.
 */

import { pyRound, type Report } from "./scorer.ts";

export interface Metrics {
  score: number;
  science_score: number;
  waste_penalty: number;
  total_waste_seconds: number;
  waste_breakdown_seconds: Record<string, number>;
  unavailable_unpenalized_seconds: number;
  completed_tiles: number;
  total_tiles: number;
  completion: number;
  uniformity: number;
  invalid_actions: number;
  n_actions: number;
  n_observations: number;
  region_completion: Record<string, number>;
}

/** Population standard deviation (mirror of `statistics.pstdev`). */
export function pstdev(values: number[]): number {
  const n = values.length;
  if (n < 1) throw new Error("pstdev requires at least one data point");
  let mean = 0.0;
  for (const v of values) mean += v;
  mean /= n;
  let ss = 0.0;
  for (const v of values) {
    const d = v - mean;
    ss += d * d;
  }
  return Math.sqrt(ss / n);
}

export function deriveMetrics(report: Report | Record<string, unknown>, nTiles: number): Metrics {
  const r = report as Record<string, unknown>;
  const completed = Math.trunc(Number(r["completed_tiles"] ?? 0));
  const completion = nTiles ? completed / nTiles : 0.0;
  const regionCompletion = (r["region_completion"] ?? {}) as Record<string, number>;
  const values = Object.values(regionCompletion).map((v) => Number(v));
  let uniformity = 1.0;
  if (values.length >= 2 && values.some((v) => v !== 0)) {
    uniformity = Math.max(0.0, Math.min(1.0, 1.0 - 2.0 * pstdev(values)));
  }
  const actions = (r["actions"] ?? []) as Array<Record<string, unknown>>;
  const observe = actions.filter((a) => a["action"] === "observe" && Boolean(a["valid"]));
  return {
    score: Number(r["score"]),
    science_score: Number(r["science_score"]),
    waste_penalty: Number(r["waste_penalty"] ?? 0.0),
    total_waste_seconds: Number(r["total_waste_seconds"] ?? 0.0),
    waste_breakdown_seconds: (r["waste_breakdown_seconds"] ?? {}) as Record<string, number>,
    unavailable_unpenalized_seconds: Number(r["unavailable_unpenalized_seconds"] ?? 0.0),
    completed_tiles: completed,
    total_tiles: nTiles,
    completion: pyRound(completion, 6),
    uniformity: pyRound(uniformity, 6),
    invalid_actions: Math.trunc(Number(r["invalid_actions"] ?? 0)),
    n_actions: actions.length,
    n_observations: observe.length,
    region_completion: regionCompletion,
  };
}
