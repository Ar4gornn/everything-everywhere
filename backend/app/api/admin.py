"""Issuing invites from the web client (AD-54).

Every route answers 404 to anyone who is not an admin — AD-8's rule applied to a whole
area: a non-admin learns nothing, not even that the area exists. The database refuses a
non-admin mint independently (`invite_issue`), so this check is the courtesy, not the lock.
"""

import uuid

from fastapi import APIRouter, Response, status

from app.core.deps import CurrentUserId, DbSession
from app.core.errors import NotFound
from app.schemas.common import Page
from app.schemas.invites import InviteCreate, InviteIssuedOut, InviteOut
from app.services import auth as auth_service
from app.services import invites as invite_service

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _require_admin(session, user_id: uuid.UUID) -> None:
    if not auth_service.is_admin(session, user_id):
        raise NotFound


@router.get("/invites", response_model=Page[InviteOut])
def list_invites(user_id: CurrentUserId, session: DbSession) -> Page[InviteOut]:
    _require_admin(session, user_id)
    rows = invite_service.list_all(session)
    return Page[InviteOut](items=[InviteOut.model_validate(r) for r in rows])


@router.post("/invites", response_model=InviteIssuedOut, status_code=status.HTTP_201_CREATED)
def create_invite(
    payload: InviteCreate, user_id: CurrentUserId, session: DbSession
) -> InviteIssuedOut:
    _require_admin(session, user_id)
    issued = invite_service.issue(session, note=payload.note, days=payload.days)
    return InviteIssuedOut.model_validate(issued)


@router.post("/invites/{invite_id}/revoke", status_code=status.HTTP_204_NO_CONTENT)
def revoke_invite(invite_id: uuid.UUID, user_id: CurrentUserId, session: DbSession) -> Response:
    _require_admin(session, user_id)
    if not invite_service.revoke(session, invite_id=invite_id):
        # Unknown, used, or already ended: nothing open by that id.
        raise NotFound
    return Response(status_code=status.HTTP_204_NO_CONTENT)
