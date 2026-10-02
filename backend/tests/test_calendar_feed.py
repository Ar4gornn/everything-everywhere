"""Epic 39 — the calendar feed (AD-55).

A secret URL is the only credential a calendar app can present, so most of what is tested
here is about that URL: it is shown once, stored hashed, stops working the moment it is
replaced or turned off, answers 404 for every kind of wrong, is rate-limited, never reaches
a log line, and reads only its owner's rows. The rest is the iCalendar text itself.
"""

import datetime as dt
import logging
import re

import pytest
from sqlalchemy import text

from app.api import calendar as calendar_api
from app.core import ical
from app.services import calendar_feed
from app.services.sessions import hash_token

TODAY = dt.date.today()


@pytest.fixture(autouse=True)
def _fresh_limiter():
    calendar_api.limiter.reset()
    yield
    calendar_api.limiter.reset()


def _on(client, user) -> dict:
    response = client.post("/api/calendar/feed", headers=user["headers"])
    assert response.status_code == 201, response.text
    return response.json()


def _fetch(client, path: str):
    return client.get(path)


def _patch(client, user, body):
    return client.patch("/api/calendar/feed", json=body, headers=user["headers"])


def _unfold(body: str) -> str:
    """Undo RFC 5545 folding so an assertion can read a whole property."""
    return body.replace("\r\n ", "").replace("\r\n", "\n")


def _summaries(body: str) -> list[str]:
    return re.findall(r"^SUMMARY:(.*)$", _unfold(body), flags=re.MULTILINE)


def _weekly(client, user, *, start_on: dt.date, amount="10.00", category="Rent"):
    response = client.post(
        "/api/recurring/templates",
        json={
            "kind": "expense",
            "amount": amount,
            "cadence": "weekly",
            "start_on": start_on.isoformat(),
            "category_name": category,
        },
        headers=user["headers"],
    )
    assert response.status_code == 201, response.text
    return response.json()


# ------------------------------------------------------------------ iCalendar text


def test_escape_handles_backslash_first_then_the_separators():
    assert ical.escape("a\\b;c,d\ne") == "a\\\\b\\;c\\,d\\ne"


def test_fold_counts_octets_and_never_splits_a_character():
    line = "SUMMARY:" + "é" * 60  # 8 + 120 octets
    folded = ical.fold(line)
    parts = folded.split("\r\n")
    assert all(len(part.encode("utf-8")) <= 75 for part in parts)
    assert all(part.startswith(" ") for part in parts[1:])
    assert "".join(p[1:] if i else p for i, p in enumerate(parts)) == line


def test_a_short_line_is_left_alone():
    assert ical.fold("SUMMARY:Rent") == "SUMMARY:Rent"


def test_calendar_uses_crlf_all_day_dates_and_an_optional_alarm():
    event = ical.Event("x@y", dt.date(2026, 12, 31), "Bill due")
    now = dt.datetime(2026, 9, 28, 12, tzinfo=dt.UTC)
    body = ical.calendar([event], name="EE", now=now, alarm="Reminder")
    assert body.startswith("BEGIN:VCALENDAR\r\n") and body.endswith("END:VCALENDAR\r\n")
    assert "\n" not in body.replace("\r\n", "")
    assert "DTSTART;VALUE=DATE:20261231" in body
    assert "DTEND;VALUE=DATE:20270101" in body  # exclusive, across a year boundary
    assert "DTSTAMP:20260928T120000Z" in body
    assert "TRIGGER;RELATED=START:PT9H" in body
    assert "BEGIN:VALARM" not in ical.calendar([event], name="EE", now=now)


def test_service_layers_match_the_migration_check():
    from importlib import import_module

    migration = import_module("migrations.versions.0032_calendar_feed")
    assert migration._LAYERS == calendar_feed.LAYERS


# --------------------------------------------------------------------- the URL


def test_the_feed_is_off_until_turned_on(client, user_a):
    assert client.get("/api/calendar/feed", headers=user_a["headers"]).json()["on"] is False


def test_turning_on_shows_the_path_once_and_then_never_again(client, user_a):
    minted = _on(client, user_a)
    assert re.fullmatch(r"/api/calendar/feed/[A-Za-z0-9_-]{43}\.ics", minted["path"])
    assert minted["layers"] == ["due"] and minted["detailed"] is False

    read = client.get("/api/calendar/feed", headers=user_a["headers"]).json()
    assert read["on"] is True
    assert "path" not in read and minted["path"].split("/")[-1][:-4] not in str(read)


def test_turning_on_twice_is_refused_rather_than_minting_a_second_url(client, user_a):
    _on(client, user_a)
    again = client.post("/api/calendar/feed", headers=user_a["headers"])
    assert again.status_code == 422
    assert again.json()["code"] == "calendar_feed_exists"


def test_only_the_hash_is_stored(client, user_a, owner_engine):
    token = _on(client, user_a)["path"].split("/")[-1][:-4]
    with owner_engine.connect() as conn:
        stored = conn.execute(text("SELECT token_hash FROM calendar_feeds")).scalar_one()
    assert stored == hash_token(token) and token not in stored


