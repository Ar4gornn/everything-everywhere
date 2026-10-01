"""Story 41.4 — freezes (AD-57).

One test per "accepted when" of the story, the walk's freeze rules at unit level (§2.3, §2.4),
the second-user proof for ``streak_purchases``, a purchase race run on **real concurrent
connections**, and a property test that the balance never goes below zero.

The clock is pinned through ``app.core.clock.get_now``. History is seeded straight into
``activity_days`` / ``streak_purchases`` through the owner connection, since nothing else can
write a month of days in a test; a purchase that is *the subject* of a test goes through the
endpoint.
"""

import datetime as dt
import random
import threading
import time

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.core.clock import get_now
from app.core.db import tenant_session
from app.core.errors import Conflict
from app.services import activity, streaks

UTC = dt.UTC
START = dt.date(2030, 1, 1)  # day 1 of every seeded run


def day(n: int) -> dt.date:
    return START + dt.timedelta(days=n - 1)


def d(n: int) -> dt.date:
    return day(n)


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


def seed_days(owner_engine, user, days: list[int], module: str = "app") -> None:
    for n in days:
        seed(owner_engine, user, n, n, module)


def give_freeze(owner_engine, user, streak: str, bought_on: int) -> None:
    """A freeze bought on day ``bought_on``, without taking its cost out of the test's way."""
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


def buy(client, user, streak: str = "overall"):
    return client.post("/api/streaks/freezes", json={"streak": streak}, headers=user["headers"])


def purchase_rows(owner_engine) -> int:
    with owner_engine.connect() as conn:
        return conn.execute(text("SELECT count(*) FROM streak_purchases")).scalar_one()


def rich(owner_engine, user, clock, today: int = 15) -> None:
    """Fourteen active days, so the balance is 24: enough for one freeze, not two."""
    seed(owner_engine, user, 1, 14)
    clock(today)


# ------------------------------------------------------------ the walk, no database


def test_a_held_freeze_covers_one_missed_day_and_the_run_goes_on():
    # 1..8 active, 9 missed, 10 active (today). The freeze was bought on day 5.
    active = set(map(d, [1, 2, 3, 4, 5, 6, 7, 8, 10]))
    current, best, state = streaks.walk(active, d(10), (d(5),))
    assert state[d(9)] == streaks.FROZEN
    assert (current, best) == (10, 10)
    assert streaks.walk(active, d(10))[0] == 1  # the same days without one


def test_two_missed_days_with_one_freeze_break_the_streak():
    active = set(map(d, [1, 2, 3, 4, 5, 8]))
    current, best, state = streaks.walk(active, d(8), (d(2),))
    assert state[d(6)] == streaks.FROZEN
    assert state[d(7)] == streaks.MISSED
    assert (current, best) == (1, 6)


def test_two_freezes_cover_two_missed_days_oldest_first():
    active = set(map(d, [1, 2, 3, 6]))
    current, _, state = streaks.walk(active, d(6), (d(3), d(2)))
    assert (state[d(4)], state[d(5)]) == (streaks.FROZEN, streaks.FROZEN)
    assert current == 6


def test_a_freeze_does_not_cover_a_day_before_it_was_bought():
    # Day 5 is missed; the freeze was bought on day 6, so it cannot rescue day 5.
    active = set(map(d, [1, 2, 3, 4, 7]))
    current, _, state = streaks.walk(active, d(7), (d(6),))
    assert state[d(5)] == streaks.MISSED
    assert state[d(6)] == streaks.MISSED  # run was already 0, nothing to protect
    assert current == 1


def test_a_freeze_bought_on_a_day_covers_that_day_once_it_has_passed():
    active = set(map(d, [1, 2, 3, 4, 5, 7]))
    current, _, state = streaks.walk(active, d(7), (d(6),))
    assert state[d(6)] == streaks.FROZEN
    assert current == 7


