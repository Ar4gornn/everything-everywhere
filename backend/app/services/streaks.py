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


def walk(active: set[dt.date], today: dt.date) -> tuple[int, int, dict[dt.date, str]]:
    """``(current, best, state by day)`` for the days from the first active one to ``today``."""
    days = {day for day in active if day <= today}
    states: dict[dt.date, str] = {}
    run = best = 0
    if days:
        day = min(days)
        while day <= today:
            if day in days:
                states[day] = ACTIVE
                run += 1
            elif day == today:
                states[day] = PENDING
            else:
                states[day] = MISSED
                run = 0
            best = max(best, run)
            day += dt.timedelta(days=1)
    return run, best, states


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
    current, best, states = walk(active, today)
    return Streak(
        id=streak_id,
        current=current,
        best=best,
        today_active=states.get(today) == ACTIVE,
        recent=_recent(states, today),
    )


def read(session: Session, user_id: uuid.UUID, now: dt.datetime) -> tuple[dt.date, list[Streak]]:
    """Today on the account's clock, and every streak: overall, then one per module. Which
    are shown is the client's call (§2.7); earning never depends on it."""
    today = local_day(session, user_id, now)
    by_module = _active_days(session, user_id)
    return today, [_streak(sid, _of(by_module, sid), today) for sid in (OVERALL, *MODULES)]


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
