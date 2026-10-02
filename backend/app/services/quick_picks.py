"""Epic 44 (AD-60): the quick-add sheet's chips, computed in SQL.

Spec: `docs/epic-44-quick-add.md` §3 — the ordering rules there are the contract and each one
has a test in `tests/test_quick_picks.py`.

AD-9: aggregates in SQL, nothing counted row by row in Python. AD-1: every query carries an
explicit ``user_id`` filter on top of row-level security.
"""

import datetime as dt
import uuid

from sqlalchemy.orm import Session

from app.models.ledger import EntryKind
from app.schemas.quick_picks import (
    MAX_CATEGORIES,
    MAX_COMBOS,
    MAX_VENDORS,
    WINDOW_DAYS,
    CategoryPick,
    Combo,
    KindPicks,
    QuickPicksOut,
    VendorPick,
)

__all__ = [
    "MAX_CATEGORIES",
    "MAX_COMBOS",
    "MAX_VENDORS",
    "WINDOW_DAYS",
    "quick_picks",
]


def category_picks(
    session: Session, user_id: uuid.UUID, kind: EntryKind, today: dt.date
) -> list[CategoryPick]:
    """Used categories of ``kind`` in ``(today - WINDOW_DAYS, today]`` ranked by count, latest
    ``occurred_on``, latest ``created_at``, ``lower(name)``, ``id``; padded to
    ``MAX_CATEGORIES`` with unused ones by ``categories.created_at`` desc, ``id``."""
    raise NotImplementedError


def combo_picks(
    session: Session, user_id: uuid.UUID, kind: EntryKind, today: dt.date
) -> list[Combo]:
    """Distinct ``(category_id, vendor_id, amount)`` of ``kind`` in the window, newest group
    first (latest ``occurred_on``, then latest ``created_at``); at most ``MAX_COMBOS``."""
    raise NotImplementedError


def vendor_picks(session: Session, user_id: uuid.UUID) -> list[VendorPick]:
    """Each vendor's most recent entry (all time): ``occurred_on`` desc, ``created_at`` desc,
    ``id`` desc. Newest first; at most ``MAX_VENDORS``."""
    raise NotImplementedError


def quick_picks(session: Session, user_id: uuid.UUID, today: dt.date) -> QuickPicksOut:
    return QuickPicksOut(
        expense=KindPicks(
            categories=category_picks(session, user_id, EntryKind.expense, today),
            combos=combo_picks(session, user_id, EntryKind.expense, today),
        ),
        income=KindPicks(
            categories=category_picks(session, user_id, EntryKind.income, today),
            combos=combo_picks(session, user_id, EntryKind.income, today),
        ),
        vendors=vendor_picks(session, user_id),
    )
