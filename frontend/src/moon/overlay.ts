import type { PhaseName } from "./engine";

/**
 * Your days against the moon (Epic 47, AD-63 §5): pure bucketing, no claims. Each local day in
 * the window is assigned the phase at its local noon; per phase, how many days and the module's
 * figure over those days. A phase with 0 days has a null figure, never 0.
 */

export interface DayValue {
  /** `YYYY-MM-DD`, local. */
  day: string;
  /** The day's figure (mood answer, check-ins, expense cents, sessions); null = no data that day. */
  value: number | null;
}

export interface PhaseBucket {
  phase: PhaseName;
  /** Days of this phase in the window. */
  days: number;
  /** Days of this phase with a value. */
  daysWithData: number;
  /** Mean of the values over `daysWithData` (or per day over `days`, see `per`); null if none. */
  figure: number | null;
}

/**
 * `phaseOf(day)` gives each day's phase (the caller computes it from the engine at local noon).
 * `per`: "dataDays" averages over days that have a value (mood); "allDays" divides the sum by all
 * days of the phase, a missing value counting as 0 (check-ins, spending, sessions per day).
 */
export function bucketByPhase(
  days: DayValue[],
  phaseOf: (day: string) => PhaseName,
  per: "dataDays" | "allDays",
): PhaseBucket[] {
  void days;
  void phaseOf;
  void per;
  throw new Error("not built");
}

/** Whole lunar cycles (29.530588 days) the window covers, rounded down. */
export function cyclesCovered(dayCount: number): number {
  void dayCount;
  throw new Error("not built");
}
