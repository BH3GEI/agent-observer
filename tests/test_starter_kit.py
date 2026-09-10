"""End-to-end checks for the participant starter kit (starter_kit/).

Runs the kit's own scripts as a participant would: baseline run on the public reference scenario, re-scoring,
scenario generation, packaging. Also guards that the vendored environment copies stay identical to challenge/.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
KIT = ROOT / "starter_kit"
PY = sys.executable
BASELINE_TOTAL = 12287.478365  # deterministic minimal agent, scenarios/dev-reference, survey_complete


def run(script: str, *args: str, cwd: Path = KIT, timeout: int = 240) -> subprocess.CompletedProcess:
    env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
    return subprocess.run([PY, "-B", str(KIT / script), *args], cwd=str(cwd), env=env, capture_output=True, text=True, timeout=timeout)


def summary_of(proc: subprocess.CompletedProcess) -> dict:
    assert proc.returncode == 0, f"exit {proc.returncode}\nstdout:\n{proc.stdout[-3000:]}\nstderr:\n{proc.stderr[-3000:]}"
    return json.loads(proc.stdout.strip().splitlines()[-1] if proc.stdout.strip().startswith("{") is False else proc.stdout)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture(scope="module")
def baseline(tmp_path_factory) -> dict:
    out = tmp_path_factory.mktemp("baseline")
    proc = run("local_runner.py", "--scenario", "scenarios/dev-reference", "--agent", "agent/minimal_agent.py",
               "--wallclock", "120", "--out", str(out), "--quiet")
    summary = summary_of(proc)
    return {"out": out, "summary": summary}


def test_baseline_completes_survey(baseline):
    summary = baseline["summary"]
    out = baseline["out"]
    assert summary["termination_reason"] == "survey_complete"
    assert summary["total"] > 12000
    assert summary["total"] == pytest.approx(BASELINE_TOTAL, abs=1.0)
    assert summary["required_missing"] == 0
    assert summary["wall_seconds"] < 120
    for name in ("decisions.csv", "workflow_result.json", "score_report.json", "agent.log"):
        assert (out / name).is_file(), name
    report = json.loads((out / "score_report.json").read_text(encoding="utf-8"))
    assert report["schema_version"] == "score-report-v3"
    assert report["score"]["total"] == summary["total"]
    assert report["termination_reason"] == "survey_complete"
    workflow = json.loads((out / "workflow_result.json").read_text(encoding="utf-8"))
    assert "initial_publication" not in workflow  # stripped like the platform does
    assert workflow["score_report"]["score"]["total"] == summary["total"]
    assert "provider=deterministic" in (out / "agent.log").read_text(encoding="utf-8")
    if (KIT / "challenge" / "replay.py").exists():
        html = out / "decision_replay.html"
        assert html.is_file() and html.stat().st_size > 10_000


def test_baseline_is_deterministic(baseline, tmp_path):
    proc = run("local_runner.py", "--wallclock", "120", "--out", str(tmp_path), "--quiet", "--no-replay")
    second = summary_of(proc)
    assert second["total"] == baseline["summary"]["total"]
    assert sha256(tmp_path / "decisions.csv") == sha256(baseline["out"] / "decisions.csv")


def test_score_decisions_reproduces_runner_report(baseline, tmp_path):
    report_path = tmp_path / "report.json"
    proc = run("score_decisions.py", "--scenario", "scenarios/dev-reference", "--decisions", str(baseline["out"] / "decisions.csv"),
               "--out", str(report_path))
    assert proc.returncode == 0, proc.stderr
    printed = json.loads(proc.stdout)
    assert printed["termination_reason"] == "survey_complete"  # picked up from workflow_result.json
    rescored = json.loads(report_path.read_text(encoding="utf-8"))
    original = json.loads((baseline["out"] / "score_report.json").read_text(encoding="utf-8"))
    assert rescored["score"] == original["score"]
    assert rescored["completion"] == original["completion"]
    assert rescored["input_sha256"]["decisions"] == sha256(baseline["out"] / "decisions.csv")


def test_score_decisions_rejects_hidden_truth(baseline, tmp_path):
    hidden = tmp_path / "hidden"
    shutil.copytree(KIT / "scenarios" / "dev-reference", hidden)
    (hidden / "outputs" / "reference" / "weather_events.csv").unlink()
    proc = run("score_decisions.py", "--scenario", str(hidden), "--decisions", str(baseline["out"] / "decisions.csv"))
    assert proc.returncode != 0
    assert "weather_events.csv" in proc.stderr


def test_make_scenario_produces_valid_scenario(tmp_path):
    scenario = tmp_path / "mine"
    proc = run("make_scenario.py", "--out", str(scenario), "--seed", "7", "--days", "7")
    assert proc.returncode == 0, proc.stderr
    info = json.loads(proc.stdout)
    assert info["n_nights"] == 7 and info["n_tiles"] > 0 and info["n_slots"] > 0
    assert info["contract"] == "challenge-score-v3"
    for rel in ("config/scenario_config.json", "config/score_config.json", "outputs/reference/weather.csv",
                "outputs/reference/weather_events.csv", "outputs/reference/scenario_manifest.json"):
        assert (scenario / rel).is_file(), rel
    check = run("make_scenario.py", "--out", str(scenario), "--validate-only")
    assert check.returncode == 0, check.stderr
    assert json.loads(check.stdout)["scenario_id"] == info["scenario_id"]
    # refuses to overwrite, and the scenario is runnable end to end
    assert run("make_scenario.py", "--out", str(scenario), "--seed", "8").returncode != 0
    result = summary_of(run("local_runner.py", "--scenario", str(scenario), "--wallclock", "60", "--out", str(tmp_path / "run"),
                            "--quiet", "--no-replay"))
    assert result["termination_reason"] == "survey_complete"
    assert result["committed_actions"] > 0


def test_pack_agent_builds_zip_with_entry_at_root(tmp_path):
    agent = tmp_path / "agent"
    shutil.copytree(KIT / "agent", agent)
    (agent / "__pycache__").mkdir()
    (agent / "__pycache__" / "x.cpython-312.pyc").write_bytes(b"\x00")
    (agent / ".env").write_text("MODEL_PROVIDER=deterministic\n", encoding="utf-8")
    (agent / "helpers.py").write_text("VALUE = 1\n", encoding="utf-8")
    out = tmp_path / "my-agent.zip"
    proc = run("pack_agent.py", "--agent", str(agent), "--out", str(out))
    assert proc.returncode == 0, proc.stderr
    names = zipfile.ZipFile(out).namelist()
    assert "minimal_agent.py" in names and "decision_graph.py" in names and "scoring_preview.py" in names
    assert "helpers.py" in names and ".env" in names and "requirements.txt" in names
    assert not any("__pycache__" in name or name.endswith(".pyc") for name in names)
    assert all("/" not in name for name in names)  # flat: entry at the zip root
    without_env = tmp_path / "no-env.zip"
    assert run("pack_agent.py", "--agent", str(agent), "--out", str(without_env), "--no-env").returncode == 0
    assert ".env" not in zipfile.ZipFile(without_env).namelist()


def test_pack_agent_rejects_uninstallable_requirements(tmp_path):
    agent = tmp_path / "agent"
    shutil.copytree(KIT / "agent", agent)
    (agent / "requirements.txt").write_text("langchain>=1.0\n-e ../my-local-package\n", encoding="utf-8")
    proc = run("pack_agent.py", "--agent", str(agent), "--out", str(tmp_path / "bad.zip"))
    assert proc.returncode != 0
    assert "requirements.txt" in proc.stderr and "line 2" in proc.stderr
    assert not (tmp_path / "bad.zip").exists()
    (agent / "requirements.txt").write_text("# pinned\nlangchain-openai>=1.0,<2\npython-dotenv[cli]==1.0.1 ; python_version >= '3.10'\n", encoding="utf-8")
    assert run("pack_agent.py", "--agent", str(agent), "--out", str(tmp_path / "ok.zip")).returncode == 0


def test_kit_environment_matches_vendored_modules():
    """The kit ships copies of challenge/; they must not drift (project_paths.py is intentionally adapted)."""
    kit_modules = sorted(p.name for p in (KIT / "challenge").glob("*.py"))
    assert "scoring_core.py" in kit_modules and "challenge_workflow.py" in kit_modules and "scenario_builder.py" in kit_modules
    for name in kit_modules:
        if name == "project_paths.py":
            continue
        assert (ROOT / "challenge" / name).read_bytes() == (KIT / "challenge" / name).read_bytes(), f"starter_kit/challenge/{name} differs from challenge/{name}"
    for template in (ROOT / "challenge" / "templates").glob("*.html"):
        assert (KIT / "challenge" / "templates" / template.name).read_bytes() == template.read_bytes()
    for path in (ROOT / "challenge" / "participant_agent").iterdir():
        if not path.is_file():
            continue
        kit_bytes = (KIT / "agent" / path.name).read_bytes()
        if path.name == "README_ZH.md":
            # the kit README carries a short preface about the kit layout, followed by the upstream text verbatim
            assert path.read_bytes() in kit_bytes, "starter_kit/agent/README_ZH.md no longer embeds the upstream README"
            continue
        assert kit_bytes == path.read_bytes(), f"starter_kit/agent/{path.name} differs"
    assert (KIT / "agent" / "scoring_preview.py").read_bytes() == (ROOT / "challenge" / "scoring_preview.py").read_bytes()
    for rel in ("config/score_config.json", "outputs/reference/weather_events.csv", "outputs/reference/scenario_manifest.json"):
        assert (KIT / "scenarios" / "dev-reference" / rel).read_bytes() == (ROOT / "challenge" / "reference" / rel).read_bytes(), rel


def test_kit_docs_and_layout():
    for name in ("README.md", "SKILL.md", "local_runner.py", "score_decisions.py", "make_scenario.py", "pack_agent.py", "sac_submit.py"):
        assert (KIT / name).is_file(), name
    skill = (KIT / "SKILL.md").read_text(encoding="utf-8")
    for placeholder in ("{{BASE_URL}}", "{{SUPABASE_URL}}", "{{SUPABASE_ANON_KEY}}"):
        assert placeholder in skill
    readme = (KIT / "README.md").read_text(encoding="utf-8")
    assert "agent/README_ZH.md" in readme and "participant-agent-protocol-v1" in readme
    assert not (KIT / "agent" / ".env").exists(), "never ship a real .env in the kit"
    assert (KIT / "agent" / ".env.example").is_file()
    assert not (KIT / "scenarios" / "dev-reference" / "outputs" / "reference" / "score_report.json").exists()
