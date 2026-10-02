"""Story 41.6 — the streak in the daily digest (AD-52, AD-57).

One test per "accepted when": off by default and on after the switch, no clause when today is
already active or the streak is 0, the zone across the date line and a DST day give the right
local today, the preview shows it. Plus: hidden tab streaks are not named, a held freeze changes
the wording, French, and the digest run as the role ``notify.py`` uses reads what it needs.
The clock is pinned by passing ``now`` (the preview) or ``today`` (the service).
"""

import datetime as dt

import pytest
from sqlalchemy import text

from app.core.clock import get_now
from app.core.config import get_settings
from app.services import push
from app.services.push import Digest

UTC = dt.UTC
TODAY = dt.date(2031, 3, 5)
ENDPOINT = "https://push.example.com/subscription/41-6"


def _on(client, user, **kinds):
    current = client.get("/api/auth/me", headers=user["headers"]).json()["preferences"]
    response = client.patch(
        "/api/auth/me/preferences",
        json={"notifications": current["notifications"] | {"streak": True} | kinds},
        headers=user["headers"],
    )
    assert response.status_code == 200, response.text


def _prefs(client, user, **body):
    response = client.patch("/api/auth/me/preferences", json=body, headers=user["headers"])
    assert response.status_code == 200, response.text


def _active(owner_engine, user, days, module="app"):
    with owner_engine.begin() as conn:
        for day in days:
            conn.execute(
                text("INSERT INTO activity_days (user_id, day, module) VALUES (:u, :d, :m)"),
                {"u": user["id"], "d": day, "m": module},
            )


def _freeze(owner_engine, user, streak, bought_on):
    with owner_engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO streak_purchases (user_id, streak, kind, cost, bought_on) "
                "VALUES (:u, :s, 'freeze', 20, :d)"
            ),
            {"u": user["id"], "s": streak, "d": bought_on},
        )


def _days(count, ending=TODAY - dt.timedelta(days=1)):
    return [ending - dt.timedelta(days=n) for n in range(count)]


def _digest(user, today=TODAY):
    from app.core.db import tenant_session

    with tenant_session(user["id"]) as session:
        return push.digest(session, user["id"], today=today)


def _zone(client, user, zone):
    response = client.patch(
        "/api/auth/me/notification-schedule",
        json={"timezone": zone, "digest_time": "19:00"},
        headers=user["headers"],
    )
    assert response.status_code == 200, response.text


@pytest.fixture
def at():
    """Pin the clock for the HTTP endpoints; the test says which instant."""
    from app.main import app

    def pin(now):
        app.dependency_overrides[get_now] = lambda: now

    yield pin
    app.dependency_overrides.pop(get_now, None)


@pytest.fixture
def push_on():
    settings = get_settings()
    before = (settings.vapid_public_key, settings.vapid_private_key, settings.vapid_subject)
    settings.vapid_public_key = "BLtestpublickey"
    settings.vapid_private_key = "testprivatekey"
    settings.vapid_subject = "mailto:ops@example.com"
    yield
    settings.vapid_public_key, settings.vapid_private_key, settings.vapid_subject = before


# ------------------------------------------------------------------ the switch


def test_the_kind_is_off_by_default_and_the_clause_follows_the_switch(client, user_a, owner_engine):
    _active(owner_engine, user_a, _days(3))
    assert (
        client.get("/api/auth/me", headers=user_a["headers"]).json()["preferences"][
            "notifications"
        ]["streak"]
        is False
    )
    assert _digest(user_a).empty is True

    _on(client, user_a)
    found = _digest(user_a)
    assert found.empty is False
    assert found.body == "Your 3-day streak is at risk today."
    assert found.url == "/"


def test_the_kind_is_a_strict_boolean(client, user_a):
    for value in ("off", None, "yes"):
        response = client.patch(
            "/api/auth/me/preferences",
            json={"notifications": {"streak": value}},
            headers=user_a["headers"],
        )
        assert response.status_code == 422, response.text
        assert response.json()["code"] == "validation"


