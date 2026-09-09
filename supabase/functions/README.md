# Supabase Edge Functions

Deno (2.x) edge functions for the Agent Observer competition platform.

```
supabase/functions/
├── deno.json              # tasks (test / check), import map, compiler options
├── _shared/
│   ├── scorer.ts          # 1:1 TypeScript port of scoring/scorer.py (frozen stage-one scorer)
│   ├── scorer_test.ts     # parity + regression tests (deno test -A _shared)
│   └── metrics.ts         # derive_metrics() port (completion / uniformity / summary)
├── score-results/index.ts # scores `results` submissions in-process (webhook target)
└── leaderboard/index.ts   # public CORS wrapper around the leaderboard() RPC
```

## `_shared/scorer.ts`

A faithful port of `scoring/scorer.py`: same validation rules and error
messages (thrown as `ScoringError`), same floating-point order of operations,
Python-compatible `round(x, 6)` (round-half-even on the exact value), and
microsecond-resolution timestamps that mirror `datetime`/`timedelta`.

```ts
import { scoreFiles, ScoringError } from "../_shared/scorer.ts";
const report = scoreFiles(weatherCsv, tilesCsv, decisionsCsv, configJson);
```

`scoreFiles` takes file *contents* (strings) rather than paths. Error messages
use the logical file name (`weather.csv: row 3: ...`) where the Python version
prints the path it was given. The report has exactly the same keys as the
Python report (`schema_version, status, score, science_score, waste_penalty,
total_waste_seconds, waste_breakdown_seconds, unavailable_unpenalized_seconds,
completed_tiles, invalid_actions, region_completion, actions[]`).

`_shared/metrics.ts` exports `deriveMetrics(report, nTiles)`, the port of
`derive_metrics` from the legacy FastAPI service (`completion`, `uniformity`,
`n_actions`, `n_observations`, ...). It is stored in `evaluations.summary`.

## `score-results`

Scores a **`results`** submission (an uploaded `decisions.csv`) entirely inside
Supabase. `agent` submissions are ignored (`{skipped: true}`) and left for the
external worker.

* **Method:** `POST`
* **Auth (one of):**
  * `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`
  * `x-webhook-secret: <SCORER_WEBHOOK_SECRET>` (only if that secret is set)
  Anything else gets `401`.
* **Body:** either the Database Webhook payload
  `{"type":"INSERT","table":"submissions","record":{...}}` or a manual
  `{"submission_id": 123}`.

Pipeline:

1. `rpc('claim_submission_by_id', {p_id, p_worker: 'edge:score-results'})` —
   if the row is not `queued` any more the function answers `200 {skipped:true}`.
2. Loads the submission and its scenario (`slug`, `n_tiles`).
3. Downloads `scenarios/<slug>/{weather.csv,tiles.csv,score_config.json}` and
   `submissions/<storage_path>`.
4. Runs `scoreFiles`.
   * `ScoringError` → writes `results/<team_id>/sub-<id>/<slug>/report.json`
     (`{status:"invalid_submission", error}`), upserts `evaluations`
     (`status='invalid'`) and sets the submission to `invalid`.
   * Success → uploads `report.json` (pretty JSON, sorted keys) and the
     uploaded `decisions.csv` to `results/<team_id>/sub-<id>/<slug>/`, upserts
     `evaluations` (`status='scored'`, score, science_score, completion,
     uniformity, report_path, decisions_path, `summary = deriveMetrics(...)`,
     runtime_seconds, finished_at) and updates the submission (`status='scored'`,
     score, science_score, completion, uniformity,
     `metrics = {scenarios:[{slug,score,science_score,completion,uniformity}]}`,
     finished_at).
5. Any unexpected exception → submission `status='failed'` with the error
   message, HTTP `500`.

`report_path` / `decisions_path` are stored as `results/<team_id>/sub-<id>/<slug>/...`
(bucket name + object key). Uploads use `upsert: true`, so re-scoring a
submission overwrites the previous artefacts.

Responses are JSON, e.g.
`{"ok":true,"submission_id":42,"scenario":"phase1-a","status":"scored","score":10377.46,...}`.

## `leaderboard`

* **Method:** `GET` (plus `OPTIONS` pre-flight), CORS `Access-Control-Allow-Origin: *`
* **Query:** `phase` (optional phase slug; defaults to the RPC's current phase),
  `limit` (default 20, max 500)
* Calls `rpc('leaderboard', {p_phase_slug, p_limit})` with the anon key
  (the caller's `Authorization` header is forwarded when present so admins see
  hidden boards).
* Response: `{phase, limit, entries:[...], data:[...], generated_at}` — `entries`
  and `data` hold the same rows so the Vue site can use either. Row keys:
  `rank, team_id, team_name, team_slug, total_score, science_score,
  completion_rate, uniformity_score, submission_count, best_submission_id, kind,
  scored_at`.

## Environment / secrets

| Variable | Used by | Notes |
|---|---|---|
| `SUPABASE_URL` | both | auto-provided in the edge runtime |
| `SUPABASE_SERVICE_ROLE_KEY` | score-results | auto-provided in the edge runtime; also the bearer token accepted for manual calls |
| `SUPABASE_ANON_KEY` | leaderboard | auto-provided in the edge runtime |
| `SCORER_WEBHOOK_SECRET` | score-results | **optional**; shared secret sent by the Database Webhook in `x-webhook-secret`. Set with `supabase secrets set SCORER_WEBHOOK_SECRET=<random>` |

## Local development

Deno is required (2.x). From `supabase/functions`:

```bash
deno task test    # deno test -A _shared   (scorer parity + regression tests)
deno task check   # deno check on both functions and the shared modules
```

The tests read `starter_kit/example/*` relative to the repository root and
compare against the frozen `score_report.json` (tolerance 1e-6 for floats,
exact for integers/strings).

## Deploy

```bash
supabase functions deploy score-results --no-verify-jwt
supabase functions deploy leaderboard --no-verify-jwt
supabase secrets set SCORER_WEBHOOK_SECRET=<random-string>   # optional but recommended
```

`--no-verify-jwt` is needed because the webhook and the public leaderboard do
not carry a user JWT; `score-results` performs its own authentication (service
role bearer or `x-webhook-secret`).

## Database Webhook

Create it in the dashboard (Database → Webhooks → *Create a new hook*) or via
SQL:

* **Name:** `score-results`
* **Table:** `public.submissions`
* **Events:** `INSERT`
* **Type:** HTTP Request, method `POST`
* **URL:** `https://<project-ref>.supabase.co/functions/v1/score-results`
* **HTTP Headers:**
  * `Content-Type: application/json`
  * `x-webhook-secret: <SCORER_WEBHOOK_SECRET>`
    (or `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` if you prefer not
    to set the extra secret)
* **Timeout:** 5000 ms is fine — the function claims the row immediately and
  keeps working after the webhook returns.

Equivalent SQL (`pg_net` must be enabled):

```sql
create or replace trigger score_results_webhook
after insert on public.submissions
for each row
execute function supabase_functions.http_request(
  'https://<project-ref>.supabase.co/functions/v1/score-results',
  'POST',
  '{"Content-Type":"application/json","x-webhook-secret":"<SCORER_WEBHOOK_SECRET>"}',
  '{}',
  '5000'
);
```

Manual (re)scoring of a queued submission:

```bash
curl -X POST https://<project-ref>.supabase.co/functions/v1/score-results \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"submission_id": 42}'
```

(Use `admin_submission_action(id, 'requeue')` / `admin_rescore_phase(slug)`
first if the submission is not in `queued` state.)
