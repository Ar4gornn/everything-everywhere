/**
 * Where moonrise is computed for (Epic 47, AD-63 §3). On this device only, never sent anywhere:
 * `everything-everywhere.moon.<userId>.place`, rounded to one decimal (~10 km) BEFORE it is
 * written. try/catch around every storage access; blocked storage = no place.
 */

export interface MoonPlace {
  lat: number;
  lon: number;
  /** What the person typed to recognise it ("Home"); optional, never geocoded. */
  label: string | null;
}

/** One decimal, clamped to valid ranges (lat ±90, lon wrapped to ±180). */
export function roundPlace(lat: number, lon: number): { lat: number; lon: number } {
  void lat;
  void lon;
  throw new Error("not built");
}

export function readPlace(userId: string): MoonPlace | null {
  void userId;
  throw new Error("not built");
}

/** Rounds, then stores. Returns what was stored (rounded), or null if storage refused. */
export function writePlace(userId: string, place: MoonPlace): MoonPlace | null {
  void userId;
  void place;
  throw new Error("not built");
}

export function clearPlace(userId: string): void {
  void userId;
  throw new Error("not built");
}

/**
 * `navigator.geolocation.getCurrentPosition` once, low accuracy, 15 s timeout; resolves the
 * rounded place (not yet stored) or rejects with "denied" | "unavailable" | "timeout".
 */
export function locateOnce(): Promise<{ lat: number; lon: number }> {
  throw new Error("not built");
}

/** The signed-in account's place, re-rendering on change (this tab and others). */
export function usePlace(): [MoonPlace | null, (next: MoonPlace | null) => void] {
  throw new Error("not built");
}
