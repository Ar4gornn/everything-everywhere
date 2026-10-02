"""The moon on the server: only what the daily digest needs (Epic 47, AD-63 §6).

Same engine as the browser (Astronomy Engine, PyPI ``astronomy-engine``, pinned to the npm
version), so both sides agree on the day of a full moon. Pure: nothing is stored.
Spec: ``docs/epic-47-moon.md``.
"""

import datetime as dt
from typing import Literal

MoonEvent = Literal["new", "full"]


def event_on(day: dt.date, zone: dt.tzinfo | None) -> MoonEvent | None:
    """``"new"`` or ``"full"`` when that moon quarter's instant falls on ``day`` in ``zone``
    (the account's local day; ``None`` = the host clock, as ``core/clock.py`` does), else None."""
    raise NotImplementedError
