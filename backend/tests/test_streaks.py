"""Story 41.1 — activity days and the overall streak (AD-57).

Every "accepted when" of the story is one test here. The clock is pinned through the one
overridable dependency, ``app.core.clock.get_now``, so a test says which instant a write
happens at and reads the rows the write left behind through the owner connection.

Mood is the write used throughout: it needs no fixtures, and the date it is *about* is
irrelevant to the day it makes active, which is itself a rule (§2.1).
"""

import datetime as dt

import pytest
from sqlalchemy import text

from app.core.clock import get_now, local_today
from app.services import activity, streaks

UTC = dt.UTC


def at(day: int, hour: int = 12, minute: int = 0, month: int = 3) -> dt.datetime:
    return dt.datetime(2031, month, day, hour, minute, tzinfo=UTC)


@pytest.fixture
def clock(client):
    """Pin the instant every request sees. ``clock(at(5))`` moves it."""
    from app.main import app

    def set_now(value: dt.datetime) -> None:
        app.dependency_overrides[get_now] = lambda: value

    set_now(at(1))
    yield set_now
    app.dependency_overrides.pop(get_now, None)


def write(client, user, about: str = "2024-01-01", mood: int = 3):
    response = client.put(f"/api/mood/days/{about}", json={"mood": mood}, headers=user["headers"])
    assert response.status_code == 200, response.text


def rows(owner_engine, user=None):
    sql = "SELECT day, module FROM activity_days"
    params = {}
    if user is not None:
        sql += " WHERE user_id = :u"
        params = {"u": user["id"]}
    with owner_engine.connect() as conn:
        return sorted((str(d), m) for d, m in conn.execute(text(sql), params))


def overall(client, user):
    body = client.get("/api/streaks", headers=user["headers"]).json()
    return body, next(s for s in body["streaks"] if s["id"] == "overall")


# ---------------------------------------------------------------- what makes a day


def test_a_successful_write_makes_today_active_for_its_module_and_overall(
    client, user_a, clock, owner_engine
):
    clock(at(5))
    write(client, user_a)
    assert rows(owner_engine) == [("2031-03-05", "mood")]
    body, streak = overall(client, user_a)
    assert body["today"] == "2031-03-05"
    assert (streak["current"], streak["today_active"]) == (1, True)


def test_the_date_written_about_is_irrelevant(client, user_a, clock, owner_engine):
    clock(at(5))
    write(client, user_a, about="2020-02-02")
    assert rows(owner_engine) == [("2031-03-05", "mood")]


def test_a_validation_error_does_not_count(client, user_a, clock, owner_engine):
    clock(at(5))
    # FastAPI's own body validation: the handler never runs.
    bad = client.put("/api/mood/days/2024-01-01", json={"mood": 9}, headers=user_a["headers"])
    assert bad.status_code == 422
    # The service's refusal: the handler raises.
    future = client.put("/api/mood/days/2099-01-01", json={"mood": 3}, headers=user_a["headers"])
    assert future.status_code == 422
    # A missing row on a mapped router.
    gone = client.delete(
        "/api/notes/00000000-0000-4000-8000-000000000000", headers=user_a["headers"]
    )
    assert gone.status_code == 404
    assert rows(owner_engine) == []
    assert overall(client, user_a)[1]["current"] == 0


def test_sign_in_settings_and_preferences_do_not_count(client, user_a, clock, owner_engine):
    clock(at(5))
    headers = user_a["headers"]
    # register + login already happened in the fixture
    for call in (
        client.patch("/api/auth/me/currency", json={"currency": "EUR"}, headers=headers),
        client.patch("/api/auth/me/language", json={"language": "fr"}, headers=headers),
        client.patch(
            "/api/auth/me/notification-schedule",
            json={"timezone": "Europe/Paris", "digest_time": "19:00"},
            headers=headers,
        ),
        client.patch(
            "/api/auth/me/preferences", json={"modules": {"gym": False}}, headers=headers
        ),
        client.post(
            "/api/auth/login",
            json={"email": user_a["email"], "password": user_a["password"]},
        ),
    ):
        assert call.status_code == 200, call.text
    assert rows(owner_engine) == []


