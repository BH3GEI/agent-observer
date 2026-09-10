"""Evaluation worker (challenge v3): claims queued submissions from Supabase, runs agents / scores decisions, writes results back.

Usage:
  python -m worker.main run | once
  python -m worker.main seed                       # default scenarios + phases (idempotent)
  python -m worker.main add-scenario --slug S --root DIR [--name N] [--hidden-weather] [--hidden-forecasts] [--public-events] [--wallclock 3600]
  python -m worker.main gen-scenario --slug S --seed 7 [--days 180] [--start-date 2026-10-05] [--wallclock 3600] [--hidden-weather] [--regions 8 --tiles-per-region 8]
  python -m worker.main promote-admin EMAIL

Environment: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (service role), SAC_* limits (see worker/config.py).
"""
from __future__ import annotations

import argparse
import json
import logging
import shutil
import sys
import tempfile
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

from challenge import scenario_builder
from challenge.scoring_core import score_files

from . import challenge_runner as cr
from .config import get_settings
from .runner import prepare_agent_dir, AgentPackageError as ZipError
from .supa import Supa, SupabaseError

log = logging.getLogger("sac.worker")
CONTENT_TYPES = {".csv": "text/csv", ".json": "application/json", ".html": "text/html", ".log": "text/plain"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def client() -> Supa:
    s = get_settings()
    return Supa(s.supabase_url, s.service_key)


# ---------------------------------------------------------------------------
# scenario files
# ---------------------------------------------------------------------------

def fetch_scenario(sb: Supa, slug: str, checksum: str) -> Path:
    """Download the complete scenario directory (service role sees hidden files) into the local cache."""
    root = get_settings().data_dir / "scenarios" / slug
    stamp = root / ".checksum"
    if stamp.exists() and stamp.read_text().strip() == checksum and (root / "outputs" / "reference" / "scenario_manifest.json").exists():
        return root
    shutil.rmtree(root, ignore_errors=True)
    names = [f"config/{n}" for n in scenario_builder.CONFIG_FILES] + [f"outputs/reference/{n}" for n in scenario_builder.DATA_FILES]
    names += [f"outputs/reference/{n}" for n in ("scenario_manifest.json", "tile_windows.csv")]
    for rel in names:
        dest = root / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            dest.write_bytes(sb.download("scenarios", f"{slug}/{rel}"))
        except SupabaseError as exc:
            if rel.endswith("tile_windows.csv"):
                continue
            raise
    scenario_builder.describe_scenario(root)
    stamp.write_text(checksum)
    return root


def upload_scenario(sb: Supa, slug: str, root: Path) -> None:
    for p in scenario_builder.scenario_files(root):
        rel = p.relative_to(root).as_posix()
        sb.upload("scenarios", f"{slug}/{rel}", p.read_bytes(), CONTENT_TYPES.get(p.suffix, "application/octet-stream"))


def register_scenario(sb: Supa, *, slug: str, name: str, description: str, root: Path, weather_public: bool, forecasts_public: bool,
                      events_public: bool, tiles_public: bool = True, wallclock: int | None = None) -> dict:
    info = scenario_builder.describe_scenario(root)
    upload_scenario(sb, slug, root)
    row = {"slug": slug, "name": name, "description": description, "weather_public": weather_public, "forecasts_public": forecasts_public,
           "events_public": events_public, "tiles_public": tiles_public, "is_active": True, "n_slots": info["n_slots"], "n_nights": info["n_nights"],
           "n_tiles": info["n_tiles"], "n_targets": info["n_targets"], "n_requests": info["n_requests"], "seed": info["seed"],
           "checksum": info["checksum"], "manifest": info["manifest"], "contract": info["contract"],
           "global_wallclock_seconds": int(wallclock or info["global_wallclock_seconds"])}
    rows = sb.insert("scenarios", row, upsert=True, on_conflict="slug")
    return rows[0] if rows else row


# ---------------------------------------------------------------------------
# metrics
# ---------------------------------------------------------------------------

def metrics_from_report(report: dict, n_tiles: int = 0) -> dict:
    """Leaderboard/summary metrics from a score-report-v3 document."""
    sc = report["score"]
    comp = report.get("completion", {})
    penalties = {k: float(v) for k, v in (sc.get("penalties") or {}).items()}
    completed_ids = comp.get("completed_tiles") or []
    completed = len(completed_ids) if isinstance(completed_ids, list) else int(completed_ids)
    required_missing = comp.get("required_missing") or []
    required_missing_n = len(required_missing) if isinstance(required_missing, list) else int(required_missing)
    shortfall = comp.get("flexible_shortfall") or {}
    shortfall_n = sum(int(v) for v in shortfall.values()) if isinstance(shortfall, dict) else int(shortfall)
    reqs = report.get("requests") or []
    gross = float(sc.get("base_science", 0.0)) + float(sc.get("program_bonus", 0.0)) + float(sc.get("request_reward", 0.0))
    total_tiles = int(n_tiles or 0)
    regions = max(1, len(shortfall) if isinstance(shortfall, dict) else 8)
    return {
        "score": float(sc["total"]), "base_science": float(sc.get("base_science", 0.0)), "program_bonus": float(sc.get("program_bonus", 0.0)),
        "request_reward": float(sc.get("request_reward", 0.0)), "penalty_total": round(sum(penalties.values()), 6), "penalties": penalties,
        "completed_tiles": completed, "total_tiles": total_tiles, "required_missing": required_missing_n, "required_missing_ids": required_missing if isinstance(required_missing, list) else [],
        "flexible_shortfall": shortfall_n, "flexible_shortfall_by_region": shortfall if isinstance(shortfall, dict) else {}, "flexible_by_region": comp.get("flexible_by_region", {}),
        "requests_completed": sum(1 for r in reqs if r.get("status") == "completed"), "requests_total": len(reqs),
        "wait_seconds": report.get("wait_seconds", {}), "n_actions": len(report.get("actions", [])),
        "n_completed_exposures": sum(1 for a in report.get("actions", []) if a.get("outcome") == "completed"),
        "termination_reason": report.get("termination_reason", ""),
        # legacy leaderboard columns kept for the site: science = gross positive score, completion = tiles ratio, uniformity = 1 - shortfall share
        "science_score": gross, "completion": round(completed / total_tiles, 6) if total_tiles else 0.0,
        "uniformity": round(max(0.0, 1.0 - shortfall_n / (4.0 * regions)), 6),
    }


# ---------------------------------------------------------------------------
# evaluation
# ---------------------------------------------------------------------------

def _finish_eval(sb: Supa, ev: dict, out: Path, prefix: str, report: dict, extra: dict, n_tiles: int = 0) -> None:
    m = metrics_from_report(report, n_tiles)
    report_path = out / "score_report.json"
    sb.upload("results", f"{prefix}/report.json", report_path.read_bytes(), "application/json")
    ev.update({"status": "scored", "score": m["score"], "science_score": m["science_score"], "completion": m["completion"], "uniformity": m["uniformity"],
               "base_science": m["base_science"], "program_bonus": m["program_bonus"], "request_reward": m["request_reward"], "penalty_total": m["penalty_total"],
               "completed_tiles": m["completed_tiles"], "required_missing": m["required_missing"], "flexible_shortfall": m["flexible_shortfall"],
               "termination_reason": m["termination_reason"], "report_path": f"{prefix}/report.json",
               "summary": {**(ev.get("summary") or {}), **{k: v for k, v in m.items() if k not in ("penalties", "flexible_by_region", "wait_seconds")},
                           "penalties": m["penalties"], "flexible_by_region": m["flexible_by_region"], "wait_seconds": m["wait_seconds"], **extra}})
    try:
        from challenge.replay import write_replay_html
        html = out / "decision_replay.html"
        write_replay_html(Path(ev["_root"]), report, html, title=extra.get("title", "Agent Observer"), agent_label=extra.get("agent_label", ""))
        sb.upload("results", f"{prefix}/decision_replay.html", html.read_bytes(), "text/html")
        ev["replay_path"] = f"{prefix}/decision_replay.html"
    except Exception as exc:  # noqa: BLE001 - replay is best effort
        log.warning("replay generation failed: %s", exc)


def evaluate(sb: Supa, sub: dict) -> None:
    s = get_settings()
    sid = int(sub["id"])
    team_id = sub["team_id"]
    links = sb.select("phase_scenarios", columns="scenario_id, scenarios(*)", filters={"phase_id": f"eq.{sub['phase_id']}"})
    if sub["kind"] == "results":
        scn_rows = [sb.select_one("scenarios", filters={"id": f"eq.{sub['scenario_id']}"})] if sub.get("scenario_id") else []
    else:
        scn_rows = [r["scenarios"] for r in links if r.get("scenarios") and r["scenarios"].get("is_active")]
    scn_rows = [r for r in scn_rows if r]
    if not scn_rows:
        sb.update("submissions", {"id": f"eq.{sid}"}, {"status": "failed", "error": "no evaluation scenario is configured for this phase", "finished_at": now_iso()})
        return
    work = s.runs_dir / f"sub-{sid}"
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    upload = work / ("upload" + Path(sub["storage_path"]).suffix.lower())
    upload.write_bytes(sb.download("submissions", sub["storage_path"]))
    sb.delete("evaluations", {"submission_id": f"eq.{sid}"})

    agent_dir = None
    if sub["kind"] == "agent":
        agent_dir = work / "agent"
        try:
            prepare_agent_dir(upload, agent_dir)
            cr.find_entry(agent_dir)
        except (ZipError, cr.AgentPackageError) as exc:
            for scn in scn_rows:
                sb.insert("evaluations", {"submission_id": sid, "scenario_id": scn["id"], "status": "invalid", "error": str(exc), "finished_at": now_iso()})
            sb.update("submissions", {"id": f"eq.{sid}"}, {"status": "invalid", "error": str(exc), "finished_at": now_iso()})
            return

    evals: list[dict] = []
    team = sb.select_one("teams", columns="name", filters={"id": f"eq.{team_id}"}) or {}
    for scn in scn_rows:
        slug = scn["slug"]
        root = fetch_scenario(sb, slug, scn.get("checksum", ""))
        out = work / slug
        out.mkdir(parents=True, exist_ok=True)
        prefix = f"{team_id}/sub-{sid}/{slug}"
        ev = {"submission_id": sid, "scenario_id": scn["id"], "status": "failed", "summary": {}, "error": "", "_root": str(root)}
        t0 = time.monotonic()
        label = f"{team.get('name', 'team')} · #{sid}"
        try:
            if sub["kind"] == "results":
                decisions = out / "decisions.csv"
                shutil.copyfile(upload, decisions)
                termination = "trace_complete"
                extra = {"title": f"{scn['name']} · {label}", "agent_label": "results file"}
            else:
                wallclock = float(scn.get("global_wallclock_seconds") or s.default_wallclock_seconds)
                # a fresh copy of the package per scenario keeps runs independent
                pkg = work / f"agent-{slug}"
                shutil.copytree(agent_dir, pkg, symlinks=False)
                result = cr.run_agent_package(pkg, root, out, wallclock_seconds=wallclock, scenario_meta={"slug": slug})
                decisions = out / "decisions.csv"
                termination = result["termination_reason"]
                sb.upload("results", f"{prefix}/agent.log", (out / "agent.log").read_bytes(), "text/plain")
                sb.upload("results", f"{prefix}/workflow_result.json", (out / "workflow_result.json").read_bytes(), "application/json")
                ev["log_path"] = f"{prefix}/agent.log"
                ev["workflow_path"] = f"{prefix}/workflow_result.json"
                ev["accounted_wallclock_seconds"] = result.get("accounted_wallclock_seconds")
                errors = [c.get("error") for c in result.get("commit_log", []) if c.get("error")]
                ev["summary"] = {"committed_actions": result.get("committed_action_count"), "termination_reason": termination,
                                 "ignored_in_flight_response": result.get("ignored_in_flight_response"), "agent_error": errors[-1] if errors else None,
                                 "stderr_tail": (out / "agent.log").read_text(encoding="utf-8", errors="replace")[-2000:]}
                extra = {"title": f"{scn['name']} · {label}", "agent_label": "agent run"}
            try:
                report = score_files(root, decisions, out / "score_report.json", termination)
            except ValueError as exc:
                ev.update({"status": "invalid", "error": f"decisions.csv rejected: {exc}"[:2000]})
                raise
            sb.upload("results", f"{prefix}/decisions.csv", decisions.read_bytes(), "text/csv")
            ev["decisions_path"] = f"{prefix}/decisions.csv"
            _finish_eval(sb, ev, out, prefix, report, extra, int(scn.get('n_tiles') or 0))
            if termination in ("agent_error", "agent_initialization_error"):
                ev["error"] = (ev["summary"].get("agent_error") or termination)[:2000]
        except ValueError:
            pass
        except cr.AgentRunError as exc:
            ev.update({"status": "failed", "error": str(exc)[:2000]})
        ev["runtime_seconds"] = round(time.monotonic() - t0, 3)
        ev["finished_at"] = now_iso()
        ev.pop("_root", None)
        sb.insert("evaluations", ev)
        evals.append(ev)

    scored = [e for e in evals if e["status"] == "scored"]
    if len(scored) == len(evals):
        n = len(scored)
        avg = lambda k: round(sum(float(e.get(k) or 0.0) for e in scored) / n, 6)  # noqa: E731
        sb.update("submissions", {"id": f"eq.{sid}"}, {
            "status": "scored", "score": avg("score"), "science_score": avg("science_score"), "completion": avg("completion"), "uniformity": avg("uniformity"),
            "base_science": avg("base_science"), "program_bonus": avg("program_bonus"), "request_reward": avg("request_reward"), "penalty_total": avg("penalty_total"),
            "completed_tiles": int(sum(e.get("completed_tiles") or 0 for e in scored) / n), "required_missing": int(sum(e.get("required_missing") or 0 for e in scored) / n),
            "flexible_shortfall": int(sum(e.get("flexible_shortfall") or 0 for e in scored) / n),
            "termination_reason": ";".join(sorted({e.get("termination_reason", "") for e in scored})),
            "metrics": {"scenarios": [{"slug": scn["slug"], "score": e["score"], "base_science": e.get("base_science"), "program_bonus": e.get("program_bonus"),
                                       "request_reward": e.get("request_reward"), "penalty_total": e.get("penalty_total"), "completed_tiles": e.get("completed_tiles"),
                                       "required_missing": e.get("required_missing"), "termination_reason": e.get("termination_reason")} for e, scn in zip(evals, scn_rows)]},
            "error": "; ".join(f"{scn['slug']}: {e['error']}" for e, scn in zip(evals, scn_rows) if e.get("error"))[:4000], "finished_at": now_iso()})
    else:
        bad = [e for e in evals if e["status"] != "scored"]
        status = "invalid" if all(e["status"] == "invalid" for e in bad) else "failed"
        err = "; ".join(f"{scn['slug']}: {e['error']}" for e, scn in zip(evals, scn_rows) if e["status"] != "scored")[:4000]
        sb.update("submissions", {"id": f"eq.{sid}"}, {"status": status, "error": err, "score": None, "finished_at": now_iso()})
    shutil.rmtree(work, ignore_errors=True)


def process_one(sb: Supa) -> bool:
    s = get_settings()
    sub = sb.rpc("claim_submission", {"p_worker": s.worker_id, "p_kinds": s.kinds})
    if not sub or not sub.get("id"):
        return False
    log.info("evaluating submission %s (%s)", sub["id"], sub["kind"])
    try:
        evaluate(sb, sub)
    except Exception as exc:  # noqa: BLE001
        log.exception("submission %s failed", sub["id"])
        try:
            sb.update("submissions", {"id": f"eq.{sub['id']}"}, {"status": "failed", "error": f"internal error: {exc}"[:2000], "finished_at": now_iso()})
        except SupabaseError:
            pass
    return True


def run_loop(once: bool = False) -> int:
    s = get_settings()
    sb = client()
    n = 0
    last_stale = 0.0
    while True:
        if time.monotonic() - last_stale > 300:
            try:
                sb.rpc("requeue_stale", {"p_minutes": s.stale_minutes})
            except SupabaseError as exc:
                log.warning("requeue_stale: %s", exc)
            last_stale = time.monotonic()
        try:
            did = process_one(sb)
        except SupabaseError as exc:
            log.warning("supabase error: %s", exc)
            did = False
            time.sleep(5)
        if did:
            n += 1
            continue
        if once:
            return n
        time.sleep(s.poll_seconds)


# ---------------------------------------------------------------------------
# seeding / admin
# ---------------------------------------------------------------------------

DEFAULT_SCENARIOS = [
    # slug, name, description, seed, days, start, wallclock, weather_public, forecasts_public, events_public
    ("dev-reference", "Development reference (180 nights, seed 20260909)", "The published example3 reference scenario. Everything public, including weather events, so local scoring reproduces the platform.", None, 180, None, 7200, True, True, True),
    ("dev-fortnight", "Development fortnight (14 nights, seed 2026)", "A short public scenario for quick iteration: 14 nights from 2026-10-05, all files public.", 2026, 14, "2026-10-05", 1800, True, True, True),
    ("eval-a", "Competition scenario A (hidden weather)", "Online competition replay A: 30 nights from 2026-10-05. Weather, forecasts and events are hidden; agents see only the published snapshots.", 90210, 30, "2026-10-05", 3600, False, False, False),
    ("eval-b", "Competition scenario B (hidden weather)", "Online competition replay B: 30 nights from 2026-11-01, different seed.", 41207, 30, "2026-11-01", 3600, False, False, False),
]


def seed(sb: Supa) -> None:
    existing = {r["slug"] for r in sb.select("scenarios", columns="slug")}
    for slug, name, desc, sd, days, start, wallclock, wp, fp, ep in DEFAULT_SCENARIOS:
        if slug in existing:
            continue
        if sd is None:
            root = scenario_builder.EXAMPLE3_ROOT
        else:
            root = Path(tempfile.mkdtemp(prefix="sac-gen-"))
            scenario_builder.generate_scenario(root, scenario_id=slug, seed=sd, days=days, start_date=start, global_wallclock_seconds=wallclock)
        register_scenario(sb, slug=slug, name=name, description=desc, root=root, weather_public=wp, forecasts_public=fp, events_public=ep, wallclock=wallclock)
        if sd is not None:
            shutil.rmtree(root, ignore_errors=True)
        print("scenario", slug, "registered")
    scn = {r["slug"]: r["id"] for r in sb.select("scenarios", columns="id, slug")}
    phases = {r["slug"]: r for r in sb.select("phases", columns="id, slug")}
    defaults = [
        {"slug": "practice", "name_en": "Practice", "name_zh": "练习赛", "sort_order": 1,
         "description_en": "Open now. Score a decisions.csv or run your agent on the public development scenarios. Practice standings are informational.",
         "description_zh": "现已开放。可对公开开发场景提交 decisions.csv 或直接运行智能体。练习榜仅供参考。",
         "allow_results": True, "allow_agents": True, "daily_limit": 50, "leaderboard_mode": "live", "counts_for_final": False, "is_active": True, "_scn": ["dev-reference", "dev-fortnight"]},
        {"slug": "online", "name_en": "Online Competition", "name_zh": "线上比赛", "sort_order": 2,
         "description_en": "October 5–7. Agents run on the platform against hidden weather replays A and B (one global wall clock per scenario); the score is the mean over both. Ten submissions per team per day.",
         "description_zh": "10 月 5–7 日。智能体在平台上对隐藏天气回放 A、B 运行（每个场景一个全局时钟），得分为两个场景的平均值。每队每天 10 次提交。",
         "allow_results": False, "allow_agents": True, "daily_limit": 10, "leaderboard_mode": "live", "counts_for_final": True, "is_active": True,
         "starts_at": "2026-10-04T16:00:00Z", "ends_at": "2026-10-07T15:59:59Z", "_scn": ["eval-a", "eval-b"]},
    ]
    for d in defaults:
        links = d.pop("_scn")
        if d["slug"] in phases:
            pid = phases[d["slug"]]["id"]
        else:
            pid = sb.insert("phases", d)[0]["id"]
        have = {r["scenario_id"] for r in sb.select("phase_scenarios", columns="scenario_id", filters={"phase_id": f"eq.{pid}"})}
        new = [{"phase_id": pid, "scenario_id": scn[s_]} for s_ in links if s_ in scn and scn[s_] not in have]
        if new:
            sb.insert("phase_scenarios", new)
    print("seeded: scenarios", sorted(scn), "phases", sorted({*phases, *[d['slug'] for d in defaults]}))


def promote_admin(sb: Supa, email: str) -> None:
    rows = sb.update("profiles", {"email": f"eq.{email.lower()}"}, {"is_admin": True})
    if rows:
        print(f"{email} is now an admin")
    else:
        cur = sb.select_one("site_settings", filters={"key": "eq.admin_emails"})
        emails = sorted(set((cur or {}).get("value") or []) | {email.lower()})
        sb.insert("site_settings", {"key": "admin_emails", "value": emails}, upsert=True, on_conflict="key")
        print(f"{email} has no account yet; added to admin_emails so the account becomes admin at sign-up")


def main(argv=None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = p.add_subparsers(dest="cmd", required=True)
    sp.add_parser("run"); sp.add_parser("once"); sp.add_parser("seed")
    a = sp.add_parser("add-scenario"); a.add_argument("--slug", required=True); a.add_argument("--name"); a.add_argument("--description", default="")
    a.add_argument("--root", type=Path, required=True); a.add_argument("--wallclock", type=int)
    for x in (a,):
        x.add_argument("--hidden-weather", action="store_true"); x.add_argument("--hidden-forecasts", action="store_true"); x.add_argument("--public-events", action="store_true")
    g = sp.add_parser("gen-scenario"); g.add_argument("--slug", required=True); g.add_argument("--name"); g.add_argument("--description", default="")
    g.add_argument("--seed", type=int, required=True); g.add_argument("--days", type=int, default=180); g.add_argument("--start-date"); g.add_argument("--wallclock", type=int, default=7200)
    g.add_argument("--regions", type=int); g.add_argument("--tiles-per-region", type=int)
    g.add_argument("--hidden-weather", action="store_true"); g.add_argument("--hidden-forecasts", action="store_true"); g.add_argument("--public-events", action="store_true")
    pa = sp.add_parser("promote-admin"); pa.add_argument("email")
    args = p.parse_args(argv)
    if args.cmd == "run":
        return run_loop(once=False)
    if args.cmd == "once":
        n = run_loop(once=True); print(f"processed {n} submissions"); return 0
    sb = client()
    if args.cmd == "seed":
        seed(sb)
    elif args.cmd == "add-scenario":
        row = register_scenario(sb, slug=args.slug, name=args.name or args.slug, description=args.description, root=args.root,
                                weather_public=not args.hidden_weather, forecasts_public=not args.hidden_forecasts, events_public=args.public_events, wallclock=args.wallclock)
        print(json.dumps({k: v for k, v in row.items() if k != "manifest"}, indent=1, default=str))
    elif args.cmd == "gen-scenario":
        root = Path(tempfile.mkdtemp(prefix="sac-gen-"))
        ov = {k: v for k, v in (("n_regions", args.regions), ("tiles_per_region", args.tiles_per_region)) if v}
        scenario_builder.generate_scenario(root, scenario_id=args.slug, seed=args.seed, days=args.days, start_date=args.start_date, global_wallclock_seconds=args.wallclock, tile_overrides=ov)
        row = register_scenario(sb, slug=args.slug, name=args.name or args.slug, description=args.description, root=root,
                                weather_public=not args.hidden_weather, forecasts_public=not args.hidden_forecasts, events_public=args.public_events, wallclock=args.wallclock)
        shutil.rmtree(root, ignore_errors=True)
        print(json.dumps({k: v for k, v in row.items() if k != "manifest"}, indent=1, default=str))
    elif args.cmd == "promote-admin":
        promote_admin(sb, args.email)
    return 0


if __name__ == "__main__":
    sys.exit(main())
