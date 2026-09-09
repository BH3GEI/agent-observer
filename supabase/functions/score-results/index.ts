/**
 * score-results — Supabase Edge Function.
 *
 * Scores a `results` submission (a decisions.csv uploaded by a team) entirely
 * inside Supabase: claims the queued submission, downloads the scenario files
 * and the uploaded decisions from Storage, runs the frozen scorer, writes the
 * report back to Storage and records the outcome in `evaluations` and
 * `submissions`.
 *
 * Invoked by a Database Webhook (INSERT on public.submissions) or manually
 * with `{ "submission_id": <id> }`.  Agent submissions (`kind = 'agent'`) are
 * left for the external worker.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { loadTiles, type Report, scoreFiles, ScoringError, stableJson } from "../_shared/scorer.ts";
import { deriveMetrics } from "../_shared/metrics.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("SCORER_WEBHOOK_SECRET") ?? "";
const WORKER_NAME = "edge:score-results";

const SCENARIO_BUCKET = "scenarios";
const SUBMISSION_BUCKET = "submissions";
const RESULTS_BUCKET = "results";

interface SubmissionRow {
  id: number;
  team_id: string;
  scenario_id: string | null;
  kind: "results" | "agent";
  status: string;
  storage_path: string;
}

interface ScenarioRow {
  id: string;
  slug: string;
  n_tiles: number | null;
}

interface WebhookPayload {
  type?: string;
  table?: string;
  schema?: string;
  record?: Partial<SubmissionRow> & { id?: number | string };
  submission_id?: number | string;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** Constant-time string comparison (avoids leaking secret length/prefix via timing). */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i += 1) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function isAuthorized(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  if (SERVICE_ROLE_KEY && auth.startsWith("Bearer ") && safeEqual(auth.slice(7).trim(), SERVICE_ROLE_KEY)) {
    return true;
  }
  const secret = req.headers.get("x-webhook-secret") ?? "";
  if (WEBHOOK_SECRET && secret && safeEqual(secret, WEBHOOK_SECRET)) return true;
  return false;
}

function parseSubmissionId(payload: WebhookPayload): number | null {
  const raw = payload.record?.id ?? payload.submission_id;
  if (raw === undefined || raw === null) return null;
  const id = typeof raw === "number" ? raw : Number(String(raw).trim());
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function downloadText(supabase: SupabaseClient, bucket: string, path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) {
    throw new Error(`storage download failed for ${bucket}/${path}: ${error?.message ?? "no data"}`);
  }
  return await data.text();
}

async function uploadText(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
  body: string,
  contentType: string,
): Promise<void> {
  const { error } = await supabase.storage.from(bucket).upload(path, new Blob([body], { type: contentType }), {
    upsert: true,
    contentType,
  });
  if (error) throw new Error(`storage upload failed for ${bucket}/${path}: ${error.message}`);
}

function nowIso(): string {
  return new Date().toISOString();
}

async function markFailed(supabase: SupabaseClient, submissionId: number, message: string): Promise<void> {
  await supabase
    .from("submissions")
    .update({ status: "failed", error: message.slice(0, 2000), finished_at: nowIso() })
    .eq("id", submissionId);
}

interface ScoredOutcome {
  status: "scored" | "invalid";
  report_path: string;
  score?: number;
  science_score?: number;
  completion?: number;
  uniformity?: number;
  error?: string;
}

