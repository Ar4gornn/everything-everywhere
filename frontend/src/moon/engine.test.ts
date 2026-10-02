import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { loadMoonEngine, PHASES, phaseNameFor, useMoonEngine, type MoonEngine } from "./engine";
import vectors from "./vectors.json";

/**
 * The engine against published tables (Epic 47, AD-63 §1). The vectors are in vectors.json, the
 * same file the Python tests read: both sides must agree on when the moon is full.
 */

const MIN = 60_000;
const at = (iso: string) => new Date(iso);

let engine: MoonEngine;
const ready = async () => {
  engine ??= await loadMoonEngine();
  return engine;
};

describe("quarters vs the NASA table (shared vectors)", () => {
  it("has at least six new/full instants", () => {
    const wanted = vectors.quarters.filter((q) => q.kind === "new" || q.kind === "full");
    expect(wanted.length).toBeGreaterThanOrEqual(6);
  });

  for (const vector of vectors.quarters) {
    it(`${vector.kind} ${vector.utc} within ${vectors.toleranceMinutes.quarters} min`, async () => {
      const e = await ready();
      const expected = at(vector.utc).getTime();
      const found = e.quartersBetween(
        new Date(expected - 24 * 3600_000),
        new Date(expected + 24 * 3600_000),
      );
      const match = found.find((q) => q.kind === vector.kind);
      expect(match, "no quarter of that kind within a day").toBeDefined();
      expect(Math.abs((match?.at.getTime() ?? 0) - expected)).toBeLessThanOrEqual(
        vectors.toleranceMinutes.quarters * MIN,
      );
    });
  }

  it("lists a year's quarters in order, cycling new > first > full > last, `end` exclusive", async () => {
    const e = await ready();
    const list = e.quartersBetween(at("2025-01-01T00:00:00Z"), at("2026-01-01T00:00:00Z"));
    expect(list.length).toBeGreaterThanOrEqual(49);
    expect(list.length).toBeLessThanOrEqual(50);
    const order = ["new", "firstQuarter", "full", "lastQuarter"];
    for (let i = 1; i < list.length; i++) {
      expect(list[i]?.at.getTime()).toBeGreaterThan(list[i - 1]?.at.getTime() ?? 0);
      expect(order.indexOf(list[i]?.kind ?? "")).toBe(
        (order.indexOf(list[i - 1]?.kind ?? "") + 1) % 4,
      );
    }
    const first = list[0]?.at as Date;
    expect(e.quartersBetween(at("2025-01-01T00:00:00Z"), first)).toEqual([]);
    expect(
      e.quartersBetween(at("2025-01-01T00:00:00Z"), new Date(first.getTime() + 1)),
    ).toHaveLength(1);
  });

  it("an empty or backwards window is empty", async () => {
    const e = await ready();
    expect(e.quartersBetween(at("2025-03-01T00:00:00Z"), at("2025-03-01T00:00:00Z"))).toEqual([]);
    expect(e.quartersBetween(at("2025-03-10T00:00:00Z"), at("2025-03-01T00:00:00Z"))).toEqual([]);
  });
});

describe("state", () => {
  it("is full at a full moon: angle 180, lit ~1", async () => {
    const e = await ready();
    const s = e.stateAt(at("2025-01-13T22:27:32Z"));
    expect(s.angle).toBeGreaterThan(179.9);
    expect(s.angle).toBeLessThan(180.1);
    expect(s.illumination).toBeGreaterThan(0.99);
    expect(s.phase).toBe("full");
  });

  it("is new at a new moon: lit ~0, age ~0", async () => {
    const e = await ready();
    const s = e.stateAt(at("2025-01-29T12:36:34Z"));
    expect(s.illumination).toBeLessThan(0.01);
    expect(s.phase).toBe("new");
    expect(s.ageDays).toBeGreaterThanOrEqual(0);
    expect(s.ageDays).toBeLessThan(0.01);
  });

  it("is half lit at the quarters", async () => {
    const e = await ready();
    expect(e.stateAt(at("2025-01-06T23:56:51Z")).illumination).toBeCloseTo(0.5, 2);
    expect(e.stateAt(at("2025-01-21T20:31:26Z")).illumination).toBeCloseTo(0.5, 2);
    expect(e.stateAt(at("2025-01-06T23:56:51Z")).phase).toBe("firstQuarter");
    expect(e.stateAt(at("2025-01-21T20:31:26Z")).phase).toBe("lastQuarter");
  });

  it("counts age in days since the last new moon (10 days after 2025-01-29 12:36:34)", async () => {
    const e = await ready();
    const s = e.stateAt(at("2025-02-08T12:36:34Z"));
    expect(s.ageDays).toBeGreaterThan(9.99);
    expect(s.ageDays).toBeLessThan(10.01);
    expect(s.phase).toBe("waxingGibbous");
  });

  it("is waning after full", async () => {
    const e = await ready();
    expect(e.stateAt(at("2025-01-18T00:00:00Z")).phase).toBe("waningGibbous");
    expect(e.stateAt(at("2025-01-26T00:00:00Z")).phase).toBe("waningCrescent");
  });
});

describe("phase names by angle (shared table)", () => {
  for (const [angle, name] of vectors.phaseNames as [number, string][]) {
    it(`${angle} -> ${name}`, () => {
      expect(phaseNameFor(angle)).toBe(name);
    });
  }

  it("uses every phase around the circle", () => {
    const seen = new Set<string>();
    for (let a = 0; a < 360; a += 1) seen.add(phaseNameFor(a));
    expect([...seen].sort()).toEqual([...PHASES].sort());
  });
});

describe("rise and set vs a published almanac (shared vectors)", () => {
  for (const vector of vectors.riseSet) {
    it(`${vector.place} ${vector.localDay} within ${vectors.toleranceMinutes.riseSet} min`, async () => {
      const e = await ready();
      const result = e.riseSet(at(vector.dayStartUtc), vector.lat, vector.lon);
      const tol = vectors.toleranceMinutes.riseSet * MIN;
      expect(result.rise).not.toBeNull();
      expect(result.set).not.toBeNull();
      expect(
        Math.abs((result.rise as Date).getTime() - at(vector.rise).getTime()),
      ).toBeLessThanOrEqual(tol);
      expect(
        Math.abs((result.set as Date).getTime() - at(vector.set).getTime()),
      ).toBeLessThanOrEqual(tol);
    });
  }

  it("is null when the moon does not rise or set that day (78 N, January 2025)", async () => {
    const e = await ready();
    expect(e.riseSet(at("2025-01-01T00:00:00Z"), 78, 15)).toEqual({ rise: null, set: null });
    const oneSided = e.riseSet(at("2025-01-06T00:00:00Z"), 78, 15);
    expect(oneSided.rise).not.toBeNull();
    expect(oneSided.set).toBeNull();
  });
});

describe("loading", () => {
  it("returns the same promise every time (loaded once)", () => {
    expect(loadMoonEngine()).toBe(loadMoonEngine());
  });

  it("useMoonEngine hands back the engine once loaded", async () => {
    const { result } = renderHook(() => useMoonEngine());
    await act(async () => {
      await loadMoonEngine();
    });
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(typeof result.current?.stateAt).toBe("function");
  });
});
