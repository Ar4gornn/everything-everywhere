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

/** The last part of an id, as written: `"America/Argentina/Buenos_Aires"` → `"Buenos Aires"`. */
function rawCity(zone: string): string {
  const last = zone.split("/").pop() ?? zone;
  return last.replace(/_/g, " ");
}

/** `"America/Argentina/Buenos_Aires"` → `"Buenos Aires"`; `"UTC"` → `"UTC"`. A legacy id is
 *  named after its current one (`Asia/Calcutta` → `"Kolkata"`), so a place saved under an
 *  old spelling reads the same everywhere. */
export function zoneCity(zone: string): string {
  const raw = rawCity(canonicalZone(zone));
  return CITY_NAMES[raw] ?? raw;
}

/** Ids whose city is not written the way the id spells it: accents and punctuation the
 *  IANA names leave out. Keyed by the id's last part, spaces for underscores. */
const CITY_NAMES: Readonly<Record<string, string>> = {
  "St Johns": "St. John's",
  "Sao Paulo": "São Paulo",
  Zurich: "Zürich",
  Bogota: "Bogotá",
  Asuncion: "Asunción",
  Reykjavik: "Reykjavík",
  Cancun: "Cancún",
  Merida: "Mérida",
  Curacao: "Curaçao",
  Ndjamena: "N’Djamena",
  Noumea: "Nouméa",
  Belem: "Belém",
  Cuiaba: "Cuiabá",
  Maceio: "Maceió",
  Mazatlan: "Mazatlán",
  Reunion: "Réunion",
};

/** The city to print beside a place's name, or null when the name already says it
 *  (`Paris` for Europe/Paris), whatever the case, accents or punctuation: `Sao Paulo`
 *  says `São Paulo`, `Zurich` says `Zürich`. */
export function zoneHint(label: string, zone: string): string | null {
  const city = zoneCity(zone);
  return foldName(city) === foldName(label) ? null : city;
}

/** Two names compared the way the search does: no case, accents, dots or apostrophes. */
export function sameName(a: string, b: string): boolean {
  return foldName(a) === foldName(b);
}

/** Do two zone ids name the same zone, legacy spellings included? */
export function sameZone(a: string, b: string): boolean {
  return canonicalZone(a) === canonicalZone(b);
}

/**
 * Legacy zone ids -> the current IANA name (the `backward` file). Chrome's
 * `Intl.supportedValuesOf("timeZone")` still lists several of the left-hand names, so
 * the same place would otherwise appear twice, under two ids. The server accepts both
 * spellings; places are stored under the current one.
 */
const LEGACY_ZONES: Readonly<Record<string, string>> = {
  "Africa/Asmera": "Africa/Asmara",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Catamarca": "America/Argentina/Catamarca",
  "America/Cordoba": "America/Argentina/Cordoba",
  "America/Jujuy": "America/Argentina/Jujuy",
  "America/Mendoza": "America/Argentina/Mendoza",
  "America/Coral_Harbour": "America/Atikokan",
  "America/Godthab": "America/Nuuk",
  "America/Indianapolis": "America/Indiana/Indianapolis",
  "America/Fort_Wayne": "America/Indiana/Indianapolis",
  "America/Knox_IN": "America/Indiana/Knox",
  "America/Louisville": "America/Kentucky/Louisville",
  "America/Montreal": "America/Toronto",
  "America/Shiprock": "America/Denver",
  "Antarctica/South_Pole": "Pacific/Auckland",
  "Asia/Ashkhabad": "Asia/Ashgabat",
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Dacca": "Asia/Dhaka",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Macao": "Asia/Macau",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Asia/Tel_Aviv": "Asia/Jerusalem",
  "Asia/Thimbu": "Asia/Thimphu",
  "Asia/Ujung_Pandang": "Asia/Makassar",
  "Asia/Ulan_Bator": "Asia/Ulaanbaatar",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Europe/Kiev": "Europe/Kyiv",
  "Pacific/Enderbury": "Pacific/Kanton",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Samoa": "Pacific/Pago_Pago",
  "Pacific/Truk": "Pacific/Chuuk",
  "Pacific/Yap": "Pacific/Chuuk",
};

/** The current name of a zone: a legacy id is mapped, anything else is returned as is. */
export function canonicalZone(zone: string): string {
  return LEGACY_ZONES[zone] ?? zone;
}

