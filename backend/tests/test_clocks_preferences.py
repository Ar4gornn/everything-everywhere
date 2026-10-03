"""Epic 48 (AD-64) — the clocks' three preferences keys: `clocks`, `clock_hours`,
`calendar_zone`. Written whole by a PATCH, resolved on read (a bad stored row is dropped,
never a 500 on `/me`), checked against the server's tz database on write.
"""

import json

import pytest
from sqlalchemy import text

DEFAULT_HOURS = {"work": ["09:00", "18:00"], "night": ["23:00", "07:00"]}


def _place(place_id="p1", zone="America/New_York", label="Home town", hours=None):
    return {"id": place_id, "zone": zone, "label": label, "hours": hours}


def _prefs(client, user):
    return client.get("/api/auth/me", headers=user["headers"]).json()["preferences"]


def _patch(client, user, body):
    return client.patch("/api/auth/me/preferences", json=body, headers=user["headers"])


def _store(owner_engine, user, preferences):
    """Write a raw stored value, as an older or hand-edited row could hold it."""
    with owner_engine.begin() as conn:
        conn.execute(
            text("UPDATE users SET preferences = CAST(:p AS jsonb) WHERE id = :id"),
            {"p": json.dumps(preferences), "id": user["id"]},
        )


# --- defaults and the round trip ---------------------------------------------------------


def test_a_new_account_has_no_places_and_the_default_hours(client, user_a):
    prefs = _prefs(client, user_a)
    assert prefs["clocks"] == []
    assert prefs["clock_hours"] == DEFAULT_HOURS
    assert prefs["calendar_zone"] is None
    assert prefs["modules"]["clocks"] is True
    cards = [card["id"] for card in prefs["phone"]["cards"]]
    assert cards.index("clocks") == cards.index("streaks") + 1


def test_places_round_trip_in_the_persons_order(client, user_a):
    mine = {"work": ["08:00", "16:30"], "night": ["22:15", "06:45"]}
    places = [
        _place("b", "Asia/Kolkata", "Office", hours=mine),
        _place("a", "America/New_York", "Home town"),
    ]
    answer = _patch(client, user_a, {"clocks": places})
    assert answer.status_code == 200, answer.text
    assert answer.json()["preferences"]["clocks"] == places
    assert _prefs(client, user_a)["clocks"] == places


def test_a_label_is_trimmed(client, user_a):
    answer = _patch(client, user_a, {"clocks": [_place(label="  Paris  ")]})
    assert answer.json()["preferences"]["clocks"][0]["label"] == "Paris"


def test_hours_round_trip_and_the_other_keys_are_left_alone(client, user_a):
    hours = {"work": ["10:00", "19:45"], "night": ["00:00", "08:00"]}
    _patch(client, user_a, {"clocks": [_place()], "calendar_zone": "Asia/Tokyo"})
    answer = _patch(client, user_a, {"clock_hours": hours})
    assert answer.status_code == 200, answer.text
    prefs = answer.json()["preferences"]
    assert prefs["clock_hours"] == hours
    assert prefs["clocks"] == [_place()]
    assert prefs["calendar_zone"] == "Asia/Tokyo"


def test_a_wrapping_and_an_empty_range_are_stored_as_sent(client, user_a):
    hours = {"work": ["09:00", "09:00"], "night": ["23:00", "07:00"]}
    assert _patch(client, user_a, {"clock_hours": hours}).status_code == 200
    assert _prefs(client, user_a)["clock_hours"] == hours


# --- refusals ----------------------------------------------------------------------------


def test_twelve_places_fit_and_thirteen_do_not(client, user_a):
    twelve = [_place(f"p{i}") for i in range(12)]
    assert _patch(client, user_a, {"clocks": twelve}).status_code == 200
    answer = _patch(client, user_a, {"clocks": [*twelve, _place("p12")]})
    assert answer.status_code == 422
    assert len(_prefs(client, user_a)["clocks"]) == 12


@pytest.mark.parametrize("zone", ["Mars/Olympus", "../etc/passwd", "Not A Zone"])
def test_an_unknown_zone_is_invalid_timezone(client, user_a, zone):
    answer = _patch(client, user_a, {"clocks": [_place(zone=zone)]})
    assert answer.status_code == 422, answer.text
    assert answer.json()["code"] == "invalid_timezone"
    assert _prefs(client, user_a)["clocks"] == []


def test_an_unknown_calendar_zone_is_invalid_timezone(client, user_a):
    answer = _patch(client, user_a, {"calendar_zone": "Mars/Olympus"})
    assert answer.status_code == 422
    assert answer.json()["code"] == "invalid_timezone"


def test_a_repeated_id_is_pref_duplicate(client, user_a):
    answer = _patch(client, user_a, {"clocks": [_place("x"), _place("x", "Asia/Tokyo")]})
    assert answer.status_code == 422
    assert answer.json()["code"] == "pref_duplicate"


@pytest.mark.parametrize(
    "label",
    ["", "   ", "x" * 33, "bad\x00label", "tab\there", "line\nbreak", "esc\x1b"],
)
def test_a_bad_label_is_a_422(client, user_a, label):
    answer = _patch(client, user_a, {"clocks": [_place(label=label)]})
    assert answer.status_code == 422, answer.text


def test_a_label_of_exactly_32_characters_is_fine(client, user_a):
    assert _patch(client, user_a, {"clocks": [_place(label="x" * 32)]}).status_code == 200


