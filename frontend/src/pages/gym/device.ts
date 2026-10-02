import { useEffect, useRef, useState } from "react";

/**
 * The phone's own hardware, feature-detected (Epic 42): vibration for the end of a rest, and
 * the screen wake lock so the session is not asleep between sets. Every call is a no-op where
 * the browser has no such thing — iOS has no `vibrate`, older Safari no `wakeLock`.
 */

export function vibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(pattern);
    }
  } catch {
    /* a blocked vibration is not worth a message */
  }
}

/**
 * The wall clock, ticking while `enabled`. A timer shows `deadline - now`, never a count of
 * ticks, so a locked phone that wakes ten minutes later shows ten minutes later.
 */
export function useNow(enabled: boolean, everyMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    // Intervals are throttled in the background; catch up the moment the page is back.
    const onVisible = () => setNow(Date.now());
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, everyMs]);
  return now;
}

interface WakeLockSentinelLike {
  release: () => Promise<void>;
}

/**
 * Hold the screen awake while the component is mounted. The browser drops the lock whenever
 * the page is hidden, so it is asked for again when the page becomes visible.
 */
export function useWakeLock(): void {
  const held = useRef<WakeLockSentinelLike | null>(null);
  useEffect(() => {
    const api = (
      navigator as Navigator & {
        wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
      }
    ).wakeLock;
    if (!api) return;
    let gone = false;
    const take = async () => {
      if (gone || document.visibilityState === "hidden") return;
      try {
        const lock = await api.request("screen");
        if (gone) void lock.release().catch(() => undefined);
        else held.current = lock;
      } catch {
        /* refused: low battery, or no permission. The session works without it. */
      }
    };
    void take();
    const onVisible = () => {
      if (document.visibilityState === "visible") void take();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      gone = true;
      document.removeEventListener("visibilitychange", onVisible);
      void held.current?.release().catch(() => undefined);
      held.current = null;
    };
  }, []);
}

/** True while the browser says it has no network. */
export function useBrowserOffline(): boolean {
  const [offline, setOffline] = useState(
    () => typeof navigator !== "undefined" && navigator.onLine === false,
  );
  useEffect(() => {
    const down = () => setOffline(true);
    const up = () => setOffline(false);
    window.addEventListener("offline", down);
    window.addEventListener("online", up);
    return () => {
      window.removeEventListener("offline", down);
      window.removeEventListener("online", up);
    };
  }, []);
  return offline;
}
