# SKILL: build, test and submit an Agent Observer entry

Platform website: {{BASE_URL}}
Backend (Supabase) URL: {{SUPABASE_URL}}
Public anon key: {{SUPABASE_ANON_KEY}}

Follow these steps in order. All commands assume Python 3.9+ and no extra packages.

## 1. Get the kit

1. Download `{{BASE_URL}}/download/starter-kit.zip` and unzip it.
2. `cd agent-observer-starter-kit`.

## 2. Understand the task

1. The agent receives JSON lines on stdin: one `init` message, then one `step` message per decision point, then `end`.
2. For each `step` it must print exactly one JSON line: `{"action": "observe", "tile_id": "<id>", "program": "<DARK|BRIGHT|BACKUP>", "reason": "<text>"}` or `{"action": "wait", "reason": "<text>"}`.
3. Useful fields in a `step`: `weather.is_observable`, `forecast` (next 4 slots), `now.night_remaining_seconds`, and `available_tiles` (each with `program_match`, `expected_gain`, `nominal_exptime_seconds`, `airmass`, `priority`, `target_value`).
4. Score: sum of exposure scores minus 0.02 per wasted second. Waiting on an open slot costs 18 points. Exposures that cannot finish before the night ends are invalid. A tile scores once.

## 3. Edit the agent

1. Open `agent.py`. Keep `main()` unchanged. Replace the body of `decide(state, memory)`.
2. Use only the Python standard library. Do not read files outside the current directory. Do not use the network.
3. Keep each decision under a few seconds.

## 4. Test locally

```
python3 local_runner.py --agent agent.py --weather example/weather.csv --tiles example/tiles.csv --config score_config.json --out run_output --quiet
python3 generate_example_data.py --seed 21 --n-nights 5 --slots-per-night 20 --n-tiles 150 --output-dir s21
python3 local_runner.py --agent agent.py --weather s21/weather.csv --tiles s21/tiles.csv --config score_config.json --out run21 --quiet
```

The baseline scores 10377.47 on `example/`. A run must finish without `warning:` lines.

## 5. Submit

1. Ask the user for the email and password of their platform account (they must already be on a team) and the phase slug (`practice` for public scenarios, `online` for the competition).
2. Agent package, evaluated on hidden weather by the platform:
   `python3 sac_submit.py --url {{SUPABASE_URL}} --key {{SUPABASE_ANON_KEY}} --email EMAIL --password PASSWORD --phase PHASE --kind agent --file agent.py --wait`
3. Results file, scored against a public scenario:
   `python3 sac_submit.py --url {{SUPABASE_URL}} --key {{SUPABASE_ANON_KEY}} --email EMAIL --password PASSWORD --phase practice --kind results --scenario dev-example --file run_output/decisions.csv --wait`
4. The command prints the submission URL and, with `--wait`, the final status and score. Report both to the user.

## 6. If the platform reports failure

1. `agent exited before answering`: the script crashed; read the log at the submission URL and fix the exception.
2. `did not answer within 20s`: the decision loop is too slow; cache computations in `memory`.
3. `invalid JSON`: something else was printed to stdout; print diagnostics to stderr instead.
