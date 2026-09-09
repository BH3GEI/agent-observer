"""Integration tests: migrations + RLS + RPCs through real PostgREST, worker evaluation, storage rules."""
from __future__ import annotations

import time
from pathlib import Path

import pytest

from conftest import Client, ROOT, signup
from harness import service_key

KIT = ROOT / "starter_kit"
EX = KIT / "example"


@pytest.fixture(scope="session")
def seeded(hs, service):
    from worker import main as wm
    wm.seed(wm.client())
    rows = service.select("scenarios", "select=slug,weather_public")[1]
    assert {r["slug"] for r in rows} == {"dev-example", "dev-week", "eval-a", "eval-b"}
    # make the online phase open right now so agent submissions on hidden weather can be tested
    hs.sql("update public.phases set starts_at = now() - interval '1 hour', ends_at = now() + interval '1 day' where slug = 'online'")
    return True


@pytest.fixture(scope="session")
def alice(hs, seeded):
    c = signup(hs, "alice@test.org", name="Alice")
    st, team_id = c.rpc("create_team", {"p_name": "Night Owls", "p_max_size": 2})
    assert st == 200, team_id
    c.team_id = team_id
    return c


@pytest.fixture(scope="session")
def bob(hs, seeded, alice):
    c = signup(hs, "bob@test.org", name="Bob")
    st, code = alice.rpc("regenerate_invite_code")
    assert st == 200
    st, res = c.rpc("join_team", {"p_invite_code": code})
    assert st == 200, res
    c.team_id = alice.team_id
    return c


@pytest.fixture(scope="session")
def mallory(hs, seeded):
    c = signup(hs, "mallory@test.org", name="Mallory")
    st, tid = c.rpc("create_team", {"p_name": "Other Team", "p_max_size": 1})
    assert st == 200
    c.team_id = tid
    return c


def _submit(client: Client, *, phase: str, kind: str, scenario: str | None, path: Path, filename: str | None = None):
    name = f"{client.team_id}/{int(time.time() * 1000)}-{path.suffix}"
    st, res = client.upload("submissions", name, path.read_bytes(), "text/csv" if path.suffix == ".csv" else "text/x-python")
    assert st == 200, res
    st, sid = client.rpc("create_submission", {"p_phase_slug": phase, "p_kind": kind, "p_scenario_slug": scenario, "p_storage_path": name, "p_filename": filename or path.name, "p_sha256": "x", "p_title": "t", "p_notes": ""})
    return st, sid


def test_anon_sees_public_config_only(hs, seeded):
    anon = Client(hs.url)
    st, phases = anon.select("phases", "select=slug,daily_limit")
    assert st == 200 and {p["slug"] for p in phases} == {"practice", "online"}
    st, body = anon.download("scenarios", "dev-example/weather.csv")
    assert st == 200 and body.startswith(b"slot_id")
    st, _ = anon.download("scenarios", "eval-a/weather.csv")
    assert st == 400  # hidden weather
    st, body = anon.download("scenarios", "eval-a/tiles.csv")
    assert st == 200
    st, subs = anon.select("submissions")
    assert st in (200, 401) and (subs == [] if st == 200 else True)


def test_team_workflow_rules(hs, alice, bob, mallory):
    st, res = alice.rpc("create_team", {"p_name": "Second", "p_max_size": 2})
    assert st == 400 and res["message"] == "already_in_team"
    carol = signup(hs, "carol@test.org", name="Carol")
    st, res = carol.rpc("join_team", {"p_invite_code": "NOPE1234"})
    assert st == 400 and res["message"] == "bad_code"
    # team is full (2/2): a third member cannot join
    st, code = alice.rpc("regenerate_invite_code")
    st, res = carol.rpc("join_team", {"p_invite_code": code})
    assert st == 400 and res["message"] == "full"
    # leader cannot leave while members remain
    st, res = alice.rpc("leave_team")
    assert st == 400 and res["message"] == "leader_must_transfer"
    # members see each other, strangers do not
    st, members = bob.rpc("team_members", {"p_team_id": alice.team_id})
    assert st == 200 and {m["name"] for m in members} == {"Alice", "Bob"}
    st, members = mallory.rpc("team_members", {"p_team_id": alice.team_id})
    assert st == 200 and members == []
    st, profiles = mallory.select("profiles", "select=email")
    assert st == 200 and {p["email"] for p in profiles} == {"mallory@test.org"}
    # participants cannot write teams directly
    st, res = mallory.call("PATCH", f"/rest/v1/teams?id=eq.{alice.team_id}", {"name": "Hacked"})
    assert st in (401, 403, 404)
    assert hs.sql("select name from public.teams where id = %s", (alice.team_id,))[0][0] == "Night Owls"


