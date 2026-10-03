"""The account's layout preferences (Epic 33, AD-49).

One ``jsonb`` column on ``users``, **sparse**: a key that is not stored means "the
default". So a card or a section added by a later epic appears for everyone without a data
migration, and the one function that fills the gaps is :func:`resolve`.

What is stored is what the client sent, validated here; what is returned is always
resolved, so the client never has to guess a default. Shape checks (types, lengths, the
two slot names) are the request schema's; everything that needs to know the catalogue
below — unknown ids, duplicates, completeness, the phone's caps — is here, with a code.
"""

import re
import unicodedata
import uuid
import zoneinfo

from sqlalchemy import bindparam, update
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session

from app.core.errors import Invalid
from app.models.user import User
from app.services.activity import MODULES as STREAK_MODULES

#: The eight sections, in their default order, with the slot each starts in. The first
#: five are the bottom tab bar on a phone (``.nav`` on a desktop); the last three are the
#: top bar (``.nav-extra``). Reproduces the app as it was before Epic 33.
SECTIONS: tuple[tuple[str, str], ...] = (
    ("dashboard", "bar"),
    ("entries", "bar"),
    ("habits", "bar"),
    ("stock", "bar"),
    ("gym", "bar"),
    ("plan", "top"),
    ("grow", "top"),
    ("recipes", "top"),
)

#: The budget itself. These can be moved, never switched off.
CORE_SECTIONS = frozenset({"dashboard", "entries", "plan", "grow"})

#: What can be switched off. Off hides the UI only; data and endpoints are untouched.
MODULES: tuple[str, ...] = (
    "habits", "books", "mood", "stock", "gym", "recipes", "notes", "moon", "clocks",
)

#: Which way the moon is drawn (Epic 47, AD-63 §4). Absent or null means "from the account's
#: time zone", which only the client works out.
MOON_HEMISPHERES: tuple[str, ...] = ("north", "south")

#: Epic 48 (AD-64): at most this many places besides the account's own zone.
CLOCKS_MAX = 12
#: A place's label, after trimming.
CLOCK_LABEL_MAX = 32
#: The default hours a clock is shaded by, until the person sets their own (Settings).
#: Each range is [start, end) in local wall time; end <= start wraps past midnight, and
#: start == end is an empty range.
CLOCK_HOURS_DEFAULT: dict[str, list[str]] = {
    "work": ["09:00", "18:00"],
    "night": ["23:00", "07:00"],
}

#: Dashboard cards in today's render order, all shown by default.
CARDS: tuple[str, ...] = (
    "stats",
    "streaks",
    "clocks",
    "gym",
    "pending",
    "leftover",
    "reading",
    "quote",
    "restock",
    "budgets",
    "savings",
    "trends",
    "categories",
)

LAYOUTS: tuple[str, ...] = ("phone", "desktop")

#: Streaks a person may show (Epic 41, AD-57): one per module streak, all **off** by
#: default so tab streaks stay optional. ``overall`` is not here: it is the dashboard card.
STREAKS: tuple[str, ...] = STREAK_MODULES

#: The person's name for points (Epic 41, AD-57): 1 to 24 characters once trimmed, shown
#: verbatim beside the number. Null or empty means the client's default label.
POINTS_NAME_MAX = 24
# Cs: a lone surrogate is valid in a Python str but not in JSON, and jsonb refuses it -> 500.
_REFUSED_CATEGORIES = frozenset({"Cc", "Cs", "Zl", "Zp"})
#: U+202A-U+202E (embeddings, overrides) and U+2066-U+2069 (isolates): clock labels only.
#: Also the bare direction marks U+200E, U+200F and U+061C, which reorder text the same way.
_BIDI_CONTROLS = frozenset(
    chr(c) for c in (*range(0x202A, 0x202F), *range(0x2066, 0x206A), 0x200E, 0x200F, 0x061C)
)
#: Characters that draw nothing although Unicode files them as letters or symbols: the
#: Hangul fillers and the blank Braille pattern. A label made only of these (or of spaces
#: and format characters) would be a place with an invisible name.
_BLANK_LOOKING = frozenset("ᅟᅠㅤﾠ⠀")

