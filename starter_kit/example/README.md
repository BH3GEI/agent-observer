# Challenge Scoring Delivery Example

This directory is a standalone, standard-library-only reference package for
hand-off to the hackathon platform team.  It freezes a small input/output
contract and provides a deterministic scorer for the first delivery stage.

The package intentionally does not import the existing
`survey_agent_challenge_v0` simulator.  A platform collaborator can copy this
directory and run it with Python 3.9 or newer.

## Files

| File | Role |
|---|---|
| `weather.csv` | Example 900-second weather records |
| `tiles.csv` | Example tile catalog |
| `decisions.csv` | Example participant decision trace |
| `score_config.json` | Frozen scoring constants and site definition |
| `generate_example_data.py` | Seeded generator for the three example CSV files |
| `scorer.py` | Strict CSV validator, time simulator, and scorer |
| `score_report.json` | Reference score produced from the included CSV files |
| `tests/test_scorer.py` | Timing, night-boundary, and schema regression tests |

## Quick check

From this directory:

```bash
python3 -B scorer.py \
  --weather weather.csv \
  --tiles tiles.csv \
  --decisions decisions.csv \
  --config score_config.json \
  --output score_report.json

python3 -B -m unittest discover -s tests -v
```

Regenerate the example inputs deterministically:

```bash
python3 -B generate_example_data.py --seed 11 --output-dir .
```

## CSV conventions

- Encoding: UTF-8.
- Delimiter: comma.
- Header: required; unknown columns are allowed for forward compatibility.
- Timestamp: `timestamp_utc` uses RFC 3339/ISO 8601 in 24-hour UTC form,
  for example `2026-10-02T02:00:00Z`.
- Boolean: `is_observable` accepts `true/false` or `1/0`.
- IDs are strings.  They must be unique in their own table.
- Canonical spellings are `transparency` and `program`.  The scorer rejects
  misspelled schema names such as `transparancy` or `programme`.

### `weather.csv`

Required columns:

```text
slot_id,night_id,timestamp_utc,duration_seconds,seeing_arcsec,
transparency,sky_brightness,is_observable
```

`slot_id` is globally unique.  Rows must be chronological.  Slots within one
night must be contiguous and have the configured duration (900 seconds in this
example).  A gap is allowed only between different `night_id` values.

### `tiles.csv`

Required columns:

```text
tile_id,ra_deg,dec_deg,program,region,priority,
nominal_exptime_seconds,n_lrg,n_elg,n_qso,n_bgs
```

`region` is a footprint bookkeeping bin.  The example divides right ascension
into eight 45-degree regions, `region = floor(ra_deg / 45)`.  It is retained so
the platform can report coverage and later add a uniformity term, but it does
not affect the stage-one score.

`priority` is a dimensionless physical/scientific importance value in
`[0, 10]`.  `nominal_exptime_seconds` is the uninterrupted time needed to
complete the tile once.

### `decisions.csv`

Required columns:

```text
decision_id,slot_id,action,tile_id,program,reason
```

- Rows are evaluated in increasing file order; `decision_id` must be a unique,
  strictly increasing non-negative integer.
- `slot_id` is the slot in which the action should start.  Multiple rows may
  use the same slot.  Their `decision_id` values define their order.
- `observe` uses the selected tile's entire `nominal_exptime_seconds`.
- An exposure may continue through consecutive slots of the same night.
- When it finishes early, another decision with that same current `slot_id`
  may use the remaining time.
- If no further decision uses the remaining time, it becomes implicit `wait`.
- `wait` consumes the remainder of its declared slot.
- An exposure that cannot finish before the end of its `night_id` is invalid:
  it scores zero and all time spent before the night ends is waste.
- A tile can score only once.  Re-observing a completed tile is invalid.
- For `wait`, `tile_id` and `program` must be empty.  For `observe`, both are
  required and the decision program must match the tile program.

Malformed tables are rejected as invalid submissions.  Operationally invalid
actions are recorded in the score report and consume time without gaining
science score.

## Stage-one score

The draft formula needed two concrete corrections before implementation:

1. `max(F_i/F_0, 1)` makes every `f_i >= 1`, so its low-flux branch can never
   run.  The implemented bounded flux factor is instead
   `f_i = min(max(F_i/F_0, 0), 1)`.
2. The tile table contains target counts, not one spectrum per target.  The
   stage-one scorer therefore uses one frozen characteristic-flux proxy for
   each target class.  These proxies and all coefficients live in
   `score_config.json`.

For target class `c`, define

```text
f_c = clip(characteristic_flux_c / reference_flux, 0, 1)
q_c = low_flux_bonus * f_c                 if f_c <= low_flux_threshold
      f_c                                  otherwise

target_value(tile) = sum_c n_c * target_weight_c * q_c
priority_factor     = 0.5 + 0.5 * priority / 10
```

The draft's `delta(program)` is a discrete category match, so the code uses an
indicator (equivalently a Kronecker delta), not a continuous Dirac delta.

Each exposure is split at weather-slot boundaries.  For a segment of duration
`dt`, evaluated at its midpoint,

```text
A = transparency / (seeing_arcsec * sky_brightness * airmass)

condition_program(A) = DARK    if A >= dark_threshold
                       BRIGHT  if bright_threshold <= A < dark_threshold
                       BACKUP  otherwise

B = configured bonus for the decision program
    if decision program == condition_program(A), else 0

segment_score = H(altitude_deg - minimum_altitude_deg)
                * A
                * (dt / nominal_exptime_seconds)
                * target_value(tile)
                * priority_factor
                * (1 + B)
```

The action score is the sum of its segment scores.  The final score is

```text
score = sum(action_score) - idle_penalty_per_second * total_waste_seconds
```

`total_waste_seconds` includes idle observable time, invalid actions, and
exposure segments taken while the site is closed or the tile is below the
altitude threshold.  Closed time that the agent did not attempt to use is
reported as unavailable time and is not penalized.

Altitude and airmass are computed from the timestamp, site longitude/latitude,
and tile RA/Dec with a dependency-free sidereal-time approximation.  This is
sufficient for a scoring reference implementation; organizers should validate
and freeze all constants before using the score for the final competition.

## Scope boundary

This delivery implements only the requested stage-one score.  It does not add
the existing benchmark's footprint-uniformity, rule-violation, or incomplete
high-priority penalties.  The report nevertheless preserves region completion,
invalid-action counts, and waste categories so those terms can be added later
without changing the three CSV schemas.
