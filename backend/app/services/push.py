"""Push subscriptions, and the digest text (Epic 18).

This module stores subscriptions and decides *what* a person should be told. It never sends
anything: sending needs the network and a schedule, and neither belongs in a request. The
sending half lives in ``notify.py``, run by cron on the host (AD-34).

Nothing here commits (AD-4).
"""

import datetime as dt
import json
import sys
import uuid

from sqlalchemy import delete, select, text
from sqlalchemy.orm import Session

from app.core.clock import local_now, zone_of
from app.core.errors import NotFound
from app.models.push import PushSubscription
from app.services.activity import MODULES as STREAK_MODULES


def list_subscriptions(session: Session, user_id: uuid.UUID) -> list[PushSubscription]:
    return list(
        session.execute(
            select(PushSubscription)
            .where(PushSubscription.user_id == user_id)
            .order_by(PushSubscription.created_at, PushSubscription.id)
        ).scalars()
    )


def subscribe(
    session: Session, user_id: uuid.UUID, *, endpoint: str, p256dh: str, auth: str
) -> PushSubscription:
    """Idempotent by endpoint, and it *moves* the row rather than refusing it.

    The endpoint identifies a browser install, not a person. If a device is handed on and
    someone else signs in, the subscription has to follow the new account — otherwise the
    previous owner keeps being told what is in this person's fridge.

    That cannot be done with ``ON CONFLICT DO UPDATE``: resolving the conflict means
    updating a row the caller is not allowed to see, and row-level security refuses it —
    correctly. So the previous claim on this endpoint is released first, through the
    narrow delete-only function of migration 0013, and the insert then runs under the
    caller's own tenancy like every other write.
    """
    session.execute(text("SELECT push_release_endpoint(:endpoint)"), {"endpoint": endpoint})
    row_id = session.execute(
        text(
            """
            INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
            VALUES (:uid, :endpoint, :p256dh, :auth)
            ON CONFLICT (endpoint) DO UPDATE
                SET user_id = EXCLUDED.user_id,
                    p256dh = EXCLUDED.p256dh,
                    auth = EXCLUDED.auth,
                    notified_on = NULL
            RETURNING id
            """
        ),
        {"uid": str(user_id), "endpoint": endpoint, "p256dh": p256dh, "auth": auth},
    ).scalar_one()
    session.flush()
    session.expire_all()
    subscription = session.get(PushSubscription, row_id)
    if subscription is None:  # pragma: no cover — the insert just returned this id
        raise NotFound("subscription was written but is not readable")
    return subscription


def unsubscribe(session: Session, user_id: uuid.UUID, endpoint: str) -> None:
    """Idempotent: an endpoint that is already gone is a success, not a 404."""
    session.execute(
        delete(PushSubscription).where(
            PushSubscription.user_id == user_id, PushSubscription.endpoint == endpoint
        )
    )
    session.flush()


def forget(session: Session, endpoint: str) -> None:
    """Drop a subscription the push service has told us is dead (404 or 410)."""
    session.execute(delete(PushSubscription).where(PushSubscription.endpoint == endpoint))
    session.flush()


def mark_notified(session: Session, subscription_id: uuid.UUID, on: dt.date) -> None:
    subscription = session.get(PushSubscription, subscription_id)
    if subscription is not None:
        subscription.notified_on = on
    session.flush()


