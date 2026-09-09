/**
 * Parity and regression tests for the TypeScript scorer port.
 *
 *   deno test -A _shared
 *
 * The reference-report test reads starter_kit/example/* and compares against
 * the frozen score_report.json produced by scoring/scorer.py.  The inline
 * scenarios were cross-checked against the Python scorer; the expected
 * numbers below are Python's output.
 */

import { assert, assertAlmostEquals, assertEquals, assertThrows } from "@std/assert";
import { fromFileUrl } from "@std/path";
import {
  formatTimestampUtc,
  parseCsv,
  parseTimestampUtc,
  pyMod,
  pyRound,
  type Report,
  scoreFiles,
  ScoringError,
  timedeltaMicros,
} from "./scorer.ts";
import { deriveMetrics, pstdev } from "./metrics.ts";

const EXAMPLE_DIR = fromFileUrl(new URL("../../../starter_kit/example/", import.meta.url));

async function readExample(name: string): Promise<string> {
  return await Deno.readTextFile(EXAMPLE_DIR + name);
}

const TOL = 1e-6;

// ---------------------------------------------------------------------------
// Inline fixtures (same strings as the Python cross-check script)
// ---------------------------------------------------------------------------

const TILES_HEADER = "tile_id,ra_deg,dec_deg,program,region,priority,nominal_exptime_seconds,n_lrg,n_elg,n_qso,n_bgs\n";
// A/X share the RA/Dec of example tile 200069; B is example tile 200003.
const TILES = TILES_HEADER +
  "A,229.848179,32.073331,DARK,5,8.8646,600,1205,2252,420,0\n" +
  "B,235.412112,38.089389,DARK,5,7.2769,450,811,2276,127,0\n" +
  "X,229.848179,32.073331,DARK,5,8.8646,1200,1205,2252,420,0\n";

const WEATHER_HEADER =
  "slot_id,night_id,timestamp_utc,duration_seconds,seeing_arcsec,transparency,sky_brightness,is_observable\n";
function slot(slotId: string, nightId: string, ts: string, observable = "true"): string {
  return `${slotId},${nightId},${ts},900,1.0,0.9,1.0,${observable}\n`;
}
const WEATHER = WEATHER_HEADER +
  slot("N01-S001", "N01", "2026-10-02T02:00:00Z") +
  slot("N01-S002", "N01", "2026-10-02T02:15:00Z") +
  slot("N01-S003", "N01", "2026-10-02T02:30:00Z") +
  slot("N01-S004", "N01", "2026-10-02T02:45:00Z") +
  slot("N02-S001", "N02", "2026-10-03T02:00:00Z", "false") +
  slot("N02-S002", "N02", "2026-10-03T02:15:00Z", "false");
const WEATHER_SHORT_NIGHT = WEATHER_HEADER +
  slot("N01-S001", "N01", "2026-10-02T02:00:00Z") +
  slot("N01-S002", "N01", "2026-10-02T02:15:00Z") +
  slot("N02-S001", "N02", "2026-10-03T02:00:00Z", "false") +
  slot("N02-S002", "N02", "2026-10-03T02:15:00Z", "false");

const DECISIONS_HEADER = "decision_id,slot_id,action,tile_id,program,reason\n";

let CONFIG = "";
async function config(): Promise<string> {
  if (!CONFIG) CONFIG = await readExample("score_config.json");
  return CONFIG;
}

async function score(weather: string, tiles: string, decisions: string): Promise<Report> {
  return scoreFiles(weather, tiles, decisions, await config());
}

function assertScoringError(fn: () => unknown, includes: string): void {
  const err = assertThrows(fn, ScoringError);
  assert(err.message.includes(includes), `expected "${includes}" in "${err.message}"`);
}

// ---------------------------------------------------------------------------
// Reference parity
// ---------------------------------------------------------------------------

