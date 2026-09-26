"""Notification control: muted items, the account's timezone and digest time (Epic 36, AD-52).

Three changes, one purpose — the person decides what the daily digest says and when:

* ``notify`` on ``savings_types``, ``recurring_templates`` and ``inventory_items`` —
  default true, so every row keeps being mentioned exactly as before. The digest skips a
  row set to false; the page that lists it does not change. Habits already have ``remind``
  (opt-in, Epic 26) and are left alone.
* ``users.timezone`` / ``users.digest_time`` — when "today" starts for this person, and at
  what local hour the digest may go. A null zone keeps the host's clock, which is what every
  account had until now. The zone is validated against ``zoneinfo`` in the service: a CHECK
  cannot call it, and a list of names in the schema would go stale with the tz database.
* ``push_subscriptions.tested_at`` — the last "Send test" to this device. A column, not an
  in-process counter, so the one-a-minute limit survives a restart and a second worker.

The kinds of notification (stock, recurring, …) are not here: they are a key of the
account's ``preferences`` (AD-49), sparse, so no data is written for them.

Revision ID: 0028
Revises: 0025

0027 is Epic 35's (plan ↔ entries), on its own branch. Whichever lands on ``main`` second
re-points its ``down_revision`` at the other.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from migrations.rls import APP_ROLE

revision: str = "0028"
down_revision: str | None = "0025"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_MUTABLE = ("savings_types", "recurring_templates", "inventory_items")


def upgrade() -> None:
    for table in _MUTABLE:
        op.add_column(
            table,
            sa.Column("notify", sa.Boolean(), nullable=False, server_default=sa.true()),
        )

    op.add_column("users", sa.Column("timezone", sa.String(64), nullable=True))
    op.add_column(
        "users",
        sa.Column(
            "digest_time", sa.Time(), nullable=False, server_default=sa.text("'19:00'::time")
        ),
    )
    # The shape only; whether the name is a real zone is the service's question.
    op.create_check_constraint(
        "users_timezone_not_blank", "users", "timezone IS NULL OR length(btrim(timezone)) > 0"
    )
    # AD-19: the runtime role reads users by named columns, so a new column is invisible to
    # it until granted explicitly.
    for column in ("timezone", "digest_time"):
        for privilege in ("SELECT", "INSERT", "UPDATE"):
            op.execute(f'GRANT {privilege} ({column}) ON users TO "{APP_ROLE}"')

    op.add_column(
        "push_subscriptions",
        sa.Column("tested_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("push_subscriptions", "tested_at")
    op.drop_constraint("users_timezone_not_blank", "users", type_="check")
    op.drop_column("users", "digest_time")
    op.drop_column("users", "timezone")
    for table in _MUTABLE:
        op.drop_column(table, "notify")