/**
 * Places people type that are not the city a zone is named after, each to one canonical
 * zone: big cities that share a zone with another, and countries with a single zone.
 * Deliberately no abbreviations (PST, CET, IST...): several of them name more than one
 * offset. "Washington DC", not "Washington": the state is on Pacific time.
 */
const PLACE_ALIASES: Readonly<Record<string, string>> = {
  Delhi: "Asia/Kolkata",
  "New Delhi": "Asia/Kolkata",
  Mumbai: "Asia/Kolkata",
  Bombay: "Asia/Kolkata",
  Bangalore: "Asia/Kolkata",
  Bengaluru: "Asia/Kolkata",
  Chennai: "Asia/Kolkata",
  Madras: "Asia/Kolkata",
  Hyderabad: "Asia/Kolkata",
  India: "Asia/Kolkata",
  Beijing: "Asia/Shanghai",
  Peking: "Asia/Shanghai",
  Guangzhou: "Asia/Shanghai",
  Shenzhen: "Asia/Shanghai",
  China: "Asia/Shanghai",
  Osaka: "Asia/Tokyo",
  Kyoto: "Asia/Tokyo",
  Japan: "Asia/Tokyo",
  "South Korea": "Asia/Seoul",
  Busan: "Asia/Seoul",
  Philippines: "Asia/Manila",
  Hanoi: "Asia/Ho_Chi_Minh",
  Vietnam: "Asia/Ho_Chi_Minh",
  Thailand: "Asia/Bangkok",
  Bali: "Asia/Makassar",
  Pakistan: "Asia/Karachi",
  Lahore: "Asia/Karachi",
  Islamabad: "Asia/Karachi",
  Bangladesh: "Asia/Dhaka",
  Nepal: "Asia/Kathmandu",
  "Abu Dhabi": "Asia/Dubai",
  UAE: "Asia/Dubai",
  "Saudi Arabia": "Asia/Riyadh",
  Jeddah: "Asia/Riyadh",
  Mecca: "Asia/Riyadh",
  "Tel Aviv": "Asia/Jerusalem",
  Israel: "Asia/Jerusalem",
  Lebanon: "Asia/Beirut",
  "San Francisco": "America/Los_Angeles",
  Seattle: "America/Los_Angeles",
  "San Diego": "America/Los_Angeles",
  "Las Vegas": "America/Los_Angeles",
  California: "America/Los_Angeles",
  Hawaii: "Pacific/Honolulu",
  "Washington DC": "America/New_York",
  Boston: "America/New_York",
  Miami: "America/New_York",
  Atlanta: "America/New_York",
  Philadelphia: "America/New_York",
  Dallas: "America/Chicago",
  Houston: "America/Chicago",
  Austin: "America/Chicago",
  "New Orleans": "America/Chicago",
  Minneapolis: "America/Chicago",
  Ottawa: "America/Toronto",
  Quebec: "America/Toronto",
  Montreal: "America/Toronto",
  Rio: "America/Sao_Paulo",
  "Rio de Janeiro": "America/Sao_Paulo",
  Brasilia: "America/Sao_Paulo",
  "Cape Town": "Africa/Johannesburg",
  "South Africa": "Africa/Johannesburg",
  Egypt: "Africa/Cairo",
  Nigeria: "Africa/Lagos",
  Abuja: "Africa/Lagos",
  Lyon: "Europe/Paris",
  Marseille: "Europe/Paris",
  Toulouse: "Europe/Paris",
  Nice: "Europe/Paris",
  Bordeaux: "Europe/Paris",
  France: "Europe/Paris",
  Munich: "Europe/Berlin",
  München: "Europe/Berlin",
  Munchen: "Europe/Berlin",
  Frankfurt: "Europe/Berlin",
  Hamburg: "Europe/Berlin",
  Cologne: "Europe/Berlin",
  Germany: "Europe/Berlin",
  Barcelona: "Europe/Madrid",
  Seville: "Europe/Madrid",
  Valencia: "Europe/Madrid",
  Spain: "Europe/Madrid",
  Milan: "Europe/Rome",
  Venice: "Europe/Rome",
  Florence: "Europe/Rome",
  Naples: "Europe/Rome",
  Italy: "Europe/Rome",
  Geneva: "Europe/Zurich",
  Switzerland: "Europe/Zurich",
  UK: "Europe/London",
  "United Kingdom": "Europe/London",
  England: "Europe/London",
  Scotland: "Europe/London",
  Wales: "Europe/London",
  Manchester: "Europe/London",
  Edinburgh: "Europe/London",
  Glasgow: "Europe/London",
  Ireland: "Europe/Dublin",
  Iceland: "Atlantic/Reykjavik",
  Netherlands: "Europe/Amsterdam",
  Rotterdam: "Europe/Amsterdam",
  Belgium: "Europe/Brussels",
  Portugal: "Europe/Lisbon",
  Greece: "Europe/Athens",
  Turkey: "Europe/Istanbul",
  Ankara: "Europe/Istanbul",
  "St Petersburg": "Europe/Moscow",
  Krakow: "Europe/Warsaw",
  "New Zealand": "Pacific/Auckland",
  Wellington: "Pacific/Auckland",
  Canberra: "Australia/Sydney",
  GMT: "UTC",
};

