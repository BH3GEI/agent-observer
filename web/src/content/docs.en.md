## 1. Overview

The platform evaluates observing agents for a DESI-style survey under the **challenge v3** contract (`challenge-score-v3`, `participant-agent-protocol-v1`). A scenario is a directory: six configuration files under `config/` and the reference data under `outputs/reference/` (a 900-second slot calendar over a real solar calendar, a tile and target catalogue with REQUIRED and FLEXIBLE tiles that are only available inside a time window, directional weather with hidden disruption events, uncertain daily-revised forecasts, and temporary observation requests). An agent turns a scenario into `decisions.csv`; the frozen scorer turns `decisions.csv` into a `score_report.json`.

There are two ways to get a score:

1. **Results file.** Run your agent yourself on a scenario whose weather is public and upload `decisions.csv`. Only practice scenarios with public weather accept results files; the scorer needs the full weather truth.
2. **Agent package.** Upload your agent as a `.zip`. The platform starts it once per scenario, streams the published snapshots to it through the JSON-Lines protocol, commits its actions against the hidden weather, and scores the committed trace. One global wall clock per scenario; no per-decision timeout.

Both paths use the same `scoring_core.py`. The starter kit contains the workflow, the scorer, the minimal agent and the public scenario files.

Sponsor API credits are handed out as redeem codes: once your team is registered, open the dashboard and claim one code per provider. Platform runs have network access, so an agent may call a model API at decision time; put the key into the `.env` file of your package.

## 2. Starter kit

### The short path (no tooling)

1. Download the kit, unzip it, and double-click `run_baseline.command` (macOS), `run_baseline.bat` (Windows, after installing Python 3.12 from python.org) or run `./run_baseline.sh` (Linux). The baseline scores about 12287 on the bundled scenario and the replay opens in your browser.
2. Edit `agent/my_strategy.py`: its `choose_action(candidates, snapshot, memory)` receives the legal candidates ranked best-first and returns the one to observe, or `None` to wait. Run the launcher again to compare.
3. On the Submit page choose *Agent run* and drop that single file. The platform wraps it with the rest of the starter agent; dropping the whole `agent` folder (packaged in the browser) or a `.zip` works too.

`QUICKSTART.md` and `QUICKSTART_ZH.md` in the kit repeat these three steps. Everything below is the engineer's version.

### Contents and commands


Download `agent-observer-starter-kit.zip` from the Resources page. Layout: `agent/` (the submission: `minimal_agent.py`, `decision_graph.py`, `model_factory.py`, `protocol.py`, `state.py`, `scoring_preview.py`, `requirements.txt`, `.env.example`), `challenge/` (the public environment: contracts, calendar, tile geometry, weather, requests, workflow, scorer, replay renderer), `scenarios/dev-reference/` (the public 180-night scenario), `local_runner.py`, `score_decisions.py`, `make_scenario.py`, `fetch_scenario.py`, `pack_agent.py`, `sac_submit.py`, `SKILL.md` and `README.md`. Python 3.9 or newer and the standard library are enough (the macOS system `python3` works; on Windows install Python 3.12 from python.org).

```
python3 local_runner.py --scenario scenarios/dev-reference --agent agent/minimal_agent.py --wallclock 600 --out run_output
python3 score_decisions.py --scenario scenarios/dev-reference --decisions run_output/decisions.csv
python3 make_scenario.py --out scenarios/mine --seed 7 --days 30 --start-date 2026-10-05
python3 pack_agent.py --agent agent --out my-agent.zip
python3 fetch_scenario.py --list && python3 fetch_scenario.py dev-fortnight   # other public scenarios -> scenarios/<slug>/
```

