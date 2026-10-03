import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "../auth/AuthContext";
import { LanguageProvider } from "../i18n";
import { DEFAULT_PREFERENCES } from "../layout/preferences";
import { daysLeftInMonth, useNavHints } from "./hints";

/** 2026-10-03 10:00 UTC. Paris 12:00; a Saturday; the moon is at its last quarter. */
const NOW = new Date("2026-10-03T10:00:00Z");

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

interface Account {
  language?: string;
  startDay?: number;
  clocks?: { id: string; zone: string; label: string; hours: null }[];
  moon?: boolean;
  hemisphere?: "north" | "south" | null;
}

let requested: string[] = [];

function wrapper({ language = "en", startDay = 1, clocks = [], moon = true, hemisphere = null }: Account = {}) {
  window.localStorage.setItem("everything-everywhere.token", "test-token");
  requested = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      requested.push(url);
      return url.includes("/api/auth/me")
        ? json({
            id: "u1",
            email: "sam@example.com",
            currency: "USD",
            created_at: "",
            language,
            timezone: "Europe/Paris",
            budget_start_day: startDay,
            preferences: {
              ...DEFAULT_PREFERENCES,
              clocks,
              moon_hemisphere: hemisphere,
              modules: { ...DEFAULT_PREFERENCES.modules, moon },
            },
          })
        : json({ items: [] });
    }),
  );
  return ({ children }: { children: ReactNode }) =>
    createElement(
      MemoryRouter,
      null,
      createElement(AuthProvider, null, createElement(LanguageProvider, null, children)),
    );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("daysLeftInMonth", () => {
  it("counts today and the rest of the calendar month", () => {
    expect(daysLeftInMonth(1, new Date(2026, 9, 3))).toBe(29);
    expect(daysLeftInMonth(1, new Date(2026, 9, 31))).toBe(1);
  });

  it("follows a month that starts on another day", () => {
    // Starting on the 15th, 3 Oct is in the month that began 15 Sep and ends 14 Oct.
    expect(daysLeftInMonth(15, new Date(2026, 9, 3))).toBe(12);
    // 20 Oct is already in the month that ends 14 Nov.
    expect(daysLeftInMonth(15, new Date(2026, 9, 20))).toBe(26);
  });
});

describe("useNavHints", () => {
  it("says today's date and the days left in the month", async () => {
    const { result } = renderHook(() => useNavHints({ moon: false }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.calendar).toBe("Sat 3 Oct"));
    expect(result.current.plan).toBe("29 days left");
  });

  it("uses the account's budget start day and says one day in the singular", async () => {
    const { result } = renderHook(() => useNavHints({ moon: false }), {
      wrapper: wrapper({ startDay: 4 }),
    });
    // From the 4th, 3 Oct is the last day of the month that began on 4 Sep.
    await waitFor(() => expect(result.current.plan).toBe("1 day left"));
  });

  it("reads in French", async () => {
    const { result } = renderHook(() => useNavHints({ moon: false }), {
      wrapper: wrapper({ language: "fr" }),
    });
    await waitFor(() => expect(result.current.plan).toBe("29 jours restants"));
    expect(result.current.calendar).toBe("sam. 3 oct.");
  });

  it("shows the first place's name and time, and nothing for clocks without a place", async () => {
    const none = renderHook(() => useNavHints({ moon: false }), { wrapper: wrapper() });
    await waitFor(() => expect(none.result.current.plan).toBeDefined());
    expect(none.result.current.clocks).toBeUndefined();

    const some = renderHook(() => useNavHints({ moon: false }), {
      wrapper: wrapper({
        clocks: [
          { id: "a", zone: "America/New_York", label: "Mum", hours: null },
          { id: "b", zone: "Asia/Tokyo", label: "Office", hours: null },
        ],
      }),
    });
    await waitFor(() => expect(some.result.current.clocks).toBe("Mum 06:00"));
  });

  it("shows the moon's glyph and how much is lit once the engine has loaded", async () => {
    const { result } = renderHook(() => useNavHints(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.moon).toBeDefined(), { timeout: 5000 });
    expect(result.current.moon).toMatch(/^🌗 5\d% lit$/);
  });

  it("draws the lit side the other way in the southern hemisphere", async () => {
    const { result } = renderHook(() => useNavHints(), {
      wrapper: wrapper({ hemisphere: "south" }),
    });
    await waitFor(() => expect(result.current.moon).toBeDefined(), { timeout: 5000 });
    expect(result.current.moon).toMatch(/^🌓 5\d% lit$/);
  });

  it("does not load the moon when it is not wanted yet, or when the module is off", async () => {
    const early = renderHook(() => useNavHints({ moon: false }), { wrapper: wrapper() });
    await waitFor(() => expect(early.result.current.plan).toBeDefined());
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(early.result.current.moon).toBeUndefined();

    const off = renderHook(() => useNavHints(), { wrapper: wrapper({ moon: false }) });
    await waitFor(() => expect(off.result.current.plan).toBeDefined());
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(off.result.current.moon).toBeUndefined();
  });

  it("asks the server for nothing but the account", async () => {
    const { result } = renderHook(() => useNavHints(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.moon).toBeDefined(), { timeout: 5000 });
    expect(requested.filter((url) => !url.includes("/api/auth/me"))).toEqual([]);
  });
});
