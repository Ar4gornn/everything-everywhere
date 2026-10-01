"""Streaks: computed on read from the activity days (Epic 41, AD-57).

Nothing here is stored. A streak is a walk forward over the days on which something was
done (``services/activity.py``), so a later fix to the rules corrects the past too, and a
timezone change cannot leave a stale copy behind.

Stories 41.1 and 41.2 walk the **overall** streak and one streak per module; 41.4 adds the
freeze to the walk and 41.5 the repair. A covered day is one of several states.

Rules, defined here once (§2.3 of ``docs/epic-41-streaks.md``):

* ``active``: something was done that day;
* ``pending``: it is today and nothing was done yet, so nothing is lost until the local
  midnight;
* ``frozen``: it was missed, the run was going, and a held freeze bought on or before it
  was consumed (the oldest first). The run goes on and the day earns nothing;
* ``repaired``: a repair was bought for that day (§2.5). It lengthens the run and earns
  nothing, like a freeze;
* ``missed``: anything else.

A repair (§2.5) is offered when the days missed directly before today are one or two and the
day before them is covered. Freezes are consumed in the walk first, so the gap is priced on
what is still missed. Repairs enter the **displayed** walk only (current, best, dots, the
offer), never the earning walk: joining two runs that each paid a bonus must not take one
back (§2.6, decided 2026-10-01).

Points (§2.6), also computed and never stored: +1 for each day overall is active, +1 for
each (day, module) active for **all ten** module streaks (shown or not: hiding a streak
must never take points back), and a bonus each time a run reaches exactly 7, 30, 100 or
365 days. The balance is earned minus what purchases cost (``streak_purchases``, the only
stored fact about points). A purchase takes the user's advisory lock before it reads the
balance, so two at once cannot both spend the same points.

A freeze (§2.4) covers one missed day of its own streak, on or after the day it was bought.
So a freeze bought today never covers yesterday, and one bought today on a day that stays
inactive covers today once today has passed. A freeze held while the run is 0 stays held.

A day before the first active one is outside the walk. The four-week dots call it
``before``: it was not missed, there was simply no streak yet.

**Current** is the run after the walk; **best** is the highest run seen at any point.
Activity dated after local today (an account that moved to a zone further west) is ignored
rather than counted early: a streak never runs ahead of the clock.
"""

import datetime as dt
import uuid
from collections import defaultdict
from dataclasses import dataclass

from sqlalchemy import insert, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import Conflict, Invalid
from app.models.activity import ActivityDay
from app.models.streak_purchase import StreakPurchase
from app.services.activity import ACTIVITY_MODULES, APP, MODULES, local_day, record

OVERALL = "overall"
RECENT_DAYS = 28

#: A run that reaches exactly ``days`` pays ``bonus`` once, for any streak (§2.6). Module
#: constants, returned by ``GET`` so the client never hardcodes one.
MILESTONES: tuple[tuple[int, int], ...] = ((7, 10), (30, 30), (100, 100), (365, 365))
_BONUS = dict(MILESTONES)

ACTIVE = "active"
PENDING = "pending"
MISSED = "missed"
BEFORE = "before"
FROZEN = "frozen"
REPAIRED = "repaired"
_COVERED = (ACTIVE, FROZEN, REPAIRED)

#: What a freeze costs and how many one streak may hold at once (§2.4). Returned by ``GET``
#: so the client never hardcodes a price.
FREEZE_COST = 20
MAX_HELD = 2

#: The price of one repaired day before the streak's own length is added (§2.5), and how many
#: missed days directly before today a repair can reach.
REPAIR_PER_DAY = 30
MAX_REPAIR_DAYS = 2

FREEZE = "freeze"
REPAIR = "repair"


@dataclass(frozen=True)
class Repair:
    """What a repair would do right now: the missed days it covers, and its total price."""

    days: tuple[dt.date, ...]
    per_day: int
    cost: int


@dataclass(frozen=True)
class Streak:
    id: str
    current: int
    best: int
    today_active: bool
    held_freezes: int
    recent: list[tuple[dt.date, str]]
    repair: Repair | None = None


@dataclass(frozen=True)
class Purchase:
    streak: str
    kind: str
    cost: int
    bought_on: dt.date
    covers: dt.date | None


@dataclass(frozen=True)
class Points:
    balance: int
    earned: int
    spent: int