#: What the daily digest may talk about, and the default for each (Epic 36, AD-52). The
#: three that existed before stay on; the two new ones are opt-in, so the digest keeps
#: meaning "something is exceptional" for everyone who never opens Settings.
NOTIFICATIONS: tuple[tuple[str, bool], ...] = (
    ("stock", True),
    ("recurring", True),
    ("habits", True),
    ("due_tomorrow", False),
    ("savings", False),
    ("streak", False),
    ("moon", False),
)
_NOTIFICATION_DEFAULT = dict(NOTIFICATIONS)

#: The phone top bar's content box is 335px at a 375px viewport, and French is the wide
#: language (Epic 27). Five tabs and three top links are what was measured to fit.
PHONE_CAPS = {"bar": 5, "top": 3}

_SECTION_IDS = tuple(section_id for section_id, _ in SECTIONS)
_DEFAULT_SLOT = dict(SECTIONS)

#: Epic 52 (AD-65): every place the navigation can show — the eight sections and the five
#: views that used to hide behind chips and links — in their default order. On a phone the
#: pinned ones are the bottom bar, in list order, and the rest are in the More drawer; on a
#: desktop all are in the sidebar. The drawer and sidebar group them (the client's
#: ``nav/model.ts``) and keep list order within each group, so the default list leads with
#: the four pinned places in bar order.
NAV_ITEMS: tuple[str, ...] = (
    "dashboard", "entries", "habits", "plan",  # the bar
    "calendar", "books", "notes", "grow",
    "stock", "recipes", "gym",
    "clocks", "moon",
)
#: Pinned by default: the daily money-and-habits loop.
NAV_DEFAULT_PINNED: tuple[str, ...] = ("dashboard", "entries", "habits", "plan")
#: A phone's bottom bar holds this many pinned places plus More.
PHONE_PIN_CAP = 4


def _merge(stored: list[dict], catalogue: tuple[str, ...], make) -> list[dict]:
    """Stored order, minus ids that no longer exist, plus ids it lacks at their default place.

    A missing id is inserted after its nearest default predecessor that is already in the
    list, or first if it has none — so a card added after "reading" in a later epic lands
    after "reading" wherever the person moved it, instead of at the bottom.
    """
    known = set(catalogue)
    result: list[dict] = []
    seen: set[str] = set()
    for item in stored:
        item_id = item.get("id") if isinstance(item, dict) else None
        if item_id in known and item_id not in seen:
            result.append(item)
            seen.add(item_id)

    for index, item_id in enumerate(catalogue):
        if item_id in seen:
            continue
        position = 0
        for earlier in reversed(catalogue[:index]):
            if earlier in seen:
                position = next(i for i, it in enumerate(result) if it["id"] == earlier) + 1
                break
        result.insert(position, make(item_id))
        seen.add(item_id)
    return result


def _resolve_layout(name: str, stored: object) -> dict:
    layout = stored if isinstance(stored, dict) else {}
    tabs = _merge(
        [
            {"id": tab["id"], "slot": tab["slot"]}
            for tab in layout.get("tabs") or []
            if isinstance(tab, dict) and isinstance(tab.get("id"), str)
            and tab.get("slot") in ("bar", "top")
        ],
        _SECTION_IDS,
        lambda section_id: {"id": section_id, "slot": _DEFAULT_SLOT[section_id]},
    )
    cards = _merge(
        [
            {"id": card["id"], "on": card["on"]}
            for card in layout.get("cards") or []
            if isinstance(card, dict) and isinstance(card.get("id"), str)
            and isinstance(card.get("on"), bool)
        ],
        CARDS,
        lambda card_id: {"id": card_id, "on": True},
    )
    return {"tabs": tabs, "cards": cards, "items": _resolve_items(name, layout, tabs)}


def _default_items() -> list[dict]:
    return [{"id": item_id, "pinned": item_id in NAV_DEFAULT_PINNED} for item_id in NAV_ITEMS]


