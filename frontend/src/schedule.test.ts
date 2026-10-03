import { describe, expect, it } from "vitest";

import { nowTime } from "./schedule";

describe("nowTime with a zone (Epic 48, round 5)", () => {
  const at = new Date("2026-09-07T10:30:00Z");

  it("reads the wall clock of the zone it is given, not the device's", () => {
    expect(nowTime(at, "Asia/Beirut")).toBe("13:30");
    expect(nowTime(at, "Pacific/Auckland")).toBe("22:30");
    expect(nowTime(at, "UTC")).toBe("10:30");
  });

  it("writes midnight as 00, never 24", () => {
    expect(nowTime(new Date("2026-09-07T21:05:00Z"), "Asia/Beirut")).toBe("00:05");
  });

  it("falls back to the device clock for no zone or an unknown one", () => {
    const device = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
    expect(nowTime(at)).toBe(device);
    expect(nowTime(at, "Not/AZone")).toBe(device);
  });
});
