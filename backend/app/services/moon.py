"""The moon on the server: only what the daily digest needs (Epic 47, AD-63 §6).

Same engine as the browser (Astronomy Engine, PyPI ``astronomy-engine``, pinned to the npm
version), so both sides agree on the day of a full moon. Pure: nothing is stored.
Spec: ``docs/epic-47-moon.md``.
"""

import datetime as dt
from typing import Literal

import astronomy

MoonEvent = Literal["new", "full"]

#: ``astronomy.SearchMoonQuarter`` numbers the quarters 0 new, 1 first, 2 full, 3 last.
_EVENTS: dict[int, MoonEvent] = {0: "new", 2: "full"}


def _utc(time: astronomy.Time) -> dt.datetime:
    """The engine's instant as an aware UTC datetime."""
    return time.Utc().replace(tzinfo=dt.UTC)


def _local_midnight_utc(day: dt.date, zone: dt.tzinfo | None) -> dt.datetime:
    """The start of ``day`` on the account's clock, as an aware UTC instant. ``zone`` None is
    the host clock, as ``core/clock.py`` has it."""
    midnight = dt.datetime.combine(day, dt.time.min)
    local = midnight.replace(tzinfo=zone) if zone is not None else midnight.astimezone()
    return local.astimezone(dt.UTC)


def event_on(day: dt.date, zone: dt.tzinfo | None) -> MoonEvent | None:
    """``"new"`` or ``"full"`` when that moon quarter's instant falls on ``day`` in ``zone``
    (the account's local day; ``None`` = the host clock, as ``core/clock.py`` does), else None."""
    start = _local_midnight_utc(day, zone)
    end = _local_midnight_utc(day + dt.timedelta(days=1), zone)
    # Search from an hour early: the engine finds the first quarter strictly after its start.
    probe = start - dt.timedelta(hours=1)
    quarter = astronomy.SearchMoonQuarter(
        astronomy.Time.Make(
            probe.year, probe.month, probe.day, probe.hour, probe.minute, probe.second
        )
    )
    while (instant := _utc(quarter.time)) < end:
        if instant >= start and quarter.quarter in _EVENTS:
            return _EVENTS[quarter.quarter]
        quarter = astronomy.NextMoonQuarter(quarter)
    return None
