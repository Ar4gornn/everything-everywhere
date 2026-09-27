"""The calendar feed: a secret URL a calendar app subscribes to (Epic 39, AD-55).

Two halves:

* **The feed row** — create, rotate, change, turn off. The token is shown once, when it is
  minted, and stored only as its SHA-256; nothing can show it again.
* **The feed itself** — every chosen layer's dated rows, read through each module's own
  service function and turned into all-day events. The web calendar composes its layers in
  the browser (AD-31, AD-37); a calendar app cannot, so this module is the one place the
  server composes them. It calls module services and never joins across modules.

Events are one per layer per day, except bills: a day with eleven entries is one "11
entries" event rather than eleven, and a bill is its own event because each one is a thing
to pay. UIDs are stable — ``<layer>-<day>`` or ``due-<template>-<day>`` — so a change in EE
updates the event in place rather than adding a second one, and a forecast bill keeps its
UID when it becomes a pending one.

Titles are written here, in the account's language. AD-44 says the client owns every
displayed word; like the push digest, a feed has no client to translate it, so this is the
second place the server writes prose.
"""

import datetime as dt
import secrets
import uuid
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import func, select, text, update
from sqlalchemy.orm import Session

from app.core import ical
from app.core.errors import Invalid, NotFound
from app.core.months import add_months, format_month
from app.core.schedule import Schedule, is_scheduled
from app.models.calendar import CalendarFeed
from app.models.gym import Routine
from app.models.ledger import Category, EntryKind
from app.models.savings import SavingsType
from app.models.user import User
from app.services import gym, habits, inventory, ledger, mood, recipes, recurring, savings
from app.services import preferences as prefs
from app.services.sessions import hash_token

#: The layers a feed may carry. ``schedule`` is the habits the plan asks for on a day;
#: ``habits`` is the check-ins that happened. The migration's CHECK holds the same list.
LAYERS: tuple[str, ...] = (
    "due",
    "money",
    "savings",
    "stock",
    "gym",
    "habits",
    "schedule",
    "mood",
    "meals",
)
DEFAULT_LAYERS: tuple[str, ...] = ("due",)

#: A layer that belongs to a module is left out while the module is switched off (Epic 33).
LAYER_MODULE: dict[str, str] = {
    "stock": "stock",
    "gym": "gym",
    "habits": "habits",
    "schedule": "habits",
    "mood": "mood",
    "meals": "recipes",
}

#: The feed covers the previous calendar month through six months ahead.
MONTHS_BACK = 1
MONTHS_AHEAD = 6

#: ``last_fetched_at`` is written at most this often, so a client polling hard does not
#: turn every read into a write.
_FETCH_WRITE_EVERY = dt.timedelta(minutes=5)

_UID_DOMAIN = "everything-everywhere.app"


# ------------------------------------------------------------------- the feed row


def get_feed(session: Session, user_id: uuid.UUID) -> CalendarFeed | None:
    return session.get(CalendarFeed, user_id)


def _mint() -> tuple[str, str]:
    token = secrets.token_urlsafe(32)
    return token, hash_token(token)


def create_feed(session: Session, user_id: uuid.UUID) -> tuple[CalendarFeed, str]:
    """Turn the feed on. Refused if one exists: "New URL" is :func:`rotate`, not this."""
    if get_feed(session, user_id) is not None:
        raise Invalid("The calendar feed is already on.", "calendar_feed_exists")
    token, token_hash = _mint()
    feed = CalendarFeed(user_id=user_id, token_hash=token_hash, layers=list(DEFAULT_LAYERS))
    session.add(feed)
    session.flush()
    session.refresh(feed)
    return feed, token


def rotate(session: Session, user_id: uuid.UUID) -> tuple[CalendarFeed, str]:
    """A new URL. The old one stops working in the same transaction."""
    feed = get_feed(session, user_id)
    if feed is None:
        raise NotFound("The calendar feed is off.", "calendar_feed_off")
    token, feed.token_hash = _mint()
    feed.last_fetched_at = None
    session.flush()
    return feed, token


