"""Offline entries: the ref a phone coined for an entry (Epic 45, AD-61).

- ``entries.client_ref``: minted by the device when an entry is queued. ``UNIQUE (user_id,
  client_ref)`` makes ``POST /api/entries`` idempotent for a resend whose first answer was lost.
  Scoped to ``user_id`` like every key here, so a conflict never meets a row RLS hides. Null for
  every entry written without one (the desktop form, everything before this migration); a
  unique constraint treats NULLs as distinct, so they never collide.

Revision ID: 0037
Revises: 0036
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0037"
down_revision: str | None = "0036"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE entries
            ADD COLUMN client_ref uuid,
            ADD CONSTRAINT entries_user_client_ref_key UNIQUE (user_id, client_ref)
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE entries
            DROP CONSTRAINT entries_user_client_ref_key,
            DROP COLUMN client_ref
        """
    )