def test_the_feed_answers_with_a_calendar(client, user_a):
    response = _fetch(client, _on(client, user_a)["path"])
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/calendar")
    assert response.headers["cache-control"].startswith("private")
    assert response.text.startswith("BEGIN:VCALENDAR")


def test_a_new_url_kills_the_old_one_at_once(client, user_a):
    old = _on(client, user_a)["path"]
    new = client.post("/api/calendar/feed/rotate", headers=user_a["headers"]).json()["path"]
    assert new != old
    assert _fetch(client, old).status_code == 404
    assert _fetch(client, new).status_code == 200


def test_turning_off_kills_the_url_and_is_idempotent(client, user_a):
    path = _on(client, user_a)["path"]
    assert client.delete("/api/calendar/feed", headers=user_a["headers"]).status_code == 204
    assert client.delete("/api/calendar/feed", headers=user_a["headers"]).status_code == 204
    assert _fetch(client, path).status_code == 404
    assert client.get("/api/calendar/feed", headers=user_a["headers"]).json()["on"] is False


@pytest.mark.parametrize(
    "path",
    [
        "/api/calendar/feed/" + "A" * 43 + ".ics",  # well-formed, unknown
        "/api/calendar/feed/short.ics",  # malformed
        "/api/calendar/feed/" + "A" * 42 + "!.ics",  # wrong alphabet
    ],
)
def test_every_wrong_url_is_the_same_404(client, path):
    response = _fetch(client, path)
    assert response.status_code == 404
    assert response.json()["detail"] == "Not Found"


def test_settings_need_a_signed_in_account(client):
    assert client.get("/api/calendar/feed").status_code == 401
    assert client.post("/api/calendar/feed").status_code == 401


def test_a_hammered_url_is_slowed_down(client, user_a):
    path = _on(client, user_a)["path"]
    for _ in range(30):
        assert _fetch(client, path).status_code == 200
    refused = _fetch(client, path)
    assert refused.status_code == 429
    assert int(refused.headers["retry-after"]) > 0


def test_last_fetched_is_recorded(client, user_a):
    path = _on(client, user_a)["path"]
    assert (
        client.get("/api/calendar/feed", headers=user_a["headers"]).json()["last_fetched_at"]
        is None
    )
    _fetch(client, path)
    assert client.get("/api/calendar/feed", headers=user_a["headers"]).json()["last_fetched_at"]


def test_the_token_never_reaches_the_access_log():
    from app.main import _MaskFeedToken

    assert any(
        isinstance(f, _MaskFeedToken) for f in logging.getLogger("uvicorn.access").filters
    ), "the mask must be attached to uvicorn's access logger, not merely defined"
    token = "A" * 43
    record = logging.LogRecord(
        "uvicorn.access",
        logging.INFO,
        __file__,
        1,
        '%s - "%s %s HTTP/%s" %d',
        ("1.2.3.4:5", "GET", f"/api/calendar/feed/{token}.ics", "1.1", 200),
        None,
    )
    _MaskFeedToken().filter(record)
    assert token not in record.getMessage()
    assert "/api/calendar/feed/***.ics" in record.getMessage()


# ------------------------------------------------------------------- isolation


def test_the_lookup_returns_one_owner_and_lists_nothing(client, user_a, runtime_connection):
    token = _on(client, user_a)["path"].split("/")[-1][:-4]
    with runtime_connection(None) as conn:
        owner = conn.execute(
            text("SELECT calendar_feed_lookup(:h)"), {"h": hash_token(token)}
        ).scalar_one()
        assert owner == user_a["id"]
        assert (
            conn.execute(
                text("SELECT calendar_feed_lookup(:h)"), {"h": hash_token("x")}
            ).scalar_one()
            is None
        )
        # No tenant: the table itself shows nothing (AD-3).
        assert conn.execute(text("SELECT count(*) FROM calendar_feeds")).scalar_one() == 0


def test_one_account_cannot_see_anothers_feed_row(client, user_a, user_b, runtime_connection):
    _on(client, user_a)
    with runtime_connection(user_b["id"]) as conn:
        assert conn.execute(text("SELECT count(*) FROM calendar_feeds")).scalar_one() == 0
    assert client.get("/api/calendar/feed", headers=user_b["headers"]).json()["on"] is False


def test_a_feed_carries_only_its_owners_rows(client, user_a, user_b):
    _weekly(client, user_a, start_on=TODAY + dt.timedelta(days=3), category="Alice rent")
    _weekly(client, user_b, start_on=TODAY + dt.timedelta(days=3), category="Bob rent")
    path = _on(client, user_b)["path"]
    _patch(client, user_b, {"detailed": True})
    body = _unfold(_fetch(client, path).text)
    assert "Bob rent" in body and "Alice rent" not in body


# ---------------------------------------------------------------------- layers


