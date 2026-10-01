"""Story 41.7 — the second-user proof across all four endpoints and both tables (AD-1, AD-57).

A is given the whole of what the epic stores: activity (a long run in the gym to fund
purchases, a ten-day overall run), a freeze, and a repair. B then reads and writes through
all four endpoints, and a connection **as the runtime role pinned to B** counts what it can
see. Per-story proofs exist beside each feature; this one is the whole picture at once, so
a policy that is right on one endpoint and wrong on another cannot hide between them.
"""

import datetime as dt

import pytest
from sqlalchemy import text

from app.core.clock import get_now

UTC = dt.UTC
START = dt.date(2030, 1, 1)


def day(n: int) -> dt.date:
    return START + dt.timedelta(days=n - 1)


@pytest.fixture
def clock(client):
    from app.main import app

    moment = dt.datetime.combine(day(12), dt.time(12), tzinfo=UTC)
    app.dependency_overrides[get_now] = lambda: moment
    yield
    app.dependency_overrides.pop(get_now, None)


def _seed(owner_engine, user, first: int, last: int, module: str) -> None:
    with owner_engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO activity_days (user_id, day, module) "
                "SELECT CAST(:u AS uuid), CAST(:d AS date) + g, CAST(:m AS text) "
                "FROM generate_series(CAST(:a AS int), CAST(:b AS int)) g"
            ),
            {"u": user["id"], "d": day(1), "m": module, "a": first - 1, "b": last - 1},
        )


def _counts(owner_engine) -> dict:
    with owner_engine.connect() as conn:
        out = {}
        for table in ("activity_days", "streak_purchases"):
            rows = conn.execute(text(f"SELECT user_id, count(*) FROM {table} GROUP BY user_id"))
            out[table] = {str(u): n for u, n in rows.all()}
        return out


@pytest.fixture
def a_has_everything(client, user_a, owner_engine, clock):
    _seed(owner_engine, user_a, -300, -200, "gym")  # funds the purchases
    _seed(owner_engine, user_a, 1, 10, "app")  # a run, then day 11 missed: a repair is offered
    headers = user_a["headers"]
    freeze = client.post("/api/streaks/freezes", json={"streak": "gym"}, headers=headers)
    assert freeze.status_code == 201, freeze.text
    offer = next(
        s
        for s in client.get("/api/streaks", headers=headers).json()["streaks"]
        if s["id"] == "overall"
    )["repair"]
    assert offer is not None
    repair = client.post(
        "/api/streaks/repairs", json={"streak": "overall", "cost": offer["cost"]}, headers=headers
    )
    assert repair.status_code == 201, repair.text
    return _counts(owner_engine)


def test_b_reads_none_of_a_and_the_runtime_role_sees_no_row(
    client, user_a, user_b, a_has_everything, runtime_connection
):
    assert a_has_everything["activity_days"][str(user_a["id"])] > 100
    assert (
        a_has_everything["streak_purchases"][str(user_a["id"])] == 2
    )  # a freeze, one repaired day

    body = client.get("/api/streaks", headers=user_b["headers"]).json()
    assert body["points"] == {"balance": 0, "earned": 0, "spent": 0}
    for streak in body["streaks"]:
        assert (streak["current"], streak["best"], streak["held_freezes"]) == (0, 0, 0)
        assert streak["today_active"] is False
        assert streak["repair"] is None
        assert {entry["state"] for entry in streak["recent"]} <= {"before", "pending", "missed"}
        assert "repaired" not in {e["state"] for e in streak["recent"]}

    a = runtime_connection(user_a["id"])
    b = runtime_connection(user_b["id"])
    try:
        for table in ("activity_days", "streak_purchases"):
            assert a.execute(text(f"SELECT count(*) FROM {table}")).scalar_one() > 0
            assert b.execute(text(f"SELECT count(*) FROM {table}")).scalar_one() == 0
    finally:
        a.close()
        b.close()


def test_b_writes_through_every_endpoint_never_touch_a(
    client, user_a, user_b, a_has_everything, owner_engine
):
    headers = user_b["headers"]

    in_ = client.post("/api/streaks/check-in", json={"streak": "overall"}, headers=headers)
    assert in_.status_code == 200
    # B has earned 1 point. A's balance is not B's to spend, on any streak.
    for streak in ("overall", "gym", "habits"):
        freeze = client.post("/api/streaks/freezes", json={"streak": streak}, headers=headers)
        assert (freeze.status_code, freeze.json()["code"]) == (409, "points_insufficient")
    # The cost A paid, and the day A repaired, are not on offer to B.
    repair = client.post(
        "/api/streaks/repairs", json={"streak": "overall", "cost": 30}, headers=headers
    )
    assert (repair.status_code, repair.json()["code"]) == (409, "repair_unavailable")

    after = _counts(owner_engine)
    assert (
        after["activity_days"][str(user_a["id"])]
        == a_has_everything["activity_days"][str(user_a["id"])]
    )
    assert after["streak_purchases"] == a_has_everything["streak_purchases"]
    assert after["activity_days"][str(user_b["id"])] == 1
    assert str(user_b["id"]) not in after["streak_purchases"]


def test_a_still_reads_its_own_numbers_after_b_has_been_busy(
    client, user_a, user_b, a_has_everything
):
    before = client.get("/api/streaks", headers=user_a["headers"]).json()
    client.post("/api/streaks/check-in", json={"streak": "overall"}, headers=user_b["headers"])
    client.post("/api/streaks/freezes", json={"streak": "overall"}, headers=user_b["headers"])
    assert client.get("/api/streaks", headers=user_a["headers"]).json() == before
