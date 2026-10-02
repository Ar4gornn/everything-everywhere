"""Epic 44 — ``GET /api/entries/quick-picks`` (spec: docs/epic-44-quick-add.md §3).

Rows are written through the owner connection so ``created_at`` can be set exactly: the API
stamps ``now()``, which is constant inside a transaction and would make every tie-break by
``created_at`` a coin toss. The clock is pinned through ``get_now`` (never ``date.today()``).

Window: day 0 is today, ``today - 90`` is in, ``today - 91`` is out, the future is out.
"""

import datetime as dt
import uuid

import pytest
from sqlalchemy import text

from app.core.clock import get_now
from app.services import quick_picks as service

UTC = dt.UTC
NOW = dt.datetime(2031, 6, 15, 12, 0, tzinfo=UTC)
TODAY = dt.date(2031, 6, 15)
T0 = dt.datetime(2031, 1, 1, tzinfo=UTC)


def days_ago(n: int) -> dt.date:
    return TODAY - dt.timedelta(days=n)


def stamp(minutes: int) -> dt.datetime:
    return T0 + dt.timedelta(minutes=minutes)


@pytest.fixture(autouse=True)
def clock(client):
    from app.main import app

    app.dependency_overrides[get_now] = lambda: NOW
    yield
    app.dependency_overrides.pop(get_now, None)


class Seeder:
    def __init__(self, engine, user):
        self.engine = engine
        self.user = user["id"]
        self.headers = user["headers"]

    def category(self, name, kind="expense", created=0, pot=None) -> uuid.UUID:
        cid = uuid.uuid4()
        with self.engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO categories (id, user_id, kind, name, created_at) "
                    "VALUES (:id, :u, CAST(:k AS entry_kind), :n, :c)"
                ),
                {"id": cid, "u": self.user, "k": kind, "n": name, "c": stamp(created)},
            )
        return cid

    def vendor(self, name, created=0) -> uuid.UUID:
        vid = uuid.uuid4()
        with self.engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO vendors (id, user_id, name, created_at) "
                    "VALUES (:id, :u, :n, :c)"
                ),
                {"id": vid, "u": self.user, "n": name, "c": stamp(created)},
            )
        return vid

    def entry(self, category, on, kind="expense", amount="5.00", vendor=None, created=0):
        eid = uuid.uuid4()
        with self.engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO entries (id, user_id, kind, category_id, amount, occurred_on, "
                    "vendor_id, created_at) "
                    "VALUES (:id, :u, CAST(:k AS entry_kind), :cat, :a, :on, :v, :c)"
                ),
                {
                    "id": eid,
                    "u": self.user,
                    "k": kind,
                    "cat": category,
                    "a": amount,
                    "on": on,
                    "v": vendor,
                    "c": stamp(created),
                },
            )
        return eid


@pytest.fixture
def seed_a(owner_engine, user_a):
    return Seeder(owner_engine, user_a)


def fetch(client, user):
    response = client.get("/api/entries/quick-picks", headers=user["headers"])
    assert response.status_code == 200, response.text
    return response.json()


def names(picks):
    return [c["name"] for c in picks]


# ------------------------------------------------------------------ empty


def test_empty_account(client, user_a):
    body = fetch(client, user_a)
    assert body == {
        "expense": {"categories": [], "combos": []},
        "income": {"categories": [], "combos": []},
        "vendors": [],
    }


def test_requires_auth(client):
    assert client.get("/api/entries/quick-picks").status_code == 401


# ------------------------------------------------------------------ categories


def test_ranked_by_count(client, user_a, seed_a):
    few = seed_a.category("Few")
    many = seed_a.category("Many")
    seed_a.entry(few, days_ago(1))
    for d in (5, 6, 7):
        seed_a.entry(many, days_ago(d))
    picks = fetch(client, user_a)["expense"]["categories"]
    assert [(c["name"], c["uses"]) for c in picks] == [("Many", 3), ("Few", 1)]


def test_count_tie_broken_by_latest_occurred_on(client, user_a, seed_a):
    older = seed_a.category("Older")
    newer = seed_a.category("Newer")
    seed_a.entry(older, days_ago(10), created=500)
    seed_a.entry(newer, days_ago(2), created=1)
    assert names(fetch(client, user_a)["expense"]["categories"]) == ["Newer", "Older"]


def test_tie_broken_by_latest_created_at(client, user_a, seed_a):
    early = seed_a.category("Early")
    late = seed_a.category("Late")
    seed_a.entry(early, days_ago(3), created=10)
    seed_a.entry(late, days_ago(3), created=20)
    assert names(fetch(client, user_a)["expense"]["categories"]) == ["Late", "Early"]


