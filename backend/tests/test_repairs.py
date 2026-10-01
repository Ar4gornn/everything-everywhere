"""Story 41.5 — repair (AD-57, §2.5).

One test per "accepted when" of the story, the walk and the offer at unit level, the rule
that **earning ignores repairs** (§2.6, decided 2026-10-01), the second-user proof, and the
double submit: sequentially, on two real concurrent connections for one streak, on two for
two streaks that share one balance (the case the advisory lock exists for), and with a stale
read that reaches the unique key (the one ``23505`` that is caught).

The clock is pinned through ``app.core.clock.get_now``. History is seeded straight into
``activity_days`` / ``streak_purchases`` through the owner connection.
"""

import datetime as dt
import threading
import time

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.core.clock import get_now
from app.core.db import tenant_session
from app.core.errors import Conflict
from app.services import streaks

UTC = dt.UTC
START = dt.date(2030, 1, 1)  # day 1 of every seeded run


def day(n: int) -> dt.date:
    return START + dt.timedelta(days=n - 1)


d = day


@pytest.fixture
def clock(client):
    from app.main import app

    def set_now(n: int) -> None:
        moment = dt.datetime.combine(day(n), dt.time(12), tzinfo=UTC)
        app.dependency_overrides[get_now] = lambda: moment

    set_now(1)
    yield set_now
    app.dependency_overrides.pop(get_now, None)


def seed(owner_engine, user, first: int, last: int, module: str = "app") -> None:
    """One activity row per day from day ``first`` to day ``last`` inclusive."""
    with owner_engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO activity_days (user_id, day, module) "
                "SELECT CAST(:u AS uuid), CAST(:d AS date) + g, CAST(:m AS text) "
                "FROM generate_series(CAST(:a AS int), CAST(:b AS int)) g"
            ),
            {"u": user["id"], "d": day(1), "m": module, "a": first - 1, "b": last - 1},
        )


def fund(owner_engine, user) -> None:
    """Points to spend, from a long run in the gym far before the days a test looks at. The
    overall streak is broken between that run and the test's own, so nothing joins."""
    seed(owner_engine, user, -300, -200, "gym")


def give_freeze(owner_engine, user, streak: str, bought_on: int) -> None:
    with owner_engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO streak_purchases (user_id, streak, kind, cost, bought_on) "
                "VALUES (:u, :s, 'freeze', :c, :b)"
            ),
            {"u": user["id"], "s": streak, "c": streaks.FREEZE_COST, "b": day(bought_on)},
        )


def overview(client, user) -> dict:
    response = client.get("/api/streaks", headers=user["headers"])
    assert response.status_code == 200, response.text
    return response.json()


def streak_of(client, user, streak_id: str = "overall") -> dict:
    return next(s for s in overview(client, user)["streaks"] if s["id"] == streak_id)


def states(streak: dict) -> dict[str, str]:
    return {entry["day"]: entry["state"] for entry in streak["recent"]}


def repair(client, user, streak: str = "overall", cost=None):
    """Confirm the price the card shows now, unless a test names another."""
    if cost is None:
        offer = streak_of(client, user, streak)["repair"] if streak != "nope" else None
        cost = offer["cost"] if offer else 1
    return client.post(
        "/api/streaks/repairs", json={"streak": streak, "cost": cost}, headers=user["headers"]
    )


def check_in(client, user, streak: str = "overall"):
    return client.post("/api/streaks/check-in", json={"streak": streak}, headers=user["headers"])


def repair_rows(owner_engine) -> list:
    with owner_engine.connect() as conn:
        return conn.execute(
            text(
                "SELECT streak, cost, bought_on, covers FROM streak_purchases "
                "WHERE kind = 'repair' ORDER BY covers"
            )
        ).all()


def activity_rows(owner_engine) -> int:
    with owner_engine.connect() as conn:
        return conn.execute(text("SELECT count(*) FROM activity_days")).scalar_one()


def run_then_gap(owner_engine, user, clock, run: int, missed: int) -> int:
    """Days 1..``run`` active, then ``missed`` missed days, today the day after. Funded."""
    fund(owner_engine, user)
    seed(owner_engine, user, 1, run)
    today = run + missed + 1
    clock(today)
    return today


