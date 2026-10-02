/**
 * Epic 47 (AD-63), the wiring: the /moon route and its module gate, the calendar's day
 * glyphs and labels, the dashboard line, Settings → Moon and the digest kind. The engine,
 * the place store, the hemisphere table and both of Builder B's components are replaced:
 * what is under test is where the moon is drawn and what the screens send, not astronomy.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import type { ModuleId, Preferences } from "../api/types";
import { AuthProvider } from "../auth/AuthContext";
import { ToastProvider } from "../components/Toast";
import { LanguageProvider } from "../i18n";
import { DEFAULT_PREFERENCES, MODULES } from "../layout/preferences";
import { PRELOAD_TIMEOUT, preloadPages } from "../test/preloadPages";
import { ThemeProvider } from "../theme";
import type { MoonState } from "./engine";
import { clearPlace, usePlace } from "./location";
import { useMoonEngine } from "./engine";

const FULL: MoonState = { angle: 180, illumination: 1, ageDays: 14.8, phase: "full" };

/** The local noon of today: the instant a day's moon is taken at, and where the full moon is. */
const todayNoon = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
};
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const fakeEngine = {
  stateAt: vi.fn(() => FULL),
  phaseAt: vi.fn(() => "full" as const),
  quartersBetween: vi.fn(() => [{ kind: "full" as const, at: todayNoon() }]),
  riseSet: vi.fn(() => ({ rise: null, set: null })),
};

vi.mock("./engine", () => ({
  PHASES: [],
  useMoonEngine: vi.fn(),
  loadMoonEngine: vi.fn(),
}));
vi.mock("./hemisphere", () => ({
  hemisphereFromZone: (zone: string | null) => (zone?.startsWith("Australia/") ? "south" : "north"),
  resolveHemisphere: (setting: string | null | undefined, zone: string | null) =>
    setting ?? (zone?.startsWith("Australia/") ? "south" : "north"),
}));
vi.mock("./location", () => ({
  clearPlace: vi.fn(),
  usePlace: vi.fn(),
  readPlace: vi.fn(),
  writePlace: vi.fn(),
  roundPlace: vi.fn(),
  locateOnce: vi.fn(),
}));
vi.mock("../components/MoonGlyph", () => ({
  MoonGlyph: ({ phase, hemisphere, size }: { phase: string; hemisphere?: string; size?: number }) => (
    <span data-testid="glyph" data-phase={phase} data-hemisphere={hemisphere} data-size={size} />
  ),
}));
vi.mock("../pages/MoonPage", () => ({
  MoonPage: () => <p>moon page marker</p>,
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ALL_ON = DEFAULT_PREFERENCES.modules;
const withoutMoon: Record<ModuleId, boolean> = { ...ALL_ON, moon: false };

let requests: { url: string; method: string; body: unknown }[];
const setPlace = vi.fn();

function renderAt(
  path: string,
  options: {
    modules?: Record<ModuleId, boolean>;
    prefs?: Partial<Preferences>;
    user?: Record<string, unknown>;
  } = {},
) {
  window.localStorage.setItem("everything-everywhere.token", "test-token");
  requests = [];
  // jsdom has no push: the digest card only draws where this device could receive one.
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      ready: Promise.resolve({ pushManager: { getSubscription: async () => null } }),
    },
  });
  vi.stubGlobal("PushManager", function PushManager() {});
  vi.stubGlobal("Notification", { permission: "granted", requestPermission: vi.fn() });
  const prefs: Preferences = {
    ...DEFAULT_PREFERENCES,
    modules: options.modules ?? ALL_ON,
    ...options.prefs,
  };
  const user = {
    id: "u1",
    email: "sam@example.com",
    currency: "USD",
    weight_unit: "kg",
    budget_start_day: 1,
    created_at: "",
    timezone: "Europe/Paris",
    preferences: prefs,
    ...options.user,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      requests.push({ url, method, body });
      if (url.includes("/api/auth/me/preferences")) {
        return json({ ...user, preferences: { ...prefs, ...(body as object) } });
      }
      if (url.includes("/api/auth/me/recovery-codes")) return json({ unused: 0, total: 0 });
      if (url.includes("/api/auth/me")) return json(user);
      if (url.includes("/api/books/quotes/draw")) return json(null);
      if (url.includes("/api/dashboard") || url.includes("/api/summary")) return json(null);
      if (url.includes("/api/savings/overview")) return json({ pots: [] });
      if (url.includes("/api/push/status")) return json({ enabled: true, devices: 0 });
      if (url.includes("/api/push/preview")) {
        return json({
          empty: true,
          title: "",
          body: null,
          url: "/",
          local_date: "2026-10-03",
          digest_time: "19:00",
          timezone: null,
        });
      }
      return json({ items: [] });
    }),
  );
  return render(
    <AuthProvider>
      <LanguageProvider>
        <ToastProvider>
          <ThemeProvider>
            <MemoryRouter initialEntries={[path]}>
              <App />
            </MemoryRouter>
          </ThemeProvider>
        </ToastProvider>
      </LanguageProvider>
    </AuthProvider>,
  );
}