Deno.test("reference example reproduces the frozen score_report.json", async () => {
  const [weather, tiles, decisions, cfg, refText] = await Promise.all([
    readExample("weather.csv"),
    readExample("tiles.csv"),
    readExample("decisions.csv"),
    readExample("score_config.json"),
    readExample("score_report.json"),
  ]);
  const report = scoreFiles(weather, tiles, decisions, cfg);
  const ref = JSON.parse(refText) as Report;

  assertEquals(report.status, "ok");
  assertEquals(report.schema_version, ref.schema_version);
  assertAlmostEquals(report.score, ref.score, TOL);
  assertAlmostEquals(report.science_score, ref.science_score, TOL);
  assertAlmostEquals(report.waste_penalty, ref.waste_penalty, TOL);
  assertEquals(report.completed_tiles, 21);
  assertEquals(ref.completed_tiles, 21);
  assertEquals(report.invalid_actions, 0);
  assertEquals(report.total_waste_seconds, 7050);
  assertEquals(report.waste_breakdown_seconds, ref.waste_breakdown_seconds);
  assertEquals(report.unavailable_unpenalized_seconds, ref.unavailable_unpenalized_seconds);
  for (const region of Object.keys(ref.region_completion)) {
    assertAlmostEquals(report.region_completion[region], ref.region_completion[region], TOL, `region ${region}`);
  }
  assertEquals(Object.keys(report.region_completion), ["0", "1", "2", "3", "4", "5", "6", "7"]);

  assertEquals(report.actions.length, ref.actions.length);
  ref.actions.forEach((expected, i) => {
    const actual = report.actions[i];
    const where = `action ${i} (decision ${expected.decision_id})`;
    assertEquals(actual.decision_id, expected.decision_id, where);
    assertEquals(actual.slot_id, expected.slot_id, where);
    assertEquals(actual.action, expected.action, where);
    assertEquals(actual.tile_id, expected.tile_id, where);
    assertEquals(actual.valid, expected.valid, where);
    assertEquals(actual.message, expected.message, where);
    assertEquals(actual.reason, expected.reason, where);
    assertEquals(actual.start_timestamp_utc, expected.start_timestamp_utc, where);
    assertEquals(actual.elapsed_seconds, expected.elapsed_seconds, where);
    assertEquals(actual.segments, expected.segments, where);
    if (expected.unproductive_seconds !== undefined) {
      assertAlmostEquals(actual.unproductive_seconds ?? NaN, expected.unproductive_seconds, TOL, where);
    }
    assertAlmostEquals(actual.science_score, expected.science_score, TOL, where);
    // Key order must match the Python dict order (json sort_keys is applied on output).
    const expectedKeys = expected.action === "observe"
      ? [
        "decision_id",
        "slot_id",
        "action",
        "tile_id",
        "valid",
        "message",
        "start_timestamp_utc",
        "elapsed_seconds",
        "segments",
        "unproductive_seconds",
        "science_score",
        "reason",
      ]
      : [
        "decision_id",
        "slot_id",
        "action",
        "tile_id",
        "valid",
        "message",
        "start_timestamp_utc",
        "elapsed_seconds",
        "science_score",
        "reason",
      ];
    assertEquals(Object.keys(actual), expectedKeys, where);
  });

  const metrics = deriveMetrics(report, 72);
  assertEquals(metrics.completed_tiles, 21);
  assertEquals(metrics.total_tiles, 72);
  assertAlmostEquals(metrics.completion, pyRound(21 / 72, 6), TOL);
  assert(metrics.uniformity >= 0 && metrics.uniformity <= 1);
  assertEquals(metrics.n_actions, 31);
  assertEquals(metrics.n_observations, 21);
  assertAlmostEquals(metrics.score, ref.score, TOL);
});

// ---------------------------------------------------------------------------
// Timing semantics
// ---------------------------------------------------------------------------

