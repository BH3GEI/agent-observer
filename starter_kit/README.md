# Agent Observer — starter kit

Files in this kit are the ones the evaluation platform uses. Local results and platform results
agree for the same scenario.

| File | Purpose |
|---|---|
| `agent.py` | Baseline agent (observer-v1 protocol). Replace `decide()` with your strategy. |
| `local_runner.py` | Runs an agent through the protocol and scores it locally. |
| `protocol.py` | Builds the state the agent sees. Same file as on the platform. |
| `scorer.py`, `score_config.json` | The frozen stage-one scorer and constants. |
| `generate_example_data.py` | Seeded generator for new weather / tile scenarios. |
| `example/` | Published development scenario (seed 11): 2 nights x 12 slots, 72 tiles. |
| `sac_submit.py` | Command-line submission with your API token. |
| `SKILL.md` | Step-by-step instructions an AI coding agent can follow. |

## Quick start (Python 3.9+, no dependencies)

```bash
python3 local_runner.py --agent agent.py --weather example/weather.csv --tiles example/tiles.csv \
    --config score_config.json --out run_output
```

The last line is a JSON summary with the score. `run_output/decisions.csv` can be uploaded as a
results file; `run_output/score_report.json` is the same report the platform produces.

Generate more scenarios so the strategy does not tune to a single weather sequence:

```bash
python3 generate_example_data.py --seed 7 --n-nights 5 --slots-per-night 20 --n-tiles 150 --output-dir scenario7
python3 local_runner.py --agent agent.py --weather scenario7/weather.csv --tiles scenario7/tiles.csv \
    --config score_config.json --out run7 --quiet
```

## Submit

1. Register on the platform website and create or join a team.
2. The platform URL and public key are shown on the Resources page (or set SAC_URL / SAC_KEY / SAC_EMAIL / SAC_PASSWORD in the environment).
3. Results file (public scenario):
   `python3 sac_submit.py --url https://<ref>.supabase.co --key <anon key> --email you@x.org --password '...' --phase practice --kind results --scenario dev-example --file run_output/decisions.csv --wait`
4. Agent package (the platform runs it on hidden weather):
   `python3 sac_submit.py --url ... --key ... --email ... --password ... --phase online --kind agent --file agent.py --wait`

Platform runs use Python 3.12 with the standard library only, no network, 20 s per decision and
10 minutes per scenario. See the Docs page for the full protocol and the Rules page for scoring.