def test_tie_broken_by_lower_name(client, user_a, seed_a):
    # Byte-wise "Banana" < "apple"; folded, "apple" < "Banana". The spec says lower(name).
    banana = seed_a.category("Banana")
    apple = seed_a.category("apple")
    seed_a.entry(banana, days_ago(3), created=10)
    seed_a.entry(apple, days_ago(3), created=10)
    assert names(fetch(client, user_a)["expense"]["categories"]) == ["apple", "Banana"]


def test_padded_with_unused_by_created_desc(client, user_a, seed_a):
    used = seed_a.category("Used", created=1)
    seed_a.entry(used, days_ago(1))
    seed_a.category("Old", created=2)
    seed_a.category("New", created=9)
    seed_a.category("Mid", created=5)
    # An income category and an out-of-window entry must not leak into the expense padding
    # as "used".
    seed_a.category("Salary", kind="income", created=50)
    stale = seed_a.category("Stale", created=3)
    seed_a.entry(stale, days_ago(200))
    picks = fetch(client, user_a)["expense"]["categories"]
    assert [(c["name"], c["uses"]) for c in picks] == [
        ("Used", 1),
        ("New", 0),
        ("Mid", 0),
        ("Stale", 0),
        ("Old", 0),
    ]


def test_capped_at_eight_used(client, user_a, seed_a):
    for i in range(10):
        seed_a.entry(seed_a.category(f"C{i:02d}", created=i), days_ago(i + 1))
    picks = fetch(client, user_a)["expense"]["categories"]
    assert len(picks) == 8
    assert names(picks) == [f"C{i:02d}" for i in range(8)]


def test_capped_at_eight_when_padding(client, user_a, seed_a):
    for i in range(12):
        seed_a.category(f"C{i:02d}", created=i)
    picks = fetch(client, user_a)["expense"]["categories"]
    assert names(picks) == [f"C{i:02d}" for i in range(11, 3, -1)]
    assert {c["uses"] for c in picks} == {0}


def test_padding_fills_exactly_to_eight(client, user_a, seed_a):
    for i in range(3):
        seed_a.entry(seed_a.category(f"U{i}", created=i), days_ago(1 + i))
    for i in range(10):
        seed_a.category(f"P{i}", created=100 + i)
    picks = fetch(client, user_a)["expense"]["categories"]
    assert len(picks) == 8
    assert [c["uses"] for c in picks] == [1, 1, 1, 0, 0, 0, 0, 0]


def test_window_edges(client, user_a, seed_a):
    day90 = seed_a.category("Day90")
    day91 = seed_a.category("Day91")
    future = seed_a.category("Future")
    today = seed_a.category("Today")
    seed_a.entry(day90, days_ago(90))
    seed_a.entry(day91, days_ago(91))
    seed_a.entry(future, TODAY + dt.timedelta(days=1))
    seed_a.entry(today, TODAY)
    picks = {c["name"]: c["uses"] for c in fetch(client, user_a)["expense"]["categories"]}
    # Out-of-window categories are still offered, but as padding: uses == 0.
    assert picks == {"Day90": 1, "Today": 1, "Day91": 0, "Future": 0}


def test_window_edges_service_level(owner_engine, user_a, seed_a):
    from sqlalchemy.orm import Session

    from app.models.ledger import EntryKind

    cat = seed_a.category("Only")
    seed_a.entry(cat, days_ago(91))
    with Session(owner_engine) as session:
        picks = service.category_picks(session, user_a["id"], EntryKind.expense, TODAY)
        assert [p.uses for p in picks] == [0]
        seed_a.entry(cat, days_ago(90))
        picks = service.category_picks(session, user_a["id"], EntryKind.expense, TODAY)
        assert [p.uses for p in picks] == [1]


def test_kinds_are_separate(client, user_a, seed_a):
    spend = seed_a.category("Food")
    pay = seed_a.category("Salary", kind="income")
    seed_a.entry(spend, days_ago(1))
    seed_a.entry(pay, days_ago(1), kind="income", amount="900.00")
    body = fetch(client, user_a)
    assert [(c["name"], c["uses"]) for c in body["expense"]["categories"]] == [("Food", 1)]
    assert [(c["name"], c["uses"]) for c in body["income"]["categories"]] == [("Salary", 1)]
    assert [c["category_name"] for c in body["expense"]["combos"]] == ["Food"]
    assert [c["category_name"] for c in body["income"]["combos"]] == ["Salary"]


def test_default_pot_carried_for_expense_never_for_income(client, user_a, seed_a, owner_engine):
    pot = client.post(
        "/api/savings/types", json={"name": "Holiday"}, headers=user_a["headers"]
    )
    if pot.status_code not in (200, 201):
        pytest.skip(f"cannot create a pot here: {pot.status_code} {pot.text}")
    pot_id = pot.json()["id"]
    spend = seed_a.category("Trips")
    pay = seed_a.category("Gift", kind="income")
    with owner_engine.begin() as conn:
        conn.execute(
            text("UPDATE categories SET default_savings_type_id = :p WHERE id = :c"),
            {"p": pot_id, "c": spend},
        )
    seed_a.entry(spend, days_ago(1))
    seed_a.entry(pay, days_ago(1), kind="income")
    body = fetch(client, user_a)
    assert body["expense"]["categories"][0]["default_savings_type_id"] == pot_id
    assert body["income"]["categories"][0]["default_savings_type_id"] is None