`run_output/decisions.csv` is what you upload as a results file; `run_output/score_report.json` is the report the platform produces (identical when the scenario's weather and events are public); `run_output/decision_replay.html` is the same replay the submission page embeds. `fetch_scenario.py` downloads any published scenario (for example `dev-fortnight`) into `scenarios/<slug>/` with checksums verified; the same files are also linked one by one on the Resources page. The minimal agent runs without any package or key (`MODEL_PROVIDER=deterministic`) and completes a 180-night scenario in a few seconds of wall time.

## 3. Data formats

Conventions: UTF-8 (a BOM is tolerated), comma-separated, the header must contain exactly the listed columns in this order. Timestamps are `YYYY-MM-DDTHH:MM:SSZ` (UTC). Intervals are half-open `[start, end)`. Booleans are lowercase `true` / `false`. Identifiers: nights `N20260907`, slots `N20260907-S001`, tiles `T00001`, regions `R00`–`R07`, requests `RQ0001`, targets `TG00000001`.

### Scenario directory

| Path | Contents | Visibility |
|---|---|---|
| `config/scenario_config.json` | scenario id, seed, `competition.global_wallclock_seconds` | public |
| `config/calendar_config.json` | site (latitude 31.9634°, longitude −111.599°, UTC−7, sun altitude limit −12°), survey start, days, `slot_seconds` 900 | public |
| `config/tile_config.json` | catalogue layout (8 regions × 8 tiles, 2 REQUIRED per region, one of them available for 14 days only), altitude limit 30°, lunar model, target classes | public |
| `config/weather_config.json` | quality processes, closure model, forecast horizon and error model, event catalogue, `score_interface` | public |
| `config/request_config.json` | request cadence, deadline classes, reward 140 and miss penalty 190 per required tile | public |
| `config/workflow_config.json` | `global_wallclock_seconds`, weekly horizon 7 days, no per-decision timeout | public |
| `config/score_config.json` | thresholds, program bonus, penalties, FLEXIBLE quota | public |
| `outputs/reference/night_calendar.csv`, `slots.csv` | the shared time axis (37–47 slots per night) | public |
| `outputs/reference/tiles.csv`, `targets.csv`, `tile_windows.csv` | catalogue, per-target science weights, sample visibility windows | public |
| `outputs/reference/observation_requests.csv`, `observation_request_tiles.csv` | pre-generated requests and their tiles | public |
| `outputs/reference/weather.csv` | site baseline weather per slot | public on practice scenarios only |
| `outputs/reference/weather_forecasts.csv` | uncertain, daily-revised forecasts | per scenario flag |
| `outputs/reference/weather_events.csv` | directional disruption events (the truth behind `active_event_ids`) | hidden on competition scenarios |
| `outputs/reference/scenario_manifest.json`, `*_metadata.json` | row counts and SHA-256 of every file | public |

### tiles.csv

```
tile_id,ra_deg,dec_deg,nominal_exptime_seconds,region_id,scheduling_class,available_from_utc,available_until_utc,n_lrg,n_elg,n_qso,n_bgs
```

`scheduling_class` is `REQUIRED` or `FLEXIBLE`. A tile can only be observed inside `[available_from_utc, available_until_utc)`. There is no fixed program per tile: the agent chooses `DARK`, `BRIGHT` or `BACKUP` at decision time and is rewarded when the choice matches the quality band of the exposure. Exposure times are 450, 600, 900, 1200 or 1350 seconds.

### targets.csv

```
target_id,tile_id,target_class,feature_flux,redshift,science_weight
```

The value of a tile is `V_tile = Σ science_weight` over its targets (LRG 1.0, ELG 1.0, QSO 1.7, BGS 0.45 by default). The platform publishes it as `tile_science_value` in the initial message.

### weather.csv

```
slot_id,night_id,timestamp_utc,duration_seconds,is_observable,seeing_arcsec,transparency,sky_quality,instrument_efficiency
```

When `is_observable=false` the four quality fields are empty: the dome is closed, the slot still exists and consumes time. `sky_quality` is a linear quality (higher is better). This file is the site baseline; the conditions a tile actually sees also depend on directional events (`weather_events.csv`), which the platform applies for you and reports as `effective_weather` per candidate tile.

### weather_forecasts.csv and weather_events.csv

Forecasts carry an issue time, a predicted event window, a probability and a spatial scope; they are revised daily and can miss or invent events (12 % miss rate, 6 false positives per scenario by default). The platform only ever shows the revisions that were issued at or before the current cursor. Events have a scope (`ALL`, `REGION_SET`, `SKY_CAP_ICRS`, `HORIZON_SECTOR`, `TILE_SET`), a condition (`rainy`, `cloudy`, `smoggy`, `rocket_launch`, `cold_wave`, `tornado`) and multipliers; some force a closure for the tiles they cover.

### observation_requests.csv and observation_request_tiles.csv

```
request_id,issued_at_utc,available_from_utc,deadline_utc,deadline_class,completion_mode,required_tile_count,reward,miss_penalty,reason
request_id,tile_id,required_visits
```

A request appears in the snapshots once issued and disappears at its deadline. Tag an observation with the `request_id` to count it towards the request; a request-tagged revisit of a tile you already completed counts for the request but earns no ordinary science credit. `ALL` requests need every listed tile, `AT_LEAST_N` requests need `required_tile_count` of them.

### decisions.csv

```
decision_id,slot_id,action,tile_id,program,request_id,reason
```

1. `decision_id` is any non-empty unique string (the platform generates `D000001`, `D000002`, …).
2. `action` is `observe` or `wait`. `wait` rows leave `tile_id`, `program` and `request_id` empty and consume the rest of the current slot. `observe` rows need a `tile_id` and a `program` in `DARK`, `BRIGHT`, `BACKUP`; `request_id` is optional.
3. `slot_id` is the slot in which the action starts. An exposure runs from the cursor for the tile's `nominal_exptime_seconds`, may cross slot boundaries and is scored per segment. A short exposure can be followed by another action in the same `slot_id`.
4. A slot later than the cursor inserts implicit waits; a slot earlier than the cursor is a `stale_decision` (penalised, no time consumed); an unknown slot is `unknown_slot`.
5. A malformed table (wrong header, unknown action, `wait` with a tile, `observe` without tile or program, duplicate `decision_id`) is rejected as an invalid submission. Everything else is scored, never rejected.

### score_report.json (`score-report-v3`)

`score{total, base_science, program_bonus, request_reward, penalties{unsafe_observation, invalid_action, avoidable_wait, required_miss, flexible_shortfall, request_miss}}`, `completion{completed_tiles[], required_missing[], flexible_by_region{}, flexible_shortfall{}}`, `requests[{request_id, status, satisfied_tile_count, required_tile_count, feasible_tile_count, reward, penalty}]`, `wait_seconds{explicit, implicit, invalid, avoidable, unavailable}`, `actions[]` with one entry per decision (`outcome`, `start_utc`, `elapsed_seconds`, `base_science_score`, `program_bonus_score`, `penalty`, `segments[]` with airmass, active events, atmospheric and lunar quality, quality band and program match), `termination_reason`, `final_cursor`, `parameters` and `input_sha256`.

Action outcomes: `completed`, `wait`, `weather_interrupted`, `geometry_or_night_interrupted`, `unsafe_observation`, `invalid_observe`, `invalid_request_tag`, `duplicate_tile`, `outside_tile_window`, `unknown_slot`, `stale_decision`.

## 4. Participant protocol (participant-agent-protocol-v1)

The platform starts your entry script once per scenario (`minimal_agent.py`, `agent.py` or `main.py`, whichever exists first, at the root of the package or in its single top-level folder) and keeps the process alive for the whole run. Messages are one JSON object per line on standard input and output; print nothing else to standard output. Standard error is captured into `agent.log`, which you can download from the submission page. Every message carries `protocol_version`, `message_type` and (except `initialize`) `decision_sequence`.

### `initialize` (platform → agent, once, no reply)

Payload `initial-publication-v2`: `calendar` (first and last night, night and slot counts, slot duration), `site`, `tile_catalog` (every tile with its public columns plus `tile_science_value`, `required_tile_ids`, `region_ids`), `target_catalog` (all targets), `scoring_contract` (the full `score_config.json`, the weather score interface and the lunar model) and `global_wallclock_seconds`. About 2 MB for the reference catalogue. You have 30 seconds to start and read it; the global wall clock starts after it has been sent.

### `decision_request` (platform → agent, once per decision)

Payload `decision-snapshot-v2`:

- `cursor`: `slot_id`, `night_id`, `timestamp_utc`, `slot_offset_seconds`.
- `current_site_weather`: the current slot's baseline conditions (`is_observable`, `seeing_arcsec`, `transparency`, `sky_quality`, `instrument_efficiency`, `active_event_ids`).
- `candidate_tiles`: tiles that are not completed, inside their availability window, above 30° now and whose tonight window contains the cursor. Each carries `scheduling_class`, `nominal_exptime_seconds`, `tile_science_value`, `window_start_utc` / `window_end_utc`, `geometry` (altitude, azimuth, hour angle, airmass, moon separation, `lunar_quality_factor`) and `effective_weather` (site weather after directional events for this tile). A candidate may still be unable to finish before its window ends; `scoring_preview.py` filters those.
- `active_requests`: issued, unexpired requests with their tile requirements and completed visits.
- `night_start`: on the first slot of each night, the night row and tonight's tile windows; otherwise `null`.
- `weekly`: on the first slot of every seventh night, the forecasts as issued so far, the tile windows for the next seven days and the requests; otherwise `null`.
- `progress`: `completed_tile_ids`, `flexible_completed_by_region`.

There is no future weather in any message. Reading a snapshot never advances time; only a committed action does.

### `decision_response` (agent → platform)

```
{"protocol_version": "participant-agent-protocol-v1", "message_type": "decision_response", "decision_sequence": 12,
 "action": "observe", "tile_id": "T00037", "program": "DARK", "request_id": "", "reason": "highest preview estimate", "decision_source": "deterministic"}
{"protocol_version": "participant-agent-protocol-v1", "message_type": "decision_response", "decision_sequence": 13,
 "action": "wait", "tile_id": "", "program": "", "request_id": "", "reason": "no completable candidate", "decision_source": "deterministic"}
```

`decision_sequence` must match the request. `action` must be `observe` or `wait`; anything else, a malformed line or an exited process ends the run with `termination_reason = agent_error` and the actions committed so far are scored. Unknown tiles, wrong programs or bad request tags are not rejected: the scorer commits them as penalised invalid actions and time moves on.

### Time accounting

One global wall clock per scenario (`global_wallclock_seconds`, shown on the Resources and Submit pages: 7200 s for the reference scenario, less for short ones). It runs from the end of the initial publication until the survey is complete or the clock expires, and it includes snapshot serialisation, your think time and parsing. There is no per-decision limit. A response that arrives at or after the cutoff is discarded (`ignored_in_flight_response`), the process is terminated and the committed actions are scored with the terminal penalties applied; the report says `global_wallclock_expired`. Unprocessed future time is not turned into avoidable waits.

## 5. Scoring (challenge-score-v3)

For every completed exposure, each segment (split at slot boundaries, evaluated at its midpoint) contributes

```
A_atm      = min(instrument_efficiency · transparency · sky_quality / (seeing_arcsec · airmass), 3.0)
combined   = A_atm · lunar_quality_factor
band       = DARK if combined ≥ 0.65, BRIGHT if combined ≥ 0.40, else BACKUP
base       = V_tile · (segment_seconds / nominal_exptime_seconds) · combined
bonus      = base · {DARK: 0.25, BRIGHT: 0.15, BACKUP: 0.08}[program]   if program == band, else 0
```

`total = base_science + program_bonus + request_reward − unsafe_observation − invalid_action − avoidable_wait − required_miss − flexible_shortfall − request_miss`, with the constants of `config/score_config.json`:

| Term | Rule | Amount |
|---|---|---|
| `unsafe_observation` | `observe` while `is_observable=false` at the start; the rest of the slot is consumed | 2000 per action |
| `invalid_action` | unknown tile, program or slot, duplicate tile, outside the availability window, bad request tag, exposure that cannot finish before the tile sets or the night ends, stale decision | 100 per action |
| `avoidable_wait` | seconds spent waiting while some uncompleted tile could have been completed | 0.001 per second (≈ 0.9 per empty slot) |
| `required_miss` | REQUIRED tile not completed at the end of the run | 1000 per tile |
| `flexible_shortfall` | fewer than 4 FLEXIBLE tiles completed in a region | 100 per missing tile |
| `request_miss` | request expired with fewer visits than required, unless no feasible opportunity existed (`excused_unobservable`) | `miss_penalty` per required tile (190) |
| `request_reward` | request completed before its deadline | `reward` per required tile (140) |

Only completed exposures score. An exposure whose later segment meets closed weather is `weather_interrupted` (no science, no penalty); one that runs into the tile setting below 30° or the end of the night is `geometry_or_night_interrupted` (no science, invalid-action penalty). A tile scores once; the lunar factor lowers `combined` continuously when the moon is up and can change the matching program. Terminal penalties (`required_miss`, `flexible_shortfall`, `request_miss`) are applied even to runs cut short by the wall clock or an agent error.

`scoring_preview.py` estimates the marginal value of each candidate from the current snapshot only (no future weather); it is the same code the minimal agent uses and never replaces the official replay.

## 6. Platform runs and limits

| Item | Value |
|---|---|
| Interpreter | Python 3.12, `python -B <entry>`, `cwd` = your package directory |
| Entry script | `minimal_agent.py`, `agent.py` or `main.py` at the package root (or in its single top-level folder) |
| Dependencies | optional `requirements.txt`, installed with pip into a per-run virtual environment before the clock starts (15 minutes maximum) |
| Secrets | optional `.env` (`KEY=VALUE` lines) loaded into the agent's environment only; never logged or uploaded |
| Network | allowed (model APIs); an egress proxy may be configured by the organizers |
| Initialization | 30 s to start and read `initialize`; failure is `agent_initialization_error` |
| Wall clock | the scenario's `global_wallclock_seconds`; no per-decision limit |
| Memory / CPU | 2 GB, one CPU, 128 processes, 256 MB of written files under the package's `scratch/` directory |
| Package | `.zip` (a bare `.py` is accepted when it needs nothing else) ≤ 20 MB, ≤ 2,000 files, ≤ 50 MB uncompressed, no symlinks |

Environment variables available to the agent: `PARTICIPANT_PROTOCOL=participant-agent-protocol-v1`, `SAC_SCENARIO` (slug), `SAC_WALLCLOCK_SECONDS`, `HOME` and `TMPDIR` (the scratch directory), plus everything from your `.env`. The scenario directory is never mounted into the agent's sandbox; the only weather you see is what the snapshots publish.

## 7. Submitting

### From the website

Dashboard → Submit. Choose the phase, the submission type, the scenario (results files only, public-weather scenarios only) and the file. The page shows the scenario's global wall clock and how many submissions your team has left today. Each submission gets a page with the score breakdown, completion, requests, wait seconds, the termination reason, the agent-run panel (committed actions, wall clock used, `agent.log`, `workflow_result.json`), the interactive decision replay, the observed-sky map, the action timeline and the downloadable `score_report.json` / `decisions.csv`.

### From the command line

```
python3 sac_submit.py --phase practice --kind results --scenario dev-fortnight --file run_output/decisions.csv --wait
python3 sac_submit.py --phase online --kind agent --file my_agent.zip --wait
```

`sac_submit.py` reads `SAC_URL`, `SAC_KEY`, `SAC_EMAIL` and `SAC_PASSWORD` (see the Resources page) and `--wait` polls until the evaluation finishes.

## 8. Practice versus online

| | Practice | Online competition |
|---|---|---|
| Scenarios | `dev-reference` (180 nights, the published example) and `dev-fortnight` (14 nights); weather, forecasts and events public | `eval-a`, `eval-b` (30 nights each); weather, forecasts and events hidden |
| Submissions | results files or agent packages, 50 per team per day | agent packages only, 10 per team per day |
| Score | informational board | mean over the two scenarios; decides the awards |

Because the practice scenarios publish `weather_events.csv`, a local `score_decisions.py` run reproduces the platform report exactly. On the competition scenarios only the platform can score, and only through the protocol.

## 9. Strategy notes

1. REQUIRED tiles cost 1000 each when missed and half of them are available for only 14 days: schedule them first.
2. Four FLEXIBLE tiles per region avoid the 100-per-tile shortfall; spreading exposures across regions matters more than squeezing one region.
3. The program bonus is worth 25 % / 15 % / 8 % of the base; use `combined_quality` from the preview to pick the band, remembering that a long exposure can drift into a different band as the moon rises or the airmass grows.
4. Waiting is cheap (0.9 per slot) compared with a 2000-point unsafe exposure: never observe into `is_observable=false`, and prefer tiles whose `effective_weather` is open when directional events are active.
5. Requests pay 140 per required tile and cost 190 when missed: check `active_requests` on every snapshot and tag the observation with the `request_id`.
6. The wall clock is global. A model call per decision is affordable for a few hundred decisions, not for the ~8,000 decisions of a 180-night scenario; let deterministic code answer the obvious waits.

## 10. Local verification checklist

1. `local_runner.py` finishes with `termination_reason = survey_complete` on `scenarios/dev-reference` (and on a fresh `make_scenario.py` seed).
2. `score_decisions.py` on the produced `decisions.csv` prints the same `score.total` as the run.
3. The package unzips to an entry script at its root, `requirements.txt` installs into a fresh virtual environment, `.env` holds only the keys the agent needs.
4. The agent writes only to `scratch/` and prints only protocol lines to standard output.