def test_bills_are_vague_by_default_and_detailed_on_request(client, user_a):
    _weekly(client, user_a, start_on=TODAY + dt.timedelta(days=3), amount="1200.00")
    path = _on(client, user_a)["path"]

    vague = _fetch(client, path).text
    assert "Bill due" in _summaries(vague)
    assert "1200" not in vague and "Rent" not in vague

    _patch(client, user_a, {"detailed": True})
    detailed = _unfold(_fetch(client, path).text)
    assert any(s.startswith("Rent · 1200.00") for s in _summaries(detailed))


def test_bill_uids_are_stable_across_fetches(client, user_a):
    _weekly(client, user_a, start_on=TODAY + dt.timedelta(days=3))
    path = _on(client, user_a)["path"]
    first = re.findall(r"^UID:(.*)$", _unfold(_fetch(client, path).text), flags=re.MULTILINE)
    second = re.findall(r"^UID:(.*)$", _unfold(_fetch(client, path).text), flags=re.MULTILINE)
    assert first and first == second
    assert all(uid.startswith("due-") for uid in first)


def test_the_window_ends_six_months_ahead(client, user_a):
    _weekly(client, user_a, start_on=TODAY + dt.timedelta(days=1))
    body = _fetch(client, _on(client, user_a)["path"]).text
    days = [
        dt.datetime.strptime(d, "%Y%m%d").date()
        for d in re.findall(r"DTSTART;VALUE=DATE:(\d{8})", body)
    ]
    window = calendar_feed.Window.around(TODAY)
    assert days and max(days) < window.end
    assert max(days) >= window.end - dt.timedelta(days=7)  # weekly: reaches the last week


def test_entries_layer_aggregates_one_event_per_day(client, user_a):
    category = client.post(
        "/api/categories", json={"name": "Food", "kind": "expense"}, headers=user_a["headers"]
    ).json()
    for amount in ("4.50", "5.50"):
        created = client.post(
            "/api/entries",
            json={
                "kind": "expense",
                "amount": amount,
                "occurred_on": TODAY.isoformat(),
                "category_id": category["id"],
            },
            headers=user_a["headers"],
        )
        assert created.status_code == 201, created.text
    path = _on(client, user_a)["path"]
    assert _patch(client, user_a, {"layers": ["money"]}).status_code == 200

    assert _summaries(_fetch(client, path).text) == ["2 entries"]
    _patch(client, user_a, {"detailed": True})
    assert _summaries(_fetch(client, path).text)[0].startswith("Spent 10.00")


def test_a_layer_whose_module_is_off_is_left_out(client, user_a):
    client.post(
        "/api/habits",
        json={"name": "Run", "schedule_kind": "daily", "target_count": 1},
        headers=user_a["headers"],
    )
    path = _on(client, user_a)["path"]
    _patch(client, user_a, {"layers": ["schedule"]})
    assert "1 habit to do" in _summaries(_fetch(client, path).text)

    client.patch(
        "/api/auth/me/preferences", json={"modules": {"habits": False}}, headers=user_a["headers"]
    )
    assert _summaries(_fetch(client, path).text) == []


def test_titles_follow_the_account_language(client, user_a):
    _weekly(client, user_a, start_on=TODAY + dt.timedelta(days=3))
    client.patch("/api/auth/me/language", json={"language": "fr"}, headers=user_a["headers"])
    body = _fetch(client, _on(client, user_a)["path"]).text
    assert "Paiement prévu" in _unfold(body)


def test_the_alarm_is_off_by_default_and_can_be_switched_on(client, user_a):
    _weekly(client, user_a, start_on=TODAY + dt.timedelta(days=3))
    path = _on(client, user_a)["path"]
    assert "VALARM" not in _fetch(client, path).text
    _patch(client, user_a, {"alarm": True})
    assert "BEGIN:VALARM" in _fetch(client, path).text


# ---------------------------------------------------------------- settings shape


def test_layers_are_stored_in_catalogue_order(client, user_a):
    _on(client, user_a)
    response = _patch(client, user_a, {"layers": ["meals", "due", "money"]})
    assert response.json()["layers"] == ["due", "money", "meals"]


@pytest.mark.parametrize(
    ("body", "code"),
    [
        ({"layers": ["weather"]}, "calendar_layer_unknown"),
        ({"layers": ["due", "due"]}, "calendar_layer_duplicate"),
        ({"detailed": "off"}, "validation"),
        ({"alarm": 1}, "validation"),
        ({"token_hash": "x"}, "validation"),
    ],
)
def test_a_bad_patch_is_refused(client, user_a, body, code):
    _on(client, user_a)
    response = _patch(client, user_a, body)
    assert response.status_code == 422
    assert response.json()["code"] == code


def test_changing_settings_needs_a_feed(client, user_a):
    response = _patch(client, user_a, {"detailed": True})
    assert response.status_code == 404
    assert client.post("/api/calendar/feed/rotate", headers=user_a["headers"]).status_code == 404


def test_a_deleted_account_takes_its_feed_with_it(client, user_a, owner_engine):
    _on(client, user_a)
    with owner_engine.begin() as conn:
        conn.execute(text("DELETE FROM users WHERE id = :id"), {"id": str(user_a["id"])})
        assert conn.execute(text("SELECT count(*) FROM calendar_feeds")).scalar_one() == 0