# ------------------------------------------------------------------ combos


def test_combos_distinct_newest_first_capped_at_three(client, user_a, seed_a):
    food = seed_a.category("Food")
    shop = seed_a.vendor("Shop")
    # Same combo three times: one group, dated by its latest entry.
    for d in (30, 20, 10):
        seed_a.entry(food, days_ago(d), amount="4.50", vendor=shop)
    seed_a.entry(food, days_ago(9), amount="4.50", vendor=None)  # null vendor: its own group
    seed_a.entry(food, days_ago(8), amount="7.00", vendor=shop)  # other amount
    seed_a.entry(food, days_ago(7), amount="9.00", vendor=shop)
    seed_a.entry(food, days_ago(6), amount="11.00", vendor=shop)
    combos = fetch(client, user_a)["expense"]["combos"]
    assert [c["amount"] for c in combos] == ["11.00", "9.00", "7.00"]
    assert all(c["vendor_name"] == "Shop" for c in combos)
    assert len(combos) == 3


def test_combos_null_vendor_group_and_dedupe(client, user_a, seed_a):
    food = seed_a.category("Food")
    shop = seed_a.vendor("Shop")
    seed_a.entry(food, days_ago(5), amount="4.50", vendor=shop, created=1)
    seed_a.entry(food, days_ago(4), amount="4.50", vendor=None, created=2)
    seed_a.entry(food, days_ago(3), amount="4.50", vendor=None, created=3)
    seed_a.entry(food, days_ago(2), amount="4.50", vendor=shop, created=4)
    combos = fetch(client, user_a)["expense"]["combos"]
    assert [(c["vendor_name"], c["vendor_id"] is None) for c in combos] == [
        ("Shop", False),
        (None, True),
    ]
    assert {c["category_name"] for c in combos} == {"Food"}


def test_combos_distinct_per_category(client, user_a, seed_a):
    a = seed_a.category("A")
    b = seed_a.category("B")
    seed_a.entry(a, days_ago(2), amount="3.00")
    seed_a.entry(b, days_ago(1), amount="3.00")
    combos = fetch(client, user_a)["expense"]["combos"]
    assert [c["category_name"] for c in combos] == ["B", "A"]


def test_combos_tie_broken_by_created_at(client, user_a, seed_a):
    a = seed_a.category("A")
    b = seed_a.category("B")
    seed_a.entry(a, days_ago(2), amount="3.00", created=20)
    seed_a.entry(b, days_ago(2), amount="3.00", created=10)
    combos = fetch(client, user_a)["expense"]["combos"]
    assert [c["category_name"] for c in combos] == ["A", "B"]


def test_combos_respect_window(client, user_a, seed_a):
    food = seed_a.category("Food")
    seed_a.entry(food, days_ago(91), amount="1.00")
    seed_a.entry(food, TODAY + dt.timedelta(days=1), amount="2.00")
    seed_a.entry(food, days_ago(90), amount="3.00")
    combos = fetch(client, user_a)["expense"]["combos"]
    assert [c["amount"] for c in combos] == ["3.00"]


# ------------------------------------------------------------------ vendors


def test_vendor_uses_most_recent_entry_all_time(client, user_a, seed_a):
    old = seed_a.category("Old habit")
    new = seed_a.category("New habit")
    pay = seed_a.category("Refund", kind="income")
    shop = seed_a.vendor("Shop")
    seed_a.entry(old, days_ago(400), vendor=shop)  # far outside the window
    seed_a.entry(new, days_ago(300), vendor=shop)
    vendors = fetch(client, user_a)["vendors"]
    assert [(v["vendor_name"], v["category_name"], v["kind"]) for v in vendors] == [
        ("Shop", "New habit", "expense")
    ]
    # Income, same day, later created_at: the kind follows the most recent entry.
    seed_a.entry(pay, days_ago(300), kind="income", vendor=shop, created=5)
    vendors = fetch(client, user_a)["vendors"]
    assert [(v["category_name"], v["kind"]) for v in vendors] == [("Refund", "income")]


def test_vendor_tie_broken_by_created_at_then_id(client, user_a, seed_a):
    first = seed_a.category("First")
    second = seed_a.category("Second")
    shop = seed_a.vendor("Shop")
    seed_a.entry(first, days_ago(3), vendor=shop, created=20)
    seed_a.entry(second, days_ago(3), vendor=shop, created=10)
    assert fetch(client, user_a)["vendors"][0]["category_name"] == "First"