def test_the_oldest_freeze_goes_first_and_a_later_one_stays_held():
    # A freeze bought on day 8 is not yet usable on day 6, so the day-2 one is used there.
    active = set(map(d, [1, 2, 3, 4, 5, 7, 8]))
    _, _, state = streaks.walk(active, d(8), (d(8), d(2)))
    assert state[d(6)] == streaks.FROZEN
    assert streaks._walk(active, d(8), (d(8), d(2)))[4] == 1  # one still held


def test_a_freeze_held_while_the_run_is_zero_stays_held():
    active = set(map(d, [1, 2, 3]))
    # Bought on day 9: day 4 onwards the run is 0 by the time it could apply.
    current, _, _, state, held, _ = streaks._walk(active, d(10), (d(9),))
    assert (current, held) == (0, 1)
    assert state[d(4)] == streaks.MISSED


def test_a_freeze_bought_early_covers_the_first_missed_day_of_a_run():
    current, _, _, state, held, _ = streaks._walk(set(map(d, [1, 2, 3])), d(10), (d(1),))
    assert state[d(4)] == streaks.FROZEN
    assert (current, held) == (0, 0)  # one day covered, then the next break stands


def test_today_is_never_frozen_while_it_is_pending():
    _, _, _, state, held, _ = streaks._walk(set(map(d, [1, 2, 3])), d(4), (d(1),))
    assert state[d(4)] == streaks.PENDING
    assert held == 1


def test_earned_does_not_drop_when_the_clock_moves_back_over_a_frozen_milestone_day(
    client, user_a, owner_engine, clock
):
    """Six active days, a held freeze: on day 8 day 7 is frozen and the run has reached 7.
    An account moved west (today 7, then 6) must not lose that bonus."""
    seed(owner_engine, user_a, 1, 6)
    give_freeze(owner_engine, user_a, "overall", 1)
    clock(8)
    earned = overview(client, user_a)["points"]["earned"]
    for earlier in (7, 6):
        clock(earlier)
        assert overview(client, user_a)["points"]["earned"] == earned


def test_a_frozen_day_earns_no_day_but_a_milestone_it_reaches_is_paid():
    # 1..6 active, 7 frozen (run reaches 7: +10), 8 active.
    active = set(map(d, [1, 2, 3, 4, 5, 6, 8]))
    by_module = {"app": active}
    with_freeze = streaks.points(by_module, [streaks.Purchase("overall", "freeze", 20, d(1), None)])
    without = streaks.points(by_module, [])
    assert without.earned == 7  # seven active days, no bonus: the run broke at six
    assert with_freeze.earned == 7 + 10  # no point for day 7, the bonus for reaching 7
    assert with_freeze.spent == 20
    assert with_freeze.balance == with_freeze.earned - 20


# ------------------------------------------------------------ the endpoint


def test_a_held_freeze_covers_a_missed_day_through_the_api(client, user_a, owner_engine, clock):
    seed(owner_engine, user_a, 1, 8)
    give_freeze(owner_engine, user_a, "overall", 5)
    seed(owner_engine, user_a, 10, 10)
    clock(10)
    overall = streak_of(client, user_a)
    assert (overall["current"], overall["best"], overall["held_freezes"]) == (10, 10, 0)
    assert states(overall)[day(9).isoformat()] == "frozen"


def test_a_freeze_bought_today_does_not_cover_yesterday(client, user_a, owner_engine, clock):
    seed(owner_engine, user_a, 1, 14)  # run 14, day 15 missed, today is day 16
    clock(16)
    assert streak_of(client, user_a)["current"] == 0
    assert buy(client, user_a).status_code == 201
    after = streak_of(client, user_a)
    assert after["held_freezes"] == 1
    assert after["current"] == 0
    assert states(after)[day(15).isoformat()] == "missed"


def test_a_freeze_bought_today_covers_today_once_today_has_passed(
    client, user_a, owner_engine, clock
):
    rich(owner_engine, user_a, clock, today=15)  # run 14, today (15) pending
    assert buy(client, user_a).status_code == 201
    assert streak_of(client, user_a)["current"] == 14
    clock(16)  # day 15 has passed with nothing done
    after = streak_of(client, user_a)
    assert (after["current"], after["held_freezes"]) == (15, 0)
    assert states(after)[day(15).isoformat()] == "frozen"


