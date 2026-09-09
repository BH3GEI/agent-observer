# Agent Observer · 巡天智能体 — competition platform (Supabase edition)

Event website and evaluation backend for the GOSIM "Agent Observer" hackathon (intelligent survey
operations). The website is a static Vue 3 site in the style of create.gosim.org/survey26; everything
stateful lives in one Supabase project; participant agents are executed by a small Python worker.

```
web/                 Vue 3 + Vite + Tailwind 4 + supabase-js static site (GitHub Pages)
supabase/migrations  Postgres schema, RLS policies, RPCs, storage buckets/policies
supabase/functions   Edge functions: score-results (TypeScript port of the scorer), leaderboard (public JSON)
worker/              Python evaluation worker: sandboxed agent runs + scoring, scenario seeding, admin CLI
scoring/             The frozen scorer (scorer.py, unchanged from the hand-off package) + observer-v1 protocol
starter_kit/         What participants download: baseline agent, local runner, example data, CLI, SKILL.md
tests/               pytest: scorer/sandbox parity, and platform integration tests against a local Supabase-like harness
legacy/fastapi/      The earlier self-hosted monolith (reference only)
```

## How the pieces fit

| Concern | Where | Notes |
|---|---|---|
| Accounts | Supabase Auth (email + password) | `handle_new_user` trigger creates `profiles`; emails listed in `site_settings.admin_emails` become admins |
| Teams, invites, membership | Postgres RPCs (`create_team`, `join_team`, …) | Transactional, capacity-checked, security definer; direct writes are revoked |
| Submissions | Storage bucket `submissions/<team_id>/…` + RPC `create_submission` | Enforces phase window, allowed kinds, hidden scenarios, daily limit, team folder |
| Scoring of `decisions.csv` | Edge function `score-results` (Deno) or the worker | Same rules as `scoring/scorer.py`; TS port verified against the reference report |
| Agent runs on hidden weather | `worker/` (Python, sandboxed subprocess or Docker) | Claims queued rows with `claim_submission` (SKIP LOCKED), writes `results/<team>/sub-<id>/<scenario>/…` |
| Leaderboard | SQL function `leaderboard(phase, limit)` | Best scored submission per team, ties by earlier submission, respects hidden boards and hidden teams |
| Admin | RLS (`is_admin()`) + `admin_*` RPCs | Phases, scenarios, announcements, users, teams, rescoring, audit log |
| Files participants may read | Storage policies | `scenarios/<slug>/weather.csv` only when `weather_public`; results only for the owning team |

## Deploy (organizers)

1. **Supabase project** (done once): `supabase link --project-ref <ref>` then `supabase db push`
   (or paste `supabase/migrations/*.sql` into the SQL editor in order). Set Auth → URL configuration:
   Site URL = the website URL, redirect URLs = site URL and `<site>/reset`. Auto-confirm email sign-ups
   (or configure a custom SMTP; the built-in mailer is rate-limited).
2. **Seed** scenarios and phases and promote the first admin:
   `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… python -m worker.main seed`
   `python -m worker.main promote-admin you@org.example`
3. **Edge functions**: `supabase functions deploy score-results --no-verify-jwt` and
   `supabase functions deploy leaderboard --no-verify-jwt`; set secret `SCORER_WEBHOOK_SECRET`; create a
   Database Webhook on `public.submissions` INSERT → `https://<ref>.functions.supabase.co/score-results`
   with header `x-webhook-secret`. See `supabase/functions/README.md`.
4. **Worker**. Default: `.github/workflows/worker.yml` runs `python -m worker.main once` on a GitHub-hosted
   runner every 5 minutes (repository secrets `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; public repos have
   unlimited Actions minutes). Trigger it manually from the Actions tab when you want a queue drained now.
   For lower latency or OS-level network isolation run it on your own machine instead:
   `docker build -f worker/Dockerfile -t sac-worker . && docker run -e SUPABASE_URL -e SUPABASE_SERVICE_ROLE_KEY -e SAC_SANDBOX_MODE=subprocess sac-worker`
   or `python -m worker.main run`. `SAC_WORKER_KINDS=agent` restricts it to agent runs when the edge function
   scores results files. Several workers can run in parallel.
5. **Website**: GitHub Pages via `.github/workflows/deploy-pages.yml`. Repository variables:
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SITE_URL`, `VITE_BASE_PATH` (e.g. `/agent-observer/`).
   Any static host works (`npm run build --prefix web` → `web/dist`).

## Local development and tests

```bash
python3 -m venv .venv && .venv/bin/pip install pytest pgserver "psycopg[binary]"
.venv/bin/pytest tests/test_worker_runner.py            # scorer parity, protocol, sandbox behaviour
SAC_POSTGREST_BIN=/path/to/postgrest .venv/bin/pytest tests/supabase   # migrations + RLS + RPC + worker, on an embedded Postgres + real PostgREST
cd supabase/functions && deno test -A _shared            # TypeScript scorer parity
cd web && npm ci && npm run dev                          # website against your Supabase project (.env)
```

`tests/supabase/harness.py` boots an embedded Postgres, applies the migrations, runs PostgREST with the
project's roles and JWT secret, and emulates the Auth and Storage HTTP APIs so the full participant flow can
be exercised without Docker. Storage policies are not emulated: verify them against the hosted project
(`tests/hosted_smoke.py`).

## Operating the competition

- Phases: rows in `phases` (windows in UTC, allowed kinds, daily limit, `leaderboard_mode` live / frozen /
  hidden / published, `counts_for_final`). Link scenarios in `phase_scenarios`. Editable in the admin UI.
- Scenarios: `python -m worker.main gen-scenario --slug eval-c --seed 4242 --hidden-weather` or
  `add-scenario --weather w.csv --tiles t.csv --hidden-weather` (validated by the frozen scorer; checksum stored).
- Rescore after a scorer fix: `admin_rescore_phase('online')` from the admin UI; workers pick the rows up.
- Announcements: pinned rows show as a banner on every page; also served by `/api`-style `leaderboard` function.
