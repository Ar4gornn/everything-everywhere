"""Story 41.2 — tab streaks (AD-57).

One test per "accepted when" of the story: a write moves its own module's streak and overall
and nothing else, a dashboard check-in moves overall only, every tab streak is off by
default, the preference is strict, and switching a module off leaves its earning alone. The
clock is pinned through ``app.core.clock.get_now`` exactly as in ``test_streaks.py``.
"""

import datetime as dt

import pytest
from sqlalchemy import text

from app.core.clock import get_now
from app.services import activity, preferences

UTC = dt.UTC
MODULE_IDS = (
    "entries",
    "plan",
    "grow",
    "habits",
    "mood",
    "books",
    "stock",
    "gym",
    "recipes",
    "notes",
)


@pytest.fixture
def clock(client):
    from app.main import app

    app.dependency_overrides[get_now] = lambda: dt.datetime(2031, 3, 5, 12, tzinfo=UTC)
    yield
    app.dependency_overrides.pop(get_now, None)


def streaks_of(client, user) -> dict[str, dict]:
    body = client.get("/api/streaks", headers=user["headers"]).json()
    return {s["id"]: s for s in body["streaks"]}


def moved(client, user) -> set[str]:
    """The ids whose streak has today active."""
    return {sid for sid, s in streaks_of(client, user).items() if s["today_active"]}


def gym_write(client, user, name: str = "Push"):
    response = client.post("/api/gym/routines", json={"name": name}, headers=user["headers"])
    assert response.status_code == 201, response.text


# ---------------------------------------------------------------- the list


def test_get_returns_overall_and_all_ten_module_streaks(client, user_a, clock):
    found = streaks_of(client, user_a)
    assert list(found) == ["overall", *MODULE_IDS]
    assert tuple(activity.MODULES) == MODULE_IDS
    assert all(len(s["recent"]) == 28 for s in found.values())
    assert all(s["current"] == 0 for s in found.values())


# ---------------------------------------------------------------- attribution


def test_a_gym_write_moves_gym_and_overall_and_nothing_else(client, user_a, clock, owner_engine):
    gym_write(client, user_a)
    assert moved(client, user_a) == {"gym", "overall"}
    found = streaks_of(client, user_a)
    assert (found["gym"]["current"], found["overall"]["current"]) == (1, 1)
    assert all(found[m]["current"] == 0 for m in MODULE_IDS if m != "gym")
    with owner_engine.connect() as conn:
        assert [r[0] for r in conn.execute(text("SELECT module FROM activity_days"))] == ["gym"]


def test_a_write_under_each_prefix_moves_only_its_module(client, user_a, clock):
    """The map is the one place that decides; proven end to end for two more modules."""
    note = client.put(
        "/api/notes/6f1d2c9e-0000-4000-8000-000000000001",
        json={"kind": "text", "title": "n", "body": "b"},
        headers=user_a["headers"],
    )
    assert note.status_code == 201, note.text
    assert moved(client, user_a) == {"notes", "overall"}
    mood = client.put("/api/mood/days/2024-01-01", json={"mood": 3}, headers=user_a["headers"])
    assert mood.status_code == 200
    assert moved(client, user_a) == {"notes", "mood", "overall"}


def test_a_dashboard_check_in_moves_overall_only(client, user_a, clock, owner_engine):
    response = client.post(
        "/api/streaks/check-in", json={"streak": "overall"}, headers=user_a["headers"]
    )
    assert response.status_code == 200
    assert moved(client, user_a) == {"overall"}
    with owner_engine.connect() as conn:
        assert [r[0] for r in conn.execute(text("SELECT module FROM activity_days"))] == ["app"]


@pytest.mark.parametrize("module", [m for m in MODULE_IDS if m != "mood"])
def test_a_tab_check_in_moves_that_tab_and_overall(client, user_a, clock, module):
    response = client.post(
        "/api/streaks/check-in", json={"streak": module}, headers=user_a["headers"]
    )
    assert response.status_code == 200, response.text
    assert response.json()["id"] == module
    assert response.json()["today_active"] is True
    assert moved(client, user_a) == {module, "overall"}


