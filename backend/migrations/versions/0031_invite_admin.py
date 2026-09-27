"""Invites issued from the web client, by an admin (AD-54).

Until now an invite could only be minted by `backend/invite.py`, as the owner role: the
runtime role had SELECT and UPDATE on `invites` and no INSERT. This keeps the missing INSERT
and adds one narrow door instead, the same shape as `auth_lookup` (AD-19):

* ``users.is_admin`` — false for everyone. The runtime role may **read** it and may never
  write it; only the owner sets it, through `backend/admin.py`.
* ``invite_issue(code_hash, note, days)`` — SECURITY DEFINER. It inserts one invite only
  when the transaction's tenant is an admin, and records who issued it.
* ``invites.created_by`` — so the list can say where an invite came from, and so an
  invite outlives the admin who issued it (SET NULL).

Revoking needs no function: the runtime role already holds UPDATE on `invites` to spend
one, so a function would guard nothing the grant does not already allow. The API gates it.

Numbered 0031 after 0028, which is the head (0028 was re-pointed onto 0030).

Revision ID: 0031
Revises: 0028
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from migrations.rls import APP_ROLE

revision: str = "0031"
down_revision: str | None = "0028"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    # AD-19: read by name, never written. No INSERT or UPDATE grant on this column is the
    # whole guarantee that the API cannot make anyone an admin.
    op.execute(f'GRANT SELECT (is_admin) ON users TO "{APP_ROLE}"')

    op.add_column(
        "invites",
        sa.Column(
            "created_by",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    op.execute(
        """
        CREATE FUNCTION invite_issue(p_code_hash text, p_note text, p_days integer)
        RETURNS uuid
        LANGUAGE plpgsql
        VOLATILE
        SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
        DECLARE
            v_admin uuid := app_current_user_id();
            v_id uuid;
        BEGIN
            IF v_admin IS NULL
               OR NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin AND is_admin) THEN
                RAISE EXCEPTION 'not an admin' USING ERRCODE = '42501';
            END IF;
            IF p_days IS NULL OR p_days < 1 OR p_days > 90 THEN
                RAISE EXCEPTION 'days out of range' USING ERRCODE = '22023';
            END IF;
            INSERT INTO invites (code_hash, note, expires_at, created_by)
            VALUES (p_code_hash, NULLIF(btrim(p_note), ''), now() + make_interval(days => p_days),
                    v_admin)
            RETURNING id INTO v_id;
            RETURN v_id;
        END
        $$;
        """
    )
    op.execute("REVOKE ALL ON FUNCTION invite_issue(text, text, integer) FROM PUBLIC")
    op.execute(f'GRANT EXECUTE ON FUNCTION invite_issue(text, text, integer) TO "{APP_ROLE}"')


def downgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS invite_issue(text, text, integer)")
    op.drop_column("invites", "created_by")
    op.execute(f'REVOKE SELECT (is_admin) ON users FROM "{APP_ROLE}"')
    op.drop_column("users", "is_admin")
