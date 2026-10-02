import { useCallback, useSyncExternalStore } from "react";

import { useOptionalAuth } from "../auth/AuthContext";
import { PREFIX } from "../storage";

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

/** Why `locateOnce` failed. */
export type LocateFailure = "denied" | "unavailable" | "timeout";

export const LABEL_MAX = 40;
export const LOCATE_TIMEOUT_MS = 15_000;

const keyOf = (userId: string) => `${PREFIX}moon.${userId}.place`;

const round1 = (value: number): number => {
  const rounded = Math.round(value * 10) / 10;
  return rounded === 0 ? 0 : rounded; // no "-0"
};

/** One decimal, clamped to valid ranges (lat ±90, lon wrapped to ±180). */
export function roundPlace(lat: number, lon: number): { lat: number; lon: number } {
  const la = Math.min(90, Math.max(-90, round1(lat)));
  let lo = round1(lon);
  if (Number.isFinite(lo)) {
    lo = (((lo + 180) % 360) + 360) % 360 - 180;
    if (lo === -180) lo = 180;
    lo = round1(lo);
  }
  return { lat: la, lon: lo };
}

function cleanLabel(label: unknown): string | null {
  if (typeof label !== "string") return null;
  // Control and line-separator characters become spaces (no regex: biome refuses one on them).
  const text = Array.from(label, (ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return code < 32 || code === 127 || code === 0x2028 || code === 0x2029 ? " " : ch;
  })
    .join("")
    .trim()
    .slice(0, LABEL_MAX);
  return text === "" ? null : text;
}

function readRaw(userId: string): string | null {
  try {
    return window.localStorage.getItem(keyOf(userId));
  } catch {
    // Blocked storage: as if no place were stored.
    return null;
  }
}

function parsePlace(raw: string | null): MoonPlace | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== "object" || value === null) return null;
    const { lat, lon, label } = value as Record<string, unknown>;
    if (typeof lat !== "number" || typeof lon !== "number") return null;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    // Whatever is on disk, precision finer than ~10 km never leaves this function.
    return { ...roundPlace(lat, lon), label: cleanLabel(label) };
  } catch {
    return null;
  }
}

export function readPlace(userId: string): MoonPlace | null {
  return parsePlace(readRaw(userId));
}

// ------------------------------------------------------------------ subscribers

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

/** Another tab wrote one of our keys: tell this tab's components. */
function onStorage(event: StorageEvent): void {
  if (event.key === null || event.key.startsWith(`${PREFIX}moon.`)) emit();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

/** Rounds, then stores. Returns what was stored (rounded), or null if storage refused. */
export function writePlace(userId: string, place: MoonPlace): MoonPlace | null {
  if (!Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return null;
  const stored: MoonPlace = { ...roundPlace(place.lat, place.lon), label: cleanLabel(place.label) };
  try {
    window.localStorage.setItem(keyOf(userId), JSON.stringify(stored));
  } catch {
    return null;
  }
  emit();
  return stored;
}

export function clearPlace(userId: string): void {
  try {
    window.localStorage.removeItem(keyOf(userId));
  } catch {
    // Nothing to remove if storage is blocked.
  }
  emit();
}

/**
 * `navigator.geolocation.getCurrentPosition` once, low accuracy, 15 s timeout; resolves the
 * rounded place (not yet stored) or rejects with "denied" | "unavailable" | "timeout".
 */
export function locateOnce(): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => {
    const geolocation = typeof navigator === "undefined" ? undefined : navigator.geolocation;
    if (!geolocation) {
      reject("unavailable" satisfies LocateFailure);
      return;
    }
    geolocation.getCurrentPosition(
      (position) => resolve(roundPlace(position.coords.latitude, position.coords.longitude)),
      (error) => {
        const reason: LocateFailure =
          error.code === 1 ? "denied" : error.code === 3 ? "timeout" : "unavailable";
        reject(reason);
      },
      { enableHighAccuracy: false, timeout: LOCATE_TIMEOUT_MS, maximumAge: 600_000 },
    );
  });
}

// ------------------------------------------------------------------------ hook

/** Last parse per account, so an unchanged place is the same object (a stable snapshot). */
const snapshots = new Map<string, { raw: string | null; value: MoonPlace | null }>();

function snapshotOf(userId: string): MoonPlace | null {
  const raw = readRaw(userId);
  const last = snapshots.get(userId);
  if (last && last.raw === raw) return last.value;
  const value = parsePlace(raw);
  snapshots.set(userId, { raw, value });
  return value;
}

/** The signed-in account's place, re-rendering on change (this tab and others). */
export function usePlace(): [MoonPlace | null, (next: MoonPlace | null) => void] {
  const userId = useOptionalAuth()?.user?.id ?? null;
  const getSnapshot = useCallback(() => (userId ? snapshotOf(userId) : null), [userId]);
  const place = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const set = useCallback(
    (next: MoonPlace | null) => {
      if (!userId) return;
      if (next === null) clearPlace(userId);
      else writePlace(userId, next);
    },
    [userId],
  );
  return [place, set];
}
