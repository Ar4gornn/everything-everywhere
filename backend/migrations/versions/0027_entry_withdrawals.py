"""An expense paid from a pot (Epic 35, Story 35.2, AD-51).

``savings_contributions.entry_id`` links a withdrawal to the expense it paid for. The
expense still counts as spending; the withdrawal is what lowers the pot. One write makes
both, and the withdrawal belongs to the entry:

* **Composite** foreign key ``(user_id, entry_id)`` to ``entries (user_id, id)`` — lab note:
  foreign-key checks bypass RLS, so a single-column key would let one account attach a
  withdrawal to another's entry id. ``entries_user_id_id_key`` exists since 0010.
* ``ON DELETE CASCADE``: deleting the entry removes its withdrawal. Removing a withdrawal
  can only raise a balance, so the cascade can never overdraw a pot.
* **Unique**: one entry, at most one pot (splitting across pots is explicitly out).
* **CHECK** ``entry_id IS NULL OR kind = 'withdrawal'``: a deposit paid for by an expense
  means nothing.

**What the schema does not hold:** that the entry is an expense, and that the withdrawal's
amount and date match the entry's. ``services/ledger.py`` writes both sides together, and
``services/savings.py`` refuses to edit or delete the withdrawal on its own.

Revision ID: 0027
Revises: 0025
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0027"
down_revision: str | None = "0025"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "savings_contributions",
        sa.Column("entry_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "savings_contributions_entry_fkey",
        "savings_contributions",
        "entries",
        ["user_id", "entry_id"],
        ["user_id", "id"],
        ondelete="CASCADE",
    )
    op.create_unique_constraint(
        "savings_contributions_entry_id_key", "savings_contributions", ["entry_id"]
    )
    op.create_check_constraint(
        "savings_contributions_entry_is_withdrawal",
        "savings_contributions",
        "entry_id IS NULL OR kind = 'withdrawal'",
    )


def downgrade() -> None:
    op.drop_constraint("savings_contributions_entry_is_withdrawal", "savings_contributions")
    op.drop_constraint(
        "savings_contributions_entry_id_key", "savings_contributions", type_="unique"
    )
    op.drop_constraint(
        "savings_contributions_entry_fkey", "savings_contributions", type_="foreignkey"
    )
    op.drop_column("savings_contributions", "entry_id")
