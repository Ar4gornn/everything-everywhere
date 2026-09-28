"""The calendar feed (Epic 39, AD-55): settings under the account's own token, and the one
route that answers with no sign-in at all — the feed, addressed by its secret."""

import re

from fastapi import APIRouter, HTTPException, Response, status

from app.core.db import tenant_session
from app.core.deps import AnonSession, CurrentUserId, DbSession
from app.core.ratelimit import WindowLimiter
from app.models.calendar import CalendarFeed
from app.schemas.calendar import FeedMintedOut, FeedOut, FeedPatch
from app.services import calendar_feed
from app.services.sessions import hash_token

router = APIRouter(prefix="/api/calendar", tags=["calendar"])

#: ``secrets.token_urlsafe(32)``: 43 characters of the URL-safe alphabet. Anything else is
#: refused before it costs a database round trip.
_TOKEN = re.compile(r"^[A-Za-z0-9_-]{43}$")

#: A calendar app polls every few minutes at most; 30 in ten minutes is generous for it and
#: tight for anyone hammering a leaked URL.
limiter = WindowLimiter(limit=30, window_seconds=600)


def feed_path(token: str) -> str:
    return f"/api/calendar/feed/{token}.ics"


def _out(feed: CalendarFeed | None) -> FeedOut:
    if feed is None:
        return FeedOut(on=False)
    return FeedOut(
        on=True,
        layers=list(feed.layers),
        detailed=feed.detailed,
        alarm=feed.alarm,
        created_at=feed.created_at,
        last_fetched_at=feed.last_fetched_at,
    )


def _minted(feed: CalendarFeed, token: str) -> FeedMintedOut:
    return FeedMintedOut(**_out(feed).model_dump(), path=feed_path(token))


@router.get("/feed", response_model=FeedOut)
def read_feed(user_id: CurrentUserId, session: DbSession) -> FeedOut:
    return _out(calendar_feed.get_feed(session, user_id))


@router.post("/feed", response_model=FeedMintedOut, status_code=status.HTTP_201_CREATED)
def create_feed(user_id: CurrentUserId, session: DbSession) -> FeedMintedOut:
    feed, token = calendar_feed.create_feed(session, user_id)
    return _minted(feed, token)


@router.post("/feed/rotate", response_model=FeedMintedOut)
def rotate_feed(user_id: CurrentUserId, session: DbSession) -> FeedMintedOut:
    feed, token = calendar_feed.rotate(session, user_id)
    return _minted(feed, token)


@router.patch("/feed", response_model=FeedOut)
def update_feed(payload: FeedPatch, user_id: CurrentUserId, session: DbSession) -> FeedOut:
    feed = calendar_feed.update_feed(
        session,
        user_id,
        layers=payload.layers,
        detailed=payload.detailed,
        alarm=payload.alarm,
    )
    return _out(feed)


@router.delete("/feed", status_code=status.HTTP_204_NO_CONTENT)
def delete_feed(user_id: CurrentUserId, session: DbSession) -> Response:
    calendar_feed.delete_feed(session, user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _gone() -> HTTPException:
    # 404 whatever went wrong — malformed, unknown, revoked — so a guess learns nothing,
    # not even that a feed route exists behind the name (AD-8's rule, applied to a secret).
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")


@router.get("/feed/{token}.ics", include_in_schema=False)
def fetch_feed(token: str, session: AnonSession) -> Response:
    if not _TOKEN.match(token):
        raise _gone()
    wait = limiter.hit(hash_token(token))
    if wait is not None:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests",
            headers={"Retry-After": str(wait)},
        )
    user_id = calendar_feed.look_up(session, token)
    if user_id is None:
        raise _gone()

    with tenant_session(user_id) as tenant:
        feed = calendar_feed.get_feed(tenant, user_id)
        if feed is None:  # turned off between the lookup and here
            raise _gone()
        body = calendar_feed.render(tenant, user_id, feed)
        calendar_feed.mark_fetched(tenant, user_id)

    return Response(
        content=body,
        media_type="text/calendar; charset=utf-8",
        headers={
            "Content-Disposition": 'inline; filename="everything-everywhere.ics"',
            "Cache-Control": "private, max-age=300",
            "X-Robots-Tag": "noindex",
        },
    )
