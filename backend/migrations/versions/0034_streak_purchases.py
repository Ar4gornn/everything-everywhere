"""Streak purchases: what was bought with points (Epic 41, AD-57).

The only stored fact about points. Earned is computed from activity on every read; the
balance is earned minus the sum of ``cost`` here. One row is one purchase: a ``freeze``
bought ahead (Story 41.4), or a ``repair`` of one missed day, ``covers`` that day (41.5, so
that story needs no migration of its own).

Append-only by grant, like ``activity_days``: the runtime role may read and add, never
rewrite or erase. "Earned never decreases" and "a balance checked at purchase time cannot
go negative later" both rest on that.

``UNIQUE (user_id, streak, covers)`` stops a repair being bought twice for the same day;
``covers`` is NULL for a freeze and NULLs are distinct, so any number of freezes may exist.
No foreign key to another user-scoped table, so the composite-FK rule of AD-1 has nothing
to apply to; the key to ``users`` is the tenancy itself.

Revision ID: 0034
Revises: 0033
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from migrations.rls import protect, unprotect

revision: str = "0034"
down_revision: str | None = "0033"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "streak_purchases",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "user_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("streak", sa.Text(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("cost", sa.Integer(), nullable=False),
        sa.Column("bought_on", sa.Date(), nullable=False),
        sa.Column("covers", sa.Date(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "length(streak) BETWEEN 1 AND 32", name="streak_purchases_streak_length"
        ),
        sa.CheckConstraint("kind IN ('freeze', 'repair')", name="streak_purchases_kind"),
        sa.CheckConstraint("cost > 0", name="streak_purchases_cost_positive"),
        sa.CheckConstraint(
            "(kind = 'repair') = (covers IS NOT NULL)", name="streak_purchases_covers_iff_repair"
        ),
        sa.UniqueConstraint("user_id", "streak", "covers", name="streak_purchases_covers_key"),
    )
    protect("streak_purchases", grants="SELECT, INSERT")


def downgrade() -> None:
    unprotect("streak_purchases")
    op.drop_table("streak_purchases")