def update_feed(
    session: Session,
    user_id: uuid.UUID,
    *,
    layers: list[str] | None = None,
    detailed: bool | None = None,
    alarm: bool | None = None,
) -> CalendarFeed:
    feed = get_feed(session, user_id)
    if feed is None:
        raise NotFound("The calendar feed is off.", "calendar_feed_off")
    if layers is not None:
        unknown = [layer for layer in layers if layer not in LAYERS]
        if unknown:
            raise Invalid(f"no calendar layer called {unknown[0]!r}", "calendar_layer_unknown")
        if len(set(layers)) != len(layers):
            raise Invalid("a calendar layer is listed twice", "calendar_layer_duplicate")
        # Stored in catalogue order, so the same choice always reads back the same way.
        feed.layers = [layer for layer in LAYERS if layer in layers]
    if detailed is not None:
        feed.detailed = detailed
    if alarm is not None:
        feed.alarm = alarm
    session.flush()
    return feed


def delete_feed(session: Session, user_id: uuid.UUID) -> None:
    """Turn the feed off. Idempotent: off is off."""
    feed = get_feed(session, user_id)
    if feed is not None:
        session.delete(feed)
        session.flush()


def look_up(session: Session, token: str) -> uuid.UUID | None:
    """The owner of a token, from a session with no tenant (AD-19's pattern)."""
    return session.execute(
        text("SELECT calendar_feed_lookup(:h)"), {"h": hash_token(token)}
    ).scalar_one_or_none()


def mark_fetched(session: Session, user_id: uuid.UUID) -> None:
    session.execute(
        update(CalendarFeed)
        .where(
            CalendarFeed.user_id == user_id,
            (CalendarFeed.last_fetched_at.is_(None))
            | (CalendarFeed.last_fetched_at < func.now() - _FETCH_WRITE_EVERY),
        )
        .values(last_fetched_at=func.now())
    )


# ------------------------------------------------------------------------ words

_WORDS: dict[str, dict[str, str]] = {
    "en": {
        "calendar": "Everything Everywhere",
        "bill_due": "Bill due",
        "income_due": "Income due",
        "forecast": "Expected from a recurring entry.",
        "waiting": "Waiting to be confirmed in Everything Everywhere.",
        "entries_one": "{count} entry",
        "entries_many": "{count} entries",
        "spent": "Spent {amount}",
        "earned": "earned {amount}",
        "earned_first": "Earned {amount}",
        "savings_one": "{count} savings movement",
        "savings_many": "{count} savings movements",
        "savings_net": "Savings {amount}",
        "stock_one": "{count} stock change",
        "stock_many": "{count} stock changes",
        "stock_added": "added",
        "workout": "Workout",
        "workout_named": "Workout: {names}",
        "done_one": "{count} habit done",
        "done_many": "{count} habits done",
        "done_named": "Done: {names}",
        "todo_one": "{count} habit to do",
        "todo_many": "{count} habits to do",
        "todo_named": "To do: {names}",
        "mood": "Mood noted",
        "mood_point": "Mood {point}/5",
        "day_ok": "good day",
        "day_hard": "hard day",
        "meals_one": "{count} meal",
        "meals_many": "{count} meals",
        "meals_named": "Meals: {names}",
        "alarm": "Reminder from Everything Everywhere",
    },
    "fr": {
        "calendar": "Everything Everywhere",
        "bill_due": "Paiement prévu",
        "income_due": "Revenu prévu",
        "forecast": "Prévu par une opération récurrente.",
        "waiting": "En attente de confirmation dans Everything Everywhere.",
        "entries_one": "{count} opération",
        "entries_many": "{count} opérations",
        "spent": "Dépensé {amount}",
        "earned": "reçu {amount}",
        "earned_first": "Reçu {amount}",
        "savings_one": "{count} mouvement d'épargne",
        "savings_many": "{count} mouvements d'épargne",
        "savings_net": "Épargne {amount}",
        "stock_one": "{count} changement de stock",
        "stock_many": "{count} changements de stock",
        "stock_added": "ajouté",
        "workout": "Séance",
        "workout_named": "Séance : {names}",
        "done_one": "{count} habitude faite",
        "done_many": "{count} habitudes faites",
        "done_named": "Fait : {names}",
        "todo_one": "{count} habitude à faire",
        "todo_many": "{count} habitudes à faire",
        "todo_named": "À faire : {names}",
        "mood": "Humeur notée",
        "mood_point": "Humeur {point}/5",
        "day_ok": "bonne journée",
        "day_hard": "journée difficile",
        "meals_one": "{count} repas",
        "meals_many": "{count} repas",
        "meals_named": "Repas : {names}",
        "alarm": "Rappel d'Everything Everywhere",
    },
}