Deno.test("exposure rolls over into the next slot; two actions share the second slot", async () => {
  const decisions = DECISIONS_HEADER +
    "0,N01-S001,observe,X,DARK,long\n" +
    "1,N01-S002,observe,B,DARK,after rollover\n" +
    "2,N01-S002,wait,,,rest\n";
  const report = await score(WEATHER, TILES, decisions);

  assertEquals(report.actions.length, 3);
  const [first, second, third] = report.actions;
  assertEquals(first.valid, true);
  assertEquals(first.segments, 2);
  assertEquals(first.elapsed_seconds, 1200);
  assertEquals(first.start_timestamp_utc, "2026-10-02T02:00:00Z");
  assertAlmostEquals(first.science_score, 1202.234586, TOL);

  // X finished 300 s into N01-S002, so B starts at 02:20:00 and ends 02:27:30.
  assertEquals(second.valid, true);
  assertEquals(second.slot_id, "N01-S002");
  assertEquals(second.start_timestamp_utc, "2026-10-02T02:20:00Z");
  assertEquals(second.segments, 1);
  assertAlmostEquals(second.science_score, 1021.876456, TOL);

  // The wait consumes the remainder of N01-S002 only.
  assertEquals(third.action, "wait");
  assertEquals(third.start_timestamp_utc, "2026-10-02T02:27:30Z");
  assertEquals(third.elapsed_seconds, 150);

  assertEquals(report.completed_tiles, 2);
  assertEquals(report.invalid_actions, 0);
  assertAlmostEquals(report.science_score, 2224.111042, TOL);
  assertAlmostEquals(report.score, 2185.111042, TOL);
  assertEquals(report.waste_breakdown_seconds, { idle: 1950, invalid_actions: 0, unproductive_exposure: 0 });
  assertEquals(report.total_waste_seconds, 1950);
  assertEquals(report.unavailable_unpenalized_seconds, 1800);
  assertAlmostEquals(report.region_completion["5"], 0.666667, TOL);
});

Deno.test("exposure crossing a night boundary is invalid (900 idle + 900 invalid)", async () => {
  const decisions = DECISIONS_HEADER +
    "0,N01-S001,wait,,,\n" +
    "1,N01-S002,observe,X,DARK,too long\n";
  const report = await score(WEATHER_SHORT_NIGHT, TILES, decisions);

  assertEquals(report.actions.length, 2);
  const [wait, observe] = report.actions;
  assertEquals(wait.action, "wait");
  assertEquals(wait.elapsed_seconds, 900);
  assertEquals(observe.valid, false);
  assertEquals(observe.message, "exposure cannot finish before the end of the night");
  assertEquals(observe.start_timestamp_utc, "2026-10-02T02:15:00Z");
  assertEquals(observe.elapsed_seconds, 900);
  assertEquals(observe.science_score, 0);
  assertEquals(observe.segments, undefined);

  assertEquals(report.completed_tiles, 0);
  assertEquals(report.invalid_actions, 1);
  assertEquals(report.waste_breakdown_seconds, { idle: 900, invalid_actions: 900, unproductive_exposure: 0 });
  assertEquals(report.total_waste_seconds, 1800);
  assertEquals(report.unavailable_unpenalized_seconds, 1800);
  assertAlmostEquals(report.waste_penalty, 36.0, TOL);
  assertAlmostEquals(report.score, -36.0, TOL);
});

Deno.test("a repeated observation of a completed tile cannot score twice", async () => {
  const decisions = DECISIONS_HEADER +
    "0,N01-S001,observe,A,DARK,first\n" +
    "1,N01-S002,observe,A,DARK,again\n";
  const report = await score(WEATHER, TILES, decisions);

  assertEquals(report.actions.length, 2);
  const [first, second] = report.actions;
  assertEquals(first.valid, true);
  assertAlmostEquals(first.science_score, 1229.085841, TOL);
  assertEquals(second.valid, false);
  assertEquals(second.message, "tile has already been completed");
  assertEquals(second.elapsed_seconds, 600);
  assertEquals(second.science_score, 0);

  assertEquals(report.completed_tiles, 1);
  assertEquals(report.invalid_actions, 1);
  assertAlmostEquals(report.science_score, 1229.085841, TOL);
  assertAlmostEquals(report.score, 1169.085841, TOL);
  assertEquals(report.waste_breakdown_seconds, { idle: 2400, invalid_actions: 600, unproductive_exposure: 0 });
  assertEquals(report.total_waste_seconds, 3000);
});

