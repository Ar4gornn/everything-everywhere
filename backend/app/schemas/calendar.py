import datetime as dt

from pydantic import BaseModel, ConfigDict, Field, StrictBool


class FeedOut(BaseModel):
    """The feed's settings. Never the token: it exists only in the answer that minted it."""

    on: bool
    layers: list[str] = Field(default_factory=list)
    detailed: bool = False
    alarm: bool = False
    created_at: dt.datetime | None = None
    last_fetched_at: dt.datetime | None = None


class FeedMintedOut(FeedOut):
    """Answer to turning the feed on or asking for a new URL: the one time the path is shown.

    ``path`` is relative to the API's origin; the client prefixes it with the base it
    already talks to, so the server needs no idea of its own public address.
    """

    path: str


class FeedPatch(BaseModel):
    # StrictBool: pydantic's lax bool reads "off" as False (lab note, Epic 33.1).
    model_config = ConfigDict(extra="forbid")

    layers: list[str] | None = Field(default=None, max_length=20)
    detailed: StrictBool | None = None
    alarm: StrictBool | None = None
