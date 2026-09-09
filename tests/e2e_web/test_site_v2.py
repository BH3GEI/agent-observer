"""v2 identity features: observatory-console hero, observed-sky map, score bars, protocol explorer, meta titles."""
from __future__ import annotations

import re
from pathlib import Path

from playwright.sync_api import Page, expect

from conftest import run_worker_once
from test_site import _register, KIT

ROOT = Path(__file__).resolve().parents[2]
SHOTS_V2 = ROOT / "artifacts" / "screenshots-web-v2"


def shot(page: Page, name: str, full: bool = False):
    SHOTS_V2.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOTS_V2 / f"{name}.png"), full_page=full)


def test_hero_console_and_meta(page: Page, site):
    base = site["base"]
    page.goto(base + "/")
    expect(page.locator("h1").first).to_contain_text(re.compile("巡天智能体|Agent Observer"))
    expect(page.locator("[data-testid=sky-console] canvas")).to_be_visible()
    expect(page.locator("[data-testid=sky-slot]")).to_contain_text(re.compile(r"N0\d-S\d{3}"), timeout=5000)
    expect(page.locator("[data-testid=phase-strip]")).to_be_visible()
    expect(page.locator("[data-testid=phase-pill]")).to_be_visible()
    expect(page.locator("[data-testid=slot-ticker]")).to_contain_text(re.compile(r"N0\d-S\d{3}"))
    assert page.locator("video").count() == 0
    assert page.evaluate("Array.from(document.querySelectorAll('canvas')).some(c => c.width > 0)")
    # the canvas is actually being drawn on (not blank)
    assert page.evaluate("""() => {
      const c = document.querySelector('[data-testid=sky-console] canvas');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let lit = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) lit++;
      return lit > 200; }""")
    page.wait_for_timeout(1200)
    shot(page, "01-hero")
    assert page.title().endswith("GOSIM Hackathon") or page.title().endswith("GOSIM 黑客松")
    page.goto(base + "/docs")
    expect(page.locator("[data-testid=protocol-explorer]")).to_be_visible()
    page.click("[data-testid=protocol-tab-step]")
    expect(page.locator("[data-testid=protocol-explorer] pre")).to_contain_text('"type": "step"')
    assert re.search(r"(Docs\W+Agent Observer|文档\W+巡天智能体)", page.title()), page.title()
    shot(page, "04-docs-protocol")
    page.goto(base + "/leaderboard")
    assert re.search(r"(Leaderboard\W+Agent Observer|排行榜\W+巡天智能体)", page.title()), page.title()


def test_mobile_hero_canvas(page: Page, site):
    page.set_viewport_size({"width": 390, "height": 844})
    page.goto(site["base"] + "/")
    expect(page.locator("h1").first).to_be_visible()
    assert page.evaluate("document.documentElement.scrollWidth") <= 390
    width = page.locator("[data-testid=sky-console] canvas").bounding_box()["width"]
    assert width >= 280, width
    page.locator("[data-testid=sky-console]").scroll_into_view_if_needed()
    shot(page, "05-mobile-console")
    page.goto(site["base"] + "/docs")
    expect(page.locator(".toc-chips a").first).to_be_visible()


def test_observed_map_and_score_bars(page: Page, site):
    base = site["base"]
    _register(page, base, "Grace Hopper", "grace@e2e.org")
    page.goto(base + "/team")
    page.fill("[data-testid=team-name-input]", "Compilers")
    page.click("[data-testid=team-create]")
    expect(page.locator("[data-testid=team-invite-code]")).to_be_visible(timeout=15000)
    page.goto(base + "/submit")
    page.select_option("[data-testid=submit-phase]", "practice")
    page.check("[data-testid=submit-kind-results]")
    page.select_option("[data-testid=submit-scenario]", "dev-example")
    page.set_input_files("[data-testid=submit-file]", str(KIT / "example" / "decisions.csv"))
    page.click("[data-testid=submit-button]")
    expect(page).to_have_url(re.compile(r"/submissions/\d+"), timeout=20000)
    assert run_worker_once() == 1
    expect(page.locator("[data-testid=sub-status]")).to_contain_text(re.compile("scored|Scored|已评分"), timeout=30000)
    expect(page.locator("[data-testid=observed-sky] canvas")).to_be_visible(timeout=15000)
    expect(page.locator("[data-testid=observed-sky]")).to_contain_text("N01")
    page.locator("[data-testid=observed-range]").fill("12")
    expect(page.locator("[data-testid=observed-sky]")).to_contain_text("#")
    page.locator("[data-testid=observed-sky]").scroll_into_view_if_needed()
    page.wait_for_timeout(300)
    shot(page, "02-submission-sky-map")
    page.goto(base + "/leaderboard/practice")
    expect(page.locator("[data-testid=score-bars]")).to_be_visible(timeout=15000)
    expect(page.locator("[data-testid=score-bar].me")).to_contain_text("Compilers")
    expect(page.locator("[data-testid=lb-row]").first).to_be_visible()
    page.locator("[data-testid=score-bars]").scroll_into_view_if_needed()
    shot(page, "03-leaderboard-chart")
    page.goto(base + "/")
    # the home section follows the main (final-ranking) phase, which may have no entries yet
    expect(page.locator("#leaderboard")).to_be_visible(timeout=15000)
    page.locator("#leaderboard").scroll_into_view_if_needed()
    page.wait_for_timeout(800)
    shot(page, "03b-home-leaderboard")
    page.click("[data-testid=nav-logout]")
    expect(page.locator("[data-testid=nav-register]")).to_be_visible(timeout=10000)
