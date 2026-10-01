"""Streaks: computed on read from the activity days (Epic 41, AD-57).

Nothing here is stored. A streak is a walk forward over the days on which something was
done (``services/activity.py``), so a later fix to the rules corrects the past too, and a
timezone change cannot leave a stale copy behind.

Stories 41.1 and 41.2 walk the **overall** streak and one streak per module; 41.4 adds the
freeze to the walk. A covered day is one of several states, which is where a repair (41.5)
arrives as well.

Rules, defined here once (§2.3 of ``docs/epic-41-streaks.md``):

* ``active``: something was done that day;
* ``pending``: it is today and nothing was done yet, so nothing is lost until the local
  midnight;
* ``frozen``: it was missed, the run was going, and a held freeze bought on or before it
  was consumed (the oldest first). The run goes on and the day earns nothing;
* ``missed``: anything else.

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

#: What a freeze costs and how many one streak may hold at once (§2.4). Returned by ``GET``
#: so the client never hardcodes a price.
FREEZE_COST = 20
MAX_HELD = 2

FREEZE = "freeze"
REPAIR = "repair"


@dataclass(frozen=True)
class Streak:
    id: str
    current: int
    best: int
    today_active: bool
    held_freezes: int
    recent: list[tuple[dt.date, str]]


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
    active: set[dt.date], today: dt.date, freezes: tuple[dt.date, ...] = ()
) -> tuple[int, int, int, dict[dt.date, str], int]:
    """``(current, best, bonus, state by day, freezes held)``. The bonus is paid on the day a
    run reaches a milestone length, frozen days included, so a run that breaks and climbs
    again pays again. ``freezes`` are the days the streak's freezes were bought on."""
    days = {day for day in active if day <= today}
    bought = sorted(freezes)  # oldest first, so the next one up is bought[used]
    used = 0
    states: dict[dt.date, str] = {}
    run = best = bonus = 0
    if days:
        day = min(days)
        while day <= today:
            if day in days:
                states[day] = ACTIVE
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
            day += dt.timedelta(days=1)
    return run, best, bonus, states, len(bought) - used


def walk(
    active: set[dt.date], today: dt.date, freezes: tuple[dt.date, ...] = ()
) -> tuple[int, int, dict[dt.date, str]]:
    """``(current, best, state by day)`` for the days from the first active one to ``today``."""
    current, best, _, states, _ = _walk(active, today, freezes)
    return current, best, states


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


def _streak(
    streak_id: str, active: set[dt.date], today: dt.date, bought: list[Purchase]
) -> Streak:
    current, best, _, states, held = _walk(active, today, _freezes(bought, streak_id))
    return Streak(
        id=streak_id,
        current=current,
        best=best,
        today_active=states.get(today) == ACTIVE,
        held_freezes=held,
        recent=_recent(states, today),
    )


def points(by_module: dict[str, set[dt.date]], bought: list[Purchase]) -> Points:
    """Earned, spent and the balance (§2.6). Earned is read off activity alone: a day
    overall is active, a day each of the ten module streaks is active (``app`` pays only
    through overall), and every milestone bonus. Nothing here looks at preferences, so
    switching a streak or a module off cannot move it.

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