# ------------------------------------------------------------------ when it speaks


def test_no_clause_when_today_is_already_active(client, user_a, owner_engine):
    _on(client, user_a)
    _active(owner_engine, user_a, [*_days(3), TODAY])
    assert _digest(user_a).empty is True


def test_no_clause_when_the_current_streak_is_zero(client, user_a, owner_engine):
    _on(client, user_a)
    # Last active three days ago: yesterday and the day before were missed, the run is 0.
    _active(owner_engine, user_a, _days(4, ending=TODAY - dt.timedelta(days=3)))
    assert _digest(user_a).empty is True


def test_no_clause_for_an_account_with_no_activity(client, user_a):
    _on(client, user_a)
    assert _digest(user_a).empty is True


def test_a_streak_clause_alone_is_a_digest_worth_sending(client, user_a, owner_engine):
    _on(client, user_a, stock=False, recurring=False, habits=False)
    _active(owner_engine, user_a, _days(1))
    assert _digest(user_a).body == "Your 1-day streak is at risk today."


# ------------------------------------------------------------------ the local day


def test_the_preview_shows_the_clause_on_the_accounts_own_date_line(
    client, user_a, owner_engine, at
):
    """10:00 UTC on the 5th is already the 6th in Kiritimati (UTC+14) and still the 4th in
    Pago Pago (UTC-11). Activity on the 4th and 5th: for Kiritimati today (the 6th) is still
    to do on a 2-day run; for Pago Pago today (the 4th) is active, and the 5th is the future."""
    _on(client, user_a)
    _active(owner_engine, user_a, [TODAY - dt.timedelta(days=1), TODAY])
    at(dt.datetime(2031, 3, 5, 10, 0, tzinfo=UTC))

    _zone(client, user_a, "Pacific/Kiritimati")
    east = client.get("/api/push/preview", headers=user_a["headers"]).json()
    assert east["local_date"] == "2031-03-06"
    assert east["body"] == "Your 2-day streak is at risk today."
    assert east["url"] == "/"

    _zone(client, user_a, "Pacific/Pago_Pago")
    west = client.get("/api/push/preview", headers=user_a["headers"]).json()
    assert west["local_date"] == "2031-03-04"
    assert west["empty"] is True


@pytest.mark.parametrize(
    ("instant", "local_date"),
    [
        # Last Sunday of March 2031 is the 30th; clocks go forward at 01:00 UTC. At 22:30 UTC
        # on the 30th it is 00:30 on the 31st in Paris (UTC+2), not 23:30 on the 30th.
        (dt.datetime(2031, 3, 30, 22, 30, tzinfo=UTC), dt.date(2031, 3, 31)),
        # Last Sunday of October 2031 is the 26th; clocks go back at 01:00 UTC. At 22:30 UTC
        # on the 25th it is 00:30 on the 26th in Paris (still UTC+2 until the next night).
        (dt.datetime(2031, 10, 25, 22, 30, tzinfo=UTC), dt.date(2031, 10, 26)),
    ],
)
def test_a_dst_day_gives_the_right_local_today(
    client, user_a, owner_engine, at, instant, local_date
):
    """The two days before the Paris date are active; the Paris date is not, while the UTC
    date (one day earlier) would be a day the clause must not be silent about."""
    _on(client, user_a)
    _zone(client, user_a, "Europe/Paris")
    _active(
        owner_engine, user_a, [local_date - dt.timedelta(days=2), local_date - dt.timedelta(days=1)]
    )
    at(instant)
    found = client.get("/api/push/preview", headers=user_a["headers"]).json()
    assert found["local_date"] == local_date.isoformat()
    assert found["body"] == "Your 2-day streak is at risk today."


# ------------------------------------------------------------------ the shown tabs