/** Every other name a zone answers to: its legacy ids' cities and the place aliases. */
const ALIASES = new Map<string, string[]>();
function addAlias(zone: string, name: string) {
  const list = ALIASES.get(zone) ?? [];
  if (!list.includes(name)) list.push(name);
  ALIASES.set(zone, list);
}
for (const [legacy, current] of Object.entries(LEGACY_ZONES)) {
  if (rawCity(legacy) !== rawCity(current)) addAlias(current, rawCity(legacy));
}
for (const [name, zone] of Object.entries(PLACE_ALIASES)) addAlias(zone, name);
/** Current id -> its legacy ids, so "asia/calc" still finds Asia/Kolkata. */
const LEGACY_IDS = new Map<string, string[]>();
for (const [legacy, current] of Object.entries(LEGACY_ZONES)) {
  LEGACY_IDS.set(current, [...(LEGACY_IDS.get(current) ?? []), legacy]);
}

/** The alias table, for tests: name -> zone. */
export const placeAliases = PLACE_ALIASES;

const FALLBACK_ZONES = [
  "UTC",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Africa/Lagos",
  "Africa/Nairobi",
  "America/Anchorage",
  "America/Argentina/Buenos_Aires",
  "America/Bogota",
  "America/Chicago",
  "America/Denver",
  "America/Halifax",
  "America/Los_Angeles",
  "America/Mexico_City",
  "America/New_York",
  "America/Sao_Paulo",
  "America/Toronto",
  "Asia/Bangkok",
  "Asia/Dubai",
  "Asia/Hong_Kong",
  "Asia/Jakarta",
  "Asia/Karachi",
  "Asia/Kathmandu",
  "Asia/Kolkata",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Europe/Berlin",
  "Europe/Istanbul",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Moscow",
  "Europe/Paris",
  "Pacific/Auckland",
  "Pacific/Honolulu",
];

/** Every zone this browser knows (`Intl.supportedValuesOf("timeZone")`) under its current
 *  name, deduplicated and sorted; a short built-in list when the browser lacks
 *  `supportedValuesOf`. Always includes `"UTC"`. */
export function allZones(): string[] {
  let zones: string[] = [];
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  try {
    if (typeof intl.supportedValuesOf === "function") zones = intl.supportedValuesOf("timeZone");
  } catch {
    zones = [];
  }
  if (zones.length === 0) zones = FALLBACK_ZONES;
  const set = new Set(zones.map(canonicalZone));
  set.add("UTC");
  return [...set].sort();
}

function foldName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/[_/\s]+/g, " ")
    .trim();
}

/**
 * How `query` sits in `text` (both folded): 1 when the text starts with it, 2 when it starts
 * a later word (after a space or a hyphen; `/` and `_` are spaces once folded), 0 otherwise.
 * Never mid-word: "usa" is not in Lusaka, Jerusalem or Busan.
 */
function wordMatch(text: string, query: string): 0 | 1 | 2 {
  let at = text.indexOf(query);
  let best: 0 | 1 | 2 = 0;
  while (at >= 0) {
    if (at === 0) return 1;
    const before = text[at - 1];
    if (before === " " || before === "-") best = 2;
    at = text.indexOf(query, at + 1);
  }
  return best;
}

/**
 * Countries with several zones: typing one lists its main cities' zones, in this order,
 * each read "United States → New York". The first name is the one shown; the others are
 * other ways to say it. Single-zone countries are plain place aliases.
 */