Deno.test("decisions that overlap an earlier exposure are rejected", async () => {
  // X occupies N01-S001 and 300 s of N01-S002; going back to N01-S001 is an error.
  const decisions = DECISIONS_HEADER +
    "0,N01-S001,observe,X,DARK,long\n" +
    "1,N01-S001,observe,B,DARK,back in time\n";
  const cfg = await config();
  assertScoringError(() => scoreFiles(WEATHER, TILES, decisions, cfg), "decision schedule overlaps an earlier exposure");
});

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

Deno.test("duplicate slot_id in weather.csv is rejected", async () => {
  const weather = WEATHER_HEADER +
    slot("N01-S001", "N01", "2026-10-02T02:00:00Z") +
    slot("N01-S001", "N01", "2026-10-02T02:15:00Z");
  const cfg = await config();
  assertScoringError(
    () => scoreFiles(weather, TILES, DECISIONS_HEADER + "0,N01-S001,wait,,,\n", cfg),
    "weather.csv: row 3: duplicate slot_id 'N01-S001'",
  );
});

Deno.test("malformed decisions throw ScoringError", async () => {
  const cfg = await config();
  assertScoringError(
    () => scoreFiles(WEATHER, TILES, DECISIONS_HEADER + "0,NOPE,observe,A,DARK,x\n", cfg),
    "decisions.csv: row 2: unknown slot_id 'NOPE'",
  );
  assertScoringError(
    () => scoreFiles(WEATHER, TILES, DECISIONS_HEADER + "1,N01-S001,wait,,,\n1,N01-S002,wait,,,\n", cfg),
    "decisions.csv: row 3: decision_id must be unique and strictly increasing",
  );
  assertScoringError(
    () => scoreFiles(WEATHER, TILES, DECISIONS_HEADER + "0,N01-S001,wait,A,,\n", cfg),
    "decisions.csv: row 2: wait requires empty tile_id and program",
  );
  assertScoringError(
    () => scoreFiles(WEATHER, TILES, DECISIONS_HEADER + "0,N01-S002,wait,,,\n1,N01-S001,wait,,,\n", cfg),
    "decision slot_id values must be chronological",
  );
  assertScoringError(
    () => scoreFiles(WEATHER, TILES, DECISIONS_HEADER + "0,N01-S001,observe,A,MOON,x\n", cfg),
    "invalid program 'MOON'",
  );
  assertScoringError(
    () => scoreFiles(WEATHER, TILES, DECISIONS_HEADER + "0,N01-S001,observe,A,,x\n", cfg),
    "observe requires tile_id and program",
  );
  assertScoringError(
    () => scoreFiles(WEATHER, TILES, DECISIONS_HEADER + "x,N01-S001,wait,,,\n", cfg),
    "decision_id must be an integer, got 'x'",
  );
  assertScoringError(
    () => scoreFiles(WEATHER, TILES, "decision_id,slot_id,action,tile_id,programme,reason\n0,N01-S001,wait,,,\n", cfg),
    "decisions.csv: missing columns: program",
  );
  assertScoringError(() => scoreFiles(WEATHER, TILES, DECISIONS_HEADER, cfg), "must contain at least one data row");
  assertScoringError(() => scoreFiles(WEATHER, TILES, "", cfg), "decisions.csv: missing CSV header");
});