# The one place on the server that writes prose for a reader (Epic 25).
#
# AD-44 says the client owns every displayed word — and a push notification has no client.
# It is composed by cron on the host, hours after anyone was last in the browser, and it
# arrives as an operating-system notification with no chance to translate anything. So the
# digest, alone, reads `users.language` and writes the sentence itself. That is also the
# reason the language is an account column rather than a browser preference (0019).
#
# Each clause is a whole sentence rather than a template with a plural switch baked into
# the middle of it: French does not agree with English about where the verb goes, and a
# shared skeleton with `{noun}` holes only ever works for languages that share a shape. In
# French `0` takes the singular, which is why the tests below check `1` and `2` rather than
# trusting a `!= 1` written for English.
_WORDS: dict[str, dict[str, str]] = {
    "en": {
        "restock_one": "{count} item needs restocking",
        "restock_many": "{count} items need restocking",
        "pending_one": "{count} recurring entry is waiting",
        "pending_many": "{count} recurring entries are waiting",
        "due_one": "{count} recurring entry is due tomorrow",
        "due_many": "{count} recurring entries are due tomorrow",
        "savings_one": "{count} savings goal is behind",
        "savings_many": "{count} savings goals are behind",
        "habits_one": "{count} habit still to do",
        "habits_many": "{count} habits still to do",
        "streak_one": "Your {count}-day streak is at risk today",
        "streak_many": "Your {count}-day streak is at risk today",
        "streak_frozen_one": "Your {count}-day streak is safe tonight: a freeze will cover it",
        "streak_frozen_many": "Your {count}-day streak is safe tonight: a freeze will cover it",
        "streak_tabs": "tabs at risk",
        "moon_new": "New moon today",
        "moon_full": "Full moon today",
        "tab_entries": "Entries",
        "tab_plan": "Plan",
        "tab_grow": "Grow",
        "tab_habits": "Habits",
        "tab_mood": "Mood",
        "tab_books": "Books",
        "tab_stock": "Stock",
        "tab_gym": "Gym",
        "tab_recipes": "Recipes",
        "tab_notes": "Notes",
        "test": "Notifications work on this device.",
        "more": ", …",
    },
    "fr": {
        "restock_one": "{count} article à racheter",
        "restock_many": "{count} articles à racheter",
        "pending_one": "{count} opération récurrente en attente",
        "pending_many": "{count} opérations récurrentes en attente",
        "due_one": "{count} opération récurrente prévue demain",
        "due_many": "{count} opérations récurrentes prévues demain",
        "savings_one": "{count} objectif d'épargne en retard",
        "savings_many": "{count} objectifs d'épargne en retard",
        "habits_one": "{count} habitude à faire",
        "habits_many": "{count} habitudes à faire",
        "streak_one": "Votre série de {count} jour est en danger aujourd'hui",
        "streak_many": "Votre série de {count} jours est en danger aujourd'hui",
        "streak_frozen_one": (
            "Votre série de {count} jour est protégée ce soir : un gel la couvrira"
        ),
        "streak_frozen_many": (
            "Votre série de {count} jours est protégée ce soir : un gel la couvrira"
        ),
        "streak_tabs": "onglets en danger",
        "moon_new": "Nouvelle lune aujourd'hui",
        "moon_full": "Pleine lune aujourd'hui",
        "tab_entries": "Opérations",
        "tab_plan": "Budget",
        "tab_grow": "Épargne",
        "tab_habits": "Habitudes",
        "tab_mood": "Humeur",
        "tab_books": "Livres",
        "tab_stock": "Stock",
        "tab_gym": "Sport",
        "tab_recipes": "Recettes",
        "tab_notes": "Notes",
        "test": "Les notifications fonctionnent sur cet appareil.",
        "more": ", …",
    },
}

#: Where each clause is dealt with. The push opens the first clause's page (AD-52): the
#: pending proposals are on the dashboard, recurring templates and pots on Plan.
_PAGES: dict[str, str] = {
    "restock": "/inventory",
    "pending": "/",
    "due": "/plan",
    "savings": "/plan",
    "habits": "/habits",
    "streak": "/",
    "moon": "/moon",
}


def _plural(language: str, count: int) -> str:
    """Which of the two forms a count takes.

    English: 1 is singular. French: 0 *and* 1 are singular — "0 article", not "0 articles".
    Neither is ever asked for a count of zero here (an empty digest is not sent), but the
    rule is written down rather than assumed, because the next language will not share it.
    """
    return "one" if count == 1 or (language == "fr" and count == 0) else "many"


