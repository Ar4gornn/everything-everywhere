# ruff: noqa: E501
"""Epic 43 - rest days (AD-59), the recent-sessions read, rest after an exercise."""

import datetime as dt
import re
import uuid

import pytest
from sqlalchemy import event, text

from app.api import calendar as calendar_api

H = "headers"


@pytest.fixture(autouse=True)
def _fresh_limiter():
    calendar_api.limiter.reset()
    yield
    calendar_api.limiter.reset()


def _complete(client, user, **body):
    body.setdefault("client_ref", str(uuid.uuid4()))
    body.setdefault("performed_on", "2026-10-01")
    body.setdefault("sets", [])
    return client.post("/api/gym/workouts/complete", json=body, headers=user[H])


def _rest(client, user, **body):
    return _complete(client, user, rest_day=True, **body)


def _session(client, user, day, name="Bench"):
    r = _complete(
        client, user, performed_on=day, sets=[{"exercise_name": name, "reps": 5, "weight": "60"}]
    )
    assert r.status_code == 201, r.text
    return r.json()


def _count(runtime_connection, user, where="true"):
    conn = runtime_connection(user["id"])
    try:
        return conn.execute(text(f"SELECT count(*) FROM workouts WHERE {where}")).scalar_one()
    finally:
        conn.close()


# --------------------------------------------------------------- rest days


def test_a_rest_day_is_stored_flagged_with_no_sets_and_no_routine(client, user_a):
    routine = client.post("/api/gym/routines", json={"name": "Push"}, headers=user_a[H]).json()
    r = _rest(client, user_a, routine_id=routine["id"])
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["rest_day"] is True
    assert body["sets"] == []
    assert body["routine_id"] is None
    listed = client.get("/api/gym/workouts", headers=user_a[H]).json()["items"]
    assert [w["rest_day"] for w in listed] == [True]
    assert client.get(f"/api/gym/workouts/{body['id']}", headers=user_a[H]).json()["rest_day"] is True


def test_a_normal_session_is_not_a_rest_day(client, user_a):
    assert _session(client, user_a, "2026-10-01")["rest_day"] is False


def test_a_rest_day_is_idempotent_on_client_ref(client, user_a, runtime_connection):
    ref = str(uuid.uuid4())
    first = _rest(client, user_a, client_ref=ref)
    again = _rest(client, user_a, client_ref=ref)
    assert (first.status_code, again.status_code) == (201, 200)
    assert again.json()["id"] == first.json()["id"]
    assert _count(runtime_connection, user_a, "rest_day") == 1


def test_a_second_rest_day_on_the_same_date_returns_the_first(client, user_a, runtime_connection):
    first = _rest(client, user_a)
    second = _rest(client, user_a)  # a fresh client_ref, same date
    assert (first.status_code, second.status_code) == (201, 200)
    assert second.json()["id"] == first.json()["id"]
    assert _count(runtime_connection, user_a, "rest_day") == 1
    # another date is another rest day
    assert _rest(client, user_a, performed_on="2026-10-02").status_code == 201
    assert _count(runtime_connection, user_a, "rest_day") == 2


def test_a_rest_day_with_sets_is_refused(client, user_a, runtime_connection):
    r = _rest(client, user_a, sets=[{"exercise_name": "Bench", "reps": 5}])
    assert r.status_code == 422, r.text
    assert r.json()["code"] == "rest_day_has_sets"
    assert _count(runtime_connection, user_a) == 0


def test_rest_day_must_be_a_real_boolean(client, user_a):
    assert _complete(client, user_a, rest_day="yes").status_code == 422
    assert _complete(client, user_a, rest_day="off").status_code == 422


def test_a_rest_day_and_a_session_on_the_same_date_both_stay(client, user_a, runtime_connection):
    session = _session(client, user_a, "2026-10-01")
    rest = _rest(client, user_a, performed_on="2026-10-01")
    assert rest.status_code == 201, rest.text
    assert rest.json()["id"] != session["id"]
    assert _count(runtime_connection, user_a) == 2
    # and the order does not matter
    _rest(client, user_a, performed_on="2026-10-05")
    assert _session(client, user_a, "2026-10-05")["rest_day"] is False
    assert _count(runtime_connection, user_a) == 4


def test_one_users_rest_day_never_blocks_anothers(client, user_a, user_b, runtime_connection):
    a = _rest(client, user_a)
    b = _rest(client, user_b)
    assert (a.status_code, b.status_code) == (201, 201)
    assert a.json()["id"] != b.json()["id"]
    assert _count(runtime_connection, user_a, "rest_day") == 1
    assert _count(runtime_connection, user_b, "rest_day") == 1
    # a ref used by A is just a fresh ref for B
    ref = str(uuid.uuid4())
    assert _rest(client, user_a, client_ref=ref, performed_on="2026-10-09").status_code == 201
    assert _rest(client, user_b, client_ref=ref, performed_on="2026-10-09").status_code == 201


