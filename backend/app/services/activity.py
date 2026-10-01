"""Activity: a day is active once, and stored (Epic 41, AD-57).

The one fact about a day that cannot be recomputed. No module's own rows can say "something
was done today": an edit or a delete leaves no trace there. So a router dependency writes
one row per ``(user, local day, module)`` after the handler returned without raising, in
the same transaction, and a Check in writes the same row. Everything else about a streak
is computed on read (``services/streaks.py``).

Two things live here and nowhere else:

* the **route map**: which URL prefix counts for which module, and which prefixes count for
  nothing. ``tests/test_activity_map.py`` fails any write route under neither, so a new
  router cannot ship without being classified;
* :func:`record_activity`, the dependency that reads the map.
"""

import datetime as dt
import uuid
from collections.abc import Iterator

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.clock import Now, local_today
from app.core.deps import CurrentUserId, DbSession
from app.models.activity import ActivityDay
from app.models.user import User

#: The dashboard's own activity. It counts for the overall streak only and has no streak of
#: its own; a Check in on the dashboard writes it.
APP = "app"

#: Modules with a streak of their own. A Python tuple, not a database CHECK, so a later
#: module adds a streak with one entry here and one line in :data:`ROUTE_MODULES`.
MODULES: tuple[str, ...] = (
    "entries",
    "plan",
    "grow",
    "habits",
    "mood",
    "books",
    "stock",
    "gym",
    "recipes",
    "notes",
)

#: Every id an activity row may carry. Rows whose id has left this tuple are ignored on
#: read, the way AD-49 treats a preference id that no longer exists.
ACTIVITY_MODULES: tuple[str, ...] = (*MODULES, APP)

#: URL prefix -> the module a successful write under it counts for.
ROUTE_MODULES: dict[str, str] = {
    "/api/entries": "entries",
    "/api/vendors": "entries",
    "/api/budgets": "plan",
    "/api/categories": "plan",
    "/api/recurring": "plan",
    "/api/savings": "grow",
    "/api/habits": "habits",
    "/api/mood": "mood",
    "/api/books": "books",
    "/api/inventory": "stock",  # the shopping list lives there
    "/api/gym": "gym",
    "/api/recipes": "recipes",
    "/api/foods": "recipes",
    "/api/meals": "recipes",
    "/api/notes": "notes",
    "/api/dashboard": APP,
}

#: Prefixes whose writes are deliberately not a day's work: signing in, settings and
#: preferences (all under ``/api/auth``), push subscriptions, export, the operator's screens,
#: the calendar feed's own settings, and the streaks' own endpoints (a check-in writes its
#: row itself, and buying help must not make a day).
COUNTS_NOTHING: tuple[str, ...] = (
    "/api/auth",
    "/api/push",
    "/api/export",
    "/api/admin",
    "/api/calendar",
    "/api/streaks",
)

WRITE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def module_for(path: str) -> str | None:
    """The module a path counts for, or None when it is listed as counting nothing (or is
    not listed at all, which the map test refuses for a write route)."""
    for prefix, module in ROUTE_MODULES.items():
        if path == prefix or path.startswith(prefix + "/"):
            return module
    return None


def is_classified(path: str) -> bool:
    return module_for(path) is not None or any(
        path == prefix or path.startswith(prefix + "/") for prefix in COUNTS_NOTHING
    )


def local_day(session: Session, user_id: uuid.UUID, now: dt.datetime) -> dt.date:
    """The account's date at ``now``. The column is named because grants on ``users`` are by
    column (AD-19); no zone means the host clock, as for the digest."""
    timezone = session.execute(select(User.timezone).where(User.id == user_id)).scalar_one_or_none()
    return local_today(timezone, now)


def record(session: Session, user_id: uuid.UUID, module: str, day: dt.date) -> None:
    """Make ``day`` active for ``module``. Idempotent: the primary key is the day's identity,
    and the conflicting row is always the caller's own, so RLS has nothing to hide from
    ``ON CONFLICT``."""
    session.execute(
        insert(ActivityDay)
        .values(user_id=user_id, day=day, module=module)
        .on_conflict_do_nothing(index_elements=["user_id", "day", "module"])
    )


def record_activity(module: str):
    """A router dependency: a write that returned without raising makes today active.

    Written after the ``yield``, so a handler that raised (a refusal, a 422 from the
    service) records nothing and the request rolls back whole. It depends on the request's
    own session with ``scope="function"``, so it exits **before** that session commits
    (lab note 2026-09-20): the activity row lands in the write's transaction and rolls
    back with it. A 422 from FastAPI's own body validation never reaches the handler, and
    the dependency's exit is given that exception too.
    """

    def dependency(
        request: Request, user_id: CurrentUserId, session: DbSession, now: Now
    ) -> Iterator[None]:
        yield
        if request.method in WRITE_METHODS:
            record(session, user_id, module, local_day(session, user_id, now))

    dependency._activity_module = module  # type: ignore[attr-defined]  # the map test reads it
    return Depends(dependency, scope="function")
