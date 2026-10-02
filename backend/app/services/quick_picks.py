"""Epic 44 (AD-60): the quick-add sheet's chips, computed in SQL.

Spec: `docs/epic-44-quick-add.md` §3 — the ordering rules there are the contract and each one
has a test in `tests/test_quick_picks.py`.

AD-9: aggregates in SQL, nothing counted row by row in Python. AD-1: every query carries an
explicit ``user_id`` filter on top of row-level security.
"""

import datetime as dt
import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.ledger import Category, Entry, EntryKind, Vendor
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


def window_start(today: dt.date) -> dt.date:
    """First day inside the window. Day 0 is ``today`` and day ``WINDOW_DAYS`` is still in:
    ``today - 90`` counts, ``today - 91`` does not. (The spec writes ``>= today - 90 days``;
    the schema's half-open phrasing is the looser sentence.) Future-dated entries are out."""
    return today - dt.timedelta(days=WINDOW_DAYS)


def category_picks(
    session: Session, user_id: uuid.UUID, kind: EntryKind, today: dt.date
) -> list[CategoryPick]:
    """Used categories of ``kind`` with an entry in ``[today - WINDOW_DAYS, today]`` ranked by
    count, latest ``occurred_on``, latest ``created_at``, ``lower(name)``, ``id``; padded to
    ``MAX_CATEGORIES`` with unused ones by ``categories.created_at`` desc, ``id``."""
    uses = func.count(Entry.id)
    used_rows = session.execute(
        select(Category.id, Category.name, Category.default_savings_type_id, uses)
        .join(Entry, (Entry.user_id == Category.user_id) & (Entry.category_id == Category.id))
        .where(
            Category.user_id == user_id,
            Category.kind == kind,
            Entry.user_id == user_id,
            Entry.kind == kind,
            Entry.occurred_on >= window_start(today),
            Entry.occurred_on <= today,
        )
        .group_by(Category.id, Category.name, Category.default_savings_type_id)
        .order_by(
            uses.desc(),
            func.max(Entry.occurred_on).desc(),
            func.max(Entry.created_at).desc(),
            func.lower(Category.name),
            Category.id,
        )
        .limit(MAX_CATEGORIES)
    ).all()
    picks = [
        CategoryPick(
            id=r.id,
            name=r.name,
            uses=r[3],
            default_savings_type_id=(
                r.default_savings_type_id if kind == EntryKind.expense else None
            ),
        )
        for r in used_rows
    ]
    room = MAX_CATEGORIES - len(picks)
    if room > 0:
        # Fewer than MAX used categories means the query above returned every used one.
        pad = session.execute(
            select(Category.id, Category.name, Category.default_savings_type_id)
            .where(
                Category.user_id == user_id,
                Category.kind == kind,
                Category.id.not_in([p.id for p in picks]),
            )
            .order_by(Category.created_at.desc(), Category.id)
            .limit(room)
        ).all()
        picks += [
            CategoryPick(
                id=r.id,
                name=r.name,
                uses=0,
                default_savings_type_id=r.default_savings_type_id
                if kind == EntryKind.expense
                else None,
            )
            for r in pad
        ]
    return picks


def combo_picks(
    session: Session, user_id: uuid.UUID, kind: EntryKind, today: dt.date
) -> list[Combo]:
    """Distinct ``(category_id, vendor_id, amount)`` of ``kind`` in the window, newest group
    first (latest ``occurred_on``, then latest ``created_at``); at most ``MAX_COMBOS``."""
    rows = session.execute(
        select(Entry.category_id, Category.name, Entry.vendor_id, Vendor.name, Entry.amount)
        .join(Category, (Category.user_id == Entry.user_id) & (Category.id == Entry.category_id))
        .outerjoin(Vendor, (Vendor.user_id == Entry.user_id) & (Vendor.id == Entry.vendor_id))
        .where(
            Entry.user_id == user_id,
            Entry.kind == kind,
            Entry.occurred_on >= window_start(today),
            Entry.occurred_on <= today,
        )
        .group_by(Entry.category_id, Category.name, Entry.vendor_id, Vendor.name, Entry.amount)
        .order_by(
            func.max(Entry.occurred_on).desc(),
            func.max(Entry.created_at).desc(),
            Entry.category_id,
            Entry.vendor_id,
            Entry.amount,
        )
        .limit(MAX_COMBOS)
    ).all()
    return [
        Combo(
            category_id=r[0],
            category_name=r[1],
            vendor_id=r[2],
            vendor_name=r[3],
            amount=r[4],
        )
        for r in rows
    ]


def vendor_picks(session: Session, user_id: uuid.UUID) -> list[VendorPick]:
    """Each vendor's most recent entry (all time): ``occurred_on`` desc, ``created_at`` desc,
    ``id`` desc. Newest first; at most ``MAX_VENDORS``."""
    latest = (
        select(
            Entry.vendor_id.label("vendor_id"),
            Entry.kind.label("kind"),
            Entry.category_id.label("category_id"),
            Entry.occurred_on.label("occurred_on"),
            Entry.created_at.label("created_at"),
            Entry.id.label("id"),
        )
        .where(Entry.user_id == user_id, Entry.vendor_id.is_not(None))
        .distinct(Entry.vendor_id)
        .order_by(
            Entry.vendor_id,
            Entry.occurred_on.desc(),
            Entry.created_at.desc(),
            Entry.id.desc(),
        )
        .subquery()
    )
    rows = session.execute(
        select(latest.c.vendor_id, Vendor.name, latest.c.kind, latest.c.category_id, Category.name)
        .join(Vendor, (Vendor.user_id == user_id) & (Vendor.id == latest.c.vendor_id))
        .join(Category, (Category.user_id == user_id) & (Category.id == latest.c.category_id))
        .order_by(
            latest.c.occurred_on.desc(),
            latest.c.created_at.desc(),
            latest.c.id.desc(),
        )
        .limit(MAX_VENDORS)
    ).all()
    return [
        VendorPick(
            vendor_id=r[0], vendor_name=r[1], kind=r[2], category_id=r[3], category_name=r[4]
        )
        for r in rows
    ]


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