def test_only_shown_tab_streaks_that_are_at_risk_are_named(client, user_a, owner_engine):
    _on(client, user_a)
    for module in ("entries", "gym", "habits", "notes"):
        _active(owner_engine, user_a, _days(2), module=module)
    # Shown and on: named. Shown but its module is off: not named. Module on but not shown:
    # not named. (A tab active today makes overall active, so that case never reaches here.)
    _prefs(
        client,
        user_a,
        streaks={"entries": True, "gym": True, "habits": False, "notes": True},
        modules={"gym": False},
    )
    found = _digest(user_a)
    assert found.streak_tabs == ["entries", "notes"]
    assert found.body == "Your 2-day streak is at risk today (tabs at risk: Entries, Notes)."


def test_a_tab_whose_streak_is_zero_is_not_named(client, user_a, owner_engine):
    _on(client, user_a)
    _active(owner_engine, user_a, _days(2))
    _active(owner_engine, user_a, _days(2, ending=TODAY - dt.timedelta(days=4)), module="gym")
    _prefs(client, user_a, streaks={"gym": True})
    assert _digest(user_a).streak_tabs == []


# ------------------------------------------------------------------ a freeze


def test_a_held_freeze_changes_the_wording_for_overall(client, user_a, owner_engine):
    _on(client, user_a)
    _active(owner_engine, user_a, _days(5))
    assert "at risk" in _digest(user_a).body
    _freeze(owner_engine, user_a, "overall", TODAY - dt.timedelta(days=2))
    found = _digest(user_a)
    assert found.streak_frozen is True
    assert found.body == "Your 5-day streak is safe tonight: a freeze will cover it."


def test_a_tab_with_its_own_freeze_is_not_named_as_at_risk(client, user_a, owner_engine):
    _on(client, user_a)
    _active(owner_engine, user_a, _days(3))
    for module in ("gym", "notes"):
        _active(owner_engine, user_a, _days(3), module=module)
    _prefs(client, user_a, streaks={"gym": True, "notes": True})
    _freeze(owner_engine, user_a, "gym", TODAY - dt.timedelta(days=3))
    assert _digest(user_a).streak_tabs == ["notes"]


def test_a_freeze_bought_after_the_local_today_does_not_promise_tonight(
    client, user_a, owner_engine
):
    # After a move west a freeze can carry a later bought_on than the local today. It is
    # held, but tomorrow's walk will not use it, so the digest must still say "at risk"
    # and still name the tab.
    _on(client, user_a)
    _active(owner_engine, user_a, _days(3))
    _active(owner_engine, user_a, _days(3), module="gym")
    _prefs(client, user_a, streaks={"gym": True})
    _freeze(owner_engine, user_a, "overall", TODAY + dt.timedelta(days=2))
    _freeze(owner_engine, user_a, "gym", TODAY + dt.timedelta(days=1))
    found = _digest(user_a)
    assert found.streak_frozen is False
    assert "at risk" in found.body
    assert found.streak_tabs == ["gym"]


def test_a_freeze_bought_today_does_cover_tonight(client, user_a, owner_engine):
    _on(client, user_a)
    _active(owner_engine, user_a, _days(3))
    _freeze(owner_engine, user_a, "overall", TODAY)
    assert _digest(user_a).streak_frozen is True


# ------------------------------------------------------------------ French


@pytest.mark.parametrize(
    ("kwargs", "expected"),
    [
        (dict(streak_days=1), "Votre série de 1 jour est en danger aujourd'hui."),
        (dict(streak_days=12), "Votre série de 12 jours est en danger aujourd'hui."),
        (
            dict(streak_days=12, streak_frozen=True),
            "Votre série de 12 jours est protégée ce soir : un gel la couvrira.",
        ),
        (
            dict(streak_days=1, streak_frozen=True),
            "Votre série de 1 jour est protégée ce soir : un gel la couvrira.",
        ),
        (
            dict(streak_days=2, streak_tabs=["entries", "gym"]),
            "Votre série de 2 jours est en danger aujourd'hui "
            "(onglets en danger : Opérations, Sport).",
        ),
        (
            dict(streak_days=2, streak_tabs=["entries", "gym", "notes", "mood"]),
            "Votre série de 2 jours est en danger aujourd'hui "
            "(onglets en danger : Opérations, Sport, Notes, …).",
        ),
    ],
)
def test_the_clause_in_french(kwargs, expected):
    assert Digest(0, 0, [], language="fr", **kwargs).body == expected


