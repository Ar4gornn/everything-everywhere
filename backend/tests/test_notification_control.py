"""Epic 36 (AD-52) — the person decides what the digest says, and when.

Kinds (preferences), muted items (`notify`), the two new clauses, the account's zone and
digest time, the preview, "Send test", and the second-user proofs. Nothing here reaches a
real push service: `push.send` is replaced wherever a send would happen.
"""

import datetime as dt
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import text

from app.core.clock import local_today
from app.core.config import get_settings
from app.services import push
from app.services.push import Digest
from app.services.savings import is_behind

ENDPOINT = "https://push.example.com/subscription/epic36"
UTC = dt.UTC


@pytest.fixture
def push_on():
    settings = get_settings()
    before = (settings.vapid_public_key, settings.vapid_private_key, settings.vapid_subject)
    settings.vapid_public_key = "BLtestpublickey"
    settings.vapid_private_key = "testprivatekey"
    settings.vapid_subject = "mailto:ops@example.com"
    yield
    (
        settings.vapid_public_key,
        settings.vapid_private_key,
        settings.vapid_subject,
    ) = before


@pytest.fixture
def sent(monkeypatch):
    """Every push that would have gone out, as (endpoint, payload). No network."""
    calls: list[tuple[str, str]] = []

    def fake(settings, subscription, payload):
        calls.append((subscription.endpoint, payload))
        return True

    monkeypatch.setattr(push, "send", fake)
    return calls


def _digest(user, today=None):
    from app.core.db import tenant_session

    with tenant_session(user["id"]) as session:
        return push.digest(session, user["id"], today=today)