def _plural(language: str, count: int) -> str:
    """French takes the singular at 0 as well as 1 (the push digest's rule, Epic 25)."""
    return "one" if count == 1 or (language == "fr" and count == 0) else "many"


@dataclass(frozen=True)
class _Words:
    language: str
    currency: str

    def __call__(self, key: str, **values: object) -> str:
        table = _WORDS.get(self.language, _WORDS["en"])
        return table[key].format(**values)

    def counted(self, stem: str, count: int) -> str:
        return self(f"{stem}_{_plural(self.language, count)}", count=count)

    def money(self, amount: Decimal, *, signed: bool = False) -> str:
        """Locale-light on purpose: two decimals and the ISO code, a comma in French."""
        text_ = f"{amount:+.2f}" if signed else f"{amount:.2f}"
        if self.language == "fr":
            text_ = text_.replace(".", ",")
        return f"{text_} {self.currency}"


def _names(values: list[str]) -> str:
    """Distinct, in first-seen order: three runs of the same habit read as one name."""
    return ", ".join(dict.fromkeys(values))


# ------------------------------------------------------------------------ the feed


@dataclass(frozen=True)
class Window:
    """``[start, end)``: the first of last month through the end of six months ahead."""

    start: dt.date
    end: dt.date
    today: dt.date

    @classmethod
    def around(cls, today: dt.date) -> "Window":
        first = today.replace(day=1)
        return cls(
            start=add_months(first, -MONTHS_BACK),
            end=add_months(first, MONTHS_AHEAD + 1),
            today=today,
        )

    def past_months(self) -> list[str]:
        """The months that can hold a fact: last month and this one. Nothing is recorded in
        the future, so the six ahead are not asked about."""
        return [format_month(self.start), format_month(self.today)]


@dataclass
class _Account:
    language: str
    currency: str
    modules: dict[str, bool]


def _account(session: Session, user_id: uuid.UUID) -> _Account:
    # Named columns, never the whole row: the runtime role cannot read password_hash.
    row = session.execute(
        select(User.language, User.currency, User.preferences).where(User.id == user_id)
    ).one()
    return _Account(
        language=row.language or "en",
        currency=row.currency or "",
        modules=prefs.resolve(row.preferences)["modules"],
    )


def _uid(*parts: object) -> str:
    return "-".join(str(part) for part in parts) + f"@{_UID_DOMAIN}"


def _day_uid(layer: str, day: dt.date) -> str:
    return _uid(layer, day.strftime("%Y%m%d"))


def _due_events(session, user_id, window, words, detailed) -> list[ical.Event]:
    # Reading what is pending brings it up to date first, exactly as `/pending` does
    # (AD-33): otherwise a bill that fell due yesterday is missing until the app is opened.
    recurring.materialise(session, user_id, today=window.today)
    rows: list[tuple[uuid.UUID, dt.date, EntryKind, str, Decimal, str | None, bool]] = [
        (r.template_id, r.due_on, r.kind, r.category_name, r.amount, r.note, False)
        for r in recurring.list_pending(session, user_id)
        if window.start <= r.due_on < window.end
    ]
    rows += [
        (r.template_id, r.due_on, r.kind, r.category_name, r.amount, r.note, True)
        for r in recurring.expected(
            session, user_id, start=window.start, end=window.end, today=window.today
        )
    ]
    events = []
    for template_id, day, kind, category, amount, note, forecast in rows:
        if detailed:
            summary = f"{category} · {words.money(amount)}"
            lines = [words("forecast" if forecast else "waiting")]
            if note:
                lines.insert(0, note)
            description = "\n".join(lines)
        else:
            summary = words("income_due" if kind == EntryKind.income else "bill_due")
            description = None
        events.append(
            ical.Event(_uid("due", template_id, day.strftime("%Y%m%d")), day, summary, description)
        )
    return events