def test_a_freeze_belongs_to_its_own_streak(client, user_a, owner_engine, clock):
    seed(owner_engine, user_a, 1, 5, "gym")  # also overall
    give_freeze(owner_engine, user_a, "gym", 1)
    clock(7)  # day 6 missed for both; the freeze is gym's
    assert streak_of(client, user_a, "gym")["current"] == 6
    assert streak_of(client, user_a)["current"] == 0


def test_a_purchase_answers_with_the_balance_and_the_streak(client, user_a, owner_engine, clock):
    rich(owner_engine, user_a, clock)
    before = overview(client, user_a)["points"]
    assert before == {"balance": 24, "earned": 24, "spent": 0}
    response = buy(client, user_a)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["points"] == {"balance": 4, "earned": 24, "spent": streaks.FREEZE_COST}
    assert body["streak"]["id"] == "overall"
    assert body["streak"]["held_freezes"] == 1
    assert overview(client, user_a)["points"] == body["points"]


def test_get_carries_the_prices_and_held_freezes(client, user_a, clock):
    body = overview(client, user_a)
    assert body["prices"]["freeze"] == streaks.FREEZE_COST == 20
    assert body["prices"]["max_held"] == streaks.MAX_HELD == 2
    assert all(s["held_freezes"] == 0 for s in body["streaks"])


def test_a_third_freeze_is_freeze_limit(client, user_a, owner_engine, clock):
    seed(owner_engine, user_a, 1, 30)  # plenty: more than three freezes' worth
    clock(31)
    assert buy(client, user_a).status_code == 201
    assert buy(client, user_a).status_code == 201
    third = buy(client, user_a)
    assert third.status_code == 409
    assert third.json()["code"] == "freeze_limit"
    assert purchase_rows(owner_engine) == 2


def test_the_limit_is_per_streak(client, user_a, owner_engine, clock):
    seed(owner_engine, user_a, 1, 30)
    seed(owner_engine, user_a, 1, 30, "gym")
    clock(31)
    assert [buy(client, user_a).status_code for _ in range(2)] == [201, 201]
    assert buy(client, user_a).json()["code"] == "freeze_limit"
    assert buy(client, user_a, "gym").status_code == 201


def test_a_consumed_freeze_no_longer_counts_as_held(client, user_a, owner_engine, clock):
    seed(owner_engine, user_a, 1, 30)
    give_freeze(owner_engine, user_a, "overall", 1)
    give_freeze(owner_engine, user_a, "overall", 1)
    clock(33)  # days 31 and 32 missed: both freezes consumed
    assert streak_of(client, user_a)["held_freezes"] == 0
    assert buy(client, user_a).status_code == 201


def test_too_few_points_is_points_insufficient(client, user_a, owner_engine, clock):
    seed(owner_engine, user_a, 1, 3)  # 3 points
    clock(4)
    response = buy(client, user_a)
    assert response.status_code == 409
    assert response.json()["code"] == "points_insufficient"
    assert purchase_rows(owner_engine) == 0
    assert overview(client, user_a)["points"]["spent"] == 0


def test_exactly_the_price_is_enough_and_leaves_zero(client, user_a, owner_engine, clock):
    # 20 points: 13 days is 13 + 10 = 23; use 20 distinct days across two non-run stretches.
    seed_days(
        owner_engine,
        user_a,
        [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31, 33, 35, 37, 39],
    )
    clock(40)
    assert overview(client, user_a)["points"]["balance"] == streaks.FREEZE_COST
    response = buy(client, user_a)
    assert response.status_code == 201
    assert response.json()["points"]["balance"] == 0


def test_an_unknown_streak_is_streak_unknown(client, user_a, owner_engine, clock):
    rich(owner_engine, user_a, clock)
    response = buy(client, user_a, "nope")
    assert response.status_code == 422
    assert response.json()["code"] == "streak_unknown"
    assert purchase_rows(owner_engine) == 0
    assert (
        client.post("/api/streaks/freezes", json={}, headers=user_a["headers"]).status_code == 422
    )


