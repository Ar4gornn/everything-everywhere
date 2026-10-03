/**
 * Epic 48 (AD-64): every time-zone computation the clocks, the dashboard card and the
 * calendar make. Pure functions over `Intl` only — no tz data shipped, no library, so DST
 * is whatever the browser's ICU says, as it already is for the rest of the app.
 *
 * Wall times are `"HH:MM"` (24h, both languages, as `schedule.ts` `timeLabel` already
 * shows them). Minutes-of-day are integers 0..1439. Offsets are minutes EAST of UTC
 * (Paris in summer = +120), the sign `Date#getTimezoneOffset` does NOT use.
 *
 * SKELETON: signatures are fixed; builder T implements and tests them. Callers (builders P
 * and S) code against these signatures now.
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

function notBuilt(): never {
  throw new Error("clocks/time: not built yet");
}

/** Minutes east of UTC for `zone` at instant `at`. Throws RangeError for an unknown zone. */
export function zoneOffset(_zone: string, _at: Date): number {
  return notBuilt();
}

/** The wall clock in `zone` at `at`, as minutes since local midnight (0..1439). */
export function wallMinutes(_zone: string, _at: Date): number {
  return notBuilt();
}

/** The calendar date in `zone` at `at`, `"YYYY-MM-DD"`. */
export function wallDate(_zone: string, _at: Date): string {
  return notBuilt();
}

/** `"HH:MM"` ↔ minutes since midnight. `toMinutes` throws on anything but `HH:MM`. */
export function toMinutes(_time: WallTime): number {
  return notBuilt();
}
export function fromMinutes(_minutes: number): WallTime {
  return notBuilt();
}

/** Is `minutes` inside [start, end)? end <= start wraps past midnight; start === end is
 *  empty. */
export function inRange(_range: [WallTime, WallTime], _minutes: number): boolean {
  return notBuilt();
}

/** Night wins over work where they overlap; anything else is free. */
export function shadeAt(_hours: ClockHours, _minutes: number): Shade {
  return notBuilt();
}

/** A place's own hours, or the account's default. */
export function hoursFor(_place: Pick<ClockPlace, "hours">, _defaults: ClockHours): ClockHours {
  return notBuilt();
}

/** Everything a clock face shows, for `zone` at `at`, relative to `home`. */
export function readClock(
  _zone: string,
  _at: Date,
  _home: string,
  _hours: ClockHours,
): ClockReading {
  return notBuilt();
}

/**
 * A difference in minutes as the clock shows it: `"+1h"`, `"−7h30"` (U+2212 minus),
 * `"+5h45"`, and `null` for 0 (the caller says "Same time"). Language-neutral on purpose:
 * "h" reads the same in English and French.
 */
export function formatDiff(_minutes: number): string | null {
  return notBuilt();
}

/** The account's zone (`user.timezone`, AD-52), else this device's, else `"UTC"`. */
export function homeZone(_user: Pick<User, "timezone"> | null | undefined): string {
  return notBuilt();
}

/** `"America/Argentina/Buenos_Aires"` → `"Buenos Aires"`; `"UTC"` → `"UTC"`. */
export function zoneCity(_zone: string): string {
  return notBuilt();
}

/** Every zone this browser knows (`Intl.supportedValuesOf("timeZone")`), sorted; a short
 *  built-in list when the browser lacks `supportedValuesOf`. Always includes `"UTC"`. */
export function allZones(): string[] {
  return notBuilt();
}

/**
 * Zones matching what the person typed: case- and accent-insensitive, spaces and
 * underscores equal, matched against the whole id and against the city. City-prefix
 * matches first, then other matches, each alphabetical; at most `limit`.
 */
export function searchZones(_query: string, _zones: readonly string[], _limit = 20): string[] {
  return notBuilt();
}

/**
 * A wall time on `date` in zone `from`, read in zone `to`. `dayShift` is `to`'s date minus
 * `date`. A wall time that does not exist in `from` (spring-forward gap) is read with the
 * offset in force just before the gap; an ambiguous one (fall-back) takes the first.
 */
export function convertWallTime(
  _date: string,
  _time: WallTime,
  _from: string,
  _to: string,
): { time: WallTime; dayShift: -1 | 0 | 1 } {
  return notBuilt();
}

/** A fresh place id matching the server's `^[A-Za-z0-9_-]{1,40}$`. */
export function newPlaceId(): string {
  return notBuilt();
}