@pytest.mark.parametrize("bad", ["09:10", "24:00", "9:00", "09:00:00", "ab:cd", "23:60", ""])
def test_hours_off_the_grid_are_a_422(client, user_a, bad):
    answer = _patch(
        client, user_a, {"clock_hours": {"work": [bad, "18:00"], "night": ["23:00", "07:00"]}}
    )
    assert answer.status_code == 422, answer.text
    assert _prefs(client, user_a)["clock_hours"] == DEFAULT_HOURS


def test_a_places_own_hours_are_checked_too(client, user_a):
    bad = {"work": ["09:10", "18:00"], "night": ["23:00", "07:00"]}
    assert _patch(client, user_a, {"clocks": [_place(hours=bad)]}).status_code == 422


@pytest.mark.parametrize(
    "body",
    [
        {"clock_hours": {"work": ["09:00", "18:00"]}},
        {"clock_hours": {"work": ["09:00"], "night": ["23:00", "07:00"]}},
        {"clock_hours": {**DEFAULT_HOURS, "extra": ["01:00", "02:00"]}},
        {"clocks": [{"id": "p1", "zone": "Asia/Tokyo"}]},
        {"clocks": [{**_place(), "colour": "red"}]},
        {"clocks": [_place(place_id="has space")]},
        {"clocks": [_place(place_id="")]},
        {"clocks": [_place(place_id="x" * 41)]},
        {"clocks": "Asia/Tokyo"},
    ],
)
def test_the_shape_is_the_schemas(client, user_a, body):
    answer = _patch(client, user_a, body)
    assert answer.status_code == 422
    assert answer.json()["code"] == "validation"


# --- calendar_zone: set, cleared by an explicit null, kept when absent -------------------


def test_the_calendar_zone_is_set_cleared_by_null_and_kept_when_absent(client, user_a):
    answer = _patch(client, user_a, {"calendar_zone": "Asia/Tokyo"})
    assert answer.status_code == 200, answer.text
    assert answer.json()["preferences"]["calendar_zone"] == "Asia/Tokyo"

    # A PATCH that does not name it leaves it.
    assert _patch(client, user_a, {"modules": {"gym": False}}).status_code == 200
    assert _prefs(client, user_a)["calendar_zone"] == "Asia/Tokyo"

    cleared = _patch(client, user_a, {"calendar_zone": None})
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["preferences"]["calendar_zone"] is None
    assert _prefs(client, user_a)["calendar_zone"] is None


# --- resolved on read --------------------------------------------------------------------


def test_stored_junk_is_dropped_on_read_not_a_500(client, user_a, owner_engine):
    good = _place("ok", "Europe/Paris", "Paris")
    _store(
        owner_engine,
        user_a,
        {
            "clocks": [
                "not a dict",
                {"id": "no-zone", "label": "x"},
                {"id": 5, "zone": "Asia/Tokyo", "label": "numeric id"},
                {"id": "gone", "zone": "Mars/Olympus", "label": "Mars"},
                {"id": "badlabel", "zone": "Asia/Tokyo", "label": "   "},
                good | {"hours": None},
                {"id": "ok", "zone": "Asia/Tokyo", "label": "same id again"},
                {
                    "id": "badhours",
                    "zone": "Asia/Tokyo",
                    "label": "Tokyo",
                    "hours": {"work": ["09:10", "18:00"], "night": ["23:00", "07:00"]},
                },
            ],
            "clock_hours": {"work": ["09:10", "18:00"], "night": ["23:00", "07:00"]},
            "calendar_zone": "Mars/Olympus",
        },
    )
    answer = client.get("/api/auth/me", headers=user_a["headers"])
    assert answer.status_code == 200, answer.text
    prefs = answer.json()["preferences"]
    assert prefs["clocks"] == [
        good | {"hours": None},
        # Kept: only its malformed hours are dropped, so it reads as "the default hours".
        {"id": "badhours", "zone": "Asia/Tokyo", "label": "Tokyo", "hours": None},
    ]
    assert prefs["clock_hours"] == DEFAULT_HOURS
    assert prefs["calendar_zone"] is None


def test_stored_values_that_are_the_wrong_type_fall_back_to_defaults(client, user_a, owner_engine):
    _store(owner_engine, user_a, {"clocks": "Asia/Tokyo", "clock_hours": [], "calendar_zone": 7})
    prefs = _prefs(client, user_a)
    assert prefs["clocks"] == []
    assert prefs["clock_hours"] == DEFAULT_HOURS
    assert prefs["calendar_zone"] is None


def test_more_than_twelve_stored_places_read_back_as_twelve(client, user_a, owner_engine):
    _store(
        owner_engine,
        user_a,
        {"clocks": [{"id": f"p{i}", "zone": "Asia/Tokyo", "label": f"P{i}"} for i in range(20)]},
    )
    assert len(_prefs(client, user_a)["clocks"]) == 12


# --- tenancy -----------------------------------------------------------------------------


def test_one_accounts_clocks_never_touch_anothers(client, user_a, user_b):
    assert (
        _patch(client, user_a, {"clocks": [_place()], "calendar_zone": "Asia/Tokyo"}).status_code
        == 200
    )
    theirs = _prefs(client, user_b)
    assert theirs["clocks"] == []
    assert theirs["calendar_zone"] is None
    assert theirs["clock_hours"] == DEFAULT_HOURS

    assert (
        _patch(client, user_b, {"clocks": [_place("q", "Asia/Tokyo", "Tokyo")]}).status_code == 200
    )
    assert _prefs(client, user_a)["clocks"] == [_place()]
