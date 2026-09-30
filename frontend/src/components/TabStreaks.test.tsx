import { render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CheckInButton } from "./CheckInButton";
import { StreakCard } from "./StreakCard";
import { StreaksSettingsCard } from "./StreaksSettingsCard";
import type { Preferences, Streak, StreakModuleId } from "../api/types";
import { AuthProvider } from "../auth/AuthContext";
import { LanguageProvider } from "../i18n";
import { DEFAULT_PREFERENCES, shownStreaks } from "../layout/preferences";
import { usePreferences } from "../layout/useLayout";

/**
 * Story 41.2: tab streaks on the client.
 *
 * What is held: every tab streak is off by default; switching one on shows its row on the
 * card and its Check in button; switching its module off hides both; a module already off at
 * load hides the row even though the preference is on; nothing is ever asked of the server
 * for a hidden streak; and the switch sends the whole `streaks` subtree.
 */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const day = Array.from({ length: 28 }, (_, i) => ({
  day: `2031-03-${String(i + 1).padStart(2, "0")}`,
  state: i === 27 ? ("pending" as const) : ("active" as const),
}));

function streak(id: string, current: number, today_active = false): Streak {
  return { id, current, best: current + 1, today_active, recent: day };
}

/** The server side: preferences live here, a PATCH merges top-level keys like the real one. */
function mockApi(
  overrides: {
    streaks?: Partial<Record<StreakModuleId, boolean>>;
    gymModule?: boolean;
    language?: string;
  } = {},
) {
  window.localStorage.setItem("everything-everywhere.token", "test-token");
  let prefs: Preferences = {
    ...DEFAULT_PREFERENCES,
    modules: { ...DEFAULT_PREFERENCES.modules, gym: overrides.gymModule ?? true },
    streaks: { ...DEFAULT_PREFERENCES.streaks, ...overrides.streaks },
  };
  const checkedIn = new Set<string>();
  const calls: { url: string; method: string; body: string | null }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: (init?.body as string) ?? null });
      if (url.endsWith("/api/auth/me/preferences") && method === "PATCH") {
        prefs = { ...prefs, ...JSON.parse(String(init?.body)) };
      }
      if (url.includes("/api/auth/me")) {
        return json({
          id: "u1",
          email: "sam@example.com",
          currency: "USD",
          created_at: "",
          language: overrides.language ?? "en",
          preferences: prefs,
        });
      }
      if (url.endsWith("/api/streaks/check-in")) {
        const id = JSON.parse(String(init?.body)).streak;
        checkedIn.add(id);
        return json(streak(id, 4, true));
      }
      if (url.endsWith("/api/streaks")) {
        return json({
          today: "2031-03-28",
          streaks: [
            streak("overall", 12),
            streak("entries", 2, checkedIn.has("entries")),
            streak("gym", 3, checkedIn.has("gym")),
            streak("notes", 5, true),
          ],
        });
      }
      return json({ items: [] });
    }),
  );
  return calls;
}

/** Stands in for the Layout card's module switch. */
function GymModuleSwitch() {
  const { preferences, update } = usePreferences();
  return (
    <button
      type="button"
      onClick={() => void update({ modules: { ...preferences.modules, gym: false } })}
    >
      gym module off
    </button>
  );
}

