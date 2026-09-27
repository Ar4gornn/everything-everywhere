"""A category's default pot (Epic 35, Story 35.3, AD-51).

``categories.default_savings_type_id`` names the pot an expense in this category is usually
paid from. It only pre-fills the entry form: nothing reads it on the server when an entry is
written, and setting or clearing it never touches an existing entry.

* **Composite** foreign key ``(user_id, default_savings_type_id)`` to
  ``savings_types (user_id, id)`` — foreign-key checks bypass RLS, so a single-column key
  would let one account point a category at another's pot. ``savings_types_user_id_id_key``
  exists since 0001.
* ``ON DELETE SET NULL (default_savings_type_id)``: deleting the pot forgets the default.
  The column-list form, as in 0010/0011/0014/0021 — a plain composite SET NULL would null
  ``user_id`` too, which is NOT NULL, and the delete would fail. SQLAlchemy cannot express
  the column list, hence raw SQL.
* **CHECK** ``default_savings_type_id IS NULL OR kind = 'expense'``: an income is never paid
  from a pot (AD-51), so neither is its category.

Numbered 0029: Epic 36 holds 0028 on its own branch.

Revision ID: 0029
Revises: 0027
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0029"
down_revision: str | None = "0027"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "categories",
        sa.Column(
            "default_savings_type_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True
        ),
    )
    op.execute(
        "ALTER TABLE categories ADD CONSTRAINT categories_default_pot_fkey "
        "FOREIGN KEY (user_id, default_savings_type_id) "
        "REFERENCES savings_types (user_id, id) "
        "ON DELETE SET NULL (default_savings_type_id)"
    )
    op.create_check_constraint(
        "categories_default_pot_expense_only",
        "categories",
        "default_savings_type_id IS NULL OR kind = 'expense'",
    )


def downgrade() -> None:
    op.drop_constraint("categories_default_pot_expense_only", "categories")
    op.drop_constraint("categories_default_pot_fkey", "categories", type_="foreignkey")
    op.drop_column("categories", "default_savings_type_id")
