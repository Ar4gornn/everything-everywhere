import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "../auth/AuthContext";
import { LanguageProvider } from "../i18n";
import { DEFAULT_PREFERENCES } from "../layout/preferences";
import { loadMoonEngine } from "../moon/engine";
import { moonOnDay } from "../moon/useMoonView";
import { daysLeftInMonth, hintLabel, useNavHints } from "./hints";

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
    await waitFor(() => expect(result.current.calendar?.text).toBe("Sat 3 Oct"));
    expect(result.current.plan?.text).toBe("29 days left");
  });

  it("uses the account's budget start day and says one day in the singular", async () => {
    const { result } = renderHook(() => useNavHints({ moon: false }), {
      wrapper: wrapper({ startDay: 4 }),
    });
    // From the 4th, 3 Oct is the last day of the month that began on 4 Sep.
    await waitFor(() => expect(result.current.plan?.text).toBe("1 day left"));
  });

  it("reads in French", async () => {
    const { result } = renderHook(() => useNavHints({ moon: false }), {
      wrapper: wrapper({ language: "fr" }),
    });
    await waitFor(() => expect(result.current.plan?.text).toBe("29 jours restants"));
    expect(result.current.calendar?.text).toBe("sam. 3 oct.");
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
    await waitFor(() => expect(some.result.current.clocks?.text).toBe("Mum 06:00"));
  });

  it("cuts a long place name in the hint to 12 characters and an ellipsis", async () => {
    expect(hintLabel("Short")).toBe("Short");
    expect(hintLabel("123456789012")).toBe("123456789012");
    expect(hintLabel("1234567890123")).toBe("123456789012…");
    const label = "Aunt Marguerite-Louise of the Islands";
    const { result } = renderHook(() => useNavHints({ moon: false }), {
      wrapper: wrapper({ clocks: [{ id: "a", zone: "America/New_York", label, hours: null }] }),
    });
    await waitFor(() => expect(result.current.clocks).toBeDefined());
    expect(result.current.clocks?.text).toBe("Aunt Marguer… 06:00");
    // In parts, so a renderer can cut the name further and never the time.
    expect(result.current.clocks?.clock).toEqual({ label: "Aunt Marguer…", time: "06:00" });
  });

  it("says the day when the first place's day is not yours, in both languages", async () => {
    // 10:00 UTC, home Paris (12:00 on the 3rd): Tokyo is 19:00 the 3rd, Auckland 23:00 the
    // 3rd; Kiritimati (UTC+14) is 00:00 on the 4th, Honolulu 00:00 on the 3rd.
    const tomorrow = renderHook(() => useNavHints({ moon: false }), {
      wrapper: wrapper({
        clocks: [{ id: "a", zone: "Pacific/Kiritimati", label: "Kiri", hours: null }],
      }),
    });
    await waitFor(() => expect(tomorrow.result.current.clocks).toBeDefined());
    expect(tomorrow.result.current.clocks?.text).toBe("Kiri 00:00 tomorrow");

    const yesterday = renderHook(() => useNavHints({ moon: false }), {
      wrapper: wrapper({
        language: "fr",
        startDay: 1,
        clocks: [{ id: "a", zone: "Pacific/Pago_Pago", label: "Pago", hours: null }],
      }),
    });
    await waitFor(() => expect(yesterday.result.current.clocks).toBeDefined());
    // Pago Pago is UTC-11: 23:00 on the 2nd while Paris is on the 3rd.
    expect(yesterday.result.current.clocks?.text).toBe("Pago 23:00 hier");
    expect(yesterday.result.current.clocks?.clock).toEqual({
      label: "Pago",
      time: "23:00",
      day: "hier",
    });

    const same = renderHook(() => useNavHints({ moon: false }), {
      wrapper: wrapper({
        clocks: [{ id: "a", zone: "Asia/Tokyo", label: "Tokyo", hours: null }],
      }),
    });
    await waitFor(() => expect(same.result.current.clocks).toBeDefined());
    expect(same.result.current.clocks?.text).toBe("Tokyo 19:00");
  });

  it("gives the moon's phase for the app's glyph and the same % as the dashboard line", async () => {
    // Midnight UTC: today's local noon is 9-12 hours away on any machine that tests run on,
    // so the moon at noon and the moon right now differ by more than a percent.
    const pinned = new Date("2026-10-03T00:00:00Z");
    vi.setSystemTime(pinned);
    const { result } = renderHook(() => useNavHints(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.moon).toBeDefined(), { timeout: 5000 });
    const hint = result.current.moon;
    expect(hint?.moon?.phase).toMatch(/Quarter|Gibbous/);
    expect(hint?.moon?.hemisphere).toBe("north");
    // The dashboard line is `moonOnDay(engine, new Date())`: the moon at today's local noon.
    // Pinned date: the hint and that call agree to the percent, and it is not the figure
    // the engine gives for the current instant, which differs.
    const engine = await loadMoonEngine();
    const dashboard = moonOnDay(engine, pinned);
    expect(hint?.text).toBe(`${Math.round(dashboard.illumination * 100)}% lit`);
    expect(hint?.moon?.illumination).toBe(dashboard.illumination);
    expect(hint?.moon?.angle).toBe(dashboard.angle);
    expect(Math.round(engine.stateAt(pinned).illumination * 100)).not.toBe(
      Math.round(dashboard.illumination * 100),
    );
  });

  it("draws the lit side the other way in the southern hemisphere", async () => {
    const { result } = renderHook(() => useNavHints(), {
      wrapper: wrapper({ hemisphere: "south" }),
    });
    await waitFor(() => expect(result.current.moon).toBeDefined(), { timeout: 5000 });
    expect(result.current.moon?.moon?.hemisphere).toBe("south");
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
