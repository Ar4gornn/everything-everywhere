"""Invite consumption (Story 7.1).

The application can only ever *spend* an invite. Minting one requires the owner
credentials and goes through `backend/invite.py`, so a compromised API cannot manufacture
its own way in.

The code is compared by hash. A leaked backup should not contain a working invite, for the
same reason it does not contain a readable password.
"""

import hashlib
import hmac
import secrets
import uuid
from datetime import UTC, datetime

from sqlalchemy import text
from sqlalchemy.orm import Session


def hash_code(code: str) -> str:
    """SHA-256, not Argon2, and deliberately.

    An invite code is 160 bits of `secrets.token_urlsafe` output, not a human-chosen
    password, so there is no dictionary to slow an attacker down against — the entropy
    already does that. Argon2 here would only make every registration slower.
    """
    return hashlib.sha256(code.strip().encode("utf-8")).hexdigest()


def _matches(candidate: str, stored: str) -> bool:
    return hmac.compare_digest(candidate, stored)


class InviteRejected(Exception):
    """Unknown, already used, or expired — deliberately not distinguished.

    Telling the caller *which* would turn the endpoint into an oracle for guessing valid
    codes, and there is nothing an honest caller can do differently with the detail.
    """


def verify(session: Session, *, code: str) -> None:
    """Reject an unusable invite before any expensive work happens.

    Read-only, and deliberately separate from :func:`consume`: `used_by` is a foreign key
    to `users`, so the invite cannot be marked used until the user row exists — but a bad
    code should be refused before Argon2 hashes a password for an account that will never
    be created.

    This check is not the enforcement. Two concurrent registrations can both pass it; the
    guarded UPDATE in :func:`consume` is what makes an invite single-use.
    """
    if not code or not code.strip():
        raise InviteRejected

    candidate = hash_code(code)
    stored = session.execute(
        text(
            "SELECT code_hash FROM invites "
            "WHERE code_hash = :h AND used_at IS NULL AND expires_at > now()"
        ),
        {"h": candidate},
    ).scalar_one_or_none()

    if stored is None or not _matches(candidate, stored):
        raise InviteRejected


def consume(session: Session, *, code: str, user_id: uuid.UUID) -> None:
    """Mark the invite used. Must run inside the registration transaction, after the user.

    The UPDATE carries the whole condition — matching hash, unused, unexpired — so two
    concurrent registrations with the same code cannot both succeed. A check-then-update
    would let them, which is why :func:`verify` is explicitly not the enforcement point.
    """
    result = session.execute(
        text(
            """
            UPDATE invites
               SET used_at = now(), used_by = :uid
             WHERE code_hash = :h
               AND used_at IS NULL
               AND expires_at > now()
            """
        ),
        {"h": hash_code(code), "uid": str(user_id)},
    )
    if result.rowcount != 1:
        # Someone else claimed it between verify and here, or it expired in the gap.
        raise InviteRejected


def utcnow() -> datetime:
    return datetime.now(UTC)


# --- Issuing from the web client (AD-54) -------------------------------------------------

#: The bounds `invite_issue` enforces too; kept here so the request is refused as a 422
#: with the client's own words before the database is asked.
MIN_DAYS = 1
MAX_DAYS = 90


class IssuedInvite:
    """The one moment the plaintext code exists outside the person who receives it."""

    def __init__(self, id: uuid.UUID, code: str, note: str | None, expires_at: datetime):
        self.id = id
        self.code = code
        self.note = note
        self.expires_at = expires_at


def new_code() -> str:
    """160 bits, exactly as `backend/invite.py` mints them."""
    return secrets.token_urlsafe(20)


def issue(session: Session, *, note: str | None, days: int) -> IssuedInvite:
    """Mint one invite through `invite_issue`, which refuses unless the tenant is an admin.

    The caller has already checked; the function checks again because the grant is the
    guarantee and the route is only the courtesy.
    """
    code = new_code()
    invite_id = session.execute(
        text("SELECT invite_issue(:h, :note, :days)"),
        {"h": hash_code(code), "note": note, "days": days},
    ).scalar_one()
    row = session.execute(
        text("SELECT note, expires_at FROM invites WHERE id = :id"), {"id": invite_id}
    ).one()
    return IssuedInvite(invite_id, code, row.note, row.expires_at)


def list_all(session: Session) -> list:
    """Every invite, newest first. Never the hash: it is no use to anyone reading a list."""
    return list(
        session.execute(
            text(
                """
                SELECT id, note, created_at, expires_at, used_at,
                       CASE WHEN used_at IS NOT NULL THEN 'used'
                            WHEN expires_at <= now() THEN 'expired'
                            ELSE 'open' END AS state
                  FROM invites
                 ORDER BY created_at DESC
                """
            )
        ).all()
    )


def revoke(session: Session, *, invite_id: uuid.UUID) -> bool:
    """End an unused invite now. False if there was nothing open to end.

    Expiring it rather than deleting it keeps the list honest about what was issued, and
    `verify`/`consume` already refuse an expired code, so nothing else has to learn a new
    state.
    """
    result = session.execute(
        text(
            "UPDATE invites SET expires_at = now() "
            "WHERE id = :id AND used_at IS NULL AND expires_at > now()"
        ),
        {"id": str(invite_id)},
    )
    return result.rowcount == 1
