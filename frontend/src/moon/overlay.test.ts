import { describe, expect, it } from "vitest";

import type { PhaseName } from "./engine";
import { bucketByPhase, cyclesCovered, type DayValue } from "./overlay";

const phaseOf = (day: string): PhaseName => {
  if (day <= "2026-01-02") return "new";
  if (day <= "2026-01-04") return "full";
  return "lastQuarter";
};

const days: DayValue[] = [
  { day: "2026-01-01", value: 4 },
  { day: "2026-01-02", value: null },
  { day: "2026-01-03", value: 2 },
  { day: "2026-01-04", value: 3 },
  { day: "2026-01-05", value: null },
];

const row = (rows: ReturnType<typeof bucketByPhase>, phase: PhaseName) => {
  const found = rows.find((r) => r.phase === phase);
  if (!found) throw new Error(`no ${phase}`);
  return found;
};

describe("bucketByPhase", () => {
  it("always returns the eight phases in order, a phase with no days having a null figure", () => {
    const rows = bucketByPhase(days, phaseOf, "dataDays");
    expect(rows.map((r) => r.phase)).toEqual([
      "new",
      "waxingCrescent",
      "firstQuarter",
      "waxingGibbous",
      "full",
      "waningGibbous",
      "lastQuarter",
      "waningCrescent",
    ]);
    expect(row(rows, "waxingCrescent")).toEqual({
      phase: "waxingCrescent",
      days: 0,
      daysWithData: 0,
      figure: null,
    });
  });

  it("averages over the days that have a value for dataDays", () => {
    const rows = bucketByPhase(days, phaseOf, "dataDays");
    expect(row(rows, "new")).toMatchObject({ days: 2, daysWithData: 1, figure: 4 });
    expect(row(rows, "full")).toMatchObject({ days: 2, daysWithData: 2, figure: 2.5 });
  });

  it("gives null for dataDays when the phase has days but none with data", () => {
    const rows = bucketByPhase(days, phaseOf, "dataDays");
    expect(row(rows, "lastQuarter")).toMatchObject({ days: 1, daysWithData: 0, figure: null });
  });

  it("divides by every day of the phase for allDays, a missing value counting as 0", () => {
    const rows = bucketByPhase(days, phaseOf, "allDays");
    expect(row(rows, "new").figure).toBe(2);
    expect(row(rows, "lastQuarter").figure).toBe(0);
    expect(row(rows, "waxingGibbous").figure).toBeNull();
  });
});

describe("cyclesCovered", () => {
  it("rounds down to whole lunar cycles", () => {
    expect(cyclesCovered(0)).toBe(0);
    expect(cyclesCovered(29)).toBe(0);
    expect(cyclesCovered(30)).toBe(1);
    expect(cyclesCovered(89)).toBe(3);
    expect(cyclesCovered(88)).toBe(2);
    expect(cyclesCovered(355)).toBe(12);
  });
});
