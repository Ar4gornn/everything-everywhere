"""The clock, defined once (AD-52, AD-57, AD-30).

A "day" in this app is the account's **local** date: ``users.timezone``, or the host's clock
when the account has none. The digest, the streaks and the activity map all ask the same
function, so they cannot disagree about which day it is.

``get_now`` is the one place a request reads the time. A test overrides it
(``app.dependency_overrides[get_now] = lambda: ...``) to pin the clock.
"""

import datetime as dt
import zoneinfo
from typing import Annotated

from fastapi import Depends


def get_now() -> dt.datetime:
    """The current instant, aware, in UTC. Overridable, so every test can pin the clock."""
    return dt.datetime.now(dt.UTC)


Now = Annotated[dt.datetime, Depends(get_now)]


def zone_of(timezone: str | None) -> dt.tzinfo | None:
    """The account's zone, or None for the host's clock. A name that no longer resolves
    (a zone retired from the tz database) falls back to the host rather than failing the
    whole run for everyone after this account."""
    if timezone is None:
        return None
    try:
        return zoneinfo.ZoneInfo(timezone)
    except (zoneinfo.ZoneInfoNotFoundError, ValueError):
        return None


def local_now(timezone: str | None, now: dt.datetime) -> dt.datetime:
    """``now`` (aware) on the account's clock. Naive only when the account has no zone and
    ``now`` was naive, which is the host's clock as it always was."""
    zone = zone_of(timezone)
    if zone is None:
        return now.astimezone() if now.tzinfo is not None else now
    return now.astimezone(zone)


def local_today(timezone: str | None, now: dt.datetime) -> dt.date:
    """The account's date at ``now``."""
    return local_now(timezone, now).date()