Deno.test("malformed weather and tiles throw ScoringError", async () => {
  const cfg = await config();
  const decisions = DECISIONS_HEADER + "0,N01-S001,wait,,,\n";
  assertScoringError(
    () => scoreFiles(WEATHER_HEADER + "N01-S001,N01,2026-10-02T02:00:00,900,1.0,0.9,1.0,true\n", TILES, decisions, cfg),
    "timestamp_utc must include a timezone",
  );
  assertScoringError(
    () =>
      scoreFiles(WEATHER_HEADER + "N01-S001,N01,2026-10-02T02:00:00+01:00,900,1.0,0.9,1.0,true\n", TILES, decisions, cfg),
    "timestamp_utc must use UTC (Z or +00:00)",
  );
  assertScoringError(
    () => scoreFiles(WEATHER_HEADER + "N01-S001,N01,not-a-date,900,1.0,0.9,1.0,true\n", TILES, decisions, cfg),
    "invalid ISO 8601 timestamp 'not-a-date'",
  );
  assertScoringError(
    () => scoreFiles(WEATHER_HEADER + "N01-S001,N01,2026-10-02T02:00:00Z,600,1.0,0.9,1.0,true\n", TILES, decisions, cfg),
    "duration_seconds must equal configured slot_seconds=900",
  );
  assertScoringError(
    () =>
      scoreFiles(
        WEATHER_HEADER + slot("N01-S001", "N01", "2026-10-02T02:00:00Z") + slot("N01-S002", "N01", "2026-10-02T02:20:00Z"),
        TILES,
        decisions,
        cfg,
      ),
    "slots within a night must be contiguous",
  );
  assertScoringError(
    () => scoreFiles(WEATHER_HEADER + "N01-S001,N01,2026-10-02T02:00:00Z,900,1.0,0.9,1.0,maybe\n", TILES, decisions, cfg),
    "is_observable must be true/false or 1/0",
  );
  assertScoringError(
    () => scoreFiles(WEATHER, TILES_HEADER + "A,229.8,32.0,DARK,9,8.8,600,1,1,1,0\n", decisions, cfg),
    "region must be an integer in [0, 7]",
  );
  assertScoringError(
    () => scoreFiles(WEATHER, TILES_HEADER + "A,229.8,32.0,DARK,5,8.8,600,1,1,1,0\nA,1,1,DARK,5,1,600,1,1,1,0\n", decisions, cfg),
    "tiles.csv: row 3: duplicate tile_id 'A'",
  );
  assertScoringError(
    () => scoreFiles(WEATHER, TILES_HEADER + "A,229.8,32.0,DARK,5,8.8,abc,1,1,1,0\n", decisions, cfg),
    "nominal_exptime_seconds must be an integer, got 'abc'",
  );
  assertScoringError(
    () => scoreFiles(WEATHER, TILES_HEADER + "A,229.8,32.0,DARK,5,nan,600,1,1,1,0\n", decisions, cfg),
    "priority must be finite",
  );
});

Deno.test("invalid score config throws ScoringError", () => {
  const decisions = DECISIONS_HEADER + "0,N01-S001,wait,,,\n";
  assertScoringError(() => scoreFiles(WEATHER, TILES, decisions, "{not json"), "cannot read score config");
  assertScoringError(() => scoreFiles(WEATHER, TILES, decisions, "{}"), "score config: missing keys:");
});

Deno.test("CSV parsing tolerates a UTF-8 BOM, quoted fields, CRLF and extra columns", async () => {
  const bomWeather = "﻿" + WEATHER.replace(/\n/g, "\r\n");
  const decisions = DECISIONS_HEADER + '0,"N01-S001",observe,"A",DARK,"has, comma and ""quotes"""\n';
  const tilesWithExtra = TILES.split("\n")
    .map((line, i) => (line ? (i === 0 ? line + ",extra" : line + ",ignored") : line))
    .join("\n");
  const report = await score(bomWeather, tilesWithExtra, decisions);
  assertEquals(report.actions.length, 1);
  assertEquals(report.actions[0].reason, 'has, comma and "quotes"');
  assertEquals(report.actions[0].tile_id, "A");
  assertAlmostEquals(report.actions[0].science_score, 1229.085841, TOL);
  assertEquals(report.waste_breakdown_seconds, { idle: 3000, invalid_actions: 0, unproductive_exposure: 0 });

  assertEquals(parseCsv('a,b\n1,"x,y"\n\n2,"line\nbreak"\r\n'), [["a", "b"], ["1", "x,y"], [], ["2", "line\nbreak"]]);
});

