"""Evaluation worker: claims queued submissions from Supabase, runs the scorer / agent sandbox, writes results back.

Usage:
  python -m worker.main run            # loop forever
  python -m worker.main once           # process everything queued, then exit
  python -m worker.main seed           # register default phases + scenarios (idempotent)
  python -m worker.main add-scenario --slug S --name N --weather W --tiles T [--config C] [--hidden-weather] [--hidden-tiles]
  python -m worker.main gen-scenario --slug S --seed 7 --nights 7 --slots 24 --tiles 240 [--hidden-weather]
  python -m worker.main promote-admin EMAIL

Environment: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (service role; never ship to browsers), SAC_* sandbox limits.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import shutil
import sys
import tempfile
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

from . import runner as runner_mod
from .config import get_settings
from .scenarios import DEFAULT_CONFIG_PATH, generate_scenario_files, sha256_files, validate_scenario_files
from .scoring import InvalidSubmission, score_decisions
from .supa import Supa, SupabaseError

log = logging.getLogger("sac.worker")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def client() -> Supa:
    s = get_settings()
    return Supa(s.supabase_url, s.service_key)


# ---------------------------------------------------------------------------
# scenario files
# ---------------------------------------------------------------------------

def fetch_scenario_files(sb: Supa, slug: str, dest: Path) -> dict[str, Path]:
    dest.mkdir(parents=True, exist_ok=True)
    out = {}
    for key, name in (("weather", "weather.csv"), ("tiles", "tiles.csv"), ("config", "score_config.json")):
        p = dest / name
        if not p.exists():
            p.write_bytes(sb.download("scenarios", f"{slug}/{name}"))
        out[key] = p
    return out


# ---------------------------------------------------------------------------
# evaluation
# ---------------------------------------------------------------------------

def evaluate(sb: Supa, sub: dict) -> None:
    s = get_settings()
    sid = int(sub["id"])
    team_id = sub["team_id"]
    phase_scenarios = sb.select("phase_scenarios", columns="scenario_id, scenarios(id, slug, name, n_slots, n_nights, n_tiles, is_active)", filters={"phase_id": f"eq.{sub['phase_id']}"})
    if sub["kind"] == "results":
        scn_rows = [sb.select_one("scenarios", filters={"id": f"eq.{sub['scenario_id']}"})] if sub.get("scenario_id") else []
    else:
        scn_rows = [r["scenarios"] for r in phase_scenarios if r.get("scenarios") and r["scenarios"].get("is_active")]
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

    agent_entry = None
    agent_dir = None
    if sub["kind"] == "agent":
        agent_dir = work / "agent"
        try:
            agent_entry = runner_mod.prepare_agent_dir(upload, agent_dir)
        except runner_mod.AgentPackageError as exc:
            for scn in scn_rows:
                sb.insert("evaluations", {"submission_id": sid, "scenario_id": scn["id"], "status": "invalid", "error": str(exc), "finished_at": now_iso()})
            sb.update("submissions", {"id": f"eq.{sid}"}, {"status": "invalid", "error": str(exc), "finished_at": now_iso()})
            return

    evals: list[dict] = []
    for scn in scn_rows:
        slug = scn["slug"]
        paths = fetch_scenario_files(sb, slug, s.data_dir / "scenarios" / slug)
        out = work / slug
        out.mkdir(parents=True, exist_ok=True)
        t0 = time.monotonic()
        prefix = f"{team_id}/sub-{sid}/{slug}"
        ev = {"submission_id": sid, "scenario_id": scn["id"], "status": "failed", "summary": {}, "error": ""}
        try:
            if sub["kind"] == "results":
                decisions = out / "decisions.csv"
                shutil.copyfile(upload, decisions)
            else:
                result = runner_mod.run_agent(agent_entry, agent_dir, weather=paths["weather"], tiles=paths["tiles"], config=paths["config"], out_dir=out,
                                              scenario_meta={"slug": slug, "name": scn["name"], "n_slots": scn["n_slots"], "n_nights": scn["n_nights"]})
                decisions = result.decisions_path
                sb.upload("results", f"{prefix}/agent.log", result.log_path.read_bytes(), "text/plain")
                ev["log_path"] = f"{prefix}/agent.log"
                ev["summary"] = {"steps": result.steps, "agent_wall_seconds": round(result.wall_seconds, 3), "warnings": result.warnings[:20], "stderr_tail": result.stderr_tail[-2000:]}
            report_path = out / "score_report.json"
            metrics = score_decisions(paths["weather"], paths["tiles"], paths["config"], decisions, report_path)
            sb.upload("results", f"{prefix}/report.json", report_path.read_bytes(), "application/json")
            sb.upload("results", f"{prefix}/decisions.csv", Path(decisions).read_bytes(), "text/csv")
            ev.update({"status": "scored", "score": metrics["score"], "science_score": metrics["science_score"], "completion": metrics["completion"], "uniformity": metrics["uniformity"],
                       "report_path": f"{prefix}/report.json", "decisions_path": f"{prefix}/decisions.csv", "summary": {**ev["summary"], **metrics}})
        except InvalidSubmission as exc:
            ev.update({"status": "invalid", "error": str(exc), "report_path": f"{prefix}/report.json"})
            sb.upload("results", f"{prefix}/report.json", (out / "score_report.json").read_bytes(), "application/json")
        except runner_mod.AgentRunError as exc:
            ev.update({"status": "failed", "error": str(exc)})
            log_file = out / "agent.log"
            if log_file.exists():
                sb.upload("results", f"{prefix}/agent.log", log_file.read_bytes(), "text/plain")
                ev["log_path"] = f"{prefix}/agent.log"
                ev["summary"] = {**ev["summary"], "stderr_tail": log_file.read_text(encoding="utf-8", errors="replace")[-2000:]}
        ev["runtime_seconds"] = round(time.monotonic() - t0, 3)
        ev["finished_at"] = now_iso()
        sb.insert("evaluations", ev)
        evals.append(ev)

    scored = [e for e in evals if e["status"] == "scored"]
    if len(scored) == len(evals):
        n = len(scored)
        sb.update("submissions", {"id": f"eq.{sid}"}, {
            "status": "scored", "score": round(sum(e["score"] for e in scored) / n, 6), "science_score": round(sum(e["science_score"] for e in scored) / n, 6),
            "completion": round(sum(e["completion"] for e in scored) / n, 6), "uniformity": round(sum(e["uniformity"] for e in scored) / n, 6),
            "metrics": {"scenarios": [{"slug": scn["slug"], "score": e["score"], "science_score": e["science_score"], "completion": e["completion"], "uniformity": e["uniformity"]} for e, scn in zip(evals, scn_rows)]},
            "error": "", "finished_at": now_iso(),
        })
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
# scenarios / seeding
# ---------------------------------------------------------------------------

def register_scenario(sb: Supa, *, slug: str, name: str, description: str, weather: Path, tiles: Path, config: Path | None,
                      weather_public: bool, tiles_public: bool, seed: int | None = None) -> dict:
    config = config or DEFAULT_CONFIG_PATH
    stats = validate_scenario_files(weather, tiles, config)
    for p, ctype in ((weather, "text/csv"), (tiles, "text/csv"), (config, "application/json")):
        sb.upload("scenarios", f"{slug}/{'weather.csv' if p is weather else 'tiles.csv' if p is tiles else 'score_config.json'}", p.read_bytes(), ctype)
    row = {"slug": slug, "name": name, "description": description, "weather_public": weather_public, "tiles_public": tiles_public, "is_active": True,
           "n_slots": stats["n_slots"], "n_nights": stats["n_nights"], "n_tiles": stats["n_tiles"], "seed": seed, "checksum": sha256_files([weather, tiles, config])}
    rows = sb.insert("scenarios", row, upsert=True, on_conflict="slug")
    return rows[0] if rows else row


def seed(sb: Supa) -> None:
    kit = Path(__file__).resolve().parents[1] / "starter_kit" / "example"
    existing = {r["slug"]: r for r in sb.select("scenarios", columns="id, slug")}
    if "dev-example" not in existing:
        register_scenario(sb, slug="dev-example", name="Development example (seed 11)", description="The published example scenario: 2 nights x 12 slots, 72 tiles. Identical to the starter kit.",
                          weather=kit / "weather.csv", tiles=kit / "tiles.csv", config=kit / "score_config.json", weather_public=True, tiles_public=True, seed=11)
    gen = [
        ("dev-week", "Development week (seed 2026)", "A longer public scenario: 7 nights x 24 slots, 240 tiles.", 2026, True, datetime(2026, 10, 5, 2, 0, tzinfo=timezone.utc)),
        ("eval-a", "Competition scenario A", "Hidden weather replay for the online competition. Tile catalogue is public.", 90210, False, datetime(2026, 10, 5, 2, 0, tzinfo=timezone.utc)),
        ("eval-b", "Competition scenario B", "Second hidden weather replay for the online competition.", 41207, False, datetime(2026, 10, 12, 2, 0, tzinfo=timezone.utc)),
    ]
    for slug, name, desc, sd, public, first in gen:
        if slug in existing:
            continue
        tmp = Path(tempfile.mkdtemp(prefix="sac-gen-"))
        try:
            paths = generate_scenario_files(tmp, seed=sd, n_nights=7, slots_per_night=24, n_tiles=240, first_night=first)
            register_scenario(sb, slug=slug, name=name, description=desc, weather=paths["weather"], tiles=paths["tiles"], config=paths["config"], weather_public=public, tiles_public=True, seed=sd)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    scn = {r["slug"]: r["id"] for r in sb.select("scenarios", columns="id, slug")}
    phases = {r["slug"]: r for r in sb.select("phases", columns="id, slug")}
    defaults = [
        {"slug": "practice", "name_en": "Practice", "name_zh": "练习赛", "sort_order": 1,
         "description_en": "Open now. Score decisions.csv files or run your agent on the public development scenarios. Unlimited practice; the practice board is informational.",
         "description_zh": "现已开放。可对公开开发场景提交 decisions.csv 或直接运行智能体。练习不限次数，练习榜仅供参考。",
         "allow_results": True, "allow_agents": True, "daily_limit": 50, "leaderboard_mode": "live", "counts_for_final": False, "is_active": True, "_scn": ["dev-example", "dev-week"]},
        {"slug": "online", "name_en": "Online Competition", "name_zh": "线上比赛", "sort_order": 2,
         "description_en": "October 5–7. Agents run on the platform against hidden weather replays A and B; the score is the mean over both scenarios. Ten submissions per team per day.",
         "description_zh": "10 月 5–7 日。智能体在平台上对隐藏天气回放 A、B 运行，得分为两个场景的平均值。每队每天 10 次提交。",
         "allow_results": False, "allow_agents": True, "daily_limit": 10, "leaderboard_mode": "live", "counts_for_final": True, "is_active": True,
         "starts_at": "2026-10-04T16:00:00Z", "ends_at": "2026-10-07T15:59:59Z", "_scn": ["eval-a", "eval-b"]},
    ]
    for d in defaults:
        if d["slug"] in phases:
            continue
        links = d.pop("_scn")
        row = sb.insert("phases", d)[0]
        sb.insert("phase_scenarios", [{"phase_id": row["id"], "scenario_id": scn[s]} for s in links if s in scn])
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
    a.add_argument("--weather", type=Path, required=True); a.add_argument("--tiles", type=Path, required=True); a.add_argument("--config", type=Path)
    a.add_argument("--hidden-weather", action="store_true"); a.add_argument("--hidden-tiles", action="store_true")
    g = sp.add_parser("gen-scenario"); g.add_argument("--slug", required=True); g.add_argument("--name"); g.add_argument("--description", default="")
    g.add_argument("--seed", type=int, default=1); g.add_argument("--nights", type=int, default=7); g.add_argument("--slots", type=int, default=24); g.add_argument("--tiles", type=int, default=240)
    g.add_argument("--first-night", default=None); g.add_argument("--hidden-weather", action="store_true"); g.add_argument("--hidden-tiles", action="store_true")
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
        row = register_scenario(sb, slug=args.slug, name=args.name or args.slug, description=args.description, weather=args.weather, tiles=args.tiles, config=args.config,
                                weather_public=not args.hidden_weather, tiles_public=not args.hidden_tiles)
        print(json.dumps(row, indent=1, default=str))
    elif args.cmd == "gen-scenario":
        tmp = Path(tempfile.mkdtemp(prefix="sac-gen-"))
        first = datetime.fromisoformat(args.first_night.replace("Z", "+00:00")) if args.first_night else None
        paths = generate_scenario_files(tmp, seed=args.seed, n_nights=args.nights, slots_per_night=args.slots, n_tiles=args.tiles, first_night=first)
        row = register_scenario(sb, slug=args.slug, name=args.name or args.slug, description=args.description, weather=paths["weather"], tiles=paths["tiles"], config=paths["config"],
                                weather_public=not args.hidden_weather, tiles_public=not args.hidden_tiles, seed=args.seed)
        shutil.rmtree(tmp, ignore_errors=True)
        print(json.dumps(row, indent=1, default=str))
    elif args.cmd == "promote-admin":
        promote_admin(sb, args.email)
    return 0


if __name__ == "__main__":
    sys.exit(main())
