"""Invites as the admin page sees them (AD-54)."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator

from app.services.invites import MAX_DAYS, MIN_DAYS


class InviteCreate(BaseModel):
    # Who it is for, for the admin's own records. Never shown to the invitee.
    note: str | None = Field(default=None, max_length=200)
    # StrictInt: "14" or 14.5 is a 422, not a guess.
    days: StrictInt = Field(default=14, ge=MIN_DAYS, le=MAX_DAYS)

    @field_validator("note", mode="before")
    @classmethod
    def _blank_is_none(cls, value: object) -> object:
        if isinstance(value, str):
            value = value.strip()
            return value or None
        return value


class InviteIssuedOut(BaseModel):
    """Carries the plaintext code. Answered once, by the create; never readable again."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    note: str | None
    expires_at: datetime


class InviteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    note: str | None
    created_at: datetime
    expires_at: datetime
    used_at: datetime | None
    state: Literal["open", "used", "expired"]
