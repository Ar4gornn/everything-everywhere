"""Streaks: computed on read from the activity days (Epic 41, AD-57).

Nothing here is stored. A streak is a walk forward over the days on which something was
done (``services/activity.py``), so a later fix to the rules corrects the past too, and a
timezone change cannot leave a stale copy behind.

Stories 41.1 and 41.2 walk the **overall** streak and one streak per module, without
freezes or repairs; the walk is written so that a covered day is one of several states,
which is where those arrive.

Rules, defined here once (§2.3 of ``docs/epic-41-streaks.md``):

* ``active``: something was done that day;
* ``pending``: it is today and nothing was done yet, so nothing is lost until the local
  midnight;
* ``missed``: anything else.

Points (§2.6), also computed and never stored: +1 for each day overall is active, +1 for
each (day, module) active for **all ten** module streaks (shown or not: hiding a streak
must never take points back), and a bonus each time a run reaches exactly 7, 30, 100 or
365 days. Spending arrives with the shop (41.4), so ``spent`` is 0 until purchases exist.

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

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import Invalid
from app.models.activity import ActivityDay
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


@dataclass(frozen=True)
class Streak:
    id: str
    current: int
    best: int
    today_active: bool
    recent: list[tuple[dt.date, str]]
    #: Milestone bonus this streak has paid, for the points total (§2.6).
    bonus: int = 0


@dataclass(frozen=True)
class Points:
    balance: int
    earned: int
    spent: int


def _walk(active: set[dt.date], today: dt.date) -> tuple[int, int, int, dict[dt.date, str]]:
    """``(current, best, bonus, state by day)``. The bonus is paid on the day a run reaches
    a milestone length, so a run that breaks and climbs again pays again."""
    days = {day for day in active if day <= today}
    states: dict[dt.date, str] = {}
    run = best = bonus = 0
    if days:
        day = min(days)
        while day <= today:
            if day in days:
                states[day] = ACTIVE
                run += 1
                bonus += _BONUS.get(run, 0)
            elif day == today:
                states[day] = PENDING
            else:
                states[day] = MISSED
                run = 0
            best = max(best, run)
            day += dt.timedelta(days=1)
    return run, best, bonus, states


def walk(active: set[dt.date], today: dt.date) -> tuple[int, int, dict[dt.date, str]]:
    """``(current, best, state by day)`` for the days from the first active one to ``today``."""
    current, best, _, states = _walk(active, today)
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


def _streak(streak_id: str, active: set[dt.date], today: dt.date) -> Streak:
    current, best, bonus, states = _walk(active, today)
    return Streak(
        id=streak_id,
        current=current,
        best=best,
        today_active=states.get(today) == ACTIVE,
        recent=_recent(states, today),
        bonus=bonus,
    )


def points(by_module: dict[str, set[dt.date]], found: list[Streak], today: dt.date) -> Points:
    """Earned, spent and the balance (§2.6). Earned is read off activity alone: a day
    overall is active, a day each of the ten module streaks is active (``app`` pays only
    through overall), and every milestone bonus. Nothing here looks at preferences, so
    switching a streak or a module off cannot move it. Days after local ``today`` are
    ignored, as the walk ignores them."""
    overall_days = {d for d in _of(by_module, OVERALL) if d <= today}
    module_days = sum(len({d for d in by_module.get(m, ()) if d <= today}) for m in MODULES)
    earned = len(overall_days) + module_days + sum(s.bonus for s in found)
    spent = 0  # purchases arrive with 41.4
    return Points(balance=earned - spent, earned=earned, spent=spent)


def read(
    session: Session, user_id: uuid.UUID, now: dt.datetime
) -> tuple[dt.date, list[Streak], Points]:
    """Today on the account's clock, every streak (overall, then one per module) and the
    points. Which streaks are shown is the client's call (§2.7); earning never depends on it."""
    today = local_day(session, user_id, now)
    by_module = _active_days(session, user_id)
    found = [_streak(sid, _of(by_module, sid), today) for sid in (OVERALL, *MODULES)]
    return today, found, points(by_module, found, today)


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
    return today, _streak(streak_id, _of(_active_days(session, user_id), streak_id), today)
