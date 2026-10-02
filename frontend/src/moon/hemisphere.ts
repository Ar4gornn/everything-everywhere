/**
 * Which way the lit side faces (Epic 47, AD-63 §4). South of the equator the moon is drawn
 * mirrored. The account's setting wins; null means "from the time zone".
 */

export type Hemisphere = "north" | "south";

/** Whole families of zones that are entirely south of the equator. */
const SOUTH_PREFIXES = [
  "Australia/",
  "Antarctica/",
  "America/Argentina/",
  "Brazil/",
  "Chile/",
] as const;

/**
 * Single zones south of the equator. The rule for a zone that straddles the line (Indonesia,
 * Ecuador, Kenya, Brazil's Amazon) is the latitude of the zone's named city: Quito (0.2 S),
 * Nairobi (1.3 S) and Pontianak (0.02 S) are south; Kampala, Libreville, Singapore are north.
 * The zone only picks a default drawing direction; the account setting overrides it.
 */
const SOUTH_ZONES: ReadonlySet<string> = new Set([
  // South America
  "America/Buenos_Aires",
  "America/Santiago",
  "America/Punta_Arenas",
  "America/Sao_Paulo",
  "America/Bahia",
  "America/Fortaleza",
  "America/Recife",
  "America/Maceio",
  "America/Belem",
  "America/Araguaina",
  "America/Manaus",
  "America/Cuiaba",
  "America/Campo_Grande",
  "America/Porto_Velho",
  "America/Rio_Branco",
  "America/Noronha",
  "America/Lima",
  "America/La_Paz",
  "America/Asuncion",
  "America/Montevideo",
  "America/Guayaquil",
  "Pacific/Galapagos",
  "Pacific/Easter",
  "Atlantic/Stanley",
  "Atlantic/South_Georgia",
  // Africa and the Indian Ocean
  "Africa/Johannesburg",
  "Africa/Maputo",
  "Africa/Harare",
  "Africa/Lusaka",
  "Africa/Windhoek",
  "Africa/Gaborone",
  "Africa/Maseru",
  "Africa/Mbabane",
  "Africa/Lubumbashi",
  "Africa/Blantyre",
  "Africa/Luanda",
  "Africa/Kinshasa",
  "Africa/Dar_es_Salaam",
  "Africa/Nairobi",
  "Africa/Kigali",
  "Africa/Bujumbura",
  "Atlantic/St_Helena",
  "Indian/Antananarivo",
  "Indian/Mauritius",
  "Indian/Reunion",
  "Indian/Comoro",
  "Indian/Mayotte",
  "Indian/Chagos",
  "Indian/Christmas",
  "Indian/Cocos",
  // Indonesia, Timor, Pacific
  "Asia/Jakarta",
  "Asia/Pontianak",
  "Asia/Makassar",
  "Asia/Jayapura",
  "Asia/Dili",
  "Pacific/Auckland",
  "NZ",
  "NZ-CHAT",
  "Pacific/Chatham",
  "Pacific/Fiji",
  "Pacific/Tongatapu",
  "Pacific/Apia",
  "Pacific/Pago_Pago",
  "Pacific/Noumea",
  "Pacific/Efate",
  "Pacific/Norfolk",
  "Pacific/Guadalcanal",
  "Pacific/Port_Moresby",
  "Pacific/Tahiti",
  "Pacific/Marquesas",
  "Pacific/Gambier",
  "Pacific/Rarotonga",
  "Pacific/Niue",
  "Pacific/Fakaofo",
  "Pacific/Wallis",
  "Pacific/Funafuti",
]);

/** Southern-hemisphere IANA zones by prefix or exact name; anything else is north. */
export function hemisphereFromZone(zone: string | null | undefined): Hemisphere {
  if (!zone) return "north";
  if (SOUTH_ZONES.has(zone)) return "south";
  return SOUTH_PREFIXES.some((prefix) => zone.startsWith(prefix)) ? "south" : "north";
}

/** The setting if set, else the zone's hemisphere. */
export function resolveHemisphere(
  setting: Hemisphere | null | undefined,
  zone: string | null | undefined,
): Hemisphere {
  return setting === "north" || setting === "south" ? setting : hemisphereFromZone(zone);
}
