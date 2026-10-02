"""Epic 47 — ``services/moon.event_on`` (AD-63 §6).

The new/full-moon instants are the ones the browser's engine tests use: ONE file,
``frontend/src/moon/vectors.json`` (NASA GSFC "Moon Phases 2001 to 2100", UT), read here by
relative path rather than copied, so the two sides cannot drift apart. A missing file fails the
suite on purpose: CI checks out the whole repo, and a skipped test would be decoration.
"""

import datetime as dt
import json
import zoneinfo
from pathlib import Path

import pytest

from app.services.moon import event_on

VECTORS = json.loads(
    (Path(__file__).resolve().parents[2] / "frontend/src/moon/vectors.json").read_text("utf-8")
)
UTC = zoneinfo.ZoneInfo("UTC")
DAY = dt.timedelta(days=1)


def _instant(iso: str) -> dt.datetime:
    return dt.datetime.fromisoformat(iso.replace("Z", "+00:00"))


NEW_FULL = [v for v in VECTORS["quarters"] if v["kind"] in ("new", "full")]
OTHER = [v for v in VECTORS["quarters"] if v["kind"] not in ("new", "full")]


def test_the_shared_vectors_are_the_ones_the_spec_asks_for():
    assert len(NEW_FULL) >= 6
    assert {v["kind"] for v in NEW_FULL} == {"new", "full"}
    assert OTHER, "the quarter days need a vector too"


@pytest.mark.parametrize("vector", NEW_FULL, ids=lambda v: f"{v['kind']}-{v['utc']}")
def test_the_day_of_a_new_or_full_moon_is_named(vector):
    day = _instant(vector["utc"]).date()
    assert event_on(day, UTC) == vector["kind"]
    assert event_on(day - DAY, UTC) is None
    assert event_on(day + DAY, UTC) is None


@pytest.mark.parametrize("vector", OTHER, ids=lambda v: v["kind"])
def test_a_quarter_that_is_not_new_or_full_says_nothing(vector):
    assert event_on(_instant(vector["utc"]).date(), UTC) is None


def test_an_ordinary_day_says_nothing():
    assert event_on(dt.date(2025, 1, 20), UTC) is None


def test_a_full_moon_late_in_the_evening_is_the_next_local_day_east_of_utc():
    # NASA: full moon 2025-12-04 23:14 UT. Beirut is UTC+2 in December: 01:14 on the 5th.
    beirut = zoneinfo.ZoneInfo("Asia/Beirut")
    assert event_on(dt.date(2025, 12, 4), UTC) == "full"
    assert event_on(dt.date(2025, 12, 5), beirut) == "full"
    assert event_on(dt.date(2025, 12, 4), beirut) is None


def test_a_new_moon_just_after_utc_midnight_is_the_previous_local_day_west_of_utc():
    # NASA: new moon 2025-02-28 00:45 UT. New York is UTC-5 in February: 19:45 on the 27th.
    new_york = zoneinfo.ZoneInfo("America/New_York")
    assert event_on(dt.date(2025, 2, 28), UTC) == "new"
    assert event_on(dt.date(2025, 2, 27), new_york) == "new"
    assert event_on(dt.date(2025, 2, 28), new_york) is None


def test_the_local_day_is_exact_at_the_edges():
    # 2025-01-13 22:27 UT full moon, against zones a whole hour either side of it:
    # UTC+1 puts it at 23:27 on the 13th, UTC+2 at 00:27
    # on the 14th.
    plus1 = zoneinfo.ZoneInfo("Etc/GMT-1")
    plus2 = zoneinfo.ZoneInfo("Etc/GMT-2")
    assert event_on(dt.date(2025, 1, 13), plus1) == "full"
    assert event_on(dt.date(2025, 1, 14), plus1) is None
    assert event_on(dt.date(2025, 1, 14), plus2) == "full"
    assert event_on(dt.date(2025, 1, 13), plus2) is None


def test_a_dst_day_does_not_lose_or_double_the_event():
    # Europe/Paris 2025-03-30 is 23 hours long; the new moon of 2025-03-29 10:58 UT is outside
    # it, and the next full moon (04-13) is untouched.
    paris = zoneinfo.ZoneInfo("Europe/Paris")
    assert event_on(dt.date(2025, 3, 29), paris) == "new"
    assert event_on(dt.date(2025, 3, 30), paris) is None
    assert event_on(dt.date(2025, 3, 31), paris) is None
    assert event_on(dt.date(2025, 4, 13), paris) == "full"  # 00:22 UT = 02:22 CEST


def test_no_zone_means_the_host_clock():
    # The host's local day of the instant, worked out the same way core/clock.py does.
    instant = _instant("2025-01-13T22:27:00Z")
    local_day = instant.astimezone().date()
    assert event_on(local_day, None) == "full"
    assert event_on(local_day - DAY, None) is None
    assert event_on(local_day + DAY, None) is None