def test_reading_does_not_count(client, user_a, clock, owner_engine):
    clock(at(5))
    assert client.get("/api/mood/history", headers=user_a["headers"]).status_code == 200
    assert client.get("/api/streaks", headers=user_a["headers"]).status_code == 200
    assert rows(owner_engine) == []


def test_two_writes_on_one_day_make_one_row(client, user_a, clock, owner_engine):
    clock(at(5))
    write(client, user_a, mood=2)
    clock(at(5, 20))
    write(client, user_a, mood=4)
    assert rows(owner_engine) == [("2031-03-05", "mood")]


def _quiet_client():
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app, raise_server_exceptions=False)


def test_the_write_and_its_activity_row_roll_back_together(
    client, user_a, clock, owner_engine, monkeypatch
):
    """A failure after the handler wrote leaves neither row."""
    from app.services import mood

    real = mood.set_day

    def write_then_fail(*args, **kwargs):
        real(*args, **kwargs)
        raise RuntimeError("boom after the write")

    monkeypatch.setattr(mood, "set_day", write_then_fail)
    clock(at(5))
    with _quiet_client() as quiet:
        response = quiet.put(
            "/api/mood/days/2024-01-01", json={"mood": 3}, headers=user_a["headers"]
        )
    assert response.status_code == 500
    with owner_engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM mood_days")).scalar_one() == 0
    assert rows(owner_engine) == []


def test_a_failing_activity_row_rolls_the_write_back(
    client, user_a, clock, owner_engine, monkeypatch
):
    def refuse(*args, **kwargs):
        raise RuntimeError("no activity row")

    monkeypatch.setattr(activity, "record", refuse)
    clock(at(5))
    with _quiet_client() as quiet:
        response = quiet.put(
            "/api/mood/days/2024-01-01", json={"mood": 3}, headers=user_a["headers"]
        )
    assert response.status_code == 500
    with owner_engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM mood_days")).scalar_one() == 0


# ---------------------------------------------------------------- the local day


@pytest.mark.parametrize(
    ("zone", "late", "early", "expected"),
    [
        # East of UTC: both instants fall on the 5th in UTC, on the 5th and 6th locally.
        ("Asia/Tokyo", at(5, 14, 30), at(5, 15, 30), ["2031-03-05", "2031-03-06"]),
        # West of UTC: both fall on the 6th in UTC, on the 5th and 6th locally.
        ("America/Los_Angeles", at(6, 7, 30), at(6, 8, 30), ["2031-03-05", "2031-03-06"]),
    ],
)
def test_23_30_and_00_30_local_land_on_two_days(
    client, user_a, clock, owner_engine, zone, late, early, expected
):
    set_zone = client.patch(
        "/api/auth/me/notification-schedule",
        json={"timezone": zone, "digest_time": "19:00"},
        headers=user_a["headers"],
    )
    assert set_zone.status_code == 200
    clock(late)
    write(client, user_a)
    clock(early)
    write(client, user_a)
    assert [day for day, _ in rows(owner_engine)] == expected


def test_a_null_zone_uses_the_host_clock(client, user_a, clock, owner_engine):
    # An instant whose host date differs from its UTC date, or UTC and the host clock
    # would agree and a fallback to UTC would pass unseen.
    candidates = [i for i in (at(5, 23, 30), at(5, 0, 30)) if i.astimezone().date() != i.date()]
    if not candidates:
        pytest.skip("host clock is UTC: host and UTC dates cannot differ")
    now = candidates[0]
    clock(now)
    write(client, user_a)
    assert [day for day, _ in rows(owner_engine)] == [str(now.astimezone().date())]
    assert local_today(None, now) == now.astimezone().date() != now.date()


def test_a_zone_that_no_longer_resolves_falls_back_to_the_host():
    now = at(5, 3)
    assert local_today("Not/AZone", now) == now.astimezone().date()


# ---------------------------------------------------------------- the walk


def d(n: int) -> dt.date:
    return dt.date(2031, 3, n)