const patches = () => requests.filter((r) => r.method === "PATCH").map((r) => r.body);

beforeAll(preloadPages, PRELOAD_TIMEOUT);
afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(useMoonEngine).mockReset();
  vi.mocked(useMoonEngine).mockReturnValue(fakeEngine);
  fakeEngine.stateAt.mockClear();
  vi.mocked(clearPlace).mockClear();
  setPlace.mockReset();
  vi.mocked(usePlace).mockReturnValue([null, setPlace]);
});
afterEach(() => vi.unstubAllGlobals());

describe("the /moon route", () => {
  it("shows the page when the module is on", async () => {
    renderAt("/moon");
    expect(await screen.findByText("moon page marker")).toBeInTheDocument();
  });

  it("shows the turned-off notice, not the page, when the module is off", async () => {
    renderAt("/moon", { modules: withoutMoon });
    expect(await screen.findByText("Moon is turned off")).toBeInTheDocument();
    expect(screen.queryByText("moon page marker")).not.toBeInTheDocument();
  });

  it("is a module Customise can switch, and not a bottom tab", async () => {
    expect(MODULES).toContain("moon");
    renderAt("/settings");
    const layout = await screen.findByText("Sections you use");
    const card = layout.closest("fieldset") as HTMLElement;
    expect(within(card).getByRole("checkbox", { name: "Moon" })).toBeChecked();
    const bar = screen.getByRole("navigation", { name: "Sections" });
    expect(within(bar).queryByText(/Moon/)).not.toBeInTheDocument();
  });
});

describe("calendar", () => {
  it("draws a small glyph in each day cell, and names the full-moon day", async () => {
    renderAt("/calendar");
    const cell = await waitFor(() => {
      const found = document.querySelector(`[data-iso="${iso(new Date())}"]`);
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    await waitFor(() => expect(cell.querySelector('[data-testid="glyph"]')).not.toBeNull());
    expect(cell.getAttribute("aria-label")).toMatch(/, Full moon$/);
    const glyphs = document.querySelectorAll('.cal-day [data-testid="glyph"]');
    expect(glyphs.length).toBeGreaterThanOrEqual(28);
    expect(glyphs[0]?.getAttribute("data-size")).toBe("14");
    // every other day names its phase too (the fake engine says "full" for each)
    const other = document.querySelector(".cal-day:not([data-iso='" + iso(new Date()) + "'])");
    expect(other?.getAttribute("aria-label")).toMatch(/, Full moon$/);
    for (const day of document.querySelectorAll(".cal-day")) {
      expect(day.getAttribute("aria-label")).toMatch(/, Full moon$/);
    }
  });

  it("keeps the plain name of every day when the module is off", async () => {
    renderAt("/calendar", { modules: withoutMoon });
    await waitFor(() => expect(document.querySelector(".cal-day")).not.toBeNull());
    for (const day of document.querySelectorAll(".cal-day")) {
      expect(day.getAttribute("aria-label")).not.toMatch(/moon/i);
    }
  });

  it("puts the phase, the lit share and a link to /moon in the day panel", async () => {
    renderAt("/calendar");
    await waitFor(() => expect(document.querySelector(".cal-moon-panel")).not.toBeNull());
    const panel = document.querySelector(".cal-side") as HTMLElement;
    expect(within(panel).getByText(/Full moon · 100% lit/)).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "Open the Moon page" })).toHaveAttribute(
      "href",
      "/moon",
    );
  });

  it("draws nothing and never asks for the engine when the module is off", async () => {
    renderAt("/calendar", { modules: withoutMoon });
    await waitFor(() => expect(document.querySelector(".cal-day")).not.toBeNull());
    expect(document.querySelector('[data-testid="glyph"]')).toBeNull();
    expect(document.querySelector(".cal-moon")).toBeNull();
    expect(useMoonEngine).not.toHaveBeenCalled();
  });

  it("draws nothing while the engine has not loaded", async () => {
    vi.mocked(useMoonEngine).mockReturnValue(null);
    renderAt("/calendar");
    await waitFor(() => expect(document.querySelector(".cal-day")).not.toBeNull());
    expect(document.querySelector(".cal-moon")).toBeNull();
    expect(document.querySelector(".cal-moon-panel")).toBeNull();
  });

  it("mirrors the glyph for a southern time zone, and the setting wins over the zone", async () => {
    const first = renderAt("/calendar", { user: { timezone: "Australia/Sydney" } });
    await waitFor(() =>
      expect(document.querySelector('.cal-day [data-testid="glyph"]')).toHaveAttribute(
        "data-hemisphere",
        "south",
      ),
    );
    first.unmount();
    renderAt("/calendar", {
      user: { timezone: "Australia/Sydney" },
      prefs: { moon_hemisphere: "north" },
    });
    await waitFor(() =>
      expect(document.querySelector('.cal-day [data-testid="glyph"]')).toHaveAttribute(
        "data-hemisphere",
        "north",
      ),
    );
  });
});