async function processSubmission(supabase: SupabaseClient, submissionId: number): Promise<Response> {
  const started = performance.now();

  // Peek at the row first so that agent submissions are never claimed here.
  const { data: peek, error: peekError } = await supabase
    .from("submissions")
    .select("id, team_id, scenario_id, kind, status, storage_path")
    .eq("id", submissionId)
    .maybeSingle();
  if (peekError) throw new Error(`cannot load submission ${submissionId}: ${peekError.message}`);
  if (!peek) return json(404, { ok: false, error: `submission ${submissionId} not found` });
  if (peek.kind !== "results") {
    return json(200, { skipped: true, reason: `kind ${peek.kind} is handled by the external worker` });
  }

  // Atomically claim the queued row (status -> running).
  const { data: claimed, error: claimError } = await supabase.rpc("claim_submission_by_id", {
    p_id: submissionId,
    p_worker: WORKER_NAME,
  });
  if (claimError) throw new Error(`claim_submission_by_id failed: ${claimError.message}`);
  const claimedRow = Array.isArray(claimed) ? claimed[0] : claimed;
  if (!claimedRow || claimedRow.id === null || claimedRow.id === undefined) {
    return json(200, { skipped: true, reason: "submission is not queued (already claimed or finished)" });
  }

  try {
    const { data: submission, error: subError } = await supabase
      .from("submissions")
      .select("id, team_id, scenario_id, kind, status, storage_path")
      .eq("id", submissionId)
      .single();
    if (subError || !submission) {
      throw new Error(`cannot load submission ${submissionId}: ${subError?.message ?? "not found"}`);
    }
    const sub = submission as SubmissionRow;
    if (!sub.scenario_id) throw new Error("results submission has no scenario_id");

    const { data: scenario, error: scnError } = await supabase
      .from("scenarios")
      .select("id, slug, n_tiles")
      .eq("id", sub.scenario_id)
      .single();
    if (scnError || !scenario) {
      throw new Error(`cannot load scenario ${sub.scenario_id}: ${scnError?.message ?? "not found"}`);
    }
    const scn = scenario as ScenarioRow;
    const slug = scn.slug;

    const [weatherCsv, tilesCsv, configJson, decisionsCsv] = await Promise.all([
      downloadText(supabase, SCENARIO_BUCKET, `${slug}/weather.csv`),
      downloadText(supabase, SCENARIO_BUCKET, `${slug}/tiles.csv`),
      downloadText(supabase, SCENARIO_BUCKET, `${slug}/score_config.json`),
      downloadText(supabase, SUBMISSION_BUCKET, sub.storage_path),
    ]);

    const resultDir = `${sub.team_id}/sub-${sub.id}/${slug}`;
    const reportKey = `${resultDir}/report.json`;
    const decisionsKey = `${resultDir}/decisions.csv`;
    // stored without the bucket prefix: the site and the worker download from bucket `results` by object key
    const reportPath = reportKey;
    const decisionsPath = decisionsKey;

    let report: Report;
    try {
      report = scoreFiles(weatherCsv, tilesCsv, decisionsCsv, configJson);
    } catch (exc) {
      if (!(exc instanceof ScoringError)) throw exc;
      const message = exc.message;
      const invalidReport = { status: "invalid_submission", error: message };
      await uploadText(supabase, RESULTS_BUCKET, reportKey, stableJson(invalidReport) + "\n", "application/json");
      const finishedAt = nowIso();
      const { error: evalError } = await supabase.from("evaluations").upsert(
        {
          submission_id: sub.id,
          scenario_id: scn.id,
          status: "invalid",
          error: message.slice(0, 2000),
          report_path: reportPath,
          runtime_seconds: (performance.now() - started) / 1000,
          finished_at: finishedAt,
        },
        { onConflict: "submission_id,scenario_id" },
      );
      if (evalError) throw new Error(`evaluations upsert failed: ${evalError.message}`);
      const { error: updError } = await supabase
        .from("submissions")
        .update({ status: "invalid", error: message.slice(0, 2000), finished_at: finishedAt })
        .eq("id", sub.id);
      if (updError) throw new Error(`submissions update failed: ${updError.message}`);
      const outcome: ScoredOutcome = { status: "invalid", report_path: reportPath, error: message };
      return json(200, { ok: true, submission_id: sub.id, ...outcome });
    }

    let nTiles = Number(scn.n_tiles ?? 0);
    if (!Number.isInteger(nTiles) || nTiles <= 0) nTiles = loadTiles(tilesCsv).size;
    const metrics = deriveMetrics(report, nTiles);

    await Promise.all([
      uploadText(supabase, RESULTS_BUCKET, reportKey, stableJson(report) + "\n", "application/json"),
      uploadText(supabase, RESULTS_BUCKET, decisionsKey, decisionsCsv, "text/csv"),
    ]);

    const runtimeSeconds = (performance.now() - started) / 1000;
    const finishedAt = nowIso();
    const { error: evalError } = await supabase.from("evaluations").upsert(
      {
        submission_id: sub.id,
        scenario_id: scn.id,
        status: "scored",
        score: metrics.score,
        science_score: metrics.science_score,
        completion: metrics.completion,
        uniformity: metrics.uniformity,
        report_path: reportPath,
        decisions_path: decisionsPath,
        summary: metrics,
        error: "",
        runtime_seconds: runtimeSeconds,
        finished_at: finishedAt,
      },
      { onConflict: "submission_id,scenario_id" },
    );
    if (evalError) throw new Error(`evaluations upsert failed: ${evalError.message}`);

    const { error: updError } = await supabase
      .from("submissions")
      .update({
        status: "scored",
        score: metrics.score,
        science_score: metrics.science_score,
        completion: metrics.completion,
        uniformity: metrics.uniformity,
        metrics: {
          scenarios: [
            {
              slug,
              score: metrics.score,
              science_score: metrics.science_score,
              completion: metrics.completion,
              uniformity: metrics.uniformity,
            },
          ],
        },
        error: "",
        finished_at: finishedAt,
      })
      .eq("id", sub.id);
    if (updError) throw new Error(`submissions update failed: ${updError.message}`);

    const outcome: ScoredOutcome = {
      status: "scored",
      report_path: reportPath,
      score: metrics.score,
      science_score: metrics.science_score,
      completion: metrics.completion,
      uniformity: metrics.uniformity,
    };
    return json(200, { ok: true, submission_id: sub.id, scenario: slug, runtime_seconds: runtimeSeconds, ...outcome });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc);
    console.error(`score-results: submission ${submissionId} failed: ${message}`);
    try {
      await markFailed(supabase, submissionId, message);
    } catch (inner) {
      console.error(`score-results: could not mark submission ${submissionId} as failed: ${String(inner)}`);
    }
    return json(500, { ok: false, submission_id: submissionId, status: "failed", error: message });
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return json(405, { ok: false, error: "method not allowed; POST a webhook payload or {submission_id}" });
  }
  if (!isAuthorized(req)) {
    return json(401, { ok: false, error: "unauthorized" });
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json(500, { ok: false, error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured" });
  }

  let payload: WebhookPayload;
  try {
    payload = (await req.json()) as WebhookPayload;
  } catch {
    return json(400, { ok: false, error: "body must be JSON" });
  }

  if (payload.table && payload.table !== "submissions") {
    return json(200, { skipped: true, reason: `ignoring table ${payload.table}` });
  }
  if (payload.type && payload.type !== "INSERT") {
    return json(200, { skipped: true, reason: `ignoring event ${payload.type}` });
  }
  if (payload.record?.kind && payload.record.kind !== "results") {
    return json(200, { skipped: true, reason: `kind ${payload.record.kind} is handled by the external worker` });
  }

  const submissionId = parseSubmissionId(payload);
  if (submissionId === null) {
    return json(400, { ok: false, error: "payload must contain record.id or submission_id" });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return await processSubmission(supabase, submissionId);
});