def _resolve_items(name: str, layout: dict, tabs: list[dict]) -> list[dict]:
    """The stored ``items`` merged with the catalogue; or, for a layout saved before Epic 52,
    derived from its ``tabs``: the first four bar tabs (in their order) stay pinned, and
    everything else follows in the default order. An account that never customised its tabs
    gets the new default rather than a copy of the old five-tab bar."""
    stored = layout.get("items")
    if isinstance(stored, list):
        clean = [
            {"id": item["id"], "pinned": item["pinned"]}
            for item in stored
            if isinstance(item, dict) and isinstance(item.get("id"), str)
            and isinstance(item.get("pinned"), bool)
        ]
        items = _merge(clean, NAV_ITEMS, lambda item_id: {"id": item_id, "pinned": False})
        # A phone's stored list that pins more than a bar holds (an older rule, a hand edit)
        # keeps the first four; reading never refuses. A desktop ignores `pinned`, and the
        # write path accepts any number there, so it is read back as it was written.
        seen = 0
        for item in items:
            if name == "phone" and item["pinned"]:
                seen += 1
                if seen > PHONE_PIN_CAP:
                    item["pinned"] = False
        return items
    raw_tabs = layout.get("tabs")
    # Only a tab list that held at least one readable tab says anything about the bar; an
    # empty or unreadable one is "never customised", as if it were absent.
    readable = isinstance(raw_tabs, list) and any(
        isinstance(tab, dict) and isinstance(tab.get("id"), str)
        and tab.get("slot") in ("bar", "top")
        for tab in raw_tabs
    )
    if not readable:
        return _default_items()
    pinned = [tab["id"] for tab in tabs if tab["slot"] == "bar"][:PHONE_PIN_CAP]
    rest = [item_id for item_id in NAV_ITEMS if item_id not in pinned]
    return [{"id": i, "pinned": True} for i in pinned] + [{"id": i, "pinned": False} for i in rest]


def clean_points_name(raw: str) -> str:
    """Trimmed, with no control characters; raises ``ValueError`` (a pydantic validator may
    raise nothing else) when longer than :data:`POINTS_NAME_MAX`. Empty is allowed: it
    means "use the default"."""
    name = raw.strip()
    if len(name) > POINTS_NAME_MAX:
        raise ValueError(f"at most {POINTS_NAME_MAX} characters")
    # Only control and line/paragraph separators: `isprintable()` would also refuse a
    # zero-width joiner (emoji sequences) and a no-break space (French typography).
    if any(unicodedata.category(c) in _REFUSED_CATEGORIES for c in name):
        raise ValueError("no control characters")
    return name


def _resolve_points_name(stored: object) -> str | None:
    """The stored name, or None (the default) for anything that is not a usable one. Read,
    never refused: a value from an older rule must not break ``/me``."""
    if not isinstance(stored, str):
        return None
    try:
        return clean_points_name(stored) or None
    except ValueError:
        return None


def resolve(stored: object) -> dict:
    """The full preferences for a stored value, defaults filled in. Never raises: a stored
    value from an older catalogue is read, not refused."""
    prefs = stored if isinstance(stored, dict) else {}
    modules = prefs.get("modules") if isinstance(prefs.get("modules"), dict) else {}
    kinds = prefs.get("notifications") if isinstance(prefs.get("notifications"), dict) else {}
    shown = prefs.get("streaks") if isinstance(prefs.get("streaks"), dict) else {}
    return {
        "modules": {
            module: modules[module] if isinstance(modules.get(module), bool) else True
            for module in MODULES
        },
        "notifications": {
            kind: kinds[kind] if isinstance(kinds.get(kind), bool) else default
            for kind, default in NOTIFICATIONS
        },
        "streaks": {
            streak: shown[streak] if isinstance(shown.get(streak), bool) else False
            for streak in STREAKS
        },
        "points_name": _resolve_points_name(prefs.get("points_name")),
        "moon_hemisphere": (
            prefs["moon_hemisphere"] if prefs.get("moon_hemisphere") in MOON_HEMISPHERES else None
        ),
        "clocks": _resolve_clocks(prefs.get("clocks")),
        "clock_hours": _resolve_hours(prefs.get("clock_hours")) or CLOCK_HOURS_DEFAULT,
        "calendar_zone": (
            prefs["calendar_zone"]
            if isinstance(prefs.get("calendar_zone"), str) and is_zone(prefs["calendar_zone"])
            else None
        ),
        **{layout: _resolve_layout(layout, prefs.get(layout)) for layout in LAYOUTS},
    }


