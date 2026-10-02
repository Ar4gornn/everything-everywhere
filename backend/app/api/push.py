from fastapi import APIRouter, HTTPException, Response, status
from fastapi.responses import JSONResponse

from app.core.clock import Now, local_today
from app.core.config import get_settings
from app.core.deps import CurrentUserId, DbSession
from app.core.errors import NotFound
from app.core.errors import refused as _refused
from app.schemas.common import Page
from app.schemas.push import (
    MutedOut,
    PreviewOut,
    PushKeyOut,
    PushStatusOut,
    SubscriptionIn,
    TestIn,
    UnsubscribeIn,
)
from app.services import auth as auth_service
from app.services import push

router = APIRouter(prefix="/api/push", tags=["push"])


def _require_enabled() -> None:
    """Push is off unless the instance was given VAPID keys (AD-15: no working default)."""
    if not get_settings().push_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Push notifications are not configured on this instance.",
        )


@router.get("/status", response_model=PushStatusOut)
def push_status(user_id: CurrentUserId, session: DbSession) -> PushStatusOut:
    """Answers even when push is off, so the client can hide the toggle rather than guess."""
    settings = get_settings()
    devices = len(push.list_subscriptions(session, user_id)) if settings.push_enabled else 0
    return PushStatusOut(enabled=settings.push_enabled, devices=devices)


@router.get("/key", response_model=PushKeyOut)
def push_key() -> PushKeyOut:
    _require_enabled()
    return PushKeyOut(public_key=get_settings().vapid_public_key)


@router.post("/subscribe", status_code=status.HTTP_204_NO_CONTENT)
def subscribe(payload: SubscriptionIn, user_id: CurrentUserId, session: DbSession) -> Response:
    _require_enabled()
    push.subscribe(
        session,
        user_id,
        endpoint=payload.endpoint,
        p256dh=payload.p256dh,
        auth=payload.auth,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/unsubscribe", status_code=status.HTTP_204_NO_CONTENT)
def unsubscribe(payload: UnsubscribeIn, user_id: CurrentUserId, session: DbSession) -> Response:
    """Idempotent, and works even when push is off — turning it off must always be possible."""
    push.unsubscribe(session, user_id, payload.endpoint)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ------------------------------------------------------------ Epic 36 (AD-52)


@router.get("/preview", response_model=PreviewOut)
def preview(user_id: CurrentUserId, session: DbSession, now: Now) -> PreviewOut:
    """Tonight's digest for this account, read-only. Answers even when push is off: it is
    the words, not a delivery, and a person choosing kinds wants to see what they change."""
    profile = auth_service.read_profile(session, user_id)
    if profile is None:  # pragma: no cover — the token names an account that exists
        raise NotFound("No such account")
    today = local_today(profile.timezone, now)
    found = push.digest(session, user_id, today=today)
    return PreviewOut(
        empty=found.empty,
        title=found.title,
        body=None if found.empty else found.body,
        url=found.url,
        local_date=today.isoformat(),
        digest_time=profile.digest_time.strftime("%H:%M"),
        timezone=profile.timezone,
    )


@router.get("/muted", response_model=Page[MutedOut])
def muted(user_id: CurrentUserId, session: DbSession) -> Page[MutedOut]:
    return Page[MutedOut](
        items=[MutedOut.model_validate(row) for row in push.muted(session, user_id)]
    )


@router.post("/test", status_code=status.HTTP_204_NO_CONTENT)
def send_test(
    payload: TestIn, user_id: CurrentUserId, session: DbSession, now: Now
) -> Response:
    """Send one push to the caller's own device now: tonight's digest if there is one to
    say, a plain "it works" otherwise.

    The one push sent from inside a request (AD-52): a click, not a schedule. The row is
    locked and stamped before sending, so two quick clicks queue and the second is a 429.
    It never writes ``notified_on`` — a test must not eat the evening's digest.
    """
    _require_enabled()
    try:
        subscription = push.claim_test(session, user_id, payload.endpoint, now)
    except push.TooSoon:
        raise _refused(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "push_test_too_soon",
            "A test was sent to this device less than a minute ago.",
            headers={"Retry-After": str(int(push.TEST_INTERVAL.total_seconds()))},
        ) from None

    profile = auth_service.read_profile(session, user_id)
    language = profile.language if profile else "en"
    today = local_today(profile.timezone if profile else None, now)
    found = push.digest(session, user_id, today=today)
    body = push.test_payload(language) if found.empty else found.payload()

    if not push.send(get_settings(), subscription, body):
        # The push service says this device is gone. Forget it, as cron would, and say so:
        # the client offers to turn notifications on again rather than claiming success.
        # Returned, not raised: a raised error rolls the request back, and the forget with it.
        push.forget(session, subscription.endpoint)
        return JSONResponse(
            status_code=status.HTTP_410_GONE,
            content={
                "detail": "This device no longer accepts notifications. Turn them on again.",
                "code": "push_device_gone",
            },
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
