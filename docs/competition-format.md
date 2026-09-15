# Competition format: what the platform implements

This records the decision the science team asked for ("我们决定的比赛方式会影响后续接口的设计，所以需要大家敲定最终版本")
and points at the code that implements it. Both formats that were on the table are supported; they are used in
different phases rather than one replacing the other.

## The decision

| | Practice phase | Online competition phase |
|---|---|---|
| Submission | `decisions.csv` (results file) **or** an agent package | agent package only |
| Weather | published in full, including `weather_events.csv` | hidden: weather, forecasts and events are not downloadable |
| Who runs the survey | the participant, locally | the platform, one process per scenario |
| Scenarios | `demo-week` (7 nights), `dev-fortnight` (14), `dev-reference` (180) | `eval-a`, `eval-b` (30 nights each) |
| Daily limit per team | 50 | 10 |
| Counts for awards | no | yes, mean over both scenarios |

Rationale, in the terms the original discussion used:

- The **results-file** route is the one that works when the weather CSV is public. The participant replays the
  weather with the shipped simulators, produces a decision sequence and the scorer grades it. Local and platform
  scores are byte-identical, so this is the fastest feedback loop and the easiest to debug. It is kept for practice.
- The **hosted-agent** route is the answer to the fairness concern. If a participant holds the whole weather
  sequence, a global optimiser beats any honest online policy. On hidden scenarios the platform starts the agent
  itself and gives it only the snapshot for the current slot, so future weather is unavailable by construction.
  It is the only route for the phase that decides the awards.

Keeping both costs nothing in interface terms: they meet at `decisions.csv`. The hosted run produces exactly the
file a participant would have uploaded, and the same scorer grades both.

## Where each piece lives

| Concern | Code |
|---|---|
| Submission kind (`results` \| `agent`) | `public.submission_kind` enum, `supabase/migrations/20260909000100_core.sql` |
| Which kinds a phase accepts | `phases.allow_results` / `phases.allow_agents`, enforced in the `create_submission` RPC |
| Which scenarios a phase uses | `phase_scenarios`, seeded in `worker/main.py` (`DEFAULT_SCENARIOS`, `seed()`) |
| Per-file visibility of a scenario | `scenarios.weather_public` / `forecasts_public` / `events_public`; enforced when the scenario is published to storage |
| Results-file evaluation | `worker/main.py` `evaluate()`, `kind == "results"` branch: the upload becomes `decisions.csv` and goes straight to the scorer |
| Hosted agent run | `worker/challenge_runner.py` via `evaluate()`, `kind == "agent"`: per-run venv, scrubbed environment, rlimits, one global wall clock, process-group kill at the cutoff |
| Agent transport | `challenge/run_challenge.py` (`JsonLineAgentProcess`), protocol `participant-agent-protocol-v1` |
| Scoring | `challenge/scoring_core.py`, unchanged from the science team; weights in `scoring/score_config.json` |
| Replay visualization | `challenge/replay.py` + `challenge/templates/decision_replay.html`; produced for both kinds and uploaded as `decision_replay.html` |
| Local equivalent of the hosted run | `starter_kit/local_runner.py` — same transport, same environment rules, same scorer |

## Scenario generation

All scenarios come from one generator, `challenge/scenario_builder.py`, driven by the tile, weather, calendar and
request simulators delivered by the science team. A scenario is a directory of `config/*.json` plus
`outputs/reference/*.csv`, checksummed and validated by the authoritative scorer before it is registered.

```bash
# public practice scenario, everything downloadable
python -m worker.main gen-scenario --slug demo-week --seed 20261005 --days 7 --start-date 2026-10-05 --wallclock 900

# competition scenario, weather and forecasts withheld
python -m worker.main gen-scenario --slug eval-c --seed 777 --days 30 --start-date 2026-10-05 --wallclock 3600 \
  --hidden-weather --hidden-forecasts
```

The `demo-week` parameters above are the same ones that produced `starter_kit/scenarios/demo-week`, so the copy in
the downloaded kit and the copy the platform publishes are the same scenario.

## Open operational items

These are decisions for the organizers, not code changes:

- Rotate the seeds of `eval-a` / `eval-b` before the online phase. The seeds and the generator are public, so any
  scenario whose parameters have been published can be rebuilt locally — hidden weather is only hidden while the
  parameters are.
- Decide how many worker runners to keep alive during the online phase. A 1–2 h wall clock per scenario means one
  runner serialises submissions.
