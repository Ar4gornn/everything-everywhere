"""What a closed month left over, dismissed (Epic 35, Story 35.4, AD-51).

The dashboard proposes the previous budget month's leftover — income, less expenses, less
net savings — as a deposit into a pot. Depositing it answers the proposal by itself: the
deposit is dated inside that month, so the leftover it is computed from drops to zero.
"Not this time" has no such trace, so it is a row here, keyed by the month's *label* like
``savings_skips`` (AD-50), because the proposal is computed per label.

No pot column: the dismissal is of the month, not of a pot.

Numbered 0030 after 0029; Epic 36 holds 0028 on its own branch.

Revision ID: 0030
Revises: 0029
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from migrations.rls import protect

revision: str = "0030"
down_revision: str | None = "0029"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    uuid_type = sa.dialects.postgresql.UUID(as_uuid=True)
    op.create_table(
        "leftover_dismissals",
        sa.Column(
            "user_id", uuid_type, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("month", sa.String(7), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("user_id", "month", name="leftover_dismissals_pkey"),
        sa.CheckConstraint(
            r"month ~ '^\d{4}-(0[1-9]|1[0-2])$'", name="leftover_dismissals_month_shape"
        ),
    )
    protect("leftover_dismissals")


def downgrade() -> None:
    op.drop_table("leftover_dismissals")