def test_results_submission_scored_by_worker(hs, alice, bob, service):
    from worker import main as wm
    st, sid = _submit(alice, phase="practice", kind="results", scenario="dev-example", path=EX / "decisions.csv")
    assert st == 200, sid
    st, rows = bob.select("submissions", f"select=id,status,kind&id=eq.{sid}")
    assert rows[0]["status"] == "queued"
    assert wm.run_loop(once=True) == 1
    st, rows = alice.select("submissions", f"select=*,evaluations(*,scenarios(slug))&id=eq.{sid}")
    sub = rows[0]
    assert sub["status"] == "scored", sub["error"]
    assert sub["score"] == pytest.approx(10377.46553, abs=1e-3)
    ev = sub["evaluations"][0]
    assert ev["scenarios"]["slug"] == "dev-example" and ev["summary"]["completed_tiles"] == 21
    # team can download the report, strangers cannot
    st, body = alice.download("results", ev["report_path"])
    assert st == 200 and b'"score": 10377.46553' in body
    # leaderboard
    st, board = Client(hs.url).rpc("leaderboard", {"p_phase_slug": "practice", "p_limit": 10})
    assert st == 200 and board[0]["team_name"] == "Night Owls" and board[0]["total_score"] == pytest.approx(10377.466, abs=1e-2)


def test_rls_blocks_other_team(hs, alice, mallory):
    st, rows = mallory.select("submissions", "select=id,team_id")
    assert st == 200 and all(r["team_id"] == mallory.team_id for r in rows) and rows == []
    st, rows = mallory.select("evaluations", "select=id")
    assert st == 200 and rows == []
    st, evs = alice.select("evaluations", "select=report_path")
    st, body = mallory.download("results", evs[0]["report_path"])
    assert st == 400
    # cannot upload into another team's folder
    st, res = mallory.upload("submissions", f"{alice.team_id}/evil.csv", b"x", "text/csv")
    assert st == 400
    # cannot cancel another team's submission
    sid = hs.sql("select id from public.submissions where team_id = %s limit 1", (alice.team_id,))[0][0]
    st, res = mallory.rpc("cancel_submission", {"p_id": sid})
    assert st == 400 and res["message"] == "cannot_cancel"


def test_submission_validation_rules(hs, alice, mallory):
    # results not allowed in the online phase; agents allowed
    st, res = _submit(alice, phase="online", kind="results", scenario="eval-a", path=EX / "decisions.csv")
    assert st == 400 and res["message"] == "results_not_allowed"
    # hidden scenario cannot be used for results
    st, res = _submit(alice, phase="practice", kind="results", scenario="eval-a", path=EX / "decisions.csv")
    assert st == 400 and res["message"] == "bad_scenario"
    # storage path must be in the team folder
    st, res = alice.rpc("create_submission", {"p_phase_slug": "practice", "p_kind": "results", "p_scenario_slug": "dev-example", "p_storage_path": f"{mallory.team_id}/x.csv"})
    assert st == 400 and res["message"] == "bad_storage_path"
    # daily limit
    hs.sql("update public.phases set daily_limit = 0 where slug = 'practice'")
    st, res = _submit(alice, phase="practice", kind="results", scenario="dev-example", path=EX / "decisions.csv")
    assert st == 400 and res["message"] == "daily_limit"
    hs.sql("update public.phases set daily_limit = 50 where slug = 'practice'")
    # invalid file -> invalid status
    from worker import main as wm
    bad = hs.dir / "bad.csv"
    bad.write_text("decision_id,slot_id,action,tile_id,program,reason\n0,NOPE,observe,1,DARK,x\n")
    st, sid = _submit(alice, phase="practice", kind="results", scenario="dev-example", path=bad)
    assert st == 200
    wm.run_loop(once=True)
    st, rows = alice.select("submissions", f"select=status,error&id=eq.{sid}")
    assert rows[0]["status"] == "invalid" and "unknown slot_id" in rows[0]["error"]


def test_agent_submission_runs_on_hidden_weather(hs, alice):
    from worker import main as wm
    st, sid = _submit(alice, phase="online", kind="agent", scenario=None, path=KIT / "agent.py")
    assert st == 200, sid
    assert wm.run_loop(once=True) == 1
    st, rows = alice.select("submissions", f"select=*,evaluations(*,scenarios(slug))&id=eq.{sid}")
    sub = rows[0]
    assert sub["status"] == "scored", sub["error"]
    assert {e["scenarios"]["slug"] for e in sub["evaluations"]} == {"eval-a", "eval-b"}
    assert all(e["summary"]["steps"] > 100 for e in sub["evaluations"])
    assert sub["score"] == pytest.approx(sum(e["score"] for e in sub["evaluations"]) / 2, abs=1e-6)
    st, log = alice.download("results", sub["evaluations"][0]["log_path"])
    assert st == 200
    st, board = Client(hs.url).rpc("leaderboard", {"p_phase_slug": "online", "p_limit": 10})
    assert board[0]["team_name"] == "Night Owls" and board[0]["kind"] == "agent"