# ------------------------------------------------------------ the walk and the offer


def test_a_repaired_day_lengthens_the_run_and_has_its_own_state():
    active = set(map(d, range(1, 11)))  # 1..10
    current, best, state = streaks.walk(active, d(12), (), frozenset({d(11)}))
    assert state[d(11)] == streaks.REPAIRED
    assert (current, best) == (11, 11)  # today is pending: nothing is lost yet
    assert streaks.walk(active, d(12))[0] == 0  # the same days without it


def test_a_repair_joins_two_runs_in_the_displayed_walk():
    active = set(map(d, [*range(1, 8), *range(9, 16)]))  # 1..7, gap 8, 9..15
    assert streaks.walk(active, d(15))[:2] == (7, 7)
    assert streaks.walk(active, d(15), (), frozenset({d(8)}))[:2] == (15, 15)


def test_the_offer_is_priced_on_the_run_that_ends_before_the_gap():
    active = set(map(d, range(1, 11)))
    _, _, _, state, _, runs = streaks._walk(active, d(12))
    offer = streaks._offer(state, runs, d(12))
    assert offer == streaks.Repair(days=(d(11),), per_day=35, cost=35)


def test_a_gap_of_three_or_with_nothing_before_it_is_not_offered():
    ten = set(map(d, range(1, 11)))
    for today, found in ((13, True), (14, False)):
        _, _, _, state, _, runs = streaks._walk(ten, d(today))
        assert (streaks._offer(state, runs, d(today)) is not None) is found
    _, _, _, state, _, runs = streaks._walk(set(), d(5))
    assert streaks._offer(state, runs, d(5)) is None


# ------------------------------------------------------------ the story, through the API


def test_a_ten_day_run_with_one_missed_day_is_offered_at_thirty_five(
    client, user_a, owner_engine, clock
):
    run_then_gap(owner_engine, user_a, clock, run=10, missed=1)
    before = overview(client, user_a)
    assert before["prices"]["repair_per_day"] == streaks.REPAIR_PER_DAY
    offer = next(s for s in before["streaks"] if s["id"] == "overall")
    assert (
        offer["repair"]
        == {"days": 1, "cost": 35}
        == {
            "days": 1,
            "cost": streaks.REPAIR_PER_DAY + 10 // 2,
        }
    )
    assert offer["current"] == 0  # the missed day broke it until it is repaired

    response = repair(client, user_a)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["streak"]["current"] == 11
    assert body["streak"]["repair"] is None
    assert states(body["streak"])[day(11).isoformat()] == "repaired"
    assert body["points"]["spent"] == 35
    assert body["points"]["earned"] == before["points"]["earned"]  # a repair earns nothing
    assert body["points"]["balance"] == before["points"]["balance"] - 35

    # Today's activity adds to the joined run: the streak reads 12.
    assert check_in(client, user_a).json()["current"] == 12
    assert streak_of(client, user_a)["current"] == 12


