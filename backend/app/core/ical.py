"""iCalendar text (RFC 5545), the small part of it a read-only feed needs (AD-55).

Written by hand rather than taken from a package: a feed of all-day events uses four
property kinds, and the two rules that are easy to get wrong — TEXT escaping and folding at
75 **octets**, not characters — are a dozen lines each and pinned by tests. No session, no
models: pure functions over plain values.
"""

import datetime as dt
from collections.abc import Iterable
from dataclasses import dataclass

CRLF = "\r\n"
_FOLD_AT = 75

PRODID = "-//Everything Everywhere//Calendar feed//EN"


@dataclass(frozen=True)
class Event:
    """One all-day event. ``day`` is the date it falls on; it lasts exactly that day."""

    uid: str
    day: dt.date
    summary: str
    description: str | None = None


def escape(value: str) -> str:
    """TEXT escaping, §3.3.11. Backslash first, or the others' backslashes get doubled."""
    return (
        value.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\n", "\\n")
        .replace("\r", "\\n")
    )


def fold(line: str) -> str:
    """Fold one content line at 75 octets, §3.1, never inside a UTF-8 sequence.

    Continuation lines start with one space, which counts toward their own 75.
    """
    encoded = line.encode("utf-8")
    if len(encoded) <= _FOLD_AT:
        return line
    parts: list[str] = []
    start = 0
    limit = _FOLD_AT
    while start < len(encoded):
        end = min(start + limit, len(encoded))
        # Step back off a continuation byte (10xxxxxx) so a character is never split.
        while end < len(encoded) and (encoded[end] & 0xC0) == 0x80:
            end -= 1
        parts.append(encoded[start:end].decode("utf-8"))
        start = end
        limit = _FOLD_AT - 1  # the leading space of a continuation line
    return (CRLF + " ").join(parts)


def _date(day: dt.date) -> str:
    return day.strftime("%Y%m%d")


def _stamp(now: dt.datetime) -> str:
    return now.astimezone(dt.UTC).strftime("%Y%m%dT%H%M%SZ")


def calendar(
    events: Iterable[Event],
    *,
    name: str,
    now: dt.datetime,
    alarm: str | None = None,
) -> str:
    """A whole VCALENDAR. ``alarm``, when given, is the text of a 09:00 reminder on the day.

    All-day events are floating dates, so 09:00 is 09:00 wherever the reader is, and no
    VTIMEZONE is needed. TRANSP:TRANSPARENT keeps a bill from marking the day busy.
    """
    stamp = _stamp(now)
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        f"PRODID:{PRODID}",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{escape(name)}",
        # RFC 7986 and its de-facto predecessor. A hint only: Google ignores both.
        "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
        "X-PUBLISHED-TTL:PT1H",
    ]
    for event in events:
        lines += [
            "BEGIN:VEVENT",
            f"UID:{event.uid}",
            f"DTSTAMP:{stamp}",
            f"DTSTART;VALUE=DATE:{_date(event.day)}",
            f"DTEND;VALUE=DATE:{_date(event.day + dt.timedelta(days=1))}",
            f"SUMMARY:{escape(event.summary)}",
        ]
        if event.description:
            lines.append(f"DESCRIPTION:{escape(event.description)}")
        lines.append("TRANSP:TRANSPARENT")
        if alarm is not None:
            lines += [
                "BEGIN:VALARM",
                "ACTION:DISPLAY",
                f"DESCRIPTION:{escape(alarm)}",
                "TRIGGER;RELATED=START:PT9H",
                "END:VALARM",
            ]
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return "".join(fold(line) + CRLF for line in lines)
