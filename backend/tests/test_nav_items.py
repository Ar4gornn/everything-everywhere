"""Epic 52 (AD-65) — a layout's `items`: every place once, and whether it is pinned to a
phone's bottom bar. Stored sparse, resolved on read (never a 500), refused on write with the
same codes as `tabs`. A layout saved before Epic 52 has only `tabs`; its first four bar tabs
become the pinned places, and a client that still writes `tabs` is still accepted.
"""

import json

import pytest
from sqlalchemy import text

PLACES = [
    "dashboard", "entries", "habits", "plan", "calendar", "books", "notes", "grow",
    "stock", "recipes", "gym", "clocks", "moon",
]
DEFAULT_PINNED = ["dashboard", "entries", "habits", "plan"]
DEFAULT_ITEMS = [{"id": p, "pinned": p in DEFAULT_PINNED} for p in PLACES]

OLD_TABS = [
    {"id": "dashboard", "slot": "bar"},
    {"id": "entries", "slot": "bar"},
    {"id": "habits", "slot": "bar"},
    {"id": "stock", "slot": "bar"},
    {"id": "gym", "slot": "bar"},
    {"id": "plan", "slot": "top"},
    {"id": "grow", "slot": "top"},
    {"id": "recipes", "slot": "top"},
]


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


def _items(pinned):
    """Every place once: `pinned` first in that order, the rest after in default order."""
    rest = [p for p in PLACES if p not in pinned]
    return [{"id": p, "pinned": True} for p in pinned] + [{"id": p, "pinned": False} for p in rest]


def _ids(items):
    return [i["id"] for i in items]


def _pinned(items):
    return [i["id"] for i in items if i["pinned"]]


# --- defaults and migration --------------------------------------------------------------


def test_a_new_account_has_the_four_pinned_default(client):
    created = client.post(
        "/api/auth/register",
        json={"email": "nav@example.com", "password": "correct-horse-battery"},
    )
    assert created.status_code == 201
    prefs = created.json()["preferences"]
    assert prefs["phone"]["items"] == DEFAULT_ITEMS
    assert prefs["desktop"]["items"] == DEFAULT_ITEMS


def test_a_customised_tabs_layout_keeps_its_first_four_bar_tabs(client, user_a, owner_engine):
    """The read-time migration: no `items` stored, a bar the person arranged — the first four
    bar tabs, in their order, stay pinned; every other place follows in default order."""
    tabs = [
        {"id": "gym", "slot": "bar"},
        {"id": "stock", "slot": "bar"},
        {"id": "dashboard", "slot": "bar"},
        {"id": "entries", "slot": "bar"},
        {"id": "habits", "slot": "bar"},  # the fifth: not pinned
        {"id": "plan", "slot": "top"},
        {"id": "grow", "slot": "top"},
        {"id": "recipes", "slot": "top"},
    ]
    _store(owner_engine, user_a, {"phone": {"tabs": tabs}})
    items = _prefs(client, user_a)["phone"]["items"]
    assert _pinned(items) == ["gym", "stock", "dashboard", "entries"]
    assert items == _items(["gym", "stock", "dashboard", "entries"])
    # The other layout was never customised: the new default, not a copy of the old bar.
    assert _prefs(client, user_a)["desktop"]["items"] == DEFAULT_ITEMS


def test_a_layout_saved_with_only_tabs_before_epic_52_still_reads(client, user_a, owner_engine):
    _store(owner_engine, user_a, {"desktop": {"tabs": OLD_TABS}})
    assert _pinned(_prefs(client, user_a)["desktop"]["items"]) == [
        "dashboard", "entries", "habits", "stock",
    ]


def test_stored_items_are_merged_with_a_place_they_lack(client, user_a, owner_engine):
    """A place added in a later epic is inserted at its default position, unpinned, and the
    person's own order and pins are kept."""
    stored = [
        {"id": "gym", "pinned": True},
        {"id": "dashboard", "pinned": True},
        {"id": "moon", "pinned": False},
        {"id": "plan", "pinned": False},
    ]
    _store(owner_engine, user_a, {"phone": {"items": stored}})
    items = _prefs(client, user_a)["phone"]["items"]
    assert sorted(_ids(items)) == sorted(PLACES), "every place exactly once"
    assert [i for i in items if i in stored] == stored, "their order and pins, untouched"
    ids = _ids(items)
    # "entries" is missing: unpinned, straight after its default predecessor "dashboard".
    assert items[ids.index("dashboard") + 1] == {"id": "entries", "pinned": False}
    # "clocks" is missing too: straight after "gym", its default predecessor.
    assert items[ids.index("gym") + 1] == {"id": "clocks", "pinned": False}


def test_stored_items_win_over_stored_tabs(client, user_a, owner_engine):
    _store(owner_engine, user_a, {"phone": {"tabs": OLD_TABS, "items": _items(["moon", "clocks"])}})
    assert _pinned(_prefs(client, user_a)["phone"]["items"]) == ["moon", "clocks"]


def test_unreadable_tabs_are_not_a_customised_bar(client, user_a, owner_engine):
    """Garbage in `tabs` says nothing about the bar: the default, not the first four of a
    tab list rebuilt from nothing."""
    _store(owner_engine, user_a, {"phone": {"tabs": [1, {"id": 3}, {"id": "gym", "slot": "side"}]}})
    assert _prefs(client, user_a)["phone"]["items"] == DEFAULT_ITEMS


# --- the write path ----------------------------------------------------------------------


