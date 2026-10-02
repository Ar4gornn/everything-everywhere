import { describe, expect, it } from "vitest";

import { translator } from "../../i18n/catalogue";
import {
  clock,
  formatDistance,
  formatSeconds,
  formatSet,
  formatTarget,
  minutesBetween,
  parseNumber,
  sanitise,
  summarise,
} from "./measure";
import { startSession, logSet } from "../../gym/session";
import { pushDay, lastBench } from "./testkit";

const en = translator("en");
const fr = translator("fr");
const none = { target_sets: null, target_reps: null, target_seconds: null, target_distance_m: null, target_weight: null, rest_seconds: null };

describe("time and distance", () => {
  it("writes clocks", () => {
    expect(clock(75)).toBe("1:15");
    expect(clock(3725)).toBe("1:02:05");
    expect(clock(-3)).toBe("0:00");
  });
  it("writes seconds under a minute as seconds", () => {
    expect(formatSeconds(45)).toBe("45 s");
    expect(formatSeconds(90)).toBe("1:30");
  });
  it("writes metres and kilometres, with a decimal comma in French", () => {
    expect(formatDistance(800, "en")).toBe("800 m");
    expect(formatDistance(2000, "en")).toBe("2 km");
    expect(formatDistance(1500, "en")).toBe("1.5 km");
    expect(formatDistance(1500, "fr")).toBe("1,5 km");
  });
  it("measures a session between two stamps", () => {
    expect(minutesBetween("2026-09-30T17:00:00Z", "2026-09-30T17:45:00Z")).toBe(45);
    expect(minutesBetween(null, "2026-09-30T17:45:00Z")).toBeNull();
    expect(minutesBetween("2026-09-30T18:00:00Z", "2026-09-30T17:45:00Z")).toBeNull();
  });
});

describe("targets and sets", () => {
  it("writes a target in the kind's measure", () => {
    expect(formatTarget({ ...none, kind: "reps", target_sets: 4, target_reps: 8, target_weight: "60.00" }, "kg", en)).toBe("4 × 8 · 60 kg");
    expect(formatTarget({ ...none, kind: "duration", target_sets: 3, target_seconds: 45 }, "kg", en)).toBe("3 × 45 s");
    expect(formatTarget({ ...none, kind: "distance", target_sets: 1, target_distance_m: 2000 }, "kg", en)).toBe("1 × 2 km");
    expect(formatTarget({ ...none, kind: "reps", target_sets: 4 }, "kg", en)).toBe("4 sets");
    expect(formatTarget({ ...none, kind: "reps" }, "kg", en)).toBe("");
  });
  it("uses French plurals, where zero and one are singular", () => {
    expect(formatTarget({ ...none, kind: "reps", target_sets: 1 }, "kg", fr)).toBe("1 série");
    expect(formatTarget({ ...none, kind: "reps", target_sets: 3 }, "kg", fr)).toBe("3 séries");
  });
  it("writes a set", () => {
    const set = { reps: null, weight: null, duration_seconds: null, distance_m: null };
    expect(formatSet({ ...set, kind: "reps", reps: 8, weight: "60.00" }, "kg", en)).toBe("8 × 60 kg");
    expect(formatSet({ ...set, kind: "reps", reps: 1 }, "kg", en)).toBe("1 rep");
    expect(formatSet({ ...set, kind: "duration", duration_seconds: 45, weight: "10.00" }, "lb", en)).toBe("45 s · 10 lb");
  });
});

describe("typed numbers", () => {
  it("reads a decimal comma, blank and garbage apart", () => {
    expect(parseNumber("62,5")).toBe(62.5);
    expect(parseNumber("62.")).toBe(62);
    expect(parseNumber("  ")).toBeNull();
    expect(parseNumber(".")).toBeNaN();
  });
  it("filters a field as it is typed, keeping a partial decimal", () => {
    expect(sanitise("62.", true)).toBe("62.");
    expect(sanitise("62.567", true)).toBe("62.56");
    expect(sanitise("6a2", true)).toBe("62");
    expect(sanitise("1.5", false)).toBe("15");
  });
});

describe("the end-of-session summary", () => {
  it("counts volume and finds a better top weight than last time", () => {
    let session = startSession(pushDay, new Date("2026-10-02T10:00:00Z"), (() => {
      let n = 0;
      return () => `k${++n}`;
    })());
    const bench = session.exercises[0]?.key ?? "";
    const draft = { reps: 8, weight: "62.50", duration_seconds: null, distance_m: null };
    session = logSet(session, bench, draft, new Date("2026-10-02T10:05:00Z"), () => "s1");
    const sum = summarise(session, { e1: lastBench }, new Date("2026-10-02T10:40:00Z"));
    expect(sum).toEqual({ seconds: 2400, sets: 1, volume: 500, bests: ["Bench press"] });
    const equal = summarise(session, { e1: { ...lastBench, top_weight: "62.50" } }, new Date("2026-10-02T10:40:00Z"));
    expect(equal.bests).toEqual([]);
  });
});

describe("sanitise holds the server's bound", () => {
  it("clamps a whole number to the cap", () => {
    expect(sanitise("5000", false, 999)).toBe("999");
    expect(sanitise("999", false, 999)).toBe("999");
    expect(sanitise("12", false, 999)).toBe("12");
  });
  it("clamps a decimal to the cap", () => {
    expect(sanitise("123456.5", true, 99_999.99)).toBe("99999.99");
    expect(sanitise("62,5", true, 99_999.99)).toBe("62,5");
  });
  it("is unbounded without a cap", () => {
    expect(sanitise("5000", false)).toBe("5000");
  });
});