def test_a_rest_day_can_be_deleted_and_logged_again(client, user_a):
    first = _rest(client, user_a).json()
    assert client.delete(f"/api/gym/workouts/{first['id']}", headers=user_a[H]).status_code == 204
    again = _rest(client, user_a)
    assert again.status_code == 201
    assert again.json()["id"] != first["id"]


# ------------------------------------------------------------------ recent


def test_recent_returns_sets_newest_first(client, user_a):
    _session(client, user_a, "2026-09-20", "Squat")
    _rest(client, user_a, performed_on="2026-09-22")
    _session(client, user_a, "2026-09-21", "Bench")
    r = client.get("/api/gym/workouts/recent", headers=user_a[H])
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert [w["performed_on"] for w in items] == ["2026-09-22", "2026-09-21", "2026-09-20"]
    assert [w["rest_day"] for w in items] == [True, False, False]
    assert items[0]["sets"] == []
    assert items[1]["sets"][0]["exercise_name"] == "Bench"
    assert items[1]["sets"][0]["reps"] == 5
    assert items[2]["sets"][0]["exercise_name"] == "Squat"


def test_recent_orders_a_day_by_creation_and_keeps_set_order(client, user_a):
    first = _complete(
        client,
        user_a,
        performed_on="2026-09-20",
        sets=[
            {"exercise_name": "Bench", "reps": 5},
            {"exercise_name": "Row", "reps": 8},
            {"exercise_name": "Bench", "reps": 4},
        ],
    ).json()
    second = _session(client, user_a, "2026-09-20", "Squat")
    items = client.get("/api/gym/workouts/recent", headers=user_a[H]).json()["items"]
    assert [w["id"] for w in items] == [second["id"], first["id"]]
    assert [(s["exercise_name"], s["reps"]) for s in items[1]["sets"]] == [
        ("Bench", 5),
        ("Row", 8),
        ("Bench", 4),
    ]


def test_recent_never_shows_another_users_sessions(client, user_a, user_b):
    _session(client, user_b, "2026-09-25", "Secret lift")
    _rest(client, user_b, performed_on="2026-09-26")
    mine = _session(client, user_a, "2026-09-20")
    items = client.get("/api/gym/workouts/recent", headers=user_a[H]).json()["items"]
    assert [w["id"] for w in items] == [mine["id"]]
    assert "Secret lift" not in str(items)


def test_recent_is_not_shadowed_by_the_id_route(client, user_a):
    # If `/workouts/{workout_id}` caught "recent" this would be a 422 (not a uuid).
    r = client.get("/api/gym/workouts/recent", headers=user_a[H])
    assert r.status_code == 200
    assert r.json() == {"items": []}


def test_recent_limit_default_and_bounds(client, user_a):
    for day in range(1, 13):
        _rest(client, user_a, performed_on=f"2026-09-{day:02d}")
    url = "/api/gym/workouts/recent"
    assert len(client.get(url, headers=user_a[H]).json()["items"]) == 10
    assert len(client.get(url, params={"limit": 3}, headers=user_a[H]).json()["items"]) == 3
    assert len(client.get(url, params={"limit": 30}, headers=user_a[H]).json()["items"]) == 12
    for bad in (0, 31, -1, "x"):
        assert client.get(url, params={"limit": bad}, headers=user_a[H]).status_code == 422


def test_recent_needs_a_signed_in_account(client):
    assert client.get("/api/gym/workouts/recent").status_code == 401


def test_recent_takes_two_queries_however_many_sessions(client, user_a):
    from app.core.db import engine

    for day in range(1, 8):
        _session(client, user_a, f"2026-09-{day:02d}", f"Lift {day}")
    seen: list[str] = []

    def count(conn, cursor, statement, *_):
        if statement.lstrip().upper().startswith("SELECT") and "workout" in statement:
            seen.append(statement)

    event.listen(engine, "before_cursor_execute", count)
    try:
        r = client.get("/api/gym/workouts/recent", headers=user_a[H])
    finally:
        event.remove(engine, "before_cursor_execute", count)
    assert len(r.json()["items"]) == 7
    assert len(seen) == 2, seen


# --------------------------------------------------------- rest after


def _routine(client, user):
    return client.post("/api/gym/routines", json={"name": "Push"}, headers=user[H]).json()


