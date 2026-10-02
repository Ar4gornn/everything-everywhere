"""Story 41.1 — the second-user proof for activity days (AD-1, AD-24, AD-57).

Run as the **runtime role** pinned to B, so it is the policy that is being executed, not
read. The table is append-only by grant, so nobody can rewrite or erase a row through the
API's role, not even the row's own owner.
"""

import datetime as dt

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.core.clock import get_now


@pytest.fixture
def clock(client):
    from app.main import app

    now = dt.datetime(2031, 3, 5, 12, tzinfo=dt.UTC)
    app.dependency_overrides[get_now] = lambda: now
    yield
    app.dependency_overrides.pop(get_now, None)


def _a_writes(client, user_a):
    r = client.put("/api/mood/days/2024-01-01", json={"mood": 4}, headers=user_a["headers"])
    assert r.status_code == 200, r.text
    r = client.post("/api/streaks/check-in", json={"streak": "overall"}, headers=user_a["headers"])
    assert r.status_code == 200, r.text


def test_b_sees_none_of_a_rows(client, user_a, user_b, clock, runtime_connection):
    _a_writes(client, user_a)

    a = runtime_connection(user_a["id"])
    b = runtime_connection(user_b["id"])
    try:
        assert a.execute(text("SELECT count(*) FROM activity_days")).scalar_one() == 2
        assert b.execute(text("SELECT count(*) FROM activity_days")).scalar_one() == 0
    finally:
        a.close()
        b.close()

    body = client.get("/api/streaks", headers=user_b["headers"]).json()
    streak = body["streaks"][0]
    assert (streak["current"], streak["best"], streak["today_active"]) == (0, 0, False)


def test_b_checking_in_leaves_a_untouched(client, user_a, user_b, clock, owner_engine):
    _a_writes(client, user_a)
    client.post("/api/streaks/check-in", json={"streak": "overall"}, headers=user_b["headers"])
    with owner_engine.connect() as conn:
        counts = dict(
            conn.execute(text("SELECT user_id, count(*) FROM activity_days GROUP BY user_id")).all()
        )
    assert counts == {user_a["id"]: 2, user_b["id"]: 1}


def test_b_cannot_write_a_row_owned_by_a(user_a, user_b, runtime_connection):
    conn = runtime_connection(user_b["id"])
    try:
        with pytest.raises(DBAPIError):
            conn.execute(
                text(
                    "INSERT INTO activity_days (user_id, day, module) "
                    "VALUES (:u, '2031-03-05', 'mood')"
                ),
                {"u": user_a["id"]},
            )
    finally:
        conn.rollback()
        conn.close()


# The UPDATE touches one row on purpose: set on both of today's rows it would collide on the
# primary key and be refused for that reason even with UPDATE granted (found by mutating the
# grant, 41.7).
@pytest.mark.parametrize(
    "statement",
    ["UPDATE activity_days SET module = 'gym' WHERE module = 'mood'", "DELETE FROM activity_days"],
)
def test_the_table_is_append_only_even_for_the_owner_of_the_rows(
    client, user_a, clock, runtime_connection, statement
):
    _a_writes(client, user_a)
    conn = runtime_connection(user_a["id"])
    try:
        with pytest.raises(DBAPIError):
            conn.execute(text(statement))
    finally:
        conn.rollback()
        conn.close()