class Digest:
    """What one person has waiting, and the one line that says it, in their language."""

    def __init__(
        self,
        low_items: int,
        pending: int,
        item_names: list[str],
        habit_names: list[str] | None = None,
        language: str = "en",
        *,
        due_names: list[str] | None = None,
        behind_names: list[str] | None = None,
        streak_days: int = 0,
        streak_tabs: list[str] | None = None,
        streak_frozen: bool = False,
        moon_event: str | None = None,
    ) -> None:
        self.low_items = low_items
        self.pending = pending
        self.item_names = item_names
        # Only the habits that opted in, and only on a day their schedule asks for. Off by
        # default, so a person who has not asked for nagging keeps a digest that arrives
        # when something is exceptional rather than every single evening (AD-34).
        self.habit_names = habit_names or []
        # Epic 36 (AD-52), both opt-in kinds: recurring entries whose next date is
        # tomorrow, and pots below the straight line to a goal less than a month away.
        self.due_names = due_names or []
        self.behind_names = behind_names or []
        # Epic 41 (41.6), opt-in: the overall streak's length when today is still to do
        # (0 says nothing), the shown tab streaks in the same state (module ids), and
        # whether a held freeze will cover tonight. Decided by ``digest()``, worded here.
        self.streak_days = streak_days
        self.streak_tabs = streak_tabs or []
        self.streak_frozen = streak_frozen
        # Epic 47 (AD-63 §6), opt-in: "new" or "full" when today is that moon's day, else
        # None (says nothing). Decided by ``digest()`` from ``services/moon``, worded here.
        self.moon_event = moon_event if moon_event in ("new", "full") else None
        self.language = language if language in _WORDS else "en"

    def _clauses(self) -> list[str]:
        """The clause keys that have something to say, in the order they are read."""
        present = {
            "restock": self.low_items,
            "pending": self.pending,
            "due": len(self.due_names),
            "savings": len(self.behind_names),
            "habits": len(self.habit_names),
            "streak": self.streak_days,
            "moon": 1 if self.moon_event else 0,
        }
        return [key for key, count in present.items() if count]

    @property
    def empty(self) -> bool:
        return not self._clauses()

    @property
    def title(self) -> str:
        return "Everything Everywhere"

    @property
    def url(self) -> str:
        """The page of the first clause, so a tap lands where the thing is dealt with."""
        clauses = self._clauses()
        return _PAGES[clauses[0]] if clauses else "/"

    def _say(self, key: str, count: int) -> str:
        return _WORDS[self.language][f"{key}_{_plural(self.language, count)}"].format(count=count)

    def _named(self, names: list[str], count: int) -> str:
        """Up to three names in brackets, with an ellipsis when there are more."""
        listed = ", ".join(names[:3])
        if not listed:
            return ""
        more = _WORDS[self.language]["more"] if count > 3 else ""
        return f" ({listed}{more})"

    def _streak_clause(self) -> str:
        """The streak sentence, defined once (41.6). A freeze held on the overall streak says
        so instead of warning; the shown tab streaks also at risk follow, named like items."""
        words = _WORDS[self.language]
        key = "streak_frozen" if self.streak_frozen else "streak"
        text_ = self._say(key, self.streak_days)
        if self.streak_tabs:
            names = [words[f"tab_{tab}"] for tab in self.streak_tabs]
            listed = ", ".join(names[:3]) + (words["more"] if len(names) > 3 else "")
            sep = " : " if self.language == "fr" else ": "
            text_ += f" ({words['streak_tabs']}{sep}{listed})"
        return text_

    @property
    def body(self) -> str:
        parts = []
        for key in self._clauses():
            if key == "restock":
                parts.append(
                    self._say("restock", self.low_items)
                    + self._named(self.item_names, self.low_items)
                )
            elif key == "pending":
                parts.append(self._say("pending", self.pending))
            elif key == "streak":
                parts.append(self._streak_clause())
            elif key == "moon":
                parts.append(_WORDS[self.language][f"moon_{self.moon_event}"])
            else:
                names = {
                    "due": self.due_names,
                    "savings": self.behind_names,
                    "habits": self.habit_names,
                }[key]
                parts.append(self._say(key, len(names)) + self._named(names, len(names)))
        return ". ".join(parts) + "."

    def payload(self) -> str:
        return json.dumps(
            {"title": self.title, "body": self.body, "url": self.url}, ensure_ascii=False
        )


def test_payload(language: str) -> str:
    """What "Send test" shows when there is nothing to report: proof the pipe works."""
    words = _WORDS[language if language in _WORDS else "en"]
    return json.dumps(
        {"title": "Everything Everywhere", "body": words["test"], "url": "/settings"},
        ensure_ascii=False,
    )


# ------------------------------------------------------------ when (Epic 36)


def is_due(
    *, timezone: str | None, digest_time: dt.time, notified_on: dt.date | None, now: dt.datetime
) -> bool:
    """Send now? Yes once the local time has reached the digest time, if this device has
    not already been told on the local today. One rule, so cron and the preview agree."""
    here = local_now(timezone, now)
    return here.time() >= digest_time and notified_on != here.date()