def test_buying_does_not_make_a_day(client, user_a, owner_engine, clock):
    rich(owner_engine, user_a, clock)
    with owner_engine.connect() as conn:
        before = conn.execute(text("SELECT count(*) FROM activity_days")).scalar_one()
    assert buy(client, user_a).status_code == 201
    with owner_engine.connect() as conn:
        after = conn.execute(text("SELECT count(*) FROM activity_days")).scalar_one()
    assert after == before
    assert streak_of(client, user_a)["today_active"] is False


def test_a_purchase_is_stamped_with_the_accounts_local_day(client, user_a, owner_engine, clock):
    rich(owner_engine, user_a, clock)  # now = day 15, 12:00 UTC
    with owner_engine.begin() as conn:
        conn.execute(
            text("UPDATE users SET timezone = 'Pacific/Kiritimati' WHERE id = :u"),
            {"u": user_a["id"]},
        )
    assert buy(client, user_a).status_code == 201  # 02:00 on day 16 there
    with owner_engine.connect() as conn:
        bought_on = conn.execute(text("SELECT bought_on FROM streak_purchases")).scalar_one()
    assert bought_on == day(16)


def test_the_client_cannot_name_a_day_or_a_price(client, user_a, owner_engine, clock):
    rich(owner_engine, user_a, clock)
    response = client.post(
        "/api/streaks/freezes",
        json={"streak": "overall", "bought_on": "2000-01-01", "cost": 1},
        headers=user_a["headers"],
    )
    assert response.status_code == 201
    with owner_engine.connect() as conn:
        row = conn.execute(text("SELECT cost, bought_on FROM streak_purchases")).one()
    assert row == (streaks.FREEZE_COST, day(15))


def test_a_purchase_needs_a_session(client):
    assert client.post("/api/streaks/freezes", json={"streak": "overall"}).status_code == 401


# ------------------------------------------------------------ the table


def test_b_sees_none_of_a_purchases_and_cannot_spend_a_points(
    client, user_a, user_b, owner_engine, clock, runtime_connection
):
    rich(owner_engine, user_a, clock)
    assert buy(client, user_a).status_code == 201

    a = runtime_connection(user_a["id"])
    b = runtime_connection(user_b["id"])
    try:
        assert a.execute(text("SELECT count(*) FROM streak_purchases")).scalar_one() == 1
        assert b.execute(text("SELECT count(*) FROM streak_purchases")).scalar_one() == 0
    finally:
        a.close()
        b.close()

    mine = overview(client, user_b)
    assert mine["points"] == {"balance": 0, "earned": 0, "spent": 0}
    assert all(s["held_freezes"] == 0 for s in mine["streaks"])
    refused = buy(client, user_b)
    assert refused.status_code == 409
    assert refused.json()["code"] == "points_insufficient"
    # A's balance was not touched by B's attempt.
    assert overview(client, user_a)["points"]["spent"] == streaks.FREEZE_COST


def test_b_cannot_write_a_purchase_owned_by_a(user_a, user_b, runtime_connection):
    conn = runtime_connection(user_b["id"])
    try:
        with pytest.raises(DBAPIError):
            conn.execute(
                text(
                    "INSERT INTO streak_purchases (user_id, streak, kind, cost, bought_on) "
                    "VALUES (:u, 'overall', 'freeze', 20, '2031-03-05')"
                ),
                {"u": user_a["id"]},
            )
    finally:
        conn.rollback()
        conn.close()


@pytest.mark.parametrize(
    "statement",
    ["UPDATE streak_purchases SET cost = 1", "DELETE FROM streak_purchases"],
)
def test_purchases_are_append_only_even_for_their_owner(
    client, user_a, owner_engine, clock, runtime_connection, statement
):
    rich(owner_engine, user_a, clock)
    assert buy(client, user_a).status_code == 201
    conn = runtime_connection(user_a["id"])
    try:
        with pytest.raises(DBAPIError):
            conn.execute(text(statement))
    finally:
        conn.rollback()
        conn.close()
    assert purchase_rows(owner_engine) == 1