def _walk(
    active: set[dt.date],
    today: dt.date,
    freezes: tuple[dt.date, ...] = (),
    repairs: frozenset[dt.date] = frozenset(),
) -> tuple[int, int, int, dict[dt.date, str], int, dict[dt.date, int]]:
    """``(current, best, bonus, state by day, freezes held, run by day)``. The bonus is paid
    on the day a run reaches a milestone length, frozen days included, so a run that breaks
    and climbs again pays again. ``freezes`` are the days the streak's freezes were bought
    on, ``repairs`` the days a repair covers. The bonus never counts a repaired day: the
    earning walk is called without any."""
    days = {day for day in active if day <= today}
    bought = sorted(freezes)  # oldest first, so the next one up is bought[used]
    used = 0
    states: dict[dt.date, str] = {}
    runs: dict[dt.date, int] = {}
    run = best = bonus = 0
    if days:
        day = min(days)
        while day <= today:
            if day in days:
                states[day] = ACTIVE
                run += 1
            elif day in repairs and day < today:
                states[day] = REPAIRED
                run += 1
            elif day == today:
                states[day] = PENDING
            elif run > 0 and used < len(bought) and bought[used] <= day:
                used += 1
                states[day] = FROZEN
                run += 1
            else:
                states[day] = MISSED
                run = 0
            if states[day] in (ACTIVE, FROZEN):
                bonus += _BONUS.get(run, 0)
            best = max(best, run)
            runs[day] = run
            day += dt.timedelta(days=1)
    return run, best, bonus, states, len(bought) - used, runs


def walk(
    active: set[dt.date],
    today: dt.date,
    freezes: tuple[dt.date, ...] = (),
    repairs: frozenset[dt.date] = frozenset(),
) -> tuple[int, int, dict[dt.date, str]]:
    """``(current, best, state by day)`` for the days from the first active one to ``today``."""
    current, best, _, states, _, _ = _walk(active, today, freezes, repairs)
    return current, best, states


def _offer(states: dict[dt.date, str], runs: dict[dt.date, int], today: dt.date) -> Repair | None:
    """The repair on offer (§2.5): the days missed directly before today are one or two, and
    the day before them is covered, ending a run of ``L`` days. Each costs
    ``REPAIR_PER_DAY + L // 2``. ``None`` otherwise: a longer gap is past repair, and a gap
    with nothing before it (or only the time before the first active day) was never a run."""
    gap: list[dt.date] = []
    day = today - dt.timedelta(days=1)
    while states.get(day) == MISSED and len(gap) <= MAX_REPAIR_DAYS:
        gap.append(day)
        day -= dt.timedelta(days=1)
    if not gap or len(gap) > MAX_REPAIR_DAYS or states.get(day) not in _COVERED:
        return None
    per_day = REPAIR_PER_DAY + runs[day] // 2
    return Repair(days=tuple(reversed(gap)), per_day=per_day, cost=per_day * len(gap))


def _recent(states: dict[dt.date, str], today: dt.date) -> list[tuple[dt.date, str]]:
    window = [today - dt.timedelta(days=n) for n in range(RECENT_DAYS - 1, -1, -1)]
    # The walk covers the first active day to today without a gap, so a past day it did
    # not reach came before the streak began.
    return [(d, states.get(d, PENDING if d == today else BEFORE)) for d in window]


def _active_days(session: Session, user_id: uuid.UUID) -> dict[str, set[dt.date]]:
    """Every active day by module, for one read of the whole history. A row whose module
    has left the catalogue is ignored (§2.2)."""
    rows = session.execute(
        select(ActivityDay.module, ActivityDay.day).where(
            ActivityDay.user_id == user_id, ActivityDay.module.in_(ACTIVITY_MODULES)
        )
    )
    by_module: dict[str, set[dt.date]] = defaultdict(set)
    for module, day in rows:
        by_module[module].add(day)
    return by_module


def _of(by_module: dict[str, set[dt.date]], streak_id: str) -> set[dt.date]:
    """The days a streak counts: any module for ``overall``, its own for a module."""
    if streak_id == OVERALL:
        return set().union(*by_module.values())
    return by_module.get(streak_id, set())


def _purchases(session: Session, user_id: uuid.UUID) -> list[Purchase]:
    """Every purchase, for one read of the whole history (the same shape as activity)."""
    rows = session.execute(
        select(
            StreakPurchase.streak,
            StreakPurchase.kind,
            StreakPurchase.cost,
            StreakPurchase.bought_on,
            StreakPurchase.covers,
        ).where(StreakPurchase.user_id == user_id)
    )
    return [Purchase(*row) for row in rows]


