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

/** Load the engine once; later calls return the same promise. */
export function loadMoonEngine(): Promise<MoonEngine> {
  throw new Error("not built");
}

/** The engine once loaded, else null (and it starts loading). Re-renders when it arrives. */
export function useMoonEngine(): MoonEngine | null {
  throw new Error("not built");
}
