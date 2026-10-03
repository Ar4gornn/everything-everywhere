/**
 * Epic 52 round 1: the place search, apart from `time.ts` so the main bundle does not carry
 * the alias and country tables. Imported only by the Clocks page and the Settings card (both
 * lazy chunks); the navigation hints use `time.ts` alone.
 */
import { LEGACY_ZONES, canonicalZone, foldName, isRegionLink, rawCity } from "./zones";

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
  Korea: "Asia/Seoul",
  Malaysia: "Asia/Kuala_Lumpur",
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
  LA: "America/Los_Angeles",
  Arizona: "America/Phoenix",
  Alaska: "America/Anchorage",
  Texas: "America/Chicago",
  Florida: "America/New_York",
  NYC: "America/New_York",
  Brooklyn: "America/New_York",
  Queens: "America/New_York",
  Manhattan: "America/New_York",
  Bronx: "America/New_York",
  "Staten Island": "America/New_York",
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
  Chile: "America/Santiago",
  Colombia: "America/Bogota",
  Peru: "America/Lima",
  "Cape Town": "Africa/Johannesburg",
  "South Africa": "Africa/Johannesburg",
  Egypt: "Africa/Cairo",
  Nigeria: "Africa/Lagos",
  Abuja: "Africa/Lagos",
  Kenya: "Africa/Nairobi",
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
  Deutschland: "Europe/Berlin",
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
  Britain: "Europe/London",
  "Great Britain": "Europe/London",
  Ireland: "Europe/Dublin",
  Iceland: "Atlantic/Reykjavik",
  Netherlands: "Europe/Amsterdam",
  Holland: "Europe/Amsterdam",
  Rotterdam: "Europe/Amsterdam",
  Belgium: "Europe/Brussels",
  Portugal: "Europe/Lisbon",
  Greece: "Europe/Athens",
  Turkey: "Europe/Istanbul",
  Ankara: "Europe/Istanbul",
  "St Petersburg": "Europe/Moscow",
  Krakow: "Europe/Warsaw",
  Poland: "Europe/Warsaw",
  Sweden: "Europe/Stockholm",
  Norway: "Europe/Oslo",
  Denmark: "Europe/Copenhagen",
  Finland: "Europe/Helsinki",
  Austria: "Europe/Vienna",
  "New Zealand": "Pacific/Auckland",
  NZ: "Pacific/Auckland",
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
  if (isRegionLink(legacy)) continue;
  if (rawCity(legacy) !== rawCity(current)) addAlias(current, rawCity(legacy));
}
for (const [name, zone] of Object.entries(PLACE_ALIASES)) addAlias(zone, name);
/** Current id -> its legacy ids, so "asia/calc" still finds Asia/Kolkata. */
const LEGACY_IDS = new Map<string, string[]>();
for (const [legacy, current] of Object.entries(LEGACY_ZONES)) {
  if (isRegionLink(legacy)) continue;
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
  if (q.length < MIN_QUERY || limit <= 0) return { matches: [], total: 0 };
  const known = new Set(zones);
  const seen = new Set<string>();
  // Countries named exactly ("brazil"), then countries whose name a word of it starts.
  const exactCountry: ZoneMatch[] = [];
  // Countries whose name a word starts, and aliases a word starts: each group is one name
  // with its zones, ordered shortest name first so "in" lists India before Indonesia.
  const groups: { name: string; items: ZoneMatch[] }[] = [];
  for (const exact of [true, false]) {
    for (const { names, zones: cities } of COUNTRIES) {
      const hit = exact
        ? names.some((name) => foldName(name) === q)
        : names.some((name) => wordMatch(foldName(name), q) > 0);
      if (!hit) continue;
      const matched =
        names.find((name) => wordMatch(foldName(name), q) === 1) ??
        names.find((name) => wordMatch(foldName(name), q) > 0) ??
        names[0] ??
        "";
      const items: ZoneMatch[] = [];
      for (const zone of cities) {
        if (!known.has(zone) || seen.has(zone)) continue;
        seen.add(zone);
        (exact ? exactCountry : items).push({ zone, alias: names[0] ?? null });
      }
      if (!exact && items.length > 0) groups.push({ name: matched, items });
    }
  }
  // A place alias said exactly ("india", "rio") is what the person meant: it comes before
  // every word-start match (Indianapolis, Rio Branco), right after an exact country.
  const exactAlias: ZoneMatch[] = [];
  const prefix: ZoneMatch[] = [];
  const aliasPrefix: { name: string; items: ZoneMatch[] }[] = [];
  const other: ZoneMatch[] = [];
  for (const zone of zones) {
    if (seen.has(zone)) continue;
    const aliases = ALIASES.get(zone) ?? [];
    const exact = aliases.find((name) => foldName(name) === q);
    if (exact && foldName(rawCity(zone)) !== q) {
      exactAlias.push({ zone, alias: exact });
      continue;
    }
    if (wordMatch(foldName(rawCity(zone)), q) === 1) {
      prefix.push({ zone, alias: null });
      continue;
    }
    const byAlias = aliases.find((name) => wordMatch(foldName(name), q) === 1);
    if (byAlias) {
      aliasPrefix.push({ name: byAlias, items: [{ zone, alias: byAlias }] });
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
  // Country and alias prefixes together: shortest name first, then alphabetical.
  const named = [...groups, ...aliasPrefix]
    .map((group) => ({ ...group, folded: foldName(group.name) }))
    .sort((a, b) =>
      a.folded.length !== b.folded.length
        ? a.folded.length - b.folded.length
        : a.folded < b.folded
          ? -1
          : a.folded > b.folded
            ? 1
            : 0,
    )
    .flatMap((group) => group.items);
  const all = [
    ...exactCountry,
    ...exactAlias.sort(byId),
    ...named,
    ...prefix.sort(byId),
    ...other.sort(byId),
  ];
  return { matches: all.slice(0, limit), total: all.length };
}

/** The fewest folded characters a search needs: one letter matches half the world. */
export const MIN_QUERY = 2;

/** Is `query` long enough to search? */
export function isSearchable(query: string): boolean {
  return foldName(query).length >= MIN_QUERY;
}

/** `findZones`, zones only. */
export function searchZones(query: string, zones: readonly string[], limit = 20): string[] {
  return findZones(query, zones, limit).matches.map((match) => match.zone);
}
