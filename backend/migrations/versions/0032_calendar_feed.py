"""A calendar feed: one secret URL per account that calendar apps subscribe to (AD-55).

A calendar app cannot sign in, so the URL is the credential. The table keeps only the
SHA-256 of the token (256 random bits, the same reasoning as ``refresh_tokens`` in 0005),
which layers the person chose to send, whether titles carry names and amounts, and whether
events carry an alarm. ``user_id`` is the primary key: one feed per account, and "New URL"
is an UPDATE of the hash, never a second row.

The fetch arrives with no tenant, so the lookup is ``calendar_feed_lookup``, AD-19's narrow
hole once more: a hash in, one owner out, no listing.

Numbered 0032 after 0031, the head.

Revision ID: 0032
Revises: 0031
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from migrations.rls import APP_ROLE, protect, unprotect

revision: str = "0032"
down_revision: str | None = "0031"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: Mirrors ``app.services.calendar_feed.LAYERS``; a test holds the two equal.
_LAYERS = ("due", "money", "savings", "stock", "gym", "habits", "schedule", "mood", "meals")


def upgrade() -> None:
    uuid_type = sa.dialects.postgresql.UUID(as_uuid=True)
    allowed = ", ".join(f"'{layer}'" for layer in _LAYERS)

    op.create_table(
        "calendar_feeds",
        sa.Column(
            "user_id",
            uuid_type,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column(
            "layers",
            sa.dialects.postgresql.ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text("ARRAY['due']::text[]"),
        ),
        sa.Column("detailed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("alarm", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("last_fetched_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(f"layers <@ ARRAY[{allowed}]::text[]", name="calendar_feeds_layers"),
    )
    protect("calendar_feeds")

    op.execute(
        """
        CREATE FUNCTION calendar_feed_lookup(p_token_hash text)
        RETURNS uuid
        LANGUAGE sql
        STABLE
        SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
            SELECT f.user_id FROM calendar_feeds f WHERE f.token_hash = p_token_hash
        $$;
        """
    )
    op.execute("REVOKE ALL ON FUNCTION calendar_feed_lookup(text) FROM PUBLIC")
    op.execute(f'GRANT EXECUTE ON FUNCTION calendar_feed_lookup(text) TO "{APP_ROLE}"')


def downgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS calendar_feed_lookup(text)")
    unprotect("calendar_feeds")
    op.drop_table("calendar_feeds")