def test_the_french_plural_rule_is_not_the_english_one():
    # 0 takes the singular in French; it is never sent, but the rule is the one written down.
    assert Digest(0, 0, [], language="fr", streak_days=0).empty is True
    assert push._plural("fr", 0) == "one" and push._plural("en", 0) == "many"


def test_the_clause_in_english_names_tabs_with_an_ellipsis_past_three():
    found = Digest(0, 0, [], streak_days=9, streak_tabs=["gym", "plan", "grow", "mood"])
    assert found.body == ("Your 9-day streak is at risk today (tabs at risk: Gym, Plan, Grow, …).")


def test_an_account_in_french_is_told_in_french(client, user_a, owner_engine):
    _on(client, user_a)
    _active(owner_engine, user_a, _days(2))
    with owner_engine.begin() as conn:
        conn.execute(text("UPDATE users SET language = 'fr' WHERE id = :u"), {"u": user_a["id"]})
    assert _digest(user_a).body == "Votre série de 2 jours est en danger aujourd'hui."


# ------------------------------------------------------------------ the role cron runs as


def test_the_run_as_the_runtime_role_reads_the_history_under_rls(
    client, user_a, user_b, owner_engine, push_on, monkeypatch
):
    """`notify.py` opens ``tenant_session`` — the runtime role, one tenant at a time. This runs
    ``run_for`` exactly so: A is told about A's streak (activity *and* a freeze, both read under
    forced RLS), never B's longer one, and the role has no grant beyond ``SELECT`` to widen."""
    import notify
    from app.core.db import tenant_session
    from app.services import auth as auth_service

    sent: list[str] = []
    monkeypatch.setattr(
        push, "send", lambda settings, subscription, payload: sent.append(payload) or True
    )
    for user in (user_a, user_b):
        _on(client, user)
        _zone(client, user, "UTC")
        assert (
            client.post(
                "/api/push/subscribe",
                json={"endpoint": ENDPOINT + user["email"], "p256dh": "p", "auth": "a"},
                headers=user["headers"],
            ).status_code
            == 204
        )
    _active(owner_engine, user_a, _days(4))
    _freeze(owner_engine, user_a, "overall", TODAY - dt.timedelta(days=1))
    _active(owner_engine, user_b, _days(9))

    now = dt.datetime(2031, 3, 5, 19, 0, tzinfo=UTC)
    with tenant_session(user_a["id"]) as session:
        counts = notify.run_for(session, user_a["id"], now, get_settings(), push, auth_service)
    assert counts == (1, 0, 0)
    assert len(sent) == 1
    assert "Your 4-day streak is safe tonight: a freeze will cover it." in sent[0]
    assert '"url": "/"' in sent[0]
    assert "9-day" not in sent[0]


def test_the_runtime_role_sees_only_its_own_activity_and_purchases(
    client, user_a, user_b, owner_engine, runtime_connection
):
    _active(owner_engine, user_a, _days(2))
    _active(owner_engine, user_b, _days(5))
    _freeze(owner_engine, user_b, "overall", TODAY)
    conn = runtime_connection(user_a["id"])
    try:
        assert conn.execute(text("SELECT count(*) FROM activity_days")).scalar_one() == 2
        assert conn.execute(text("SELECT count(*) FROM streak_purchases")).scalar_one() == 0
    finally:
        conn.close()
    blind = runtime_connection(None)
    try:
        assert blind.execute(text("SELECT count(*) FROM activity_days")).scalar_one() == 0
    finally:
        blind.close()