# ------------------------------------------------------------ what (Epic 18, 36)


def digest(session: Session, user_id: uuid.UUID, *, today: dt.date | None = None) -> Digest:
    """Read-only. The counts come from the same predicates the pages use (AD-30, AD-33).

    ``today`` is the account's **local** date (AD-52); the caller works it out from the
    account's zone. Every date reasoned about below is relative to it.

    Deliberately does *not* materialise recurring occurrences: a notification job must not
    write to the ledger. It reports what is already pending, and the next visit to the app
    brings the rest into being.
    """
    from app.services import auth as auth_service
    from app.services import habits as habits_service
    from app.services import recurring as recurring_service
    from app.services import savings as savings_service
    from app.services import streaks as streaks_service

    today = today or dt.date.today()

    # The language is read here rather than passed in, so every caller of `digest` gets a
    # correctly-worded one without having to remember to look it up (AD-30's shape: one
    # definition, no second copy). The same read carries the modules (Epic 33, AD-49) — a
    # module switched off says nothing here, and its data is left alone — and the kinds the
    # person asked to hear about (Epic 36, AD-52). A kind needs both.
    profile = auth_service.read_profile(session, user_id)
    modules = profile.preferences["modules"] if profile else {}
    kinds = profile.preferences["notifications"] if profile else {}

    def wanted(kind: str, module: str | None = None) -> bool:
        return kinds.get(kind, False) and (module is None or modules.get(module, True))

    low: list[str] = []
    if wanted("stock", "stock"):
        low = list(
            session.execute(
                text(
                    "SELECT name FROM inventory_items "
                    "WHERE user_id = :uid AND notify AND restock_below IS NOT NULL "
                    "AND quantity <= restock_below ORDER BY lower(name)"
                ),
                {"uid": str(user_id)},
            )
            .scalars()
            .all()
        )

    pending = 0
    if wanted("recurring"):
        pending = session.execute(
            text(
                "SELECT count(*) FROM recurring_occurrences o "
                "JOIN recurring_templates t ON t.user_id = o.user_id AND t.id = o.template_id "
                "WHERE o.user_id = :uid AND o.status = 'pending' AND t.notify"
            ),
            {"uid": str(user_id)},
        ).scalar_one()

    # "Due tomorrow" is the calendar's forecast for one day (AD-39), not a second walk over
    # the cadence written here: the calendar and the push cannot disagree about a date.
    due: list[str] = []
    if wanted("due_tomorrow"):
        muted = set(
            session.execute(
                text("SELECT id FROM recurring_templates WHERE user_id = :uid AND NOT notify"),
                {"uid": str(user_id)},
            ).scalars()
        )
        tomorrow = today + dt.timedelta(days=1)
        due = [
            row.note or row.category_name
            for row in recurring_service.expected(
                session, user_id, start=tomorrow, end=tomorrow + dt.timedelta(days=1), today=today
            )
            if row.template_id not in muted
        ]

    behind: list[str] = []
    if wanted("savings"):
        behind = [
            pot.name
            for pot in savings_service.behind_pots(session, user_id, today=today)
            if pot.notify
        ]

    # The habits clause calls the habits service rather than rewriting its predicate in SQL
    # here. That is deliberate: "is this period met" is period arithmetic plus a target, not
    # a comparison — a second copy would drift from the Habits page the first time either
    # changed, which is exactly what AD-30 forbids. Reading another module's service (never
    # its models) is what the notification side is allowed to do, being a composer rather
    # than a module (AD-37).
    habits = (
        habits_service.outstanding(session, user_id, today=today)
        if wanted("habits", "habits")
        else []
    )

    # The streak clause reads the streaks service, never its own walk (AD-30, AD-57): the
    # overall streak is still alive (current >= 1) and today is not yet active on the
    # digest's local day. A tab streak is named when it is *shown* (its switch on, its
    # module not off) and in the same state, and not already covered by a freeze of its own.
    streak_days = 0
    streak_frozen = False
    streak_tabs: list[str] = []
    if wanted("streak"):
        found = streaks_service.on(session, user_id, today)
        overall = found[streaks_service.OVERALL]
        if overall.current >= 1 and not overall.today_active:
            streak_days = overall.current
            streak_frozen = overall.freeze_tonight
            shown = profile.preferences["streaks"] if profile else {}
            streak_tabs = [
                tab
                for tab in STREAK_MODULES
                if shown.get(tab)
                and modules.get(tab, True)
                and found[tab].current >= 1
                and not found[tab].today_active
                and not found[tab].freeze_tonight
            ]

    # The moon clause asks services/moon for the account's local today (Epic 47, AD-63 §6):
    # the kind is on, the Moon module is not switched off, and today holds a new or full moon.
    moon_event = None
    if wanted("moon", "moon"):
        from app.services import moon as moon_service

        moon_event = moon_service.event_on(today, zone_of(profile.timezone) if profile else None)

    return Digest(
        len(low),
        int(pending),
        low,
        habits,
        language=profile.language if profile else "en",
        due_names=due,
        behind_names=behind,
        streak_days=streak_days,
        streak_tabs=streak_tabs,
        streak_frozen=streak_frozen,
        moon_event=moon_event,
    )


