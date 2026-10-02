import { PHASES, type PhaseName } from "./engine";

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
  const acc = new Map<PhaseName, { days: number; withData: number; sum: number }>(
    PHASES.map((phase) => [phase, { days: 0, withData: 0, sum: 0 }]),
  );
  for (const { day, value } of days) {
    const slot = acc.get(phaseOf(day));
    if (!slot) continue;
    slot.days += 1;
    if (value !== null) {
      slot.withData += 1;
      slot.sum += value;
    }
  }
  return PHASES.map((phase) => {
    const slot = acc.get(phase) ?? { days: 0, withData: 0, sum: 0 };
    const divisor = per === "dataDays" ? slot.withData : slot.days;
    return {
      phase,
      days: slot.days,
      daysWithData: slot.withData,
      figure: divisor === 0 ? null : slot.sum / divisor,
    };
  });
}

/** Mean length of a lunar month, in days. */
export const SYNODIC_DAYS = 29.530588;

/** Whole lunar cycles (29.530588 days) the window covers, rounded down. */
export function cyclesCovered(dayCount: number): number {
  return Math.max(0, Math.floor(dayCount / SYNODIC_DAYS));
}
