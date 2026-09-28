/**
 * One all-day event as an .ics file, built in the browser (Epic 39, "Add to calendar").
 *
 * The same two rules as the server's feed (`backend/app/core/ical.py`): TEXT escaping, and
 * folding at 75 octets without splitting a character. Nothing leaves the device: the file
 * is handed to the person's own calendar app, which is also why it carries the details
 * the feed hides by default.
 */

const CRLF = "\r\n";
const FOLD_AT = 75;

export interface IcsEvent {
  /** Stable, so importing the same thing twice updates rather than duplicates. */
  uid: string;
  /** `YYYY-MM-DD`, the day it falls on. */
  day: string;
  summary: string;
  description?: string | null;
}

export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

export function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= FOLD_AT) return line;
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let start = 0;
  let limit = FOLD_AT;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Step back off a UTF-8 continuation byte (10xxxxxx).
    while (end < bytes.length && ((bytes[end] ?? 0) & 0xc0) === 0x80) end -= 1;
    parts.push(decoder.decode(bytes.slice(start, end)));
    start = end;
    limit = FOLD_AT - 1; // a continuation line's leading space counts
  }
  return parts.join(`${CRLF} `);
}

const compact = (day: string): string => day.replace(/-/g, "");

function nextDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  // UTC arithmetic: a local Date would move across a DST change and land on the same day.
  const next = new Date(Date.UTC(year, month - 1, date + 1));
  return next.toISOString().slice(0, 10);
}

function stamp(now: Date): string {
  return `${now.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
}

export function icsFor(event: IcsEvent, now: Date = new Date()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Everything Everywhere//Add to calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART;VALUE=DATE:${compact(event.day)}`,
    `DTEND;VALUE=DATE:${compact(nextDay(event.day))}`,
    `SUMMARY:${escapeText(event.summary)}`,
    ...(event.description ? [`DESCRIPTION:${escapeText(event.description)}`] : []),
    "TRANSP:TRANSPARENT",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map((line) => foldLine(line) + CRLF).join("");
}

/**
 * A bill or an income from a recurring rule, on the day it falls due. The UID is the
 * feed's (`due-<template>-<day>`), so the same bill is the same event in both.
 */
export function dueEvent(
  templateId: string,
  day: string,
  name: string,
  amount: string,
  note: string | null,
): IcsEvent {
  return {
    uid: `due-${templateId}-${compact(day)}@everything-everywhere.app`,
    day,
    summary: `${name} · ${amount}`,
    description: note,
  };
}

/** A file name a phone will keep: the summary, stripped to safe characters. */
export function icsFileName(event: IcsEvent): string {
  const slug = event.summary
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40);
  return `${slug || "event"}-${event.day}.ics`;
}

/** Hand the file to the browser. Split out so a test can stub the one side effect. */
export function downloadIcs(event: IcsEvent): void {
  const blob = new Blob([icsFor(event)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = icsFileName(event);
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on the next task, after the click has handed the blob over.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