def test_rest_after_seconds_round_trips_on_create_patch_and_full(client, user_a):
    routine = _routine(client, user_a)
    url = f"/api/gym/routines/{routine['id']}/exercises"
    r = client.post(url, json={"exercise_name": "Bench", "rest_after_seconds": 90}, headers=user_a[H])
    assert r.status_code == 201, r.text
    assert r.json()["rest_after_seconds"] == 90
    bare = client.post(url, json={"exercise_name": "Row"}, headers=user_a[H]).json()
    assert bare["rest_after_seconds"] is None

    line_id = r.json()["id"]
    patched = client.patch(
        f"/api/gym/routines/lines/{line_id}", json={"rest_after_seconds": 0}, headers=user_a[H]
    )
    assert patched.json()["rest_after_seconds"] == 0
    # An absent key leaves it, an explicit null clears it.
    kept = client.patch(f"/api/gym/routines/lines/{line_id}", json={"note": "x"}, headers=user_a[H])
    assert kept.json()["rest_after_seconds"] == 0
    cleared = client.patch(
        f"/api/gym/routines/lines/{line_id}", json={"rest_after_seconds": None}, headers=user_a[H]
    )
    assert cleared.json()["rest_after_seconds"] is None

    client.patch(
        f"/api/gym/routines/lines/{line_id}", json={"rest_after_seconds": 120}, headers=user_a[H]
    )
    full = client.get("/api/gym/routines/full", headers=user_a[H]).json()["items"][0]
    assert [ln["rest_after_seconds"] for ln in full["lines"]] == [120, None]
    detail = client.get(f"/api/gym/routines/{routine['id']}", headers=user_a[H]).json()
    assert [ln["rest_after_seconds"] for ln in detail["lines"]] == [120, None]


def test_rest_after_seconds_range_is_0_to_3600(client, user_a):
    routine = _routine(client, user_a)
    url = f"/api/gym/routines/{routine['id']}/exercises"
    for ok in (0, 3600):
        body = {"exercise_name": f"E{ok}", "rest_after_seconds": ok}
        assert client.post(url, json=body, headers=user_a[H]).status_code == 201
    for bad in (-1, 3601):
        body = {"exercise_name": "Bad", "rest_after_seconds": bad}
        assert client.post(url, json=body, headers=user_a[H]).status_code == 422
    line = client.post(url, json={"exercise_name": "Fine"}, headers=user_a[H]).json()
    for bad in (-1, 3601):
        r = client.patch(
            f"/api/gym/routines/lines/{line['id']}", json={"rest_after_seconds": bad}, headers=user_a[H]
        )
        assert r.status_code == 422


def test_import_carries_rest_after_seconds_and_refuses_out_of_range(client, user_a):
    ok = client.post(
        "/api/gym/routines/import",
        json={
            "name": "Imported",
            "lines": [
                {"exercise_name": "Bench", "kind": "reps", "target_sets": 3, "target_reps": 5, "rest_after_seconds": 120},
                {"exercise_name": "Row", "kind": "reps"},
            ],
        },
        headers=user_a[H],
    )
    assert ok.status_code == 201, ok.text
    assert [ln["rest_after_seconds"] for ln in ok.json()["lines"]] == [120, None]
    bad = client.post(
        "/api/gym/routines/import",
        json={"name": "Bad", "lines": [{"exercise_name": "Bench", "kind": "reps", "rest_after_seconds": 3601}]},
        headers=user_a[H],
    )
    assert bad.status_code == 422


# -------------------------------------------------------------- the feed


class _Feed:
    def __init__(self, client, user):
        self.client, self.user = client, user
        self.path = client.post("/api/calendar/feed", headers=user[H]).json()["path"]

    def summaries(self, *, detailed=False):
        self.client.patch(
            "/api/calendar/feed",
            json={"layers": ["gym"], "detailed": detailed},
            headers=self.user[H],
        )
        raw = self.client.get(self.path).text
        body = raw.replace("\r\n ", "").replace("\r\n", "\n")
        return re.findall(r"^SUMMARY:(.*)$", body, flags=re.MULTILINE)


def test_feed_says_rest_day_for_a_rest_only_day(client, user_a):
    _rest(client, user_a, performed_on=dt.date.today().isoformat())
    feed = _Feed(client, user_a)
    assert feed.summaries() == ["Rest day"]
    assert feed.summaries(detailed=True) == ["Rest day"]
    client.patch("/api/auth/me/language", json={"language": "fr"}, headers=user_a[H])
    assert feed.summaries() == ["Repos"]


def test_feed_adds_rest_to_a_day_with_a_session(client, user_a):
    today = dt.date.today().isoformat()
    _session(client, user_a, today)
    _rest(client, user_a, performed_on=today)
    feed = _Feed(client, user_a)
    assert feed.summaries() == ["Workout + rest"]
    client.patch("/api/auth/me/language", json={"language": "fr"}, headers=user_a[H])
    assert feed.summaries() == ["Séance + repos"]


def test_feed_leaves_a_plain_session_day_as_it_was(client, user_a):
    _session(client, user_a, dt.date.today().isoformat())
    assert _Feed(client, user_a).summaries() == ["Workout"]


def test_recent_with_a_small_limit_returns_only_those_sessions_sets(client, user_a):
    _session(client, user_a, "2026-09-20", "Squat")
    newest = _session(client, user_a, "2026-09-21", "Bench")
    items = client.get("/api/gym/workouts/recent", params={"limit": 1}, headers=user_a[H]).json()["items"]
    assert [w["id"] for w in items] == [newest["id"]]
    assert [s["exercise_name"] for s in items[0]["sets"]] == ["Bench"]