const COUNTRIES: readonly { names: readonly string[]; zones: readonly string[] }[] = [
  {
    names: ["United States", "USA", "US", "America", "États-Unis"],
    zones: [
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles",
      "America/Anchorage",
      "Pacific/Honolulu",
    ],
  },
  {
    names: ["Canada"],
    zones: [
      "America/Toronto",
      "America/Winnipeg",
      "America/Edmonton",
      "America/Vancouver",
      "America/Halifax",
      "America/St_Johns",
    ],
  },
  {
    names: ["Australia", "Australie"],
    zones: [
      "Australia/Sydney",
      "Australia/Brisbane",
      "Australia/Adelaide",
      "Australia/Darwin",
      "Australia/Perth",
    ],
  },
  {
    names: ["Brazil", "Brasil", "Brésil"],
    zones: ["America/Sao_Paulo", "America/Fortaleza", "America/Manaus", "America/Rio_Branco"],
  },
  {
    names: ["Russia", "Russie"],
    zones: [
      "Europe/Kaliningrad",
      "Europe/Moscow",
      "Asia/Yekaterinburg",
      "Asia/Novosibirsk",
      "Asia/Vladivostok",
    ],
  },
  {
    names: ["Mexico", "Mexique"],
    zones: ["America/Mexico_City", "America/Cancun", "America/Chihuahua", "America/Tijuana"],
  },
  {
    names: ["Indonesia", "Indonésie"],
    zones: ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"],
  },
];

/** One search result: the zone, and the name it was found by when that is not the zone's
 *  own city ("Delhi" for Asia/Kolkata), so the list can say "Delhi → Kolkata". */
export interface ZoneMatch {
  zone: string;
  alias: string | null;
}

/**
 * Zones matching what the person typed: case- and accent-insensitive, spaces and
 * underscores equal, dots and apostrophes ignored ("st. john's" finds America/St_Johns).
 * It matches the start of a word, never the middle of one: against the whole id, the city,
 * the legacy spelling ("calcutta" finds Asia/Kolkata) and the place aliases ("delhi" finds
 * Asia/Kolkata). A country with several zones ("usa") lists its main cities first. Then
 * the zone's own city and aliases that start with the query, then other word matches, each
 * alphabetical; at most `limit`, with `total` the number before the cut.
 */
export function findZones(
  query: string,
  zones: readonly string[],
  limit = 20,
): { matches: ZoneMatch[]; total: number } {
  const q = foldName(query);
  if (!q || limit <= 0) return { matches: [], total: 0 };
  const known = new Set(zones);
  const seen = new Set<string>();
  const country: ZoneMatch[] = [];
  for (const { names, zones: cities } of COUNTRIES) {
    if (!names.some((name) => wordMatch(foldName(name), q) > 0)) continue;
    for (const zone of cities) {
      if (!known.has(zone) || seen.has(zone)) continue;
      seen.add(zone);
      country.push({ zone, alias: names[0] ?? null });
    }
  }
  const prefix: ZoneMatch[] = [];
  const other: ZoneMatch[] = [];
  for (const zone of zones) {
    if (seen.has(zone)) continue;
    const aliases = ALIASES.get(zone) ?? [];
    if (wordMatch(foldName(rawCity(zone)), q) === 1) {
      prefix.push({ zone, alias: null });
      continue;
    }
    const byAlias = aliases.find((name) => wordMatch(foldName(name), q) === 1);
    if (byAlias) {
      prefix.push({ zone, alias: byAlias });
      continue;
    }
    if ([zone, ...(LEGACY_IDS.get(zone) ?? [])].some((id) => wordMatch(foldName(id), q) > 0)) {
      other.push({ zone, alias: null });
      continue;
    }
    const inside = aliases.find((name) => wordMatch(foldName(name), q) > 0);
    if (inside) other.push({ zone, alias: inside });
  }
  const byId = (a: ZoneMatch, b: ZoneMatch) => (a.zone < b.zone ? -1 : a.zone > b.zone ? 1 : 0);
  const all = [...country, ...prefix.sort(byId), ...other.sort(byId)];
  return { matches: all.slice(0, limit), total: all.length };
}

/** `findZones`, zones only. */
export function searchZones(query: string, zones: readonly string[], limit = 20): string[] {
  return findZones(query, zones, limit).matches.map((match) => match.zone);
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
