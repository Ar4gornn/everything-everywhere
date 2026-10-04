/**
 * Epic 48 (AD-64): every time-zone computation the clocks, the dashboard card and the
 * calendar make. Pure functions over `Intl` only — no tz data shipped, no library, so DST
 * is whatever the browser's ICU says, as it already is for the rest of the app.
 *
 * Wall times are `"HH:MM"` (24h, both languages, as `schedule.ts` `timeLabel` already
 * shows them). Minutes-of-day are integers 0..1439. Offsets are minutes EAST of UTC
 * (Paris in summer = +120), the sign `Date#getTimezoneOffset` does NOT use.
 */
import type { ClockHours, ClockPlace, User, WallTime } from "../api/types";

export type Shade = "night" | "work" | "free";

export interface ClockReading {
  /** `"HH:MM"` in the zone at that instant. */
  time: WallTime;
  /** The zone's calendar date minus the home zone's, at the same instant: -1, 0 or +1. */
  dayShift: -1 | 0 | 1;
  /** Zone offset minus home offset, in minutes (+60: an hour ahead of you). */
  diff: number;
  shade: Shade;
}

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    // Throws RangeError for an unknown zone, which is the documented contract.
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      calendar: "gregory",
      numberingSystem: "latn",
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(zone, f);
  }
  return f;
}

function partsOf(zone: string, at: Date): Parts {
  const out: Record<string, number> = {};
  for (const p of formatterFor(zone).formatToParts(at)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return {
    year: out.year ?? 0,
    month: out.month ?? 1,
    day: out.day ?? 1,
    // Some engines answer "24" for midnight even with h23.
    hour: (out.hour ?? 0) === 24 ? 0 : (out.hour ?? 0),
    minute: out.minute ?? 0,
    second: out.second ?? 0,
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Minutes east of UTC for `zone` at instant `at`. Throws RangeError for an unknown zone. */
export function zoneOffset(zone: string, at: Date): number {
  const p = partsOf(zone, at);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const truncated = Math.floor(at.getTime() / 1000) * 1000;
  return Math.round((asUtc - truncated) / 60000);
}

/** The wall clock in `zone` at `at`, as minutes since local midnight (0..1439). */
export function wallMinutes(zone: string, at: Date): number {
  const p = partsOf(zone, at);
  return p.hour * 60 + p.minute;
}

/** The calendar date in `zone` at `at`, `"YYYY-MM-DD"`. */
export function wallDate(zone: string, at: Date): string {
  const p = partsOf(zone, at);
  return `${String(p.year).padStart(4, "0")}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** `"HH:MM"` ↔ minutes since midnight. `toMinutes` throws on anything but `HH:MM`. */
export function toMinutes(time: WallTime): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!m) throw new Error(`not a HH:MM time: ${String(time)}`);
  return Number(m[1]) * 60 + Number(m[2]);
}
export function fromMinutes(minutes: number): WallTime {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** Is `minutes` inside [start, end)? end <= start wraps past midnight; start === end is
 *  empty. */
export function inRange(range: [WallTime, WallTime], minutes: number): boolean {
  const start = toMinutes(range[0]);
  const end = toMinutes(range[1]);
  if (start === end) return false;
  if (start < end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end;
}

/** Night wins over work where they overlap; anything else is free. */
export function shadeAt(hours: ClockHours, minutes: number): Shade {
  if (inRange(hours.night, minutes)) return "night";
  if (inRange(hours.work, minutes)) return "work";
  return "free";
}

/** A place's own hours, or the account's default. */
export function hoursFor(place: Pick<ClockPlace, "hours">, defaults: ClockHours): ClockHours {
  return place.hours ?? defaults;
}

function dateToUtc(date: string): number {
  const [y = 0, m = 1, d = 1] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function daysBetween(a: string, b: string): number {
  return Math.round((dateToUtc(b) - dateToUtc(a)) / 86400000);
}

function clampShift(n: number): -1 | 0 | 1 {
  return n < 0 ? -1 : n > 0 ? 1 : 0;
}

/** Everything a clock face shows, for `zone` at `at`, relative to `home`. */
export function readClock(
  zone: string,
  at: Date,
  home: string,
  hours: ClockHours,
  reference: Date = at,
): ClockReading {
  const minutes = wallMinutes(zone, at);
  return {
    time: fromMinutes(minutes),
    // The day word is relative to the home date at `reference` (the real now when the page
    // shows a shifted instant), so a place that is still "today" says nothing.
    dayShift: clampShift(daysBetween(wallDate(home, reference), wallDate(zone, at))),
    diff: zoneOffset(zone, at) - zoneOffset(home, at),
    shade: shadeAt(hours, minutes),
  };
}

/**
 * A difference in minutes as the clock shows it: `"+1h"`, `"−7h30"` (U+2212 minus),
 * `"+5h45"`, `"+15 min"` under an hour, and `null` for 0 (the caller says "Same time"). Language-neutral on purpose:
 * "h" reads the same in English and French.
 */
export function formatDiff(minutes: number): string | null {
  const total = Math.round(minutes);
  if (total === 0) return null;
  const abs = Math.abs(total);
  if (abs < 60) return `${total < 0 ? "−" : "+"}${abs} min`;
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${total < 0 ? "−" : "+"}${h}h${m === 0 ? "" : pad2(m)}`;
}

// The zone-naming helpers live in `zones.ts`; re-exported so callers keep one import.
export {
  LEGACY_ZONES,
  canonicalZone,
  foldName,
  isRegionLink,
  rawCity,
  sameName,
  sameZone,
  zoneCity,
  zoneHint,
} from "./zones";

/** The account's zone (`user.timezone`, AD-52), else this device's, else `"UTC"`. */
export function homeZone(user: Pick<User, "timezone"> | null | undefined): string {
  if (user?.timezone) return user.timezone;
  try {
    const z = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (z) return z;
  } catch {
    // fall through
  }
  return "UTC";
}

/**
 * A wall time on `date` in zone `from`, read in zone `to`. `dayShift` is `to`'s date minus
 * `date`. A wall time that does not exist in `from` (spring-forward gap) is read with the
 * offset in force just before the gap; an ambiguous one (fall-back) takes the first.
 */
export function convertWallTime(
  date: string,
  time: WallTime,
  from: string,
  to: string,
): { time: WallTime; dayShift: -1 | 0 | 1 } {
  const minutes = toMinutes(time);
  const naive = dateToUtc(date) + minutes * 60000;
  const before = zoneOffset(from, new Date(naive - 86400000));
  const after = zoneOffset(from, new Date(naive + 86400000));
  let instant: number | null = null;
  for (const offset of new Set([before, after])) {
    const candidate = naive - offset * 60000;
    const ok = wallMinutes(from, new Date(candidate)) === minutes &&
      wallDate(from, new Date(candidate)) === date;
    // The earliest valid instant is the first occurrence of an ambiguous time.
    if (ok && (instant === null || candidate < instant)) instant = candidate;
  }
  // Gap: the wall time never happens, so read it with the offset before the gap.
  if (instant === null) instant = naive - before * 60000;
  const at = new Date(instant);
  return {
    time: fromMinutes(wallMinutes(to, at)),
    dayShift: clampShift(daysBetween(date, wallDate(to, at))),
  };
}

/** A fresh place id matching the server's `^[A-Za-z0-9_-]{1,40}$`. */
export function newPlaceId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return `p${c.randomUUID().replace(/-/g, "")}`.slice(0, 33);
  let s = "";
  while (s.length < 16) s += Math.random().toString(36).slice(2);
  return `p${s.slice(0, 16)}`;
}