def _freezes(bought: list[Purchase], streak_id: str) -> tuple[dt.date, ...]:
    """The days a streak's freezes were bought on."""
    return tuple(p.bought_on for p in bought if p.streak == streak_id and p.kind == FREEZE)


def _repairs(bought: list[Purchase], streak_id: str) -> frozenset[dt.date]:
    """The days a streak's repairs cover."""
    return frozenset(
        p.covers
        for p in bought
        if p.streak == streak_id and p.kind == REPAIR and p.covers is not None
    )


def _streak(
    streak_id: str, active: set[dt.date], today: dt.date, bought: list[Purchase]
) -> Streak:
    current, best, _, states, held, runs = _walk(
        active, today, _freezes(bought, streak_id), _repairs(bought, streak_id)
    )
    return Streak(
        id=streak_id,
        current=current,
        best=best,
        today_active=states.get(today) == ACTIVE,
        held_freezes=held,
        recent=_recent(states, today),
        repair=_offer(states, runs, today),
    )


def points(by_module: dict[str, set[dt.date]], bought: list[Purchase]) -> Points:
    """Earned, spent and the balance (§2.6). Earned is read off activity alone: a day
    overall is active, a day each of the ten module streaks is active (``app`` pays only
    through overall), and every milestone bonus. Nothing here looks at preferences, so
    switching a streak or a module off cannot move it.

    **Repairs are not in the earning walk** (§2.6): they keep the displayed run alive and
    cost points, but never add or remove a bonus. A milestone reached only across a repaired
    gap therefore pays nothing, which is the accepted cost of earned never decreasing.

    **Earned reads no clock at all.** Every stored row counts, and each streak's bonuses come
    from a walk that ends on its last active day, not on ``today``: an account moved to a zone
    further west has a local today *before* a day it already recorded, and earned must never
    decrease (§2.6). A frozen day after the last active day is not walked, so a milestone it
    would reach is paid once a later active day closes the run, never before, and moving the
    clock back cannot take it away again. ``current``, ``best`` and the dots stay bound to
    ``today``."""
    overall_days = _of(by_module, OVERALL)
    module_days = sum(len(by_module.get(m, ())) for m in MODULES)
    bonus = 0
    for streak_id in (OVERALL, *MODULES):
        days = _of(by_module, streak_id)
        if days:
            bonus += _walk(days, max(days), _freezes(bought, streak_id))[2]
    earned = len(overall_days) + module_days + bonus
    spent = sum(p.cost for p in bought)
    return Points(balance=earned - spent, earned=earned, spent=spent)


def read(
    session: Session, user_id: uuid.UUID, now: dt.datetime
) -> tuple[dt.date, list[Streak], Points]:
    """Today on the account's clock, every streak (overall, then one per module) and the
    points. Which streaks are shown is the client's call (§2.7); earning never depends on it."""
    today = local_day(session, user_id, now)
    by_module = _active_days(session, user_id)
    bought = _purchases(session, user_id)
    found = [_streak(sid, _of(by_module, sid), today, bought) for sid in (OVERALL, *MODULES)]
    return today, found, points(by_module, bought)


def on(session: Session, user_id: uuid.UUID, today: dt.date) -> dict[str, Streak]:
    """Every streak (overall, then one per module) as of ``today``, by id, from one read of
    the history. For callers that already hold the account's local day (the digest, 41.6):
    the same walk as ``read``, so a reminder and the card cannot disagree."""
    by_module = _active_days(session, user_id)
    bought = _purchases(session, user_id)
    return {sid: _streak(sid, _of(by_module, sid), today, bought) for sid in (OVERALL, *MODULES)}


def check_in(
    session: Session, user_id: uuid.UUID, streak_id: str, now: dt.datetime
) -> tuple[dt.date, Streak]:
    """Make today active for ``streak_id`` and answer with it. Idempotent. ``overall``
    writes ``app`` (the dashboard's own activity); a module id writes itself. Mood has no
    check-in: recording a mood is its check-in (§2.2), so a bare press cannot earn it."""
    if streak_id == OVERALL:
        module = APP
    elif streak_id in MODULES and streak_id != "mood":
        module = streak_id
    else:
        raise Invalid(f"{streak_id!r} is not a streak", "streak_unknown")
    today = local_day(session, user_id, now)
    record(session, user_id, module, today)
    by_module = _active_days(session, user_id)
    bought = _purchases(session, user_id)
    return today, _streak(streak_id, _of(by_module, streak_id), today, bought)