def _kinds(client, user, **kinds):
    current = client.get("/api/auth/me", headers=user["headers"]).json()["preferences"]
    response = client.patch(
        "/api/auth/me/preferences",
        json={"notifications": current["notifications"] | kinds},
        headers=user["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()["preferences"]["notifications"]


def _low_item(client, user, name="Milk"):
    client.post("/api/inventory/spaces", json={"name": "Fridge"}, headers=user["headers"])
    response = client.post(
        "/api/inventory/items",
        json={"name": name, "quantity": 0, "restock_below": 1, "space_name": "Fridge"},
        headers=user["headers"],
    )
    assert response.status_code == 201, response.text
    return response.json()


def _template(client, user, start_on, category="Rent", **overrides):
    response = client.post(
        "/api/recurring/templates",
        json={
            "kind": "expense",
            "amount": "1200.00",
            "cadence": "monthly",
            "start_on": start_on,
            "category_name": category,
        }
        | overrides,
        headers=user["headers"],
    )
    assert response.status_code == 201, response.text
    return response.json()


def _pot(client, user, name="vacation"):
    items = client.get("/api/savings/types", headers=user["headers"]).json()["items"]
    return next(t for t in items if t["name"] == name)


def _subscribe(client, user, endpoint=ENDPOINT):
    response = client.post(
        "/api/push/subscribe",
        json={"endpoint": endpoint, "p256dh": "p256", "auth": "auth"},
        headers=user["headers"],
    )
    assert response.status_code == 204, response.text


# ------------------------------------------------------------------ kinds (36.1)


def test_kinds_are_stored_and_resolved(client, user_a):
    kinds = _kinds(client, user_a, stock=False, savings=True)
    assert kinds == {
        "stock": False,
        "recurring": True,
        "habits": True,
        "due_tomorrow": False,
        "savings": True,
    }


@pytest.mark.parametrize(
    ("body", "code"),
    [
        ({"notifications": {"weather": True}}, "pref_unknown_id"),
        # Lax pydantic would read "off" as False and switch stock off on a typo.
        ({"notifications": {"stock": "off"}}, "validation"),
        ({"notifications": {"stock": None}}, "validation"),
    ],
)
def test_a_bad_kind_is_refused(client, user_a, body, code):
    response = client.patch("/api/auth/me/preferences", json=body, headers=user_a["headers"])
    assert response.status_code == 422, response.text
    assert response.json()["code"] == code


def test_a_kind_switched_off_is_silent(client, user_a):
    _low_item(client, user_a)
    assert _digest(user_a).low_items == 1
    _kinds(client, user_a, stock=False)
    assert _digest(user_a).empty


def test_a_module_switched_off_silences_its_kind_even_when_the_kind_is_on(client, user_a):
    _low_item(client, user_a)
    client.patch(
        "/api/auth/me/preferences", json={"modules": {"stock": False}}, headers=user_a["headers"]
    )
    assert _kinds(client, user_a)["stock"] is True
    assert _digest(user_a).empty


# ------------------------------------------------------------------ items (36.2)


def test_a_muted_item_leaves_the_digest_but_not_the_page(client, user_a):
    _low_item(client, user_a, "Milk")
    eggs = _low_item(client, user_a, "Eggs")
    response = client.patch(
        f"/api/inventory/items/{eggs['id']}", json={"notify": False}, headers=user_a["headers"]
    )
    assert response.status_code == 200, response.text
    assert response.json()["notify"] is False

    assert _digest(user_a).item_names == ["Milk"]
    listed = client.get("/api/inventory/items", headers=user_a["headers"]).json()["items"]
    assert {i["name"] for i in listed if i["needs_restock"]} == {"Milk", "Eggs"}


@pytest.mark.parametrize("value", [None, "no", 0])
def test_notify_is_true_or_false_and_nothing_else(client, user_a, value):
    item = _low_item(client, user_a)
    pot = _pot(client, user_a)
    template = _template(client, user_a, "2026-07-01")
    for url in (
        f"/api/inventory/items/{item['id']}",
        f"/api/savings/types/{pot['id']}",
        f"/api/recurring/templates/{template['id']}",
    ):
        response = client.patch(url, json={"notify": value}, headers=user_a["headers"])
        assert response.status_code == 422, (url, response.text)


def test_a_muted_template_is_not_counted_as_waiting(client, user_a):
    rent = _template(client, user_a, "2026-07-01", category="Rent")
    _template(client, user_a, "2026-07-01", category="Gym")
    client.get("/api/recurring/pending", headers=user_a["headers"])
    both = _digest(user_a).pending

    client.patch(
        f"/api/recurring/templates/{rent['id']}", json={"notify": False}, headers=user_a["headers"]
    )
    assert _digest(user_a).pending == both // 2
    # Still proposed on the page: muting is about the push, nothing else.
    assert (
        len(client.get("/api/recurring/pending", headers=user_a["headers"]).json()["items"]) == both
    )


def test_the_savings_overview_says_whether_each_pot_is_mentioned(client, user_a):
    """The Plan page draws the pot's bell from the overview, not from a second request."""
    pot = _pot(client, user_a)
    client.patch(
        f"/api/savings/types/{pot['id']}", json={"notify": False}, headers=user_a["headers"]
    )
    pots = client.get("/api/savings/overview", headers=user_a["headers"]).json()["pots"]
    assert {p["name"]: p["notify"] for p in pots}["vacation"] is False
    assert all(p["notify"] for p in pots if p["name"] != "vacation")


def test_the_muted_list_names_every_muted_row(client, user_a):
    item = _low_item(client, user_a, "Eggs")
    pot = _pot(client, user_a)
    template = _template(client, user_a, "2026-07-01", category="Rent", note="Flat")
    for url in (
        f"/api/inventory/items/{item['id']}",
        f"/api/savings/types/{pot['id']}",
        f"/api/recurring/templates/{template['id']}",
    ):
        client.patch(url, json={"notify": False}, headers=user_a["headers"])

    listed = client.get("/api/push/muted", headers=user_a["headers"]).json()["items"]
    assert [(row["kind"], row["name"]) for row in listed] == [
        ("recurring", "Flat"),
        ("savings", "vacation"),
        ("stock", "Eggs"),
    ]

    client.patch(
        f"/api/inventory/items/{item['id']}", json={"notify": True}, headers=user_a["headers"]
    )
    listed = client.get("/api/push/muted", headers=user_a["headers"]).json()["items"]
    assert "stock" not in {row["kind"] for row in listed}


# ------------------------------------------------------------------ due tomorrow (36.4)


def test_due_tomorrow_is_opt_in(client, user_a):
    _template(client, user_a, "2026-10-01", category="Rent")
    assert _digest(user_a, today=dt.date(2026, 9, 30)).due_names == []
    _kinds(client, user_a, due_tomorrow=True)
    found = _digest(user_a, today=dt.date(2026, 9, 30))
    assert found.due_names == ["Rent"]
    assert "1 recurring entry is due tomorrow (Rent)." in found.body


def test_due_tomorrow_means_tomorrow_and_skips_muted_and_paused(client, user_a):
    _kinds(client, user_a, due_tomorrow=True)
    _template(client, user_a, "2026-10-01", category="Rent", note="Flat")
    muted = _template(client, user_a, "2026-10-01", category="Gym")
    paused = _template(client, user_a, "2026-10-01", category="Phone")
    _template(client, user_a, "2026-10-02", category="Later")
    client.patch(
        f"/api/recurring/templates/{muted['id']}", json={"notify": False}, headers=user_a["headers"]
    )
    client.patch(
        f"/api/recurring/templates/{paused['id']}", json={"paused": True}, headers=user_a["headers"]
    )
    assert _digest(user_a, today=dt.date(2026, 9, 30)).due_names == ["Flat"]
    assert _digest(user_a, today=dt.date(2026, 10, 1)).due_names == ["Later"]


# ------------------------------------------------------------------ savings behind (36.4)

START = dt.date(2026, 1, 1)


@pytest.mark.parametrize(
    ("goal", "goal_date", "balance", "today", "expected"),
    [
        # 180 days of 200, 20 to go: the line says 900 of 1000. On the line is on track.
        ("1000", dt.date(2026, 7, 20), "899.99", dt.date(2026, 6, 30), True),
        ("1000", dt.date(2026, 7, 20), "900", dt.date(2026, 6, 30), False),
        # Reached is never behind, whatever the date.
        ("1000", dt.date(2026, 7, 20), "1000", dt.date(2026, 7, 19), False),
        # More than 30 days off: Plan's business, not a push.
        ("1000", dt.date(2026, 8, 1), "0", dt.date(2026, 6, 30), False),
        ("1000", dt.date(2026, 7, 30), "0", dt.date(2026, 6, 30), True),
        # The goal day itself counts; the day after does not.
        ("1000", dt.date(2026, 6, 30), "999", dt.date(2026, 6, 30), True),
        ("1000", dt.date(2026, 6, 29), "0", dt.date(2026, 6, 30), False),
        # No amount or no date: no goal.
        (None, dt.date(2026, 7, 1), "0", dt.date(2026, 6, 30), False),
    ],
)
def test_behind_is_below_the_straight_line(goal, goal_date, balance, today, expected):
    amount = Decimal(goal) if goal is not None else None
    assert is_behind(amount, goal_date, START, Decimal(balance), today) is expected


def test_a_pot_behind_is_named_when_asked_for(client, user_a, owner_engine):
    pot = _pot(client, user_a)
    created = dt.date(2026, 1, 1)
    with owner_engine.begin() as conn:
        conn.execute(
            text("UPDATE savings_types SET created_at = :at WHERE id = :id"),
            {"at": dt.datetime(2026, 1, 1, 12, tzinfo=UTC), "id": pot["id"]},
        )
    client.patch(
        f"/api/savings/types/{pot['id']}",
        json={"goal_amount": "1000.00", "goal_date": "2026-07-20"},
        headers=user_a["headers"],
    )
    client.post(
        "/api/savings/contributions",
        json={"savings_type_id": pot["id"], "amount": "850.00", "occurred_on": "2026-06-01"},
        headers=user_a["headers"],
    )
    today = created + dt.timedelta(days=180)
    assert _digest(user_a, today=today).behind_names == []  # opt-in

    _kinds(client, user_a, savings=True)
    found = _digest(user_a, today=today)
    assert found.behind_names == ["vacation"]
    assert "1 savings goal is behind (vacation)." in found.body

    client.patch(
        f"/api/savings/types/{pot['id']}", json={"notify": False}, headers=user_a["headers"]
    )
    assert _digest(user_a, today=today).empty


# ------------------------------------------------------------------ words and links (36.4, 36.5)


@pytest.mark.parametrize(
    ("language", "due", "behind", "expected"),
    [
        ("en", ["Rent"], [], "1 recurring entry is due tomorrow (Rent)."),
        ("en", ["A", "B"], [], "2 recurring entries are due tomorrow (A, B)."),
        ("fr", ["Loyer"], [], "1 opération récurrente prévue demain (Loyer)."),
        ("fr", ["A", "B"], [], "2 opérations récurrentes prévues demain (A, B)."),
        ("en", [], ["Car"], "1 savings goal is behind (Car)."),
        ("en", [], ["A", "B"], "2 savings goals are behind (A, B)."),
        ("fr", [], ["Auto"], "1 objectif d'épargne en retard (Auto)."),
        ("fr", [], ["A", "B"], "2 objectifs d'épargne en retard (A, B)."),
    ],
)
def test_the_new_clauses_read_as_sentences(language, due, behind, expected):
    found = Digest(0, 0, [], language=language, due_names=due, behind_names=behind)
    assert found.body == expected


@pytest.mark.parametrize(
    ("digest", "url"),
    [
        (Digest(1, 1, ["Milk"]), "/inventory"),
        (Digest(0, 1, []), "/"),
        (Digest(0, 0, [], due_names=["Rent"]), "/plan"),
        (Digest(0, 0, [], behind_names=["Car"]), "/plan"),
        (Digest(0, 0, [], ["Run"]), "/habits"),
        (Digest(0, 0, []), "/"),
    ],
)
def test_the_push_opens_the_first_clauses_page(digest, url):
    assert digest.url == url


# ------------------------------------------------------------------ when (36.3)


def test_the_schedule_is_stored_and_read_back(client, user_a):
    me = client.get("/api/auth/me", headers=user_a["headers"]).json()
    assert (me["timezone"], me["digest_time"]) == (None, "19:00")

    response = client.patch(
        "/api/auth/me/notification-schedule",
        json={"timezone": "Europe/Paris", "digest_time": "07:30"},
        headers=user_a["headers"],
    )
    assert response.status_code == 200, response.text
    assert (response.json()["timezone"], response.json()["digest_time"]) == (
        "Europe/Paris",
        "07:30",
    )

    # Null hands the account back to the host's clock.
    response = client.patch(
        "/api/auth/me/notification-schedule",
        json={"timezone": None, "digest_time": "19:00"},
        headers=user_a["headers"],
    )
    assert response.json()["timezone"] is None


@pytest.mark.parametrize(
    ("body", "code"),
    [
        ({"timezone": "Mars/Olympus", "digest_time": "19:00"}, "invalid_timezone"),
        ({"timezone": "../etc/passwd", "digest_time": "19:00"}, "invalid_timezone"),
        ({"timezone": "", "digest_time": "19:00"}, "validation"),
        ({"timezone": "Europe/Paris", "digest_time": "19:00:30"}, "validation"),
        ({"timezone": "Europe/Paris", "digest_time": "25:00"}, "validation"),
        ({"timezone": "Europe/Paris"}, "validation"),
    ],
)
def test_a_bad_schedule_is_refused(client, user_a, body, code):
    response = client.patch(
        "/api/auth/me/notification-schedule", json=body, headers=user_a["headers"]
    )
    assert response.status_code == 422, response.text
    assert response.json()["code"] == code


@pytest.mark.parametrize(
    ("zone", "now", "notified_on", "due"),
    [
        # 18:59 in Paris (summer, UTC+2) is not yet 19:00.
        ("Europe/Paris", dt.datetime(2026, 9, 27, 16, 59, tzinfo=UTC), None, False),
        ("Europe/Paris", dt.datetime(2026, 9, 27, 17, 0, tzinfo=UTC), None, True),
        # Already told on the local today.
        ("Europe/Paris", dt.datetime(2026, 9, 27, 17, 0, tzinfo=UTC), dt.date(2026, 9, 27), False),
        # Told yesterday: due again.
        ("Europe/Paris", dt.datetime(2026, 9, 27, 17, 0, tzinfo=UTC), dt.date(2026, 9, 26), True),
        # The day summer time ends (25 Oct 2026, UTC+1): 19:00 is 18:00 UTC, not 17:00.
        ("Europe/Paris", dt.datetime(2026, 10, 25, 17, 30, tzinfo=UTC), None, False),
        ("Europe/Paris", dt.datetime(2026, 10, 25, 18, 0, tzinfo=UTC), None, True),
        # Across the date line: 05:00 UTC on the 27th is 19:00 on the 27th in Kiritimati
        # (UTC+14) and 18:00 on the 26th in Pago Pago (UTC-11).
        ("Pacific/Kiritimati", dt.datetime(2026, 9, 27, 5, 0, tzinfo=UTC), None, True),
        (
            "Pacific/Kiritimati",
            dt.datetime(2026, 9, 27, 5, 0, tzinfo=UTC),
            dt.date(2026, 9, 26),
            True,
        ),
        (
            "Pacific/Kiritimati",
            dt.datetime(2026, 9, 27, 5, 0, tzinfo=UTC),
            dt.date(2026, 9, 27),
            False,
        ),
        ("Pacific/Pago_Pago", dt.datetime(2026, 9, 27, 5, 0, tzinfo=UTC), None, False),
        (
            "Pacific/Pago_Pago",
            dt.datetime(2026, 9, 27, 6, 0, tzinfo=UTC),
            dt.date(2026, 9, 25),
            True,
        ),
    ],
)
def test_the_digest_is_due_on_the_accounts_own_clock(zone, now, notified_on, due):
    assert (
        push.is_due(timezone=zone, digest_time=dt.time(19, 0), notified_on=notified_on, now=now)
        is due
    )


def test_the_local_day_is_the_one_habits_are_judged_on(client, user_a):
    """Monday 00:30 in Tokyo is still Sunday in UTC. A Monday-only habit is due in Tokyo."""
    client.post(
        "/api/habits",
        json={
            "name": "Stretch",
            "schedule_kind": "weekdays",
            "weekdays": 1,  # bit 0: Monday
            "started_on": "2026-09-01",
            "target_count": 1,
            "remind": True,
        },
        headers=user_a["headers"],
    )
    now = dt.datetime(2026, 9, 27, 15, 30, tzinfo=UTC)  # Sunday in UTC, Monday in Tokyo
    assert local_today("Asia/Tokyo", now).weekday() == 0
    assert _digest(user_a, today=local_today("Asia/Tokyo", now)).habit_names == [
        "Stretch"
    ]
    assert _digest(user_a, today=local_today("UTC", now)).habit_names == []


def test_a_run_sends_once_at_the_local_hour_and_marks_the_local_day(client, user_a, push_on, sent):
    import notify
    from app.core.db import tenant_session
    from app.services import auth as auth_service

    _low_item(client, user_a)
    _subscribe(client, user_a)
    client.patch(
        "/api/auth/me/notification-schedule",
        json={"timezone": "Pacific/Kiritimati", "digest_time": "08:00"},
        headers=user_a["headers"],
    )

    def run(now):
        with tenant_session(user_a["id"]) as session:
            return notify.run_for(session, user_a["id"], now, get_settings(), push, auth_service)

    # 17:30 UTC on the 26th is 07:30 on the 27th in Kiritimati: not yet.
    assert run(dt.datetime(2026, 9, 26, 17, 30, tzinfo=UTC)) == (0, 1, 0)
    assert sent == []
    # 18:00 UTC is 08:00 there.
    assert run(dt.datetime(2026, 9, 26, 18, 0, tzinfo=UTC)) == (1, 0, 0)
    assert len(sent) == 1
    assert '"url": "/inventory"' in sent[0][1]
    with tenant_session(user_a["id"]) as session:
        [subscription] = push.list_subscriptions(session, user_a["id"])
        assert subscription.notified_on == dt.date(2026, 9, 27)  # the local day, not UTC's
    # A quarter of an hour later: already told today.
    assert run(dt.datetime(2026, 9, 26, 18, 15, tzinfo=UTC)) == (0, 1, 0)
    assert len(sent) == 1


# ------------------------------------------------------------------ preview and test (36.6)


def test_the_preview_is_the_digest_and_works_with_push_off(client, user_a):
    empty = client.get("/api/push/preview", headers=user_a["headers"]).json()
    assert empty["empty"] is True and empty["body"] is None
    assert (empty["digest_time"], empty["timezone"]) == ("19:00", None)

    _low_item(client, user_a)
    preview = client.get("/api/push/preview", headers=user_a["headers"]).json()
    assert preview["body"] == "1 item needs restocking (Milk)."
    assert preview["url"] == "/inventory"


def test_send_test_needs_push_configured(client, user_a):
    response = client.post("/api/push/test", json={"endpoint": ENDPOINT}, headers=user_a["headers"])
    assert response.status_code == 503


def test_send_test_goes_once_a_minute_and_leaves_the_digest_alone(client, user_a, push_on, sent):
    from app.core.db import tenant_session

    _subscribe(client, user_a)
    first = client.post("/api/push/test", json={"endpoint": ENDPOINT}, headers=user_a["headers"])
    assert first.status_code == 204, first.text
    assert sent == [(ENDPOINT, push.test_payload("en"))]

    again = client.post("/api/push/test", json={"endpoint": ENDPOINT}, headers=user_a["headers"])
    assert again.status_code == 429
    assert again.json()["code"] == "push_test_too_soon"
    assert again.headers["Retry-After"] == "60"
    assert len(sent) == 1

    with tenant_session(user_a["id"]) as session:
        [subscription] = push.list_subscriptions(session, user_a["id"])
        assert subscription.notified_on is None  # the evening's digest is still to come
        subscription.tested_at = subscription.tested_at - dt.timedelta(minutes=2)

    _low_item(client, user_a)
    third = client.post("/api/push/test", json={"endpoint": ENDPOINT}, headers=user_a["headers"])
    assert third.status_code == 204
    assert "1 item needs restocking (Milk)." in sent[-1][1]


def test_a_dead_device_is_forgotten_and_said_to_be_gone(client, user_a, push_on, monkeypatch):
    monkeypatch.setattr(push, "send", lambda settings, subscription, payload: False)
    _subscribe(client, user_a)
    response = client.post("/api/push/test", json={"endpoint": ENDPOINT}, headers=user_a["headers"])
    assert response.status_code == 410
    assert response.json()["code"] == "push_device_gone"
    status = client.get("/api/push/status", headers=user_a["headers"]).json()
    assert status["devices"] == 0


# ------------------------------------------------------------------ second user (36.7)


def test_one_accounts_choices_never_shape_anothers_digest(client, user_a, user_b):
    for user in (user_a, user_b):
        _low_item(client, user, "Milk")
    _kinds(client, user_a, stock=False)
    assert _digest(user_a).empty
    assert _digest(user_b).item_names == ["Milk"]


def test_b_can_neither_mute_nor_list_nor_test_as_a(client, user_a, user_b, push_on, sent):
    item = _low_item(client, user_a)
    pot = _pot(client, user_a)
    template = _template(client, user_a, "2026-07-01")
    for url in (
        f"/api/inventory/items/{item['id']}",
        f"/api/savings/types/{pot['id']}",
        f"/api/recurring/templates/{template['id']}",
    ):
        response = client.patch(url, json={"notify": False}, headers=user_b["headers"])
        assert response.status_code == 404, url
        client.patch(url, json={"notify": False}, headers=user_a["headers"])

    assert client.get("/api/push/muted", headers=user_b["headers"]).json()["items"] == []
    assert len(client.get("/api/push/muted", headers=user_a["headers"]).json()["items"]) == 3

    _subscribe(client, user_a)
    response = client.post("/api/push/test", json={"endpoint": ENDPOINT}, headers=user_b["headers"])
    assert response.status_code == 404
    assert response.json()["code"] == "push_not_subscribed"
    assert sent == []


def test_the_new_columns_are_granted_by_name(runtime_connection, user_a):
    """AD-19: a column on `users` the runtime role cannot read would fail every /me."""
    conn = runtime_connection(user_a["id"])
    try:
        row = conn.execute(
            text("SELECT timezone, digest_time FROM users WHERE id = :id"), {"id": user_a["id"]}
        ).one()
        assert row == (None, dt.time(19, 0))
    finally:
        conn.close()


def test_zoneinfo_has_the_zones_the_tests_rely_on():
    """tzdata is a pinned dependency; without it Windows has no zones at all."""
    for name in ("Europe/Paris", "Pacific/Kiritimati", "Pacific/Pago_Pago", "Asia/Tokyo"):
        ZoneInfo(name)