def _money_events(session, user_id, window, words, detailed) -> list[ical.Event]:
    names = dict(
        session.execute(select(Category.id, Category.name).where(Category.user_id == user_id)).all()
    )
    by_day = defaultdict(list)
    for month in window.past_months():
        for entry in ledger.list_entries(session, user_id, month=month):
            by_day[entry.occurred_on].append(entry)
    events = []
    for day, entries in by_day.items():
        if detailed:
            spent = sum((e.amount for e in entries if e.kind == EntryKind.expense), Decimal(0))
            earned = sum((e.amount for e in entries if e.kind == EntryKind.income), Decimal(0))
            parts = []
            if spent:
                parts.append(words("spent", amount=words.money(spent)))
            if earned:
                key = "earned" if parts else "earned_first"
                parts.append(words(key, amount=words.money(earned)))
            summary = " · ".join(parts)
            description = "\n".join(
                f"{names.get(e.category_id, '-')}: "
                f"{words.money(e.amount if e.kind == EntryKind.income else -e.amount, signed=True)}"
                + (f" ({e.note})" if e.note else "")
                for e in entries
            )
        else:
            summary, description = words.counted("entries", len(entries)), None
        events.append(ical.Event(_day_uid("money", day), day, summary, description))
    return events


def _savings_events(session, user_id, window, words, detailed) -> list[ical.Event]:
    names = dict(
        session.execute(
            select(SavingsType.id, SavingsType.name).where(SavingsType.user_id == user_id)
        ).all()
    )
    by_day = defaultdict(list)
    for month in window.past_months():
        for row in savings.list_contributions(session, user_id, month=month):
            by_day[row.occurred_on].append(row)
    events = []
    for day, rows in by_day.items():
        signed = [(r, -r.amount if r.kind == "withdrawal" else r.amount) for r in rows]
        if detailed:
            net = sum((amount for _, amount in signed), Decimal(0))
            summary = words("savings_net", amount=words.money(net, signed=True))
            description = "\n".join(
                f"{names.get(r.savings_type_id, '-')}: {words.money(amount, signed=True)}"
                + (f" ({r.note})" if r.note else "")
                for r, amount in signed
            )
        else:
            summary, description = words.counted("savings", len(rows)), None
        events.append(ical.Event(_day_uid("savings", day), day, summary, description))
    return events


def _stock_events(session, user_id, window, words, detailed) -> list[ical.Event]:
    by_day = defaultdict(list)
    for month in window.past_months():
        for change, name in inventory.changes_in(session, user_id, month=month):
            # The UTC day, as the web calendar and the restocks chart both use.
            by_day[change.changed_at.astimezone(dt.UTC).date()].append((change, name))
    events = []
    for day, rows in by_day.items():
        summary = words.counted("stock", len(rows))
        description = None
        if detailed:
            description = "\n".join(
                f"{name}: {words('stock_added')} ({c.quantity_after})"
                if c.quantity_before == c.quantity_after
                else f"{name}: {c.quantity_before} → {c.quantity_after}"
                for c, name in rows
            )
        events.append(ical.Event(_day_uid("stock", day), day, summary, description))
    return events


def _gym_events(session, user_id, window, words, detailed) -> list[ical.Event]:
    names = dict(
        session.execute(select(Routine.id, Routine.name).where(Routine.user_id == user_id)).all()
    )
    by_day = defaultdict(list)
    for month in window.past_months():
        for workout in gym.list_workouts(session, user_id, month=month, limit=200):
            by_day[workout.performed_on].append(workout)
    events = []
    for day, workouts in by_day.items():
        routines = [names[w.routine_id] for w in workouts if w.routine_id in names]
        if detailed and routines:
            summary = words("workout_named", names=_names(routines))
            notes = [w.note for w in workouts if w.note]
            description = "\n".join(notes) or None
        else:
            summary, description = words("workout"), None
        events.append(ical.Event(_day_uid("gym", day), day, summary, description))
    return events