#: A wall-clock time on the 15-minute grid the clocks' slider moves on.
HHMM = re.compile(r"^(?:[01]\d|2[0-3]):(?:00|15|30|45)$")


def is_zone(name: str) -> bool:
    """A zone this server's tz database knows (the ``check_timezone`` rule, as a bool)."""
    try:
        zoneinfo.ZoneInfo(name)
    except (zoneinfo.ZoneInfoNotFoundError, ValueError):
        return False
    return True


def clean_clock_label(raw: str) -> str:
    """Trimmed, 1-32 characters, no control characters. Raises ``ValueError`` only."""
    label = raw.strip()
    if not 1 <= len(label) <= CLOCK_LABEL_MAX:
        raise ValueError(f"between 1 and {CLOCK_LABEL_MAX} characters")
    if any(unicodedata.category(c) in _REFUSED_CATEGORIES for c in label):
        raise ValueError("no control characters")
    # Bidi overrides and isolates (Cf) can make a label read as another one; the zero-width
    # joiner stays allowed, emoji sequences need it.
    if any(c in _BIDI_CONTROLS for c in label):
        raise ValueError("no direction-control characters")
    if not any(_visible(c) for c in label):
        raise ValueError("at least one visible character")
    return label


def _visible(c: str) -> bool:
    """Does this character draw something? Spaces, format characters (Cf) and the blank
    fillers do not."""
    return not (c.isspace() or unicodedata.category(c) == "Cf" or c in _BLANK_LOOKING)


def _resolve_hours(stored: object) -> dict | None:
    """A stored hours object if both ranges are well formed, else None. Read, never refused."""
    if not isinstance(stored, dict):
        return None
    hours = {}
    for key in ("work", "night"):
        pair = stored.get(key)
        if not (
            isinstance(pair, list)
            and len(pair) == 2
            and all(isinstance(v, str) and HHMM.match(v) for v in pair)
        ):
            return None
        hours[key] = list(pair)
    return hours


def _resolve_clocks(stored: object) -> list[dict]:
    """Stored places in stored order, skipping any that no longer resolve (a zone gone from
    the tz database, a malformed row, a repeated id) rather than failing ``/me``."""
    if not isinstance(stored, list):
        return []
    places: list[dict] = []
    seen: set[str] = set()
    for item in stored:
        if not isinstance(item, dict):
            continue
        place_id, zone, label = item.get("id"), item.get("zone"), item.get("label")
        if not (isinstance(place_id, str) and isinstance(zone, str) and isinstance(label, str)):
            continue
        if place_id in seen or not is_zone(zone):
            continue
        try:
            label = clean_clock_label(label)
        except ValueError:
            continue
        seen.add(place_id)
        places.append(
            {
                "id": place_id,
                "zone": zone,
                "label": label,
                "hours": _resolve_hours(item.get("hours")),
            }
        )
        if len(places) == CLOCKS_MAX:
            break
    return places


def _no_duplicates(ids: list[str], what: str) -> None:
    seen: set[str] = set()
    for item_id in ids:
        if item_id in seen:
            raise Invalid(f"{what} {item_id!r} is listed twice", "pref_duplicate")
        seen.add(item_id)


def _check_modules(modules: dict[str, bool]) -> None:
    for module in modules:
        if module in CORE_SECTIONS:
            raise Invalid(f"{module!r} is part of the budget and cannot be turned off",
                          "pref_core_module")
        if module not in MODULES:
            raise Invalid(f"no module called {module!r}", "pref_unknown_id")