def test_two_missed_days_are_priced_per_day_on_the_length_of_the_run(
    client, user_a, owner_engine, clock
):
    run_then_gap(owner_engine, user_a, clock, run=13, missed=2)
    expected = 2 * (streaks.REPAIR_PER_DAY + 13 // 2)  # 72: a plain /2 would be 73
    assert streak_of(client, user_a)["repair"] == {"days": 2, "cost": expected}
    body = repair(client, user_a).json()
    assert body["streak"]["current"] == 15
    assert body["points"]["spent"] == expected
    # One row per missed day, each carrying its own day and half the price.
    rows = repair_rows(owner_engine)
    assert [(r.streak, r.cost, r.bought_on, r.covers) for r in rows] == [
        ("overall", expected // 2, day(16), day(14)),
        ("overall", expected // 2, day(16), day(15)),
    ]


def test_three_missed_days_are_past_repair(client, user_a, owner_engine, clock):
    run_then_gap(owner_engine, user_a, clock, run=10, missed=3)
    assert streak_of(client, user_a)["repair"] is None
    response = repair(client, user_a)
    assert response.status_code == 409
    assert response.json()["code"] == "repair_unavailable"
    assert repair_rows(owner_engine) == []


def test_with_nothing_missed_there_is_nothing_to_repair(client, user_a, owner_engine, clock):
    fund(owner_engine, user_a)
    seed(owner_engine, user_a, 1, 10)
    clock(11)  # today is pending and yesterday was active
    assert streak_of(client, user_a)["repair"] is None
    assert repair(client, user_a).json()["code"] == "repair_unavailable"


def test_a_repaired_day_is_not_offered_again_and_the_streak_stays_joined(
    client, user_a, owner_engine, clock
):
    run_then_gap(owner_engine, user_a, clock, run=10, missed=1)
    assert repair(client, user_a).status_code == 201
    check_in(client, user_a)
    clock(13)  # the next morning: 11 was repaired, 12 active
    mine = streak_of(client, user_a)
    assert mine["repair"] is None
    assert mine["current"] == 12
    assert states(mine)[day(11).isoformat()] == "repaired"


def test_too_few_points_is_points_insufficient(client, user_a, owner_engine, clock):
    seed(owner_engine, user_a, 1, 10)  # earns 20, the repair costs 35
    clock(12)
    assert streak_of(client, user_a)["repair"]["cost"] == 35
    response = repair(client, user_a)
    assert response.status_code == 409
    assert response.json()["code"] == "points_insufficient"
    assert repair_rows(owner_engine) == []


def test_freezes_are_consumed_before_a_repair_is_priced(client, user_a, owner_engine, clock):
    """One freeze held and two missed days: the freeze covers the first, so the repair is
    one day, priced on the run the freeze extended (11)."""
    fund(owner_engine, user_a)
    seed(owner_engine, user_a, 1, 10)
    give_freeze(owner_engine, user_a, "overall", bought_on=5)
    clock(13)
    mine = streak_of(client, user_a)
    assert states(mine)[day(11).isoformat()] == "frozen"
    assert mine["repair"] == {"days": 1, "cost": streaks.REPAIR_PER_DAY + 11 // 2}
    body = repair(client, user_a).json()
    assert body["streak"]["current"] == 12
    assert [r.covers for r in repair_rows(owner_engine)] == [day(12)]


def test_repairing_a_module_streak_leaves_overall_alone(client, user_a, owner_engine, clock):
    fund(owner_engine, user_a)
    seed(owner_engine, user_a, 1, 10, "gym")
    clock(12)
    assert streak_of(client, user_a, "gym")["repair"]["days"] == 1
    assert streak_of(client, user_a)["repair"]["days"] == 1  # overall is missed there too
    assert repair(client, user_a, "gym").status_code == 201
    assert streak_of(client, user_a, "gym")["current"] == 11
    assert streak_of(client, user_a)["current"] == 0  # a repair belongs to its own streak
    assert all(r.streak == "gym" for r in repair_rows(owner_engine))


def test_buying_a_repair_makes_no_day_and_the_client_names_no_price(
    client, user_a, owner_engine, clock
):
    run_then_gap(owner_engine, user_a, clock, run=10, missed=1)
    rows = activity_rows(owner_engine)
    response = client.post(
        "/api/streaks/repairs",
        json={"streak": "overall", "cost": 35, "covers": "2030-01-01", "days": 9},
        headers=user_a["headers"],
    )
    assert response.status_code == 201
    assert activity_rows(owner_engine) == rows
    assert [(r.cost, r.covers) for r in repair_rows(owner_engine)] == [(35, day(11))]


def test_an_unknown_streak_is_streak_unknown(client, user_a, owner_engine, clock):
    run_then_gap(owner_engine, user_a, clock, run=10, missed=1)
    response = repair(client, user_a, "nope")
    assert response.status_code == 422
    assert response.json()["code"] == "streak_unknown"


def test_a_repair_needs_a_session(client):
    assert (
        client.post("/api/streaks/repairs", json={"streak": "overall", "cost": 35}).status_code
        == 401
    )


# ------------------------------------------------------------ earning ignores repairs


def _earned(by_module, bought):
    return streaks.points(by_module, bought).earned


def test_a_repair_joining_two_runs_that_each_paid_takes_nothing_back():
    """Days 1..7 and 9..15 each paid +10. Repairing day 8 joins them in the displayed walk
    (15 long, one 7-milestone) but must never be in the earning walk, where it would pay the
    bonus once instead of twice and take ten points back (§2.6)."""
    days = {"app": set(map(d, [*range(1, 8), *range(9, 16)]))}
    repaired = [streaks.Purchase("overall", streaks.REPAIR, 35, d(16), d(8))]
    without = _earned(days, [])
    assert without == 14 + 2 * 10
    assert _earned(days, repaired) == without
    # The displayed run really is joined, so the test is not vacuous.
    joined = streaks._streak("overall", days["app"], d(15), repaired)
    assert (joined.current, joined.best) == (15, 15)
    assert streaks._streak("overall", days["app"], d(15), []).current == 7


def test_a_milestone_reached_only_across_a_repaired_gap_pays_nothing(
    client, user_a, owner_engine, clock
):
    """Six days, a missed one, today. Repaired, the run reads 7 on the repaired day and 8
    with today's activity, but the +10 for a seventh day is not paid: the accepted cost of
    earned never decreasing."""
    run_then_gap(owner_engine, user_a, clock, run=6, missed=1)
    before = overview(client, user_a)["points"]["earned"]
    # Funded by 101 gym days, so a 6-day run costs 30 + 3.
    assert streak_of(client, user_a)["repair"] == {"days": 1, "cost": 33}
    assert repair(client, user_a).status_code == 201
    assert check_in(client, user_a).json()["current"] == 8
    after = overview(client, user_a)["points"]
    assert after["earned"] - before == 1  # today's day, and no bonus
    assert after["spent"] == 33


def test_a_repair_never_lowers_earned_through_the_api(client, user_a, owner_engine, clock):
    run_then_gap(owner_engine, user_a, clock, run=8, missed=2)
    before = overview(client, user_a)["points"]
    after = repair(client, user_a).json()["points"]
    assert after["earned"] == before["earned"]
    assert after["balance"] == before["balance"] - after["spent"] >= 0


# ------------------------------------------------------------ the table, per user


def test_b_cannot_see_or_buy_a_repair_of_a(
    client, user_a, user_b, owner_engine, clock, runtime_connection
):
    run_then_gap(owner_engine, user_a, clock, run=10, missed=1)
    assert repair(client, user_a).status_code == 201

    a = runtime_connection(user_a["id"])
    b = runtime_connection(user_b["id"])
    try:
        sql = text("SELECT count(*) FROM streak_purchases WHERE kind = 'repair'")
        assert a.execute(sql).scalar_one() == 1
        assert b.execute(sql).scalar_one() == 0
    finally:
        a.close()
        b.close()

    mine = overview(client, user_b)
    assert mine["points"] == {"balance": 0, "earned": 0, "spent": 0}
    assert all(s["repair"] is None for s in mine["streaks"])
    assert all("repaired" not in states(s).values() for s in mine["streaks"])
    refused = repair(client, user_b)
    assert refused.status_code == 409
    assert refused.json()["code"] == "repair_unavailable"
    assert len(repair_rows(owner_engine)) == 1  # nothing of A's changed


def test_b_cannot_write_a_repair_row_for_a(user_a, user_b, runtime_connection):
    b = runtime_connection(user_b["id"])
    try:
        with pytest.raises(Exception, match="row-level security"):
            b.execute(
                text(
                    "INSERT INTO streak_purchases (user_id, streak, kind, cost, bought_on, covers) "
                    "VALUES (:u, 'overall', 'repair', 30, '2031-03-05', '2031-03-04')"
                ),
                {"u": user_a["id"]},
            )
    finally:
        b.close()


# ------------------------------------------------------------ the double submit


def test_a_double_submit_makes_one_repair_and_the_second_is_repair_unavailable(
    client, user_a, owner_engine, clock
):
    run_then_gap(owner_engine, user_a, clock, run=10, missed=2)
    first = repair(client, user_a)
    second = repair(client, user_a)
    assert first.status_code == 201
    assert second.status_code == 409
    assert second.json()["code"] == "repair_unavailable"
    assert len(repair_rows(owner_engine)) == 2  # the two days of one repair, not four


def _race(fn, user_id, now, streak, results, barrier):
    try:
        with tenant_session(user_id) as session:
            barrier.wait(timeout=10)
            fn(session, user_id, streak, now, 35)
        results.append("created")
    except Conflict as refusal:
        results.append(refusal.code)
    except BaseException as error:  # anything else is a failure of the test, never a refusal
        results.append(error)


def _run_race(user_id, now, streak_ids, monkeypatch):
    """One real connection per streak id, released together, each pausing for half a second
    *after* it has read the purchases: the window the advisory lock exists to close."""
    real = streaks._purchases

    def slow(session, uid):
        found = real(session, uid)
        time.sleep(0.5)
        return found

    monkeypatch.setattr(streaks, "_purchases", slow)
    results: list = []
    barrier = threading.Barrier(len(streak_ids))
    threads = [
        threading.Thread(
            target=_race, args=(streaks.buy_repair, user_id, now, streak, results, barrier)
        )
        for streak in streak_ids
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)
    assert not any(thread.is_alive() for thread in threads)
    assert all(isinstance(r, str) for r in results), results  # a lock error is not a refusal
    return results


def test_two_simultaneous_repairs_of_one_streak_make_exactly_one(
    client, user_a, owner_engine, clock, monkeypatch
):
    run_then_gap(owner_engine, user_a, clock, run=10, missed=1)
    now = dt.datetime.combine(day(12), dt.time(12), tzinfo=UTC)
    results = _run_race(user_a["id"], now, ["overall", "overall"], monkeypatch)
    assert sorted(results) == ["created", "repair_unavailable"]
    assert [r.covers for r in repair_rows(owner_engine)] == [day(11)]


def test_two_simultaneous_repairs_of_two_streaks_with_points_for_one_make_exactly_one(
    client, user_a, owner_engine, clock, monkeypatch
):
    """Overall and gym both have a ten-day run and a missed yesterday, both offered at 35, and
    the one balance is 40. They share no unique key, so only the advisory lock stops both
    reading "40" and both spending: without it the balance ends at -30."""
    seed(owner_engine, user_a, 1, 10, "gym")
    clock(12)
    now = dt.datetime.combine(day(12), dt.time(12), tzinfo=UTC)
    assert overview(client, user_a)["points"]["balance"] == 40
    results = _run_race(user_a["id"], now, ["overall", "gym"], monkeypatch)
    assert sorted(results) == ["created", "points_insufficient"]
    assert len(repair_rows(owner_engine)) == 1
    points = overview(client, user_a)["points"]
    assert points["spent"] == 35
    assert points["balance"] == points["earned"] - 35 >= 0


def test_a_stale_read_that_reaches_the_unique_key_is_repair_unavailable(
    client, user_a, owner_engine, clock, monkeypatch
):
    """The only way past the lock is a read that missed the first repair. It collides on
    ``(user_id, streak, covers)`` and is the one ``23505`` that is caught."""
    run_then_gap(owner_engine, user_a, clock, run=10, missed=1)
    now = dt.datetime.combine(day(12), dt.time(12), tzinfo=UTC)
    with tenant_session(user_a["id"]) as session:
        stale = streaks._purchases(session, user_a["id"])
    with tenant_session(user_a["id"]) as session:
        streaks.buy_repair(session, user_a["id"], "overall", now, 35)

    monkeypatch.setattr(streaks, "_purchases", lambda session, uid: stale)
    with pytest.raises(Conflict) as refusal, tenant_session(user_a["id"]) as session:
        streaks.buy_repair(session, user_a["id"], "overall", now, 35)
    assert refusal.value.code == "repair_unavailable"
    assert len(repair_rows(owner_engine)) == 1


def test_any_other_integrity_error_is_not_swallowed_as_unavailable(
    client, user_a, owner_engine, clock, monkeypatch
):
    """A price of zero breaks ``cost > 0`` (23514). Catching every ``IntegrityError`` would
    turn that bug into a quiet "nothing to repair" (lab note 2026-09-26)."""
    seed(owner_engine, user_a, 10, 10)  # a run of one: 0 + 1 // 2 = 0 a day
    clock(12)
    now = dt.datetime.combine(day(12), dt.time(12), tzinfo=UTC)
    monkeypatch.setattr(streaks, "REPAIR_PER_DAY", 0)
    with pytest.raises(IntegrityError) as error, tenant_session(user_a["id"]) as session:
        streaks.buy_repair(session, user_a["id"], "overall", now, 0)
    assert error.value.orig.sqlstate == "23514"
    assert repair_rows(owner_engine) == []


# ------------------------------------------------------------ the confirmed price


def test_a_repair_after_midnight_is_refused_when_the_price_it_confirmed_has_changed(
    client, user_a, owner_engine, clock
):
    """The card loaded on day 12 (one day, 35). Left open past midnight, on day 13 the same
    run has two missed days and the server would charge 70: it must refuse, not spend it."""
    fund(owner_engine, user_a)
    seed(owner_engine, user_a, 1, 10)
    clock(12)
    assert streak_of(client, user_a)["repair"] == {"days": 1, "cost": 35}
    before = overview(client, user_a)["points"]
    clock(13)
    assert streak_of(client, user_a)["repair"] == {"days": 2, "cost": 70}
    response = repair(client, user_a, cost=35)
    assert response.status_code == 409
    assert response.json()["code"] == "repair_unavailable"
    assert repair_rows(owner_engine) == []
    assert overview(client, user_a)["points"] == before


@pytest.mark.parametrize("cost", [34, 36, 0, -35, 70])
def test_a_repair_with_the_wrong_cost_is_repair_unavailable(
    client, user_a, owner_engine, clock, cost
):
    run_then_gap(owner_engine, user_a, clock, run=10, missed=1)
    response = repair(client, user_a, cost=cost)
    assert response.status_code == 409
    assert response.json()["code"] == "repair_unavailable"
    assert repair_rows(owner_engine) == []


def test_a_repair_with_the_right_cost_is_created(client, user_a, owner_engine, clock):
    run_then_gap(owner_engine, user_a, clock, run=10, missed=1)
    assert repair(client, user_a, cost=35).status_code == 201


@pytest.mark.parametrize(
    "body",
    [
        {"streak": "overall"},
        {"streak": "overall", "cost": "35"},
        {"streak": "overall", "cost": 35.5},
        {"streak": "overall", "cost": None},
        {"streak": "overall", "cost": True},
    ],
)
def test_a_missing_or_non_integer_cost_is_a_422(client, user_a, owner_engine, clock, body):
    run_then_gap(owner_engine, user_a, clock, run=10, missed=1)
    response = client.post("/api/streaks/repairs", json=body, headers=user_a["headers"])
    assert response.status_code == 422
    assert repair_rows(owner_engine) == []


# ------------------------------------------------------------ the two walks, pinned


def test_the_earning_walk_and_the_displayed_walk_consume_a_freeze_on_different_days():
    """Decided 2026-10-01 (§2.6). Days 1..6 active, 7..10 missed, 11..16 active, a
    freeze bought on day 1, a repair on day 7. Displayed, the repair keeps the run alive and
    the freeze goes to day 8; earning, which never sees a repair, spends it on day 7 and the
    run it keeps is paid a bonus across a day the card shows as repaired. Sharing the
    consumption would let a later repair move a freeze and take a paid bonus back."""
    active = set(map(d, [*range(1, 7), *range(11, 17)]))
    freezes = (d(1),)
    repairs = frozenset({d(7)})
    _, _, _, shown, _, _ = streaks._walk(active, d(16), freezes, repairs)
    assert shown[d(7)] == streaks.REPAIRED
    assert shown[d(8)] == streaks.FROZEN
    assert shown[d(9)] == streaks.MISSED
    _, _, _, earning, _, _ = streaks._walk(active, d(16), freezes)
    assert earning[d(7)] == streaks.FROZEN
    assert earning[d(8)] == streaks.MISSED
    # Earning pays the 7-day milestone on the frozen day the card shows as repaired.
    assert streaks._walk(active, d(16), freezes)[2] == 10
    assert streaks._walk(active, d(16), freezes, repairs)[2] == 0