def test_vendor_tie_broken_by_id(client, user_a, seed_a, owner_engine):
    first = seed_a.category("First")
    second = seed_a.category("Second")
    shop = seed_a.vendor("Shop")
    e1 = seed_a.entry(first, days_ago(3), vendor=shop, created=10)
    e2 = seed_a.entry(second, days_ago(3), vendor=shop, created=10)
    winner = "First" if e1 > e2 else "Second"
    assert fetch(client, user_a)["vendors"][0]["category_name"] == winner


def test_vendors_ordered_by_recency_and_skip_unused(client, user_a, seed_a):
    cat = seed_a.category("Food")
    older = seed_a.vendor("Older")
    newer = seed_a.vendor("Newer")
    same_day_late = seed_a.vendor("SameDayLate")
    seed_a.vendor("Never used")
    seed_a.entry(cat, days_ago(10), vendor=older)
    seed_a.entry(cat, days_ago(2), vendor=newer, created=1)
    seed_a.entry(cat, days_ago(2), vendor=same_day_late, created=9)
    seed_a.entry(cat, days_ago(1))  # no vendor
    assert [v["vendor_name"] for v in fetch(client, user_a)["vendors"]] == [
        "SameDayLate",
        "Newer",
        "Older",
    ]


def test_vendors_capped(client, user_a, seed_a, monkeypatch):
    monkeypatch.setattr(service, "MAX_VENDORS", 3)
    cat = seed_a.category("Food")
    for i in range(5):
        seed_a.entry(cat, days_ago(10 - i), vendor=seed_a.vendor(f"V{i}"))
    got = [v["vendor_name"] for v in fetch(client, user_a)["vendors"]]
    assert got == ["V4", "V3", "V2"]


def test_vendors_real_cap_is_200(client, user_a, seed_a):
    cat = seed_a.category("Food")
    with seed_a.engine.begin() as conn:
        vids = [uuid.uuid4() for _ in range(201)]
        conn.execute(
            text(
                "INSERT INTO vendors (id, user_id, name) VALUES (:id, :u, :n)"
            ),
            [{"id": v, "u": seed_a.user, "n": f"V{i:03d}"} for i, v in enumerate(vids)],
        )
        conn.execute(
            text(
                "INSERT INTO entries (id, user_id, kind, category_id, amount, occurred_on, "
                "vendor_id) VALUES (gen_random_uuid(), :u, 'expense', :c, 1, :d, :v)"
            ),
            [
                {
                    "u": seed_a.user,
                    "c": cat,
                    "d": days_ago(1) - dt.timedelta(days=i),
                    "v": v,
                }
                for i, v in enumerate(vids)
            ],
        )
    got = [v["vendor_name"] for v in fetch(client, user_a)["vendors"]]
    assert len(got) == 200
    assert got[0] == "V000" and got[-1] == "V199"


def test_vendors_tie_broken_by_entry_id(client, user_a, seed_a):
    cat = seed_a.category("Food")
    v1 = seed_a.vendor("V1")
    v2 = seed_a.vendor("V2")
    e1 = seed_a.entry(cat, days_ago(3), vendor=v1, created=10)
    e2 = seed_a.entry(cat, days_ago(3), vendor=v2, created=10)
    expected = ["V1", "V2"] if e1 > e2 else ["V2", "V1"]
    assert [v["vendor_name"] for v in fetch(client, user_a)["vendors"]] == expected


def test_window_uses_the_accounts_local_date_not_the_utc_date(client, user_a, seed_a):
    """UTC+14 at 12:00 UTC is already the next day: an entry dated there is "today", in the window.

    Measured against ``now.date()`` the same entry would be a day in the future and fall out.
    """
    zone = client.patch(
        "/api/auth/me/notification-schedule",
        json={"timezone": "Pacific/Kiritimati", "digest_time": "19:00"},
        headers=user_a["headers"],
    )
    assert zone.status_code == 200, zone.text
    local_today = TODAY + dt.timedelta(days=1)
    food = seed_a.category("Food")
    edge = seed_a.category("Edge")
    seed_a.entry(food, local_today, amount="3.00")
    # 90 days before the *local* today is the last day in; 91 would be out.
    seed_a.entry(edge, local_today - dt.timedelta(days=90))
    body = fetch(client, user_a)["expense"]
    assert {c["name"]: c["uses"] for c in body["categories"]} == {"Food": 1, "Edge": 1}
    assert [c["amount"] for c in body["combos"]] == ["3.00", "5.00"]


def test_combo_dated_today_is_in(client, user_a, seed_a):
    food = seed_a.category("Food")
    seed_a.entry(food, TODAY, amount="2.50")
    assert [c["amount"] for c in fetch(client, user_a)["expense"]["combos"]] == ["2.50"]