def test_walk_three_active_days_is_three():
    current, best, states = streaks.walk({d(1), d(2), d(3)}, today=d(3))
    assert (current, best) == (3, 3)
    assert set(states.values()) == {"active"}


def test_walk_today_pending_keeps_the_streak():
    current, best, states = streaks.walk({d(1), d(2), d(3)}, today=d(4))
    assert (current, best) == (3, 3)
    assert states[d(4)] == "pending"


def test_walk_a_missed_yesterday_is_zero_and_best_survives():
    current, best, states = streaks.walk({d(1), d(2), d(3)}, today=d(5))
    assert (current, best) == (0, 3)
    assert states[d(4)] == "missed"
    assert states[d(5)] == "pending"


def test_walk_a_new_run_after_a_break_and_best_is_the_longest():
    current, best, _ = streaks.walk({d(1), d(2), d(3), d(5), d(6)}, today=d(6))
    assert (current, best) == (2, 3)


def test_walk_ignores_activity_after_local_today():
    current, best, states = streaks.walk({d(1), d(2), d(9)}, today=d(2))
    assert (current, best) == (2, 2)
    assert d(9) not in states


def test_walk_with_no_activity_is_zero():
    assert streaks.walk(set(), today=d(4))[:2] == (0, 0)


def test_the_streak_over_the_api_follows_the_clock(client, user_a, clock):
    for day in (1, 2, 3):
        clock(at(day))
        write(client, user_a)
    assert overall(client, user_a)[1]["current"] == 3

    clock(at(4))  # today pending
    _, streak = overall(client, user_a)
    assert (streak["current"], streak["best"], streak["today_active"]) == (3, 3, False)
    assert streak["recent"][-1] == {"day": "2031-03-04", "state": "pending"}
    assert len(streak["recent"]) == streaks.RECENT_DAYS

    clock(at(5))  # yesterday missed
    _, streak = overall(client, user_a)
    assert (streak["current"], streak["best"]) == (0, 3)
    assert [s["state"] for s in streak["recent"][-5:]] == [
        "active",
        "active",
        "active",
        "missed",
        "pending",
    ]

    write(client, user_a)  # a new run; the best survives
    _, streak = overall(client, user_a)
    assert (streak["current"], streak["best"]) == (1, 3)


# ---------------------------------------------------------------- check in


def _check_in(client, user, streak="overall"):
    return client.post("/api/streaks/check-in", json={"streak": streak}, headers=user["headers"])


def test_check_in_is_idempotent(client, user_a, clock, owner_engine):
    clock(at(5))
    first = _check_in(client, user_a)
    second = _check_in(client, user_a)
    assert (first.status_code, second.status_code) == (200, 200)
    assert first.json() == second.json()
    assert first.json()["today_active"] is True
    assert first.json()["current"] == 1
    assert rows(owner_engine) == [("2031-03-05", "app")]


def test_check_in_for_an_unknown_streak_is_422(client, user_a, clock, owner_engine):
    clock(at(5))
    response = _check_in(client, user_a, "nope")
    assert response.status_code == 422
    assert response.json()["code"] == "streak_unknown"
    assert rows(owner_engine) == []


def test_a_check_in_and_a_write_on_one_day_are_one_day(client, user_a, clock, owner_engine):
    clock(at(5))
    _check_in(client, user_a)
    write(client, user_a)
    assert rows(owner_engine) == [("2031-03-05", "app"), ("2031-03-05", "mood")]
    assert overall(client, user_a)[1]["current"] == 1


def test_rows_of_a_module_that_left_the_catalogue_are_ignored(client, user_a, clock, owner_engine):
    clock(at(5))
    with owner_engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO activity_days (user_id, day, module) "
                "VALUES (:u, '2031-03-05', 'retired')"
            ),
            {"u": user_a["id"]},
        )
    assert overall(client, user_a)[1]["current"] == 0


def test_the_streaks_endpoints_require_a_token(client):
    assert client.get("/api/streaks").status_code == 401
    assert client.post("/api/streaks/check-in", json={"streak": "overall"}).status_code == 401