describe("dashboard title line", () => {
  it("links today's phase, with the glyph, to /moon", async () => {
    renderAt("/");
    const link = await screen.findByRole("link", { name: /Full moon · 100% lit/ });
    expect(link).toHaveAttribute("href", "/moon");
    expect(within(link).getByTestId("glyph")).toHaveAttribute("data-phase", "full");
  });

  it("sits on its own line below the title row, not inside it", async () => {
    renderAt("/");
    const link = await screen.findByRole("link", { name: /Full moon · 100% lit/ });
    const title = document.querySelector(".dash-title") as HTMLElement;
    expect(title).not.toBeNull();
    expect(title.contains(link)).toBe(false);
    expect(link.parentElement).toBe(title.parentElement);
  });

  it("is absent with the module off", async () => {
    renderAt("/", { modules: withoutMoon });
    await screen.findAllByRole("heading", { level: 1 });
    expect(screen.queryByRole("link", { name: /moon/i })).not.toBeInTheDocument();
    expect(useMoonEngine).not.toHaveBeenCalled();
  });

  it("is absent until the engine has loaded", async () => {
    vi.mocked(useMoonEngine).mockReturnValue(null);
    renderAt("/");
    await screen.findAllByRole("heading", { level: 1 });
    expect(screen.queryByRole("link", { name: /moon/i })).not.toBeInTheDocument();
  });
});

describe("Settings → Moon", () => {
  it("sends the hemisphere, and null for Auto", async () => {
    const user = userEvent.setup();
    renderAt("/settings");
    const south = await screen.findByRole("radio", { name: "Southern" });
    expect(screen.getByRole("radio", { name: "From my time zone" })).toBeChecked();
    await user.click(south);
    await waitFor(() => expect(patches()).toContainEqual({ moon_hemisphere: "south" }));
    await waitFor(() => expect(south).toBeChecked());
    await user.click(screen.getByRole("radio", { name: "From my time zone" }));
    await waitFor(() => expect(patches()).toContainEqual({ moon_hemisphere: null }));
    await user.click(screen.getByRole("radio", { name: "Northern" }));
    await waitFor(() => expect(patches()).toContainEqual({ moon_hemisphere: "north" }));
  });

  it("is not shown with the module off", async () => {
    renderAt("/settings", { modules: withoutMoon });
    await screen.findByText("Sections you use");
    expect(screen.queryByRole("radio", { name: "Southern" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Set it on the Moon page" })).not.toBeInTheDocument();
  });

  it("shows no place and links to the Moon page to set one", async () => {
    renderAt("/settings");
    expect(
      await screen.findByText("No place set: moonrise and moonset are not shown."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set it on the Moon page" })).toHaveAttribute(
      "href",
      "/moon",
    );
    expect(screen.queryByRole("button", { name: "Remove the place" })).not.toBeInTheDocument();
  });

  it("shows the rounded place and removes it", async () => {
    vi.mocked(usePlace).mockReturnValue([{ lat: 48.9, lon: 2.4, label: "Home" }, setPlace]);
    const user = userEvent.setup();
    renderAt("/settings");
    expect(await screen.findByText("Place: Home · 48.9, 2.4")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove the place" }));
    expect(clearPlace).toHaveBeenCalledWith("u1");
    expect(setPlace).toHaveBeenCalledWith(null);
  });
});

describe("Settings → Notifications", () => {
  it("offers the moon kind, off by default, and turns it on", async () => {
    const user = userEvent.setup();
    renderAt("/settings");
    const box = await screen.findByRole("checkbox", { name: "New and full moon" });
    expect(box).not.toBeChecked();
    await user.click(box);
    await waitFor(() =>
      expect(patches()).toContainEqual({
        notifications: { ...DEFAULT_PREFERENCES.notifications, moon: true },
      }),
    );
  });

  it("does not offer it with the module off", async () => {
    renderAt("/settings", { modules: withoutMoon });
    await screen.findByText("What to mention");
    expect(screen.queryByRole("checkbox", { name: /New and full moon/ })).not.toBeInTheDocument();
  });
});