def _check_notifications(kinds: dict[str, bool]) -> None:
    for kind in kinds:
        if kind not in _NOTIFICATION_DEFAULT:
            raise Invalid(f"no notification called {kind!r}", "pref_unknown_id")


def _check_streaks(shown: dict[str, bool]) -> None:
    for streak in shown:
        if streak not in STREAKS:
            raise Invalid(f"no streak called {streak!r}", "pref_unknown_id")


def _check_layout(name: str, layout: dict) -> None:
    items = layout.get("items")
    if items is not None:
        ids = [item["id"] for item in items]
        for item_id in ids:
            if item_id not in NAV_ITEMS:
                raise Invalid(f"no place called {item_id!r}", "pref_unknown_id")
        _no_duplicates(ids, "place")
        # Complete for the same reason as the tabs: nowhere to reach a place it left out.
        if len(ids) != len(NAV_ITEMS):
            raise Invalid("the list must name every place once", "pref_incomplete")
        if name == "phone" and sum(item["pinned"] for item in items) > PHONE_PIN_CAP:
            raise Invalid(f"a phone's bar holds at most {PHONE_PIN_CAP}", "pref_slot_full")
    tabs = layout.get("tabs")
    if tabs is not None:
        ids = [tab["id"] for tab in tabs]
        for section_id in ids:
            if section_id not in _DEFAULT_SLOT:
                raise Invalid(f"no section called {section_id!r}", "pref_unknown_id")
        _no_duplicates(ids, "section")
        # Complete, unlike the cards: a tab list that dropped a section would leave it
        # nowhere to be reached, and "hide" is what modules are for.
        if len(ids) != len(_SECTION_IDS):
            raise Invalid("the tab list must name every section once", "pref_incomplete")
        if name == "phone":
            for slot, cap in PHONE_CAPS.items():
                if sum(tab["slot"] == slot for tab in tabs) > cap:
                    raise Invalid(f"a phone fits at most {cap} in the {slot}", "pref_slot_full")

    cards = layout.get("cards")
    if cards is not None:
        ids = [card["id"] for card in cards]
        for card_id in ids:
            if card_id not in CARDS:
                raise Invalid(f"no dashboard card called {card_id!r}", "pref_unknown_id")
        _no_duplicates(ids, "card")


def validate(patch: dict) -> None:
    """Refuse, with a code, anything the catalogue does not allow. ``patch`` holds only
    the top-level keys the request sent, already shape-checked by the schema."""
    if "modules" in patch:
        _check_modules(patch["modules"])
    if "notifications" in patch:
        _check_notifications(patch["notifications"])
    if "streaks" in patch:
        _check_streaks(patch["streaks"])
    if "clocks" in patch:
        _check_clocks(patch["clocks"])
    if patch.get("calendar_zone") is not None:
        _check_zone(patch["calendar_zone"])
    for layout in LAYOUTS:
        if layout in patch:
            _check_layout(layout, patch[layout])


def _check_zone(name: str) -> None:
    if not is_zone(name):
        raise Invalid(f"{name!r} is not a time zone this server knows", "invalid_timezone")


def _check_clocks(places: list[dict]) -> None:
    """Epic 48 (AD-64). Shape (lengths, the HH:MM grid, the cap) is the schema's; here, that
    each zone is one this server knows and that no id is listed twice."""
    for place in places:
        _check_zone(place["zone"])
    _no_duplicates([place["id"] for place in places], "clock")


def update_preferences(session: Session, user_id: uuid.UUID, patch: dict) -> None:
    """Replace each top-level key the patch carries; leave the others as stored.

    One ``UPDATE ... SET preferences = preferences || :patch``, not a read-modify-write:
    two tabs saving ``modules`` and ``phone`` at the same moment both land. Refusals are
    raised before anything is written.
    """
    validate(patch)
    if not patch:
        return
    session.execute(
        update(User)
        .where(User.id == user_id)
        .values(preferences=User.preferences.op("||")(bindparam("patch", patch, type_=JSONB)))
    )
    session.flush()
