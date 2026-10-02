import { useEffect, useSyncExternalStore } from "react";

/**
 * The moon, computed (Epic 47, AD-63 §1). Spec: docs/epic-47-moon.md.
 *
 * Wraps Astronomy Engine, loaded with a dynamic `import()` so it never sits in the main chunk.
 * Every function is pure in time (and place); nothing here is stored anywhere.
 */

/** The eight phases, in order from new moon. Translated as `moon.phase.<name>`. */
export const PHASES = [
  "new",
  "waxingCrescent",
  "firstQuarter",
  "waxingGibbous",
  "full",
  "waningGibbous",
  "lastQuarter",
  "waningCrescent",
] as const;
export type PhaseName = (typeof PHASES)[number];

export interface MoonState {
  /** Ecliptic elongation of the moon from the sun, 0-360°: 0 new, 90 first quarter, 180 full. */
  angle: number;
  /** Lit fraction of the disc, 0-1. */
  illumination: number;
  /** Days since the last new moon. */
  ageDays: number;
  phase: PhaseName;
}

export interface Quarter {
  kind: "new" | "firstQuarter" | "full" | "lastQuarter";
  /** The instant, UTC. */
  at: Date;
}

export interface RiseSet {
  /** Null when the moon does not rise (or set) on that local day at that place. */
  rise: Date | null;
  set: Date | null;
}

export interface MoonEngine {
  stateAt: (when: Date) => MoonState;
  /** Quarters with `start <= at < end`, in order. */
  quartersBetween: (start: Date, end: Date) => Quarter[];
  /** Rise and set during the local day that starts at `dayStart` (a local midnight). */
  riseSet: (dayStart: Date, lat: number, lon: number) => RiseSet;
}

type Astronomy = typeof import("astronomy-engine");

const KINDS: Quarter["kind"][] = ["new", "firstQuarter", "full", "lastQuarter"];

/** The phase word for an elongation: 45° sectors centred on 0, 45, 90, ... (new is < 22.5 or >= 337.5). */
export function phaseNameFor(angle: number): PhaseName {
  const a = ((angle % 360) + 360) % 360;
  const index = Math.floor((a + 22.5) / 45) % 8;
  return PHASES[index] as PhaseName;
}

function build(astro: Astronomy): MoonEngine {
  const stateAt = (when: Date): MoonState => {
    const angle = astro.MoonPhase(when);
    const illumination = astro.Illumination(astro.Body.Moon, when).phase_fraction;
    // The last new moon: search back a little more than one synodic month (29.53 d).
    const lastNew = astro.SearchMoonPhase(0, when, -32);
    const ageDays = lastNew ? (when.getTime() - lastNew.date.getTime()) / 86_400_000 : 0;
    return { angle, illumination, ageDays, phase: phaseNameFor(angle) };
  };

  const quartersBetween = (start: Date, end: Date): Quarter[] => {
    const found: Quarter[] = [];
    if (!(start.getTime() < end.getTime())) return found;
    let quarter = astro.SearchMoonQuarter(start);
    while (quarter.time.date.getTime() < end.getTime()) {
      found.push({ kind: KINDS[quarter.quarter] as Quarter["kind"], at: quarter.time.date });
      quarter = astro.NextMoonQuarter(quarter);
    }
    return found;
  };

  const riseSet = (dayStart: Date, lat: number, lon: number): RiseSet => {
    const observer = new astro.Observer(lat, lon, 0);
    // Search the 24 hours from the local midnight. A DST day is 23 or 25 hours long; the
    // one-hour slip is at most one event at the very edge of the day, accepted (spec: "a minute
    // or two" is for the instant, not the day boundary).
    const rise = astro.SearchRiseSet(astro.Body.Moon, observer, +1, dayStart, 1);
    const set = astro.SearchRiseSet(astro.Body.Moon, observer, -1, dayStart, 1);
    return { rise: rise ? rise.date : null, set: set ? set.date : null };
  };

  return { stateAt, quartersBetween, riseSet };
}

let pending: Promise<MoonEngine> | null = null;
let loaded: MoonEngine | null = null;
const listeners = new Set<() => void>();

/** Load the engine once; later calls return the same promise. */
export function loadMoonEngine(): Promise<MoonEngine> {
  if (!pending) {
    pending = import("astronomy-engine").then((astro) => {
      loaded = build(astro);
      for (const listener of listeners) listener();
      return loaded;
    });
    // A failed chunk load must be retryable, not cached forever.
    pending.catch(() => {
      pending = null;
    });
  }
  return pending;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The engine once loaded, else null (and it starts loading). Re-renders when it arrives. */
export function useMoonEngine(): MoonEngine | null {
  const engine = useSyncExternalStore(subscribe, () => loaded, () => null);
  useEffect(() => {
    if (!loaded) loadMoonEngine().catch(() => undefined);
  }, []);
  return engine;
}
