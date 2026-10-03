/**
 * Epic 52 round 1: the zone-naming helpers (legacy ids, city names, folded comparison), apart
 * from `time.ts` so the main bundle, which only needs the clock arithmetic, does not carry the
 * legacy table. `time.ts` re-exports these, so every caller keeps importing from it; a module
 * that never uses them (the navigation hints) is not charged for them.
 */

/** The last part of an id, as written: `"America/Argentina/Buenos_Aires"` → `"Buenos Aires"`. */
export function rawCity(zone: string): string {
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
export const LEGACY_ZONES: Readonly<Record<string, string>> = {
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
  // Region links (round 4): a calendar zone saved as "US/Eastern" is New York's zone, so it
  // is not shown as a second time beside a New York home. Never search aliases: "Eastern"
  // or "Pacific" name more than one place.
  "US/Eastern": "America/New_York",
  "US/Central": "America/Chicago",
  "US/Mountain": "America/Denver",
  "US/Pacific": "America/Los_Angeles",
  "US/Alaska": "America/Anchorage",
  "US/Aleutian": "America/Adak",
  "US/Arizona": "America/Phoenix",
  "US/East-Indiana": "America/Indiana/Indianapolis",
  "US/Hawaii": "Pacific/Honolulu",
  "US/Indiana-Starke": "America/Indiana/Knox",
  "US/Michigan": "America/Detroit",
  "US/Samoa": "Pacific/Pago_Pago",
  "Canada/Atlantic": "America/Halifax",
  "Canada/Central": "America/Winnipeg",
  "Canada/Eastern": "America/Toronto",
  "Canada/Mountain": "America/Edmonton",
  "Canada/Newfoundland": "America/St_Johns",
  "Canada/Pacific": "America/Vancouver",
  "Canada/Saskatchewan": "America/Regina",
  "Canada/Yukon": "America/Whitehorse",
  "Etc/UTC": "UTC",
  "Etc/UCT": "UTC",
  "Etc/Universal": "UTC",
  "Etc/Zulu": "UTC",
  "Etc/GMT": "UTC",
  "Etc/Greenwich": "UTC",
  UCT: "UTC",
  Universal: "UTC",
  Zulu: "UTC",
  GMT: "UTC",
  Greenwich: "UTC",
};

/** Legacy ids that are region links rather than an old city name: no search alias. */
export const isRegionLink = (id: string) => !id.includes("/") || /^(US|Canada|Etc)\//.test(id);

/** The current name of a zone: a legacy id is mapped, anything else is returned as is. */
export function canonicalZone(zone: string): string {
  return LEGACY_ZONES[zone] ?? zone;
}

export function foldName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/[_/\s]+/g, " ")
    .trim();
}