// ---------------------------------------------------------------------------
// Python-compat helpers
// ---------------------------------------------------------------------------

Deno.test("pyRound mirrors Python round(x, 6)", () => {
  assertEquals(pyRound(0.0078125, 6), 0.007812); // exact tie -> even
  assertEquals(pyRound(0.0234375, 6), 0.023438); // exact tie -> even (odd digit rounds up)
  assertEquals(pyRound(2.5, 0), 2);
  assertEquals(pyRound(3.5, 0), 4);
  assertEquals(pyRound(1211.6971884999999, 6), 1211.697188);
  // The exact double is -1.00000050000000006988..., i.e. above the tie -> away from zero.
  assertEquals(pyRound(-1.0000005, 6), -1.000001);
  assertEquals(pyRound(1.0000005, 6), 1.000001);
  // The exact double is 0.49999999999999995886..., i.e. below the tie.
  assertEquals(pyRound(0.5000005, 6), 0.5);
  assertEquals(pyRound(2.675, 2), 2.67); // classic: 2.67499999999999982236...
  assertEquals(pyRound(0.1 + 0.2, 6), 0.3);
  assertEquals(pyRound(1e-7, 6), 0);
  assertEquals(pyRound(999999.9999995, 6), 999999.999999); // 999999.99999949999619...
  assertEquals(pyRound(0, 6), 0);
});

Deno.test("pyMod mirrors Python float modulo", () => {
  assertEquals(pyMod(5.0 - 7.0, 360.0), 358.0);
  assertEquals(pyMod(-1e-9, 360.0), 359.999999999);
  assertEquals(pyMod(725.5, 360.0), 5.5);
  assertEquals(pyMod(360.0, 360.0), 0);
});

Deno.test("timestamps round-trip like datetime.isoformat", () => {
  const t = parseTimestampUtc("2026-10-02T02:00:00Z", "ctx");
  assertEquals(formatTimestampUtc(t), "2026-10-02T02:00:00Z");
  assertEquals(formatTimestampUtc(t + timedeltaMicros(450)), "2026-10-02T02:07:30Z");
  assertEquals(formatTimestampUtc(t + timedeltaMicros(0.5)), "2026-10-02T02:00:00.500000Z");
  assertEquals(parseTimestampUtc("2026-10-02T02:00:00+00:00", "ctx"), t);
  assertEquals(parseTimestampUtc("2026-10-02T02:00:00.250Z", "ctx"), t + 250_000);
  assertEquals(timedeltaMicros(0.0000005), 0); // half-even at the microsecond
  assertEquals(timedeltaMicros(0.0000015), 2);
});

Deno.test("deriveMetrics: completion and uniformity", () => {
  const base = {
    score: 1,
    science_score: 2,
    completed_tiles: 3,
    invalid_actions: 0,
    actions: [{ action: "observe", valid: true }, { action: "wait", valid: true }, { action: "observe", valid: false }],
  };
  const even = deriveMetrics({ ...base, region_completion: { "0": 0.5, "1": 0.5 } }, 6);
  assertEquals(even.completion, 0.5);
  assertEquals(even.uniformity, 1);
  assertEquals(even.n_actions, 3);
  assertEquals(even.n_observations, 1);

  const spread = deriveMetrics({ ...base, region_completion: { "0": 1, "1": 0 } }, 0);
  assertEquals(spread.completion, 0);
  assertEquals(spread.uniformity, 0); // 1 - 2 * 0.5 = 0
  assertAlmostEquals(pstdev([1, 0]), 0.5, 1e-12);

  const allZero = deriveMetrics({ ...base, region_completion: { "0": 0, "1": 0 } }, 4);
  assertEquals(allZero.uniformity, 1);
  const single = deriveMetrics({ ...base, region_completion: { "0": 0.25 } }, 4);
  assertEquals(single.uniformity, 1);
});