@pytest.mark.parametrize(
    "values",
    [
        "'overall', 'freeze', 0, '2031-03-05', NULL",  # cost must be positive
        "'overall', 'freeze', 20, '2031-03-05', '2031-03-04'",  # a freeze covers nothing
        "'overall', 'repair', 30, '2031-03-05', NULL",  # a repair covers a day
        "'overall', 'gift', 20, '2031-03-05', NULL",  # kinds are freeze and repair
        "'', 'freeze', 20, '2031-03-05', NULL",  # a streak id is 1 to 32 characters
    ],
)
def test_the_table_refuses_a_malformed_row(user_a, owner_engine, values):
    with pytest.raises(DBAPIError), owner_engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO streak_purchases (user_id, streak, kind, cost, bought_on, covers) "
                f"VALUES (:u, {values})"
            ),
            {"u": user_a["id"]},
        )


def test_many_freezes_may_coexist_but_a_repair_day_is_bought_once(user_a, owner_engine):
    """UNIQUE (user_id, streak, covers): NULLs are distinct (freezes), a day is not (41.5)."""
    insert = (
        "INSERT INTO streak_purchases (user_id, streak, kind, cost, bought_on, covers) "
        "VALUES (:u, 'overall', :k, 30, '2031-03-05', :c)"
    )
    with owner_engine.begin() as conn:
        for _ in range(3):
            conn.execute(text(insert), {"u": user_a["id"], "k": "freeze", "c": None})
        conn.execute(text(insert), {"u": user_a["id"], "k": "repair", "c": "2031-03-04"})
    with pytest.raises(DBAPIError), owner_engine.begin() as conn:
        conn.execute(text(insert), {"u": user_a["id"], "k": "repair", "c": "2031-03-04"})


# ------------------------------------------------------------ the race


def _race(user_id, now, results, barrier, streak="overall"):
    try:
        with tenant_session(user_id) as session:
            barrier.wait(timeout=10)
            streaks.buy_freeze(session, user_id, streak, now)
        results.append("created")
    except Conflict as refusal:
        results.append(refusal.code)
    except BaseException as error:  # anything else is a failure of the test, never a refusal
        results.append(error)


def test_two_simultaneous_purchases_with_points_for_one_make_exactly_one(
    client, user_a, owner_engine, clock, monkeypatch
):
    """Two real connections through the runtime role, released together by a barrier.

    Each one pauses for half a second *after* it has read the purchases, which is exactly the
    window the lock exists to close: without the advisory lock both read "no purchases yet,
    24 points", both pass the check and both insert. With it the second blocks before it
    reads, then sees the first's row and refuses. Anything other than a clean ``created`` or
    ``points_insufficient`` fails the test: a lock error is not an acceptable refusal.
    """
    rich(owner_engine, user_a, clock)
    now = dt.datetime.combine(day(15), dt.time(12), tzinfo=UTC)

    real = streaks._purchases

    def slow(session, user_id):
        found = real(session, user_id)
        time.sleep(0.5)
        return found

    monkeypatch.setattr(streaks, "_purchases", slow)

    results: list = []
    barrier = threading.Barrier(2)
    threads = [
        threading.Thread(target=_race, args=(user_a["id"], now, results, barrier)) for _ in range(2)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)
    assert not any(thread.is_alive() for thread in threads)

    assert all(isinstance(r, str) for r in results), results
    assert sorted(results) == ["created", "points_insufficient"]
    assert purchase_rows(owner_engine) == 1
    points = overview(client, user_a)["points"]
    assert points["balance"] == points["earned"] - streaks.FREEZE_COST >= 0


# ------------------------------------------------------------ the property


ZONES = [
    None,
    "UTC",
    "Europe/Paris",
    "Asia/Kolkata",
    "America/Los_Angeles",
    "Pacific/Auckland",
    "Pacific/Kiritimati",  # UTC+14
    "Etc/GMT+12",  # UTC-12
]


