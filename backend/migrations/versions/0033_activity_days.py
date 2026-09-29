"""Activity days: which days something was done, and in which module (Epic 41, AD-57).

One row per user, local day and module, written at most once by a router dependency inside
the write's own transaction (or by a Check in). It is the one fact about a day that cannot
be recomputed from the modules' own rows, because an edit or a delete leaves no trace there.
Every streak is walked from these rows on read.

Append-only by grant: the runtime role may read and add, never rewrite or erase, and the
"earned points never decrease" invariant of AD-57 rests on that. The module id is a
``text`` column with a length check and **no** list of allowed values: a later module gets a
streak from one entry in ``services/activity.py``, not from a migration.

There is no foreign key to another user-scoped table, so the composite-FK rule of AD-1 has
nothing to apply to; the key to ``users`` is the tenancy itself.

Numbered 0033 after 0032, the head.

Revision ID: 0033
Revises: 0032
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from migrations.rls import protect, unprotect

revision: str = "0033"
down_revision: str | None = "0032"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "activity_days",
        sa.Column(
            "user_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("module", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("user_id", "day", "module"),
        sa.CheckConstraint("length(module) BETWEEN 1 AND 32", name="activity_days_module_length"),
    )
    protect("activity_days", grants="SELECT, INSERT")


def downgrade() -> None:
    unprotect("activity_days")
    op.drop_table("activity_days")