class MutedRow:
    def __init__(self, kind: str, id: uuid.UUID, name: str) -> None:
        self.kind = kind
        self.id = id
        self.name = name


def muted(session: Session, user_id: uuid.UUID) -> list[MutedRow]:
    """Every row the person has kept out of the digest, named, for Settings (AD-52): a mute
    that cannot be found again is a notification lost for good."""
    rows = session.execute(
        text(
            """
            SELECT 'stock' AS kind, i.id, i.name FROM inventory_items i
             WHERE i.user_id = :uid AND NOT i.notify
            UNION ALL
            SELECT 'recurring', t.id, COALESCE(NULLIF(t.note, ''), c.name)
              FROM recurring_templates t
              JOIN categories c ON c.user_id = t.user_id AND c.id = t.category_id
             WHERE t.user_id = :uid AND NOT t.notify
            UNION ALL
            SELECT 'savings', s.id, s.name FROM savings_types s
             WHERE s.user_id = :uid AND NOT s.notify
            ORDER BY 1, 3, 2
            """
        ),
        {"uid": str(user_id)},
    ).all()
    return [MutedRow(kind, row_id, name) for kind, row_id, name in rows]


# ------------------------------------------------------------ sending


#: One test per device per minute (AD-52). Enough to retry after granting permission;
#: not enough to turn "Send test" into a way of spamming a phone.
TEST_INTERVAL = dt.timedelta(minutes=1)


class TooSoon(Exception):
    """A second test inside ``TEST_INTERVAL``; the API answers 429."""


def claim_test(
    session: Session, user_id: uuid.UUID, endpoint: str, now: dt.datetime
) -> PushSubscription:
    """The caller's own subscription for ``endpoint``, stamped as tested now.

    ``NotFound`` for an endpoint that is not theirs — row-level security already hides
    another account's, so "not yours" and "no such device" are one answer. ``TooSoon``
    when the last test was under a minute ago. Does not touch ``notified_on``: a test must
    not eat the evening's digest.
    """
    subscription = session.execute(
        select(PushSubscription)
        .where(PushSubscription.user_id == user_id, PushSubscription.endpoint == endpoint)
        .with_for_update()
    ).scalar_one_or_none()
    if subscription is None:
        raise NotFound("This device is not subscribed", "push_not_subscribed")
    if subscription.tested_at is not None and now - subscription.tested_at < TEST_INTERVAL:
        raise TooSoon
    subscription.tested_at = now
    session.flush()
    return subscription


def send(settings, subscription: PushSubscription, payload: str) -> bool:
    """Deliver one push. True if it went (or may go on a retry), False if the push service
    says the subscription is gone for good and it should be forgotten."""
    from pywebpush import WebPushException, webpush

    try:
        webpush(
            subscription_info={
                "endpoint": subscription.endpoint,
                "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
            },
            data=payload,
            vapid_private_key=settings.vapid_private_key,
            vapid_claims={"sub": settings.vapid_subject},
            ttl=60 * 60 * 12,
        )
        return True
    except WebPushException as exc:
        # 404 and 410 are the push service saying this endpoint is gone for good — an
        # uninstalled app, a cleared browser. Anything else may be temporary, so the
        # subscription is kept and the next run tries again.
        status = getattr(exc, "status_code", None) or getattr(exc.response, "status_code", None)
        if status in (404, 410):
            print(f"dropping dead subscription ({status})", file=sys.stderr)
            return False
        print(f"push failed ({status}): {exc}", file=sys.stderr)
        return True