def test_items_round_trip_in_the_persons_order(client, user_a):
    mine = _items(["notes", "moon", "dashboard"])
    answer = _patch(client, user_a, {"phone": {"items": mine}})
    assert answer.status_code == 200, answer.text
    assert answer.json()["preferences"]["phone"]["items"] == mine
    assert _prefs(client, user_a)["phone"]["items"] == mine
    assert _prefs(client, user_a)["desktop"]["items"] == DEFAULT_ITEMS


def test_a_phone_may_pin_four_but_not_five(client, user_a):
    assert _patch(client, user_a, {"phone": {"items": _items(PLACES[:4])}}).status_code == 200
    answer = _patch(client, user_a, {"phone": {"items": _items(PLACES[:5])}})
    assert answer.status_code == 422, answer.text
    assert answer.json()["code"] == "pref_slot_full"


def test_a_desktop_accepts_all_thirteen_pinned(client, user_a):
    everything = _items(PLACES)
    answer = _patch(client, user_a, {"desktop": {"items": everything}})
    assert answer.status_code == 200, answer.text
    assert answer.json()["preferences"]["desktop"]["items"] == everything


def test_a_stored_overfull_bar_reads_with_the_first_four(client, user_a, owner_engine):
    """Reading never refuses: a phone list pinning more than a bar holds keeps the first four;
    a desktop's `pinned` is ignored, so it is read as written."""
    _store(owner_engine, user_a, {"phone": {"items": _items(PLACES[:7])},
                                  "desktop": {"items": _items(PLACES[:7])}})
    prefs = _prefs(client, user_a)
    assert _pinned(prefs["phone"]["items"]) == PLACES[:4]
    assert _pinned(prefs["desktop"]["items"]) == PLACES[:7]


@pytest.mark.parametrize(
    ("items", "code"),
    [
        ([*DEFAULT_ITEMS[:-1], {"id": "chess", "pinned": False}], "pref_unknown_id"),
        ([*DEFAULT_ITEMS, DEFAULT_ITEMS[0]], "pref_duplicate"),
        (DEFAULT_ITEMS[:-1], "pref_incomplete"),
        ([], "pref_incomplete"),
    ],
)
def test_the_catalogue_refuses_with_a_code(client, user_a, items, code):
    for layout in ("phone", "desktop"):
        answer = _patch(client, user_a, {layout: {"items": items}})
        assert answer.status_code == 422, answer.text
        assert answer.json()["code"] == code


@pytest.mark.parametrize(
    "body",
    [
        {"phone": {"items": [{"id": "dashboard", "pinned": "yes"}]}},
        {"phone": {"items": [{"id": "dashboard"}]}},
        {"phone": {"items": [{"id": "dashboard", "pinned": True, "x": 1}]}},
        {"phone": {"items": [{"id": "x" * 33, "pinned": True}]}},
        {"phone": {"items": [{"id": "dashboard", "pinned": True}] * 33}},
    ],
)
def test_the_shape_is_the_schemas(client, user_a, body):
    answer = _patch(client, user_a, body)
    assert answer.status_code == 422
    assert answer.json()["code"] == "validation"


def test_a_refusal_writes_nothing(client, user_a):
    answer = _patch(client, user_a, {"phone": {"items": _items(PLACES[:5])}})
    assert answer.status_code == 422
    assert _prefs(client, user_a)["phone"]["items"] == DEFAULT_ITEMS


# --- an installed app that has not updated -----------------------------------------------


def test_an_old_client_writing_only_tabs_is_accepted_and_items_still_resolve(client, user_a):
    moved = [
        {**tab, "slot": "bar"} if tab["id"] == "plan" else tab for tab in OLD_TABS
    ]
    moved = [t for t in moved if t["id"] != "gym"] + [{"id": "gym", "slot": "top"}]
    answer = _patch(client, user_a, {"phone": {"tabs": moved}})
    assert answer.status_code == 200, answer.text
    items = answer.json()["preferences"]["phone"]["items"]
    assert sorted(_ids(items)) == sorted(PLACES)
    # `tabs` is written and read back whole, and `items` follow them.
    assert answer.json()["preferences"]["phone"]["tabs"] == moved
    assert _pinned(items) == ["dashboard", "entries", "habits", "stock"]


def test_tabs_and_items_may_be_sent_together(client, user_a):
    answer = _patch(client, user_a, {"phone": {"tabs": OLD_TABS, "items": _items(["notes"])}})
    assert answer.status_code == 200, answer.text
    prefs = answer.json()["preferences"]["phone"]
    assert prefs["tabs"] == OLD_TABS
    assert _pinned(prefs["items"]) == ["notes"]


# --- reading never fails -----------------------------------------------------------------


@pytest.mark.parametrize(
    "stored",
    [
        "x",
        [1, 2],
        {"id": "dashboard"},
        [{"id": "dashboard"}],
        [{"id": "dashboard", "pinned": "yes"}, {"id": 3, "pinned": True}, None, "x"],
        [{"id": "chess", "pinned": True}],
        [{"id": "dashboard", "pinned": True}] * 20,
    ],
)
def test_malformed_stored_items_read_without_a_500(client, user_a, owner_engine, stored):
    _store(owner_engine, user_a, {"phone": {"items": stored}, "desktop": {"items": stored}})
    answer = client.get("/api/auth/me", headers=user_a["headers"])
    assert answer.status_code == 200, answer.text
    for layout in ("phone", "desktop"):
        items = answer.json()["preferences"][layout]["items"]
        assert sorted(_ids(items)) == sorted(PLACES), "every place exactly once"
        assert all(isinstance(i["pinned"], bool) for i in items)
        assert len(_pinned(items)) <= 4
