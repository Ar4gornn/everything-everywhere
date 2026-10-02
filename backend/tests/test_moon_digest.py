"""Epic 47 — the moon in the daily digest and in preferences (AD-63 §2, §6).

Digest: kind ``moon`` is off by default; the clause needs the kind AND the Moon module AND a new
or full moon on the account's local today. Preferences: ``modules.moon`` defaults on,
``moon_hemisphere`` is north/south/null, a typo is a 422, null clears. Dates are pinned from the
shared NASA vectors (``frontend/src/moon/vectors.json``); nothing here reads the wall clock.
"""

import datetime as dt

import pytest

from app.core.clock import get_now
from app.services import push
from app.services.push import _WORDS, Digest

UTC = dt.UTC
FULL = dt.date(2025, 1, 13)  # full moon 22:27 UT
NEW = dt.date(2025, 1, 29)  # new moon 12:36 UT
PLAIN = dt.date(2025, 1, 20)


def _kinds(client, user, **kinds):
    current = client.get("/api/auth/me", headers=user["headers"]).json()["preferences"]
    response = client.patch(
        "/api/auth/me/preferences",
        json={"notifications": current["notifications"] | kinds},
        headers=user["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()["preferences"]


def _on(client, user, **kinds):
    """The kind on, and the account on UTC: with no zone the day is the host's, which differs
    from UTC for part of every day on most machines (this one is UTC+3)."""
    _zone(client, user, "UTC")
    return _kinds(client, user, moon=True, **kinds)


def _module(client, user, on):
    response = client.patch(
        "/api/auth/me/preferences", json={"modules": {"moon": on}}, headers=user["headers"]
    )
    assert response.status_code == 200, response.text


def _zone(client, user, zone):
    response = client.patch(
        "/api/auth/me/notification-schedule",
        json={"timezone": zone, "digest_time": "19:00"},
        headers=user["headers"],
    )
    assert response.status_code == 200, response.text


def _digest(user, today):
    from app.core.db import tenant_session

    with tenant_session(user["id"]) as session:
        return push.digest(session, user["id"], today=today)


@pytest.fixture
def at():
    from app.main import app

    def pin(now):
        app.dependency_overrides[get_now] = lambda: now

    yield pin
    app.dependency_overrides.pop(get_now, None)


# ------------------------------------------------------------------ the switch


def test_the_kind_is_off_by_default_and_the_clause_follows_the_switch(client, user_a):
    kinds = client.get("/api/auth/me", headers=user_a["headers"]).json()["preferences"][
        "notifications"
    ]
    assert kinds["moon"] is False
    assert _digest(user_a, FULL).empty is True

    _on(client, user_a)
    found = _digest(user_a, FULL)
    assert found.empty is False
    assert found.body == "Full moon today."
    assert found.url == "/moon"


def test_the_kind_is_a_strict_boolean(client, user_a):
    for value in ("off", None, "yes"):
        response = client.patch(
            "/api/auth/me/preferences",
            json={"notifications": {"moon": value}},
            headers=user_a["headers"],
        )
        assert response.status_code == 422, response.text
        assert response.json()["code"] == "validation"


# ------------------------------------------------------------------ when it speaks


def test_a_new_moon_is_worded_as_new(client, user_a):
    _on(client, user_a)
    assert _digest(user_a, NEW).body == "New moon today."


def test_no_clause_on_an_ordinary_day(client, user_a):
    _on(client, user_a)
    assert _digest(user_a, PLAIN).empty is True


def test_no_clause_on_a_quarter_that_is_not_new_or_full(client, user_a):
    _on(client, user_a)
    assert _digest(user_a, dt.date(2025, 1, 6)).empty is True  # first quarter


def test_the_module_off_silences_the_kind(client, user_a):
    _on(client, user_a)
    _module(client, user_a, False)
    assert _digest(user_a, FULL).empty is True
    _module(client, user_a, True)
    assert _digest(user_a, FULL).body == "Full moon today."


def test_the_clause_comes_after_the_others_in_one_sentence_list(client, user_a):
    _on(client, user_a, habits=False, stock=False)
    found = Digest(0, 3, [], moon_event="full")
    assert found.body == "3 recurring entries are waiting. Full moon today."
    assert _digest(user_a, FULL).body == "Full moon today."


def test_a_junk_event_is_not_a_clause():
    assert Digest(0, 0, [], moon_event="gibbous").empty is True


# ------------------------------------------------------------------ the local day


def test_the_accounts_zone_decides_which_day_the_full_moon_is(client, user_a):
    """Full moon 2025-12-04 23:14 UT: the 4th in London, already the 5th in Beirut."""
    _on(client, user_a)
    _zone(client, user_a, "Asia/Beirut")
    assert _digest(user_a, dt.date(2025, 12, 5)).body == "Full moon today."
    assert _digest(user_a, dt.date(2025, 12, 4)).empty is True
    _zone(client, user_a, "Europe/London")
    assert _digest(user_a, dt.date(2025, 12, 4)).body == "Full moon today."
    assert _digest(user_a, dt.date(2025, 12, 5)).empty is True


def test_the_preview_uses_the_accounts_local_date(client, user_a, at):
    """23:30 UTC on 2025-12-04 is the 5th in Beirut: the preview speaks there, not in London."""
    _on(client, user_a)
    at(dt.datetime(2025, 12, 4, 23, 30, tzinfo=UTC))
    _zone(client, user_a, "Asia/Beirut")
    east = client.get("/api/push/preview", headers=user_a["headers"]).json()
    assert east["local_date"] == "2025-12-05"
    assert east["body"] == "Full moon today."
    assert east["url"] == "/moon"
    _zone(client, user_a, "Europe/London")
    west = client.get("/api/push/preview", headers=user_a["headers"]).json()
    assert west["local_date"] == "2025-12-04"
    assert west["body"] == "Full moon today."  # the 4th is the day it is full in London too
    _zone(client, user_a, "America/New_York")
    behind = client.get("/api/push/preview", headers=user_a["headers"]).json()
    assert behind["local_date"] == "2025-12-04"


# ------------------------------------------------------------------ words


def test_french_words(client, user_a):
    client.patch("/api/auth/me/language", json={"language": "fr"}, headers=user_a["headers"])
    _on(client, user_a)
    assert _digest(user_a, FULL).body == "Pleine lune aujourd'hui."
    assert _digest(user_a, NEW).body == "Nouvelle lune aujourd'hui."


def test_the_moon_words_exist_in_both_languages_and_differ():
    for key in ("moon_new", "moon_full"):
        assert key in _WORDS["en"] and key in _WORDS["fr"]
        assert _WORDS["en"][key] != _WORDS["fr"][key]


# ------------------------------------------------------------------ preferences


def test_the_module_defaults_on_and_the_hemisphere_to_null(client, user_a):
    prefs = client.get("/api/auth/me", headers=user_a["headers"]).json()["preferences"]
    assert prefs["modules"]["moon"] is True
    assert prefs["moon_hemisphere"] is None


def test_the_module_can_be_switched_off_and_on(client, user_a):
    _module(client, user_a, False)
    assert client.get("/api/auth/me", headers=user_a["headers"]).json()["preferences"][
        "modules"
    ]["moon"] is False
    _module(client, user_a, True)
    assert client.get("/api/auth/me", headers=user_a["headers"]).json()["preferences"][
        "modules"
    ]["moon"] is True


def _hemisphere(client, user, body):
    return client.patch("/api/auth/me/preferences", json=body, headers=user["headers"])


def test_the_hemisphere_is_set_and_cleared(client, user_a):
    answer = _hemisphere(client, user_a, {"moon_hemisphere": "south"})
    assert answer.status_code == 200, answer.text
    assert answer.json()["preferences"]["moon_hemisphere"] == "south"
    answer = _hemisphere(client, user_a, {"moon_hemisphere": "north"})
    assert answer.json()["preferences"]["moon_hemisphere"] == "north"
    answer = _hemisphere(client, user_a, {"moon_hemisphere": None})
    assert answer.status_code == 200, answer.text
    assert answer.json()["preferences"]["moon_hemisphere"] is None
    assert (
        client.get("/api/auth/me", headers=user_a["headers"]).json()["preferences"][
            "moon_hemisphere"
        ]
        is None
    )


@pytest.mark.parametrize("value", ["nord", "South", "", "both", 1, True, ["north"]])
def test_a_typo_in_the_hemisphere_is_a_422_and_changes_nothing(client, user_a, value):
    _hemisphere(client, user_a, {"moon_hemisphere": "south"})
    answer = _hemisphere(client, user_a, {"moon_hemisphere": value})
    assert answer.status_code == 422, answer.text
    assert answer.json()["code"] == "validation"
    assert client.get("/api/auth/me", headers=user_a["headers"]).json()["preferences"][
        "moon_hemisphere"
    ] == "south"


def test_another_key_leaves_the_hemisphere_alone(client, user_a):
    _hemisphere(client, user_a, {"moon_hemisphere": "south"})
    answer = _hemisphere(client, user_a, {"modules": {"notes": False}})
    assert answer.json()["preferences"]["moon_hemisphere"] == "south"


def test_resolve_ignores_junk_stored_values():
    from app.services.preferences import resolve

    for junk in ("nord", 3, True, ["south"], {"a": 1}, None):
        assert resolve({"moon_hemisphere": junk})["moon_hemisphere"] is None
    assert resolve({"moon_hemisphere": "south"})["moon_hemisphere"] == "south"
    assert resolve({"modules": {"moon": "off"}})["modules"]["moon"] is True
    assert resolve({"notifications": {"moon": "yes"}})["notifications"]["moon"] is False