def test_mood_has_no_check_in(client, user_a, clock, owner_engine):
    response = client.post(
        "/api/streaks/check-in", json={"streak": "mood"}, headers=user_a["headers"]
    )
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "streak_unknown"
    with owner_engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM activity_days")).scalar_one() == 0


def test_a_tab_check_in_is_idempotent(client, user_a, clock, owner_engine):
    for _ in range(2):
        client.post("/api/streaks/check-in", json={"streak": "gym"}, headers=user_a["headers"])
    with owner_engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM activity_days")).scalar_one() == 1


def test_a_check_in_for_overall_is_not_a_tab_check_in(client, user_a, clock):
    """``app`` is overall's own activity: it must not show up under any tab."""
    client.post("/api/streaks/check-in", json={"streak": "overall"}, headers=user_a["headers"])
    assert all(
        not s["today_active"] for sid, s in streaks_of(client, user_a).items() if sid != "overall"
    )


# ---------------------------------------------------------------- preferences


def _prefs(client, user):
    return client.get("/api/auth/me", headers=user["headers"]).json()["preferences"]


def _patch(client, user, body):
    return client.patch("/api/auth/me/preferences", json=body, headers=user["headers"])


def test_every_tab_streak_is_off_by_default(client, user_a):
    assert _prefs(client, user_a)["streaks"] == {m: False for m in MODULE_IDS}
    assert preferences.resolve({})["streaks"] == {m: False for m in MODULE_IDS}


def test_switching_a_streak_on_reads_back_and_leaves_the_rest_off(client, user_a):
    answer = _patch(client, user_a, {"streaks": {"gym": True}})
    assert answer.status_code == 200, answer.text
    expected = {m: m == "gym" for m in MODULE_IDS}
    assert answer.json()["preferences"]["streaks"] == expected
    assert _prefs(client, user_a)["streaks"] == expected


def test_a_non_boolean_is_a_422_not_a_streak_switched_on(client, user_a):
    answer = _patch(client, user_a, {"streaks": {"gym": "off"}})
    assert answer.status_code == 422, answer.text
    assert _prefs(client, user_a)["streaks"]["gym"] is False
    assert _patch(client, user_a, {"streaks": {"gym": "yes"}}).status_code == 422
    assert _patch(client, user_a, {"streaks": {"gym": 1}}).status_code == 422


@pytest.mark.parametrize("bad", ["overall", "app", "nope"])
def test_an_unknown_streak_id_is_refused_with_its_code(client, user_a, bad):
    answer = _patch(client, user_a, {"streaks": {bad: True}})
    assert answer.status_code == 422
    assert answer.json()["code"] == "pref_unknown_id"


def test_a_preferences_patch_does_not_make_a_day(client, user_a, clock, owner_engine):
    _patch(client, user_a, {"streaks": {"gym": True}})
    with owner_engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM activity_days")).scalar_one() == 0


def test_a_stored_unknown_or_malformed_value_is_read_not_refused():
    resolved = preferences.resolve({"streaks": {"gym": True, "retired": True, "notes": "x"}})
    assert resolved["streaks"]["gym"] is True
    assert resolved["streaks"]["notes"] is False
    assert "retired" not in resolved["streaks"]


# ---------------------------------------------------------------- module off


def test_switching_a_module_off_leaves_its_earning_alone(client, user_a, clock, owner_engine):
    _patch(client, user_a, {"streaks": {"gym": True}})
    gym_write(client, user_a)
    before = streaks_of(client, user_a)
    assert _patch(client, user_a, {"modules": {"gym": False}}).status_code == 200
    # Off hides UI only (AD-49): the streak is still computed, unchanged, and still earns.
    assert streaks_of(client, user_a) == before
    with owner_engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM activity_days")).scalar_one() == 1
    gym_write(client, user_a, "Pull")  # the endpoints are untouched; same day, same row
    assert streaks_of(client, user_a)["gym"]["current"] == 1
