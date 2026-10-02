import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearPlace, locateOnce, readPlace, roundPlace, usePlace, writePlace } from "./location";

vi.mock("../auth/AuthContext", () => ({ useOptionalAuth: () => ({ user: { id: "u1" } }) }));

const KEY = "everything-everywhere.moon.u1.place";

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("roundPlace", () => {
  it("rounds to one decimal", () => {
    expect(roundPlace(48.8566, 2.3522)).toEqual({ lat: 48.9, lon: 2.4 });
    expect(roundPlace(-33.8688, 151.2093)).toEqual({ lat: -33.9, lon: 151.2 });
  });
  it("clamps latitude and wraps longitude", () => {
    expect(roundPlace(95, 0).lat).toBe(90);
    expect(roundPlace(-123, 0).lat).toBe(-90);
    expect(roundPlace(0, 190).lon).toBe(-170);
    expect(roundPlace(0, -190).lon).toBe(170);
    expect(roundPlace(0, 180).lon).toBe(180);
    expect(roundPlace(0, 540).lon).toBe(180);
  });
  it("never yields negative zero", () => {
    expect(Object.is(roundPlace(-0.01, -0.02).lat, 0)).toBe(true);
    expect(Object.is(roundPlace(-0.01, -0.02).lon, 0)).toBe(true);
  });
});

describe("the stored place", () => {
  it("is rounded BEFORE it is written: the stored bytes carry one decimal", () => {
    const stored = writePlace("u1", { lat: 48.856614, lon: 2.352222, label: "Home" });
    expect(stored).toEqual({ lat: 48.9, lon: 2.4, label: "Home" });
    const raw = window.localStorage.getItem(KEY) as string;
    expect(JSON.parse(raw)).toEqual({ lat: 48.9, lon: 2.4, label: "Home" });
    expect(raw).not.toContain("48.85");
    expect(raw).not.toContain("2.352");
  });

  it("round-trips, and clearing removes the key", () => {
    writePlace("u1", { lat: 10, lon: 20, label: null });
    expect(readPlace("u1")).toEqual({ lat: 10, lon: 20, label: null });
    clearPlace("u1");
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(readPlace("u1")).toBeNull();
  });

  it("is per account", () => {
    writePlace("u1", { lat: 10, lon: 20, label: null });
    expect(readPlace("u2")).toBeNull();
  });

  it("trims, caps and empties the label", () => {
    expect(writePlace("u1", { lat: 1, lon: 1, label: "  Home  " })?.label).toBe("Home");
    expect(writePlace("u1", { lat: 1, lon: 1, label: "   " })?.label).toBeNull();
    expect(writePlace("u1", { lat: 1, lon: 1, label: "x".repeat(100) })?.label).toHaveLength(40);
  });

  it("refuses a non-finite coordinate and stores nothing", () => {
    expect(writePlace("u1", { lat: Number.NaN, lon: 0, label: null })).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("re-rounds finer bytes found on disk and ignores junk", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ lat: 48.856614, lon: 2.352222, label: null }),
    );
    expect(readPlace("u1")).toEqual({ lat: 48.9, lon: 2.4, label: null });
    for (const junk of ["not json", "null", "[]", '{"lat":"1","lon":2}', '{"lat":1}']) {
      window.localStorage.setItem(KEY, junk);
      expect(readPlace("u1")).toBeNull();
    }
  });

  it("blocked storage means no place, and a write reports null", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readPlace("u1")).toBeNull();
    expect(writePlace("u1", { lat: 1, lon: 1, label: null })).toBeNull();
    expect(() => clearPlace("u1")).not.toThrow();
  });
});

describe("locateOnce", () => {
  const stub = (
    impl: (ok: PositionCallback, err: PositionErrorCallback, opts?: PositionOptions) => void,
  ) => {
    const getCurrentPosition = vi.fn(impl);
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });
    return getCurrentPosition;
  };

  it("resolves the rounded coordinates, low accuracy, 15 s timeout", async () => {
    const spy = stub((ok) =>
      ok({ coords: { latitude: 48.856614, longitude: 2.352222 } } as GeolocationPosition),
    );
    await expect(locateOnce()).resolves.toEqual({ lat: 48.9, lon: 2.4 });
    const options = spy.mock.calls[0]?.[2];
    expect(options?.enableHighAccuracy).toBe(false);
    expect(options?.timeout).toBe(15_000);
    // resolving does not store anything
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("rejects 'denied' for code 1", async () => {
    stub((_ok, err) => err({ code: 1 } as GeolocationPositionError));
    await expect(locateOnce()).rejects.toBe("denied");
  });

  it("rejects 'timeout' for code 3", async () => {
    stub((_ok, err) => err({ code: 3 } as GeolocationPositionError));
    await expect(locateOnce()).rejects.toBe("timeout");
  });

  it("rejects 'unavailable' for code 2 and for no geolocation at all", async () => {
    stub((_ok, err) => err({ code: 2 } as GeolocationPositionError));
    await expect(locateOnce()).rejects.toBe("unavailable");
    vi.stubGlobal("navigator", {});
    await expect(locateOnce()).rejects.toBe("unavailable");
  });
});

describe("usePlace", () => {
  it("starts empty and re-renders on a write through the setter", () => {
    const { result } = renderHook(() => usePlace());
    expect(result.current[0]).toBeNull();
    act(() => result.current[1]({ lat: 48.856, lon: 2.352, label: "Home" }));
    expect(result.current[0]).toEqual({ lat: 48.9, lon: 2.4, label: "Home" });
    act(() => result.current[1](null));
    expect(result.current[0]).toBeNull();
  });

  it("re-renders on a direct write and on another tab's storage event", () => {
    const { result } = renderHook(() => usePlace());
    act(() => {
      writePlace("u1", { lat: 5, lon: 6, label: null });
    });
    expect(result.current[0]).toEqual({ lat: 5, lon: 6, label: null });
    act(() => {
      window.localStorage.setItem(KEY, JSON.stringify({ lat: 7, lon: 8, label: null }));
      window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
    });
    expect(result.current[0]).toEqual({ lat: 7, lon: 8, label: null });
  });

  it("returns the same object while nothing changed (stable snapshot)", () => {
    writePlace("u1", { lat: 5, lon: 6, label: null });
    const { result, rerender } = renderHook(() => usePlace());
    const first = result.current[0];
    rerender();
    expect(result.current[0]).toBe(first);
  });
});
