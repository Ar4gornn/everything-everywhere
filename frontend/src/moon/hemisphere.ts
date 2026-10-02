/**
 * Which way the lit side faces (Epic 47, AD-63 §4). South of the equator the moon is drawn
 * mirrored. The account's setting wins; null means "from the time zone".
 */

export type Hemisphere = "north" | "south";

/** Southern-hemisphere IANA zones by prefix or exact name; anything else is north. */
export function hemisphereFromZone(zone: string | null | undefined): Hemisphere {
  void zone;
  throw new Error("not built");
}

/** The setting if set, else the zone's hemisphere. */
export function resolveHemisphere(
  setting: Hemisphere | null | undefined,
  zone: string | null | undefined,
): Hemisphere {
  void setting;
  void zone;
  throw new Error("not built");
}