def test_crashing_agent_is_marked_failed(hs, alice):
    from worker import main as wm
    bad = hs.dir / "crash.py"
    bad.write_text("import sys\nsys.stdin.readline()\nraise SystemExit(3)\n")
    st, sid = _submit(alice, phase="practice", kind="agent", scenario=None, path=bad, filename="agent.py")
    assert st == 200, sid
    wm.run_loop(once=True)
    st, rows = alice.select("submissions", f"select=status,error&id=eq.{sid}")
    assert rows[0]["status"] == "failed" and "exited before answering" in rows[0]["error"]
    # failed runs do not appear on the board
    st, board = Client(hs.url).rpc("leaderboard", {"p_phase_slug": "practice", "p_limit": 10})
    assert all(e["best_submission_id"] != sid for e in board)


def test_admin_controls(hs, alice, mallory, service):
    admin = signup(hs, "admin@test.org", name="Admin")
    hs.sql("update public.profiles set is_admin = true where email = 'admin@test.org'")
    st, stats = admin.rpc("admin_stats")
    assert st == 200 and stats["users"] >= 4 and stats["scored"] >= 1
    st, users = admin.rpc("admin_users", {"p_query": "alice"})
    assert st == 200 and users[0]["email"] == "alice@test.org"
    st, users = alice.rpc("admin_users", {"p_query": None})
    assert st == 200 and users == []  # non-admin gets nothing
    st, res = alice.rpc("admin_set_user", {"p_user_id": users and users[0]["id"] or str(mallory.team_id), "p_action": "toggle_ban"})
    assert st == 400 and res["message"] == "admin_only"
    # hide a phase board -> participants see nothing, admins still do
    hs.sql("update public.phases set leaderboard_mode = 'hidden' where slug = 'practice'")
    assert Client(hs.url).rpc("leaderboard", {"p_phase_slug": "practice", "p_limit": 10})[1] == []
    assert admin.rpc("leaderboard", {"p_phase_slug": "practice", "p_limit": 10})[1] != []
    hs.sql("update public.phases set leaderboard_mode = 'live' where slug = 'practice'")
    # admin writes announcements; anon reads only published ones
    st, res = admin.call("POST", "/rest/v1/announcements", {"title_en": "Scorer frozen", "title_zh": "评分器冻结", "is_pinned": True, "is_published": True}, headers={"Prefer": "return=representation"})
    assert st == 201, res
    st, res = admin.call("POST", "/rest/v1/announcements", {"title_en": "Draft", "title_zh": "草稿", "is_published": False}, headers={"Prefer": "return=representation"})
    assert st == 201
    st, rows = Client(hs.url).select("announcements", "select=title_en")
    assert {r["title_en"] for r in rows} == {"Scorer frozen"}
    st, res = alice.call("POST", "/rest/v1/announcements", {"title_en": "x", "title_zh": "x"})
    assert st in (401, 403)
    # rescore a submission via admin RPC, then the worker picks it up again
    from worker import main as wm
    sid = hs.sql("select id from public.submissions where status = 'scored' order by id limit 1")[0][0]
    st, _ = admin.rpc("admin_submission_action", {"p_id": sid, "p_action": "rescore"})
    assert st in (200, 204)
    assert hs.sql("select status from public.submissions where id = %s", (sid,))[0][0] == "queued"
    wm.run_loop(once=True)
    assert hs.sql("select status from public.submissions where id = %s", (sid,))[0][0] == "scored"
    # audit trail exists
    assert hs.sql("select count(*) from public.audit_log where action like 'admin.%'")[0][0] >= 1


def test_stale_running_rows_are_requeued(hs, service):
    hs.sql("update public.submissions set status = 'running', started_at = now() - interval '2 hours' where status = 'scored'")
    st, n = service.rpc("requeue_stale", {"p_minutes": 30})
    assert st == 200 and n >= 1
    assert hs.sql("select count(*) from public.submissions where status = 'running'")[0][0] == 0


def test_banned_user_cannot_create_or_join_team(hs, seeded):
    dave = signup(hs, "dave@test.org", name="Dave")
    hs.sql("update public.profiles set is_banned = true where email = 'dave@test.org'")
    st, res = dave.rpc("create_team", {"p_name": "Banned Team", "p_max_size": 1})
    assert st == 400 and res["message"] == "banned"
    st, res = dave.rpc("join_team", {"p_invite_code": "ABCDEFGH"})
    assert st == 400 and res["message"] == "banned"