def _step(rng, owner_engine, user, now, zone):
    """One random move. Returns the new clock and zone."""
    roll = rng.random()
    if roll < 0.45:
        # A day's work touches a few modules, so points come in at a pace worth spending.
        with tenant_session(user["id"]) as session:
            today = activity.local_day(session, user["id"], now)
            for module in rng.sample(activity.ACTIVITY_MODULES, rng.randint(1, 4)):
                activity.record(session, user["id"], module, today)
    elif roll < 0.60:
        with tenant_session(user["id"]) as session:
            try:
                streaks.buy_freeze(
                    session, user["id"], rng.choice((streaks.OVERALL, *activity.MODULES)), now
                )
            except Conflict as refusal:
                assert refusal.code in ("freeze_limit", "points_insufficient")
    elif roll < 0.72:
        # Repairs (41.5): usually a streak that has an offer, otherwise any, so that refusals
        # are part of the sequence without the repair path going unvisited.
        with tenant_session(user["id"]) as session:
            _, found, _ = streaks.read(session, user["id"], now)
            offered = [s.id for s in found if s.repair]
            everyone = (streaks.OVERALL, *activity.MODULES)
            pool = offered if offered and rng.random() < 0.8 else everyone
            try:
                streaks.buy_repair(session, user["id"], rng.choice(pool), now)
            except Conflict as refusal:
                assert refusal.code in ("repair_unavailable", "points_insufficient")
    elif roll < 0.92:
        now += dt.timedelta(hours=rng.choice((3, 12, 24, 24, 24, 30, 48, 72)))
    else:
        zone = rng.choice(ZONES)
        with owner_engine.begin() as conn:
            conn.execute(
                text("UPDATE users SET timezone = :z WHERE id = :u"), {"z": zone, "u": user["id"]}
            )
    return now, zone


def test_the_balance_never_goes_below_zero_and_earned_never_decreases(user_a, owner_engine):
    """Random activity, purchases, clock moves and zone moves, 40 seeded sequences of 60
    steps. After every step the balance is >= 0, earned has not dropped (repairs never enter
    the earning walk), spent is exactly the sum of the purchases' costs, a freeze costs
    twenty, a repair covers only days before the day it was bought and no streak holds more
    than two freezes."""
    purchases = frozen_days = repaired_days = 0
    for seed_value in range(40):
        rng = random.Random(seed_value)  # noqa: S311 - a seeded test sequence
        with owner_engine.begin() as conn:
            conn.execute(text("TRUNCATE activity_days, streak_purchases"))
            conn.execute(
                text("UPDATE users SET timezone = NULL WHERE id = :u"), {"u": user_a["id"]}
            )
        now = dt.datetime(2031, 6, 1, rng.randrange(24), tzinfo=UTC)
        zone = None
        earned_before = 0
        for step in range(60):
            now, zone = _step(rng, owner_engine, user_a, now, zone)
            with tenant_session(user_a["id"]) as session:
                _, found, points = streaks.read(session, user_a["id"], now)
                bought = streaks._purchases(session, user_a["id"])
            where = f"seed {seed_value} step {step} zone {zone}"
            assert points.balance >= 0, where
            assert points.earned >= earned_before, where
            assert points.spent == sum(p.cost for p in bought), where
            assert all(
                p.cost == streaks.FREEZE_COST
                for p in bought
                if p.kind == streaks.FREEZE
            ), where
            assert all(
                p.covers is not None and p.covers < p.bought_on
                for p in bought
                if p.kind == streaks.REPAIR
            ), where
            assert points.balance == points.earned - points.spent, where
            assert all(0 <= s.held_freezes <= streaks.MAX_HELD for s in found), where
            earned_before = points.earned
            frozen_days += sum(1 for s in found for _, state in s.recent if state == streaks.FROZEN)
            repaired_days += sum(
                1 for s in found for _, state in s.recent if state == streaks.REPAIRED
            )
        purchases += len(bought)
    # Not vacuous: money really was spent, freezes really were consumed in the walk and
    # repairs really joined runs.
    assert purchases >= 60
    assert frozen_days >= 60
    assert repaired_days >= 20
