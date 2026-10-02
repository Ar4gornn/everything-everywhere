import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class PushKeyOut(BaseModel):
    """The VAPID public key a browser needs to subscribe. Public by design."""

    public_key: str


class SubscriptionIn(BaseModel):
    """Exactly what `PushSubscription.toJSON()` gives the client, flattened."""

    endpoint: str = Field(min_length=1, max_length=2000)
    p256dh: str = Field(min_length=1, max_length=200)
    auth: str = Field(min_length=1, max_length=200)


class UnsubscribeIn(BaseModel):
    endpoint: str = Field(min_length=1, max_length=2000)


class SubscriptionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: str


class PushStatusOut(BaseModel):
    """Whether push is configured on this instance, and whether this account has a device."""

    enabled: bool
    devices: int


class TestIn(BaseModel):
    """Epic 36: the device asking for a test names itself; only its own row is used."""

    endpoint: str = Field(min_length=1, max_length=2000)


class PreviewOut(BaseModel):
    """Tonight's digest, exactly as `notify.py` would compose it now (AD-52)."""

    empty: bool
    title: str
    body: str | None
    url: str
    #: The local date it is composed for, and the account's schedule, so the page can say
    #: "at 19:00 (Europe/Paris)" without a second request.
    local_date: str
    digest_time: str
    timezone: str | None


class MutedOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    kind: Literal["stock", "recurring", "savings"]
    id: uuid.UUID
    name: str
