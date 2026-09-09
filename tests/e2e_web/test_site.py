from __future__ import annotations

import re
from pathlib import Path

import pytest
from playwright.sync_api import Page, expect

from conftest import SHOTS, run_worker_once

ROOT = Path(__file__).resolve().parents[2]
KIT = ROOT / "starter_kit"


def shot(page: Page, name: str, full: bool = True):
    page.screenshot(path=str(SHOTS / f"{name}.png"), full_page=full)


def _register(page: Page, base: str, name: str, email: str, password: str = "correct-horse-9"):
    page.goto(base + "/register")
    page.fill("[data-testid=reg-name]", name)
    page.fill("[data-testid=reg-email]", email)
    page.fill("[data-testid=reg-password]", password)
    page.fill("[data-testid=reg-password2]", password)
    page.check("[data-testid=reg-agree]")
    page.click("[data-testid=reg-submit]")
    expect(page).to_have_url(re.compile(r"/dashboard"), timeout=20000)


def test_public_pages_and_language(page: Page, site):
    base = site["base"]
    page.goto(base + "/")
    expect(page.locator("h1").first).to_contain_text(re.compile("巡天智能体|Agent Observer"))
    page.click("[data-testid=lang-toggle]")
    page.click("[data-testid=lang-toggle]")
    shot(page, "01-home")
    for path in ["/brief", "/rules", "/docs", "/faq", "/resources", "/leaderboard", "/announcements"]:
        page.goto(base + path)
        expect(page.locator("h1").first).to_be_visible()
        shot(page, "02-page" + path.replace("/", "-"))
    page.goto(base + "/resources")
    expect(page.locator("text=dev-example")).to_be_visible()


def test_participant_journey(page: Page, site):
    base = site["base"]
    _register(page, base, "Ada Lovelace", "ada@e2e.org")
    shot(page, "10-dashboard")
    page.goto(base + "/team")
    page.fill("[data-testid=team-name-input]", "Analytical Engines")
    page.click("[data-testid=team-create]")
    expect(page.locator("[data-testid=team-invite-code]")).to_be_visible(timeout=15000)
    code = page.locator("[data-testid=team-invite-code]").inner_text().strip()
    assert re.fullmatch(r"[A-Z0-9]{8}", code), code
    shot(page, "11-team")

    page.goto(base + "/submit")
    page.select_option("[data-testid=submit-phase]", "practice")
    page.check("[data-testid=submit-kind-results]")
    page.select_option("[data-testid=submit-scenario]", "dev-example")
    page.set_input_files("[data-testid=submit-file]", str(KIT / "example" / "decisions.csv"))
    page.fill("[data-testid=submit-title]", "reference trace")
    page.click("[data-testid=submit-button]")
    expect(page).to_have_url(re.compile(r"/submissions/\d+"), timeout=20000)
    expect(page.locator("[data-testid=sub-status]")).to_contain_text(re.compile("queued|Queued|排队"), timeout=15000)
    assert run_worker_once() == 1
    expect(page.locator("[data-testid=sub-status]")).to_contain_text(re.compile("scored|Scored|已评分"), timeout=30000)
    expect(page.locator("[data-testid=sub-score]")).to_contain_text("10377.47")
    shot(page, "12-submission-scored")

    page.goto(base + "/submit")
    page.select_option("[data-testid=submit-phase]", "practice")
    page.check("[data-testid=submit-kind-agent]")
    page.set_input_files("[data-testid=submit-file]", str(KIT / "agent.py"))
    page.click("[data-testid=submit-button]")
    expect(page).to_have_url(re.compile(r"/submissions/\d+"), timeout=20000)
    assert run_worker_once() == 1
    expect(page.locator("[data-testid=sub-status]")).to_contain_text(re.compile("scored|Scored|已评分"), timeout=60000)
    expect(page.locator("text=dev-week")).to_be_visible()
    shot(page, "13-agent-submission")

    page.goto(base + "/leaderboard/practice")
    expect(page.locator("[data-testid=lb-row]").first).to_contain_text("Analytical Engines", timeout=15000)
    shot(page, "14-leaderboard")

    ctx2 = page.context.browser.new_context(viewport={"width": 1280, "height": 800})
    p2 = ctx2.new_page()
    _register(p2, base, "Charles Babbage", "charles@e2e.org")
    p2.goto(base + "/team")
    p2.fill("[data-testid=team-join-code]", code)
    p2.click("[data-testid=team-join]")
    expect(p2.locator("text=Analytical Engines").first).to_be_visible(timeout=15000)
    ctx2.close()

    page.goto(base + "/profile")
    page.fill("[data-testid=profile-name]", "Ada K. Lovelace")
    page.click("[data-testid=profile-save]")
    expect(page.locator("[data-testid=flash]")).to_be_visible(timeout=10000)
    page.click("[data-testid=nav-logout]")
    expect(page.locator("[data-testid=nav-register]")).to_be_visible(timeout=10000)


def test_admin_journey(page: Page, site):
    base = site["base"]
    _register(page, base, "Admin", "admin@e2e.org")
    page.goto(base + "/admin")
    expect(page.locator("h1").first).to_be_visible(timeout=15000)
    shot(page, "20-admin")
    page.goto(base + "/admin/announcements")
    page.fill("[data-testid=ann-title-en]", "Online competition opens Oct 5 00:00 (UTC+8)")
    page.fill("[data-testid=ann-title-zh]", "线上比赛 10 月 5 日 0 点开放")
    page.check("[data-testid=ann-pinned]")
    page.click("[data-testid=ann-save]")
    page.goto(base + "/")
    expect(page.locator("[data-testid=announcement-banner]")).to_contain_text("Online competition opens", timeout=15000)
    shot(page, "21-home-banner")


def test_mobile_layout(page: Page, site):
    page.set_viewport_size({"width": 390, "height": 844})
    page.goto(site["base"] + "/")
    expect(page.locator("h1").first).to_be_visible()
    assert page.evaluate("document.documentElement.scrollWidth") <= 390
    shot(page, "30-mobile", full=False)