def _lock(session: Session, user_id: uuid.UUID) -> None:
    """Serialise this user's purchases until the transaction ends (§2.6). Taken **before**
    the balance is read: without it two requests both read "20 points", both pass the check
    and both insert. ``users`` itself cannot be locked, its grants are by column (AD-19)."""
    session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(CAST(:u AS text), 0))"),
        {"u": str(user_id)},
    )


def buy_freeze(
    session: Session, user_id: uuid.UUID, streak_id: str, now: dt.datetime
) -> tuple[Points, Streak]:
    """Buy one freeze for ``streak_id`` (§2.4). Refused with ``freeze_limit`` when two are
    already held, then with ``points_insufficient`` when the balance is under the price.
    Buying never makes a day: the endpoint is classified "counts nothing"."""
    if streak_id != OVERALL and streak_id not in MODULES:
        raise Invalid(f"{streak_id!r} is not a streak", "streak_unknown")
    _lock(session, user_id)
    today = local_day(session, user_id, now)
    by_module = _active_days(session, user_id)
    bought = _purchases(session, user_id)
    held = _streak(streak_id, _of(by_module, streak_id), today, bought).held_freezes
    if held >= MAX_HELD:
        raise Conflict(f"{MAX_HELD} freezes are already held", "freeze_limit")
    if points(by_module, bought).balance < FREEZE_COST:
        raise Conflict("Not enough points for a freeze", "points_insufficient")
    session.execute(
        insert(StreakPurchase).values(
            user_id=user_id, streak=streak_id, kind=FREEZE, cost=FREEZE_COST, bought_on=today
        )
    )
    bought = [*bought, Purchase(streak_id, FREEZE, FREEZE_COST, today, None)]
    return (
        points(by_module, bought),
        _streak(streak_id, _of(by_module, streak_id), today, bought),
    )


def buy_repair(
    session: Session, user_id: uuid.UUID, streak_id: str, now: dt.datetime, cost: int
) -> tuple[Points, Streak]:
    """Repair the days missed directly before today (§2.5): one row per day, ``covers = d``.
    ``cost`` is the total the person confirmed: the offer is priced again here, on this
    request's clock and history, and anything but the same number is ``repair_unavailable``
    (a page left open past midnight must not spend more than it showed).
    ``repair_unavailable`` when nothing is on offer, ``points_insufficient`` when the balance
    is under the price. The lock is taken first, as for a freeze. A second submit that still
    saw the offer would collide on ``(user_id, streak, covers)``; that one ``23505`` is
    ``repair_unavailable`` too and nothing else is caught. Never makes a day (AD-57)."""
    if streak_id != OVERALL and streak_id not in MODULES:
        raise Invalid(f"{streak_id!r} is not a streak", "streak_unknown")
    _lock(session, user_id)
    today = local_day(session, user_id, now)
    by_module = _active_days(session, user_id)
    bought = _purchases(session, user_id)
    offer = _streak(streak_id, _of(by_module, streak_id), today, bought).repair
    if offer is None:
        raise Conflict("There is nothing to repair", "repair_unavailable")
    if cost != offer.cost:
        raise Conflict("The price of this repair has changed", "repair_unavailable")
    if points(by_module, bought).balance < offer.cost:
        raise Conflict("Not enough points for this repair", "points_insufficient")
    try:
        with session.begin_nested():
            session.execute(
                insert(StreakPurchase),
                [
                    {
                        "user_id": user_id,
                        "streak": streak_id,
                        "kind": REPAIR,
                        "cost": offer.per_day,
                        "bought_on": today,
                        "covers": covered,
                    }
                    for covered in offer.days
                ],
            )
    except IntegrityError as error:
        if getattr(error.orig, "sqlstate", None) != "23505":
            raise
        raise Conflict("That repair was already bought", "repair_unavailable") from error
    bought = [
        *bought,
        *(Purchase(streak_id, REPAIR, offer.per_day, today, covered) for covered in offer.days),
    ]
    return (
        points(by_module, bought),
        _streak(streak_id, _of(by_module, streak_id), today, bought),
    )