def _habit_events(session, user_id, window, words, detailed) -> list[ical.Event]:
    by_day = defaultdict(list)
    rows = habits.list_checkins(
        session, user_id, start=window.start, end=window.today + dt.timedelta(days=1)
    )
    for checkin, name in rows:
        by_day[checkin.done_on].append(name)
    return [
        ical.Event(
            _day_uid("habits", day),
            day,
            words("done_named", names=_names(names))
            if detailed
            else words.counted("done", len(names)),
        )
        for day, names in by_day.items()
    ]


def _schedule_events(session, user_id, window, words, detailed) -> list[ical.Event]:
    """What the plan asks for, today onward. ``times_per_week`` names no day, so it adds
    nothing — the same rule that keeps the digest from nagging every evening (AD-43)."""
    plans = [(h.name, Schedule.of(h), h.started_on) for h in habits.list_habits(session, user_id)]
    events = []
    day = window.today
    while day < window.end:
        due = [name for name, plan, started in plans if is_scheduled(plan, started, day)]
        if due:
            summary = (
                words("todo_named", names=_names(due))
                if detailed
                else words.counted("todo", len(due))
            )
            events.append(ical.Event(_day_uid("schedule", day), day, summary))
        day += dt.timedelta(days=1)
    return events


def _mood_events(session, user_id, window, words, detailed) -> list[ical.Event]:
    events = []
    for row in mood.list_days(session, user_id, start=window.start, end=window.end):
        summary, description = words("mood"), None
        if detailed:
            parts = []
            if row.mood is not None:
                parts.append(words("mood_point", point=row.mood))
            if row.day_ok is not None:
                parts.append(words("day_ok" if row.day_ok else "day_hard"))
            summary = " · ".join(parts) or summary
            description = row.note
        events.append(ical.Event(_day_uid("mood", row.on_day), row.on_day, summary, description))
    return events


def _meal_events(session, user_id, window, words, detailed) -> list[ical.Event]:
    by_day = defaultdict(list)
    for row in recipes.list_meals(session, user_id, start=window.start, end=window.end):
        by_day[row.meal.eaten_on].append(row.recipe_name or row.food_name or "-")
    return [
        ical.Event(
            _day_uid("meals", day),
            day,
            words("meals_named", names=_names(names))
            if detailed
            else words.counted("meals", len(names)),
        )
        for day, names in by_day.items()
    ]


_BUILDERS: dict[str, Callable[..., list[ical.Event]]] = {
    "due": _due_events,
    "money": _money_events,
    "savings": _savings_events,
    "stock": _stock_events,
    "gym": _gym_events,
    "habits": _habit_events,
    "schedule": _schedule_events,
    "mood": _mood_events,
    "meals": _meal_events,
}


def render(
    session: Session,
    user_id: uuid.UUID,
    feed: CalendarFeed,
    *,
    today: dt.date | None = None,
    now: dt.datetime | None = None,
) -> str:
    """The whole VCALENDAR for one account, in its own tenant-pinned session."""
    account = _account(session, user_id)
    words = _Words(account.language, account.currency)
    window = Window.around(today or dt.date.today())
    events: list[ical.Event] = []
    for layer in feed.layers:
        module = LAYER_MODULE.get(layer)
        if module is not None and not account.modules.get(module, True):
            continue
        builder = _BUILDERS.get(layer)
        if builder is not None:
            events += builder(session, user_id, window, words, feed.detailed)
    # AD-20: the same feed read twice is the same text twice, bar DTSTAMP.
    events.sort(key=lambda event: (event.day, event.uid))
    return ical.calendar(
        events,
        name=words("calendar"),
        now=now or dt.datetime.now(dt.UTC),
        alarm=words("alarm") if feed.alarm else None,
    )