function render() {
  return rtlRender(
    <MemoryRouter>
      <AuthProvider>
        <LanguageProvider>
          <GymModuleSwitch />
          <StreaksSettingsCard />
          <StreakCard collapseKey="test.streaks" />
          <CheckInButton streak="gym" />
          <CheckInButton streak="entries" bar />
        </LanguageProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

const rows = () => screen.queryByRole("list", { name: "Streaks by tab" });
const gymButton = () => document.querySelector('button[data-streak="gym"]');
const switchFor = (name: string) => screen.findByRole("checkbox", { name: `Show the ${name} streak` });
const streakRequests = (calls: { url: string }[]) => calls.filter((c) => c.url.endsWith("/api/streaks"));

describe("shownStreaks", () => {
  it("is empty by default: every tab streak is opt-in", () => {
    expect(shownStreaks(DEFAULT_PREFERENCES)).toEqual([]);
  });

  it("needs the preference and, where the tab has one, its module", () => {
    const on = {
      ...DEFAULT_PREFERENCES,
      streaks: { ...DEFAULT_PREFERENCES.streaks, gym: true, entries: true, notes: true },
    };
    expect(shownStreaks(on)).toEqual(["entries", "gym", "notes"]);
    const gymOff = { ...on, modules: { ...on.modules, gym: false } };
    expect(shownStreaks(gymOff)).toEqual(["entries", "notes"]);
    // A core section has no module to switch off.
    expect(shownStreaks({ ...on, modules: { ...on.modules, notes: false } })).toEqual([
      "entries",
      "gym",
    ]);
  });
});

describe("tab streaks on the client", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("are off by default: no row, no button, and no request for one", async () => {
    const calls = mockApi();
    render();
    expect(await screen.findByText("12")).toBeInTheDocument(); // the card itself loaded
    expect(rows()).toBeNull();
    expect(gymButton()).toBeNull();
    expect(document.querySelector('button[data-streak="entries"]')).toBeNull();
    // Only the card asked: the two hidden buttons made no request of their own.
    expect(streakRequests(calls)).toHaveLength(1);
    // Every switch starts unchecked.
    for (const name of ["Entries", "Plan", "Grow", "Habits", "Mood", "Books", "Stock", "Gym", "Recipes", "Notes"]) {
      expect(await switchFor(name)).not.toBeChecked();
    }
  });

  it("switching one on shows its row and its button, and sends the whole subtree", async () => {
    const calls = mockApi();
    const user = userEvent.setup();
    render();
    await user.click(await switchFor("Gym"));

    const list = await screen.findByRole("list", { name: "Streaks by tab" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent("Gym");
    expect(items[0]).toHaveTextContent("3 days");
    expect(items[0]).toHaveTextContent("Best: 4");
    await waitFor(() => expect(gymButton()).toHaveTextContent("Check in"));

    const patch = calls.find((c) => c.method === "PATCH" && c.url.endsWith("/preferences"));
    const sent = JSON.parse(patch?.body ?? "{}");
    expect(Object.keys(sent)).toEqual(["streaks"]);
    expect(sent.streaks).toEqual({ ...DEFAULT_PREFERENCES.streaks, gym: true });
  });

  it("a row says when its tab is already active today", async () => {
    mockApi({ streaks: { notes: true } });
    render();
    const list = await screen.findByRole("list", { name: "Streaks by tab" });
    expect(within(list).getByText("active today")).toBeInTheDocument();
  });

  it("the button checks in once for its own tab and then reads as done", async () => {
    const calls = mockApi({ streaks: { gym: true } });
    const user = userEvent.setup();
    render();
    await waitFor(() => expect(gymButton()).not.toBeNull());
    await user.click(gymButton() as Element);

    await waitFor(() => expect(gymButton()).toHaveTextContent("Checked in ✓"));
    expect(gymButton()).toBeDisabled();
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toMatch(/\/api\/streaks\/check-in$/);
    // The server owns the day: the body names the streak and nothing else.
    expect(JSON.parse(posts[0]?.body ?? "{}")).toEqual({ streak: "gym" });
  });

  it("reads as done on mount when a write earlier today already made the day", async () => {
    mockApi({ streaks: { notes: true } });
    rtlRender(
      <MemoryRouter>
        <AuthProvider>
          <LanguageProvider>
            <CheckInButton streak="notes" />
          </LanguageProvider>
        </AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(document.querySelector('button[data-streak="notes"]')).toHaveTextContent("Checked in ✓"),
    );
  });

  it("a core tab has no module to hide it: Entries shows on its preference alone", async () => {
    mockApi({ streaks: { entries: true } });
    render();
    await waitFor(() =>
      expect(document.querySelector('button[data-streak="entries"]')).toHaveTextContent("Check in"),
    );
  });

  it("switching its module off hides the row and the button at once", async () => {
    const calls = mockApi({ streaks: { gym: true } });
    const user = userEvent.setup();
    render();
    expect(await screen.findByRole("list", { name: "Streaks by tab" })).toBeInTheDocument();
    await waitFor(() => expect(gymButton()).not.toBeNull());

    await user.click(screen.getByRole("button", { name: "gym module off" }));
    await waitFor(() => expect(rows()).toBeNull());
    expect(gymButton()).toBeNull();
    // Its switch goes from Settings too, and nothing was deleted or reset on the server.
    expect(screen.queryByRole("checkbox", { name: "Show the Gym streak" })).toBeNull();
    expect(calls.filter((c) => c.method === "POST" || c.method === "DELETE")).toHaveLength(0);
  });

  it("a module already off at load hides the row even with its preference on", async () => {
    const calls = mockApi({ streaks: { gym: true, entries: true }, gymModule: false });
    render();
    expect(await screen.findByText("12")).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: "Streaks by tab" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent("Entries");
    expect(gymButton()).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Show the Gym streak" })).toBeNull();
    // The hidden button never asked for its streak: the card and the Entries button did.
    expect(streakRequests(calls)).toHaveLength(2);
  });

  it("a failed save is undone and said in the card", async () => {
    mockApi();
    const user = userEvent.setup();
    render();
    const fetchMock = vi.mocked(globalThis.fetch);
    const real = fetchMock.getMockImplementation();
    fetchMock.mockImplementation(async (url, init) =>
      String(url).endsWith("/preferences")
        ? json({ detail: "x", code: "error" }, 500)
        : (real as typeof fetch)(url, init),
    );
    await user.click(await switchFor("Gym"));
    expect(await screen.findByText("Could not save that change.")).toBeInTheDocument();
    expect(await switchFor("Gym")).not.toBeChecked();
  });

  it("speaks French, short on a header", async () => {
    mockApi({ streaks: { gym: true }, language: "fr" });
    render();
    expect(await screen.findByRole("list", { name: "Séries par onglet" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Valider" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Afficher la série Sport" })).toBeChecked();
  });
});
