import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import type { ModuleId, NavItem, Preferences } from "../api/types";
import { AuthProvider } from "../auth/AuthContext";
import { ToastProvider } from "../components/Toast";
import { TutorialProvider, useTutorial } from "../components/Tutorial/useTutorial";
import { LanguageProvider } from "../i18n";
import { ThemeProvider } from "../theme";
import { DEFAULT_PREFERENCES, MODULES, NAV_ITEMS } from "./preferences";

/**
 * Turning a module off (Epic 33, story 33.3): its tab, its pages, and everything that
 * points at it elsewhere go, and so do the requests they would have made.
 */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ALL_ON = DEFAULT_PREFERENCES.modules;
const off = (...ids: ModuleId[]): Record<ModuleId, boolean> =>
  Object.fromEntries(MODULES.map((id) => [id, !ids.includes(id)])) as Record<ModuleId, boolean>;

function withModules(modules: Record<ModuleId, boolean>): Preferences {
  return { ...DEFAULT_PREFERENCES, modules };
}

let requests: { url: string; method: string; body: unknown }[];

function renderAt(
  path: string,
  modules: Record<ModuleId, boolean>,
  patch: (body: unknown) => Response = () => json({}),
  prefs: Preferences = withModules(modules),
) {
  window.localStorage.setItem("everything-everywhere.token", "test-token");
  requests = [];
  const user = {
    id: "u1",
    email: "sam@example.com",
    currency: "USD",
    weight_unit: "kg",
    budget_start_day: 1,
    created_at: "",
    preferences: prefs,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      requests.push({ url, method, body });
      if (url.includes("/api/auth/me/preferences")) return patch(body);
      if (url.includes("/api/auth/me/recovery-codes")) return json({ unused: 0, total: 0 });
      if (url.includes("/api/auth/me")) return json(user);
      if (url.includes("/api/books/quotes/draw")) return json(null);
      if (url.includes("/api/dashboard") || url.includes("/api/summary")) return json(null);
      if (url.includes("/api/savings/overview")) return json({ pots: [] });
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

const asked = (fragment: string) => requests.some((r) => r.url.includes(fragment));
const bottomBar = () => screen.getByRole("navigation", { name: "Sections" });
// Epic 52: the sidebar lists every visible place, whatever the bar holds.
const sidebar = () => screen.getByRole("navigation", { name: "All places" });
const tabs = () =>
  within(bottomBar())
    .getAllByRole("link")
    .map((link) => link.textContent?.replace(/^\W+/u, "").trim());

describe("a module that is off", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it("is in neither the bar nor the sidebar, and the rest are", async () => {
    const pinned = DEFAULT_PREFERENCES.desktop.items?.map((i) => ({
      ...i,
      pinned: ["dashboard", "entries", "stock", "gym"].includes(i.id),
    }));
    renderAt("/entries", off("gym", "recipes", "stock"), undefined, {
      ...withModules(off("gym", "recipes", "stock")),
      desktop: { ...DEFAULT_PREFERENCES.desktop, items: pinned },
    });
    await waitFor(() => expect(bottomBar()).toBeInTheDocument());
    // Stock and Gym are pinned, and off: the bar has what is left.
    expect(tabs()).toEqual(["Dashboard", "Entries"]);
    for (const name of ["Stock", "Gym", "Recipes"]) {
      expect(within(sidebar()).queryByRole("link", { name })).toBeNull();
    }
    // Plan carries a live hint ("N days left") in its name.
    expect(within(sidebar()).getByRole("link", { name: /^Plan/ })).toBeInTheDocument();
    expect(within(sidebar()).getByRole("link", { name: "Books" })).toBeInTheDocument();
  });

  it("answers its routes with a page that says so, not a redirect", async () => {
    renderAt("/gym", off("gym"));
    expect(await screen.findByRole("heading", { name: "Gym is turned off" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Settings" })).toHaveAttribute(
      "href",
      "/settings#layout",
    );
    expect(asked("/api/gym")).toBe(false);
  });

  it("closes the notes routes too, deep links included", async () => {
    renderAt("/notes/abc", off("notes"));
    expect(await screen.findByRole("heading", { name: "Notes is turned off" })).toBeInTheDocument();
    expect(asked("/api/notes")).toBe(false);
  });

  it("takes Habits out and leaves Books where it was: they are separate places", async () => {
    renderAt("/books", off("habits"));
    await waitFor(() => expect(bottomBar()).toBeInTheDocument());
    expect(within(bottomBar()).queryByRole("link", { name: /Habits/ })).toBeNull();
    expect(within(sidebar()).queryByRole("link", { name: "Habits" })).toBeNull();
    expect(within(sidebar()).getByRole("link", { name: "Books" })).toHaveAttribute("href", "/books");
    // One view left is no choice, so there is no switch on the page.
    await waitFor(() => expect(asked("/api/books")).toBe(true));
    expect(screen.queryByRole("group", { name: "Habits view" })).toBeNull();
  });

  it("vanishes from the Dashboard and is not asked for", async () => {
    renderAt("/", off("books", "stock", "mood", "notes"));
    await waitFor(() => expect(asked("/api/recurring/pending")).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(asked("/api/books")).toBe(false);
    expect(asked("/api/inventory")).toBe(false);
    expect(asked("/api/mood")).toBe(false);
    expect(screen.queryByRole("link", { name: /Notes/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Write a note" })).toBeNull();
    expect(screen.queryByRole("button", { name: /mood/i })).toBeNull();
  });

  it("is still asked for on the Dashboard when it is on", async () => {
    // The guard for the test above: the same page, everything on, does ask.
    renderAt("/", ALL_ON);
    await waitFor(() => expect(asked("/api/books")).toBe(true));
    expect(asked("/api/inventory")).toBe(true);
    expect(within(screen.getByRole("main")).getByRole("link", { name: /Notes/ })).toBeInTheDocument();
  });

  it("loses its calendar layer: no menu entry, no request", async () => {
    renderAt("/calendar", off("gym", "recipes", "mood", "stock", "habits"));
    // Money, savings and what is due are the budget's own and stay.
    await userEvent.click(await screen.findByRole("button", { name: "Layers (3/3)" }));
    await waitFor(() => expect(asked("/api/entries")).toBe(true));
    const names = screen.getAllByRole("checkbox").map((box) => box.closest("label")?.textContent);
    expect(names).toEqual(["Money", "Savings", "Due"]);
    for (const path of ["/api/gym", "/api/inventory", "/api/habits", "/api/mood", "/api/meals"]) {
      expect(asked(path)).toBe(false);
    }
  });

  it("drops the mood card from the Habits page", async () => {
    renderAt("/habits", off("mood"));
    await waitFor(() => expect(asked("/api/habits")).toBe(true));
    expect(screen.queryByRole("heading", { name: "Mood" })).toBeNull();
    expect(asked("/api/mood")).toBe(false);
  });
});

describe("Settings → Layout", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it("switches a module off at once and saves the whole set", async () => {
    renderAt("/settings", ALL_ON, (body) =>
      json({ id: "u1", email: "sam@example.com", currency: "USD", created_at: "",
        preferences: { ...DEFAULT_PREFERENCES, ...(body as object) } }),
    );
    // Settings is heavy (Clocks adds hundreds of options): 1s is not enough under a full run.
    const gym = await screen.findByRole("checkbox", { name: "Gym" }, { timeout: 5000 });
    expect(gym).toBeChecked();
    expect(within(sidebar()).getByRole("link", { name: "Gym" })).toBeInTheDocument();

    await userEvent.click(gym);
    expect(within(sidebar()).queryByRole("link", { name: "Gym" })).toBeNull();
    await waitFor(() =>
      expect(requests.find((r) => r.method === "PATCH")?.body).toEqual({ modules: off("gym") }),
    );
    expect(screen.getByRole("checkbox", { name: "Gym" })).not.toBeChecked();
  });

  it("undoes a switch the server refused, and says so", async () => {
    renderAt("/settings", ALL_ON, () => json({ detail: "boom", code: "error" }, 500));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Books" }));
    expect(await screen.findByText("Could not save, so the change was undone.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Books" })).toBeChecked();
  });
});

/**
 * Every caller of a module's API, outside `api/client.ts`, is either one of that module's
 * own pages or a place listed in `layout/modules.ts` and gated there. A new caller makes
 * this red until it is gated and added to the table below and to the one in modules.ts.
 */
describe("the module table is complete", () => {
  const sources = import.meta.glob<string>(["../**/*.{ts,tsx}", "!../**/*.test.*"], {
    query: "?raw",
    import: "default",
    eager: true,
  });
  const client = sources["../api/client.ts"] ?? "";
  const SEGMENT: Record<string, Exclude<ModuleId, "moon" | "clocks">> = {
    habits: "habits",
    books: "books",
    mood: "mood",
    inventory: "stock",
    gym: "gym",
    recipes: "recipes",
    foods: "recipes",
    meals: "recipes",
    notes: "notes",
  };
  // The moon (Epic 47) has no endpoints at all: it is computed on the device (AD-63), so it
  // has no API callers to list and is left out of this table.
  const API_MODULES = MODULES.filter((id): id is Exclude<ModuleId, "moon" | "clocks"> => id !== "moon" && id !== "clocks");
  const CALLERS: Record<Exclude<ModuleId, "moon" | "clocks">, string[]> = {
    // pages/MoonPage.tsx (Epic 47) reads habits, mood and gym days for its overlay, each only
    // for a module that is on.
    habits: ["pages/CalendarPage.tsx", "pages/HabitsPage.tsx", "pages/MoonPage.tsx"],
    books: [
      "components/BookQuotes.tsx",
      "components/QuoteCard.tsx",
      "pages/BooksPage.tsx",
      "pages/DashboardPage.tsx",
    ],
    mood: [
      "components/MoodCheckin.tsx",
      "pages/CalendarPage.tsx",
      "pages/HabitsPage.tsx",
      "pages/MoonPage.tsx",
    ],
    stock: [
      // Settings' muted list unmutes a stock item even with Stock off (Epic 36): a mute
      // that could not be undone while the module is off would be a notification lost.
      "components/NotificationsCard.tsx",
      "components/ShoppingList.tsx",
      "pages/CalendarPage.tsx",
      "pages/DashboardPage.tsx",
      "pages/InventoryPage.tsx",
    ],
    // store.ts sends sessions finished offline, whatever the switch says: syncing is not UI.
    gym: [
      "gym/store.ts",
      "pages/CalendarPage.tsx",
      "pages/MoonPage.tsx",
      "pages/gym/GymBuild.tsx",
      "pages/gym/GymHistory.tsx",
      "pages/gym/GymImport.tsx",
      "pages/gym/RoutineEditor.tsx",
    ],
    recipes: ["pages/CalendarPage.tsx", "pages/RecipePage.tsx", "pages/RecipesPage.tsx"],
    // drafts.ts sends notes already written, whatever the switch says: syncing is not UI.
    notes: ["notes/drafts.ts", "pages/NotePage.tsx", "pages/NotesPage.tsx"],
  };

  const functions: Record<Exclude<ModuleId, "moon" | "clocks">, string[]> = {
    habits: [], books: [], mood: [], stock: [], gym: [], recipes: [], notes: [],
  };
  for (const match of client.matchAll(/\n {2}(\w+): (?:async )?\([^)]*\)[^=]*=>[\s\S]*?["`]\/api\/([\w-]+)/g)) {
    const module = SEGMENT[match[2] ?? ""];
    if (module && match[1]) functions[module].push(match[1]);
  }

  it("found each module's functions in the client", () => {
    for (const id of API_MODULES) expect(functions[id].length).toBeGreaterThan(0);
  });

  for (const id of API_MODULES) {
    it(`lists every caller of ${id}`, () => {
      const pattern = new RegExp(`api\\.(${functions[id].join("|")})\\b`);
      const found = Object.entries(sources)
        .filter(([path, text]) => path !== "../api/client.ts" && pattern.test(text))
        .map(([path]) => path.replace(/^\.\.\//, ""))
        .sort();
      expect(found).toEqual(CALLERS[id]);
    });
  }
});

describe("Settings → Layout → places (Epic 52, AD-65)", () => {
  const echo = (body: unknown) =>
    json({
      id: "u1",
      email: "sam@example.com",
      currency: "USD",
      created_at: "",
      preferences: { ...DEFAULT_PREFERENCES, ...(body as object) },
    });
  const firstPatch = () =>
    requests.find((r) => r.method === "PATCH")?.body as Record<string, { items: NavItem[] }>;
  const lastPatch = () =>
    requests.filter((r) => r.method === "PATCH").at(-1)?.body as Record<string, { items: NavItem[] }>;
  const pinnedIn = (items: NavItem[]) => items.filter((i) => i.pinned).map((i) => i.id);

  const barList = () => screen.findByRole("list", { name: /^In the bar/ }, { timeout: 5000 });
  const group = (name: string) => screen.getByRole("list", { name });
  const names = (list: HTMLElement) =>
    within(list)
      .getAllByRole("listitem")
      .map((item) => item.textContent?.replace(/[↑↓⤒⤓]/gu, "").trim());

  /** A phone whose bar and order are the account's own. */
  function prefsWith(phoneItems: NavItem[]): Preferences {
    return { ...DEFAULT_PREFERENCES, phone: { ...DEFAULT_PREFERENCES.phone, items: phoneItems } };
  }

  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("opens on the layout this screen uses", async () => {
    renderAt("/settings", ALL_ON, echo);
    expect(await screen.findByRole("button", { name: "Phone" }, { timeout: 5000 })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Computer" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("shows the bar, then every other place by group", async () => {
    renderAt("/settings", ALL_ON, echo);
    expect(names(await barList())).toEqual(["Dashboard", "Entries", "Habits", "Plan"]);
    expect(screen.getByRole("heading", { name: "In the bar (4 of 4)" })).toBeInTheDocument();
    expect(names(group("Daily"))).toEqual(["Calendar", "Books", "Notes"]);
    expect(names(group("Money"))).toEqual(["Grow"]);
    expect(names(group("Home & body"))).toEqual(["Stock", "Recipes", "Gym"]);
    expect(names(group("Tools"))).toEqual(["Clocks", "Moon"]);
  });

  it("refuses a fifth pin, and says why where the person can read it", async () => {
    renderAt("/settings", ALL_ON, echo);
    await barList();
    const pin = screen.getByRole("button", { name: "Pin Gym to the bar" });
    expect(pin).toBeDisabled();
    const reason = screen.getByText("The bar is full (4 places). Unpin one to pin another.");
    expect(reason).toBeVisible();
    expect(pin).toHaveAttribute("aria-describedby", reason.id);
  });

  it("unpins a place at once, the bar follows, and the whole list is saved", async () => {
    renderAt("/settings", ALL_ON, echo);
    await barList();
    await userEvent.click(screen.getByRole("button", { name: "Unpin Plan from the bar" }));

    expect(tabs()).toEqual(["Dashboard", "Entries", "Habits"]);
    expect(names(screen.getByRole("list", { name: /^In the bar/ }))).toEqual([
      "Dashboard",
      "Entries",
      "Habits",
    ]);
    expect(screen.queryByText(/The bar is full/)).toBeNull();
    await waitFor(() => expect(firstPatch()).toBeDefined());
    expect(Object.keys(firstPatch())).toEqual(["phone"]);
    const items = firstPatch().phone?.items ?? [];
    expect(items.map((i) => i.id).sort()).toEqual([...NAV_ITEMS].sort());
    expect(pinnedIn(items)).toEqual(["dashboard", "entries", "habits"]);
  });

  it("pins a place into the free slot, last in the bar", async () => {
    renderAt("/settings", ALL_ON, echo);
    await barList();
    await userEvent.click(screen.getByRole("button", { name: "Unpin Entries from the bar" }));
    await userEvent.click(screen.getByRole("button", { name: "Pin Gym to the bar" }));

    expect(tabs()).toEqual(["Dashboard", "Habits", "Plan", "Gym"]);
    await waitFor(() => expect(lastPatch()?.phone?.items.some((i) => i.id === "gym" && i.pinned)).toBe(true));
    expect(pinnedIn(lastPatch().phone?.items ?? [])).toEqual(["dashboard", "habits", "plan", "gym"]);
    // Entries is back in the group it came from, and the full-bar reason is back.
    expect(names(group("Money"))).toEqual(["Entries", "Grow"]);
    expect(screen.getByText(/The bar is full/)).toBeInTheDocument();
  });

  it("reorders the bar with up and down, and cannot move past either end", async () => {
    renderAt("/settings", ALL_ON, echo);
    const bar = await barList();
    expect(within(bar).getByRole("button", { name: "Move Dashboard up" })).toBeDisabled();
    expect(within(bar).getByRole("button", { name: "Move Plan down" })).toBeDisabled();
    await userEvent.click(within(bar).getByRole("button", { name: "Move Habits up" }));
    expect(tabs()).toEqual(["Dashboard", "Habits", "Entries", "Plan"]);
  });

  it("reorders inside a group only, and cannot move past either end", async () => {
    renderAt("/settings", ALL_ON, echo);
    await barList();
    const daily = group("Daily");
    expect(within(daily).getByRole("button", { name: "Move Calendar up" })).toBeDisabled();
    expect(within(daily).getByRole("button", { name: "Move Notes down" })).toBeDisabled();
    await userEvent.click(within(daily).getByRole("button", { name: "Move Books up" }));
    expect(names(group("Daily"))).toEqual(["Books", "Calendar", "Notes"]);
    // Grow is alone in Money while Entries and Plan are in the bar.
    const money = group("Money");
    expect(within(money).getByRole("button", { name: "Move Grow up" })).toBeDisabled();
    expect(within(money).getByRole("button", { name: "Move Grow down" })).toBeDisabled();
    await waitFor(() => expect(firstPatch()).toBeDefined());
    expect(pinnedIn(firstPatch().phone?.items ?? [])).toEqual(["dashboard", "entries", "habits", "plan"]);
  });

  it("edits the computer layout from a phone: groups only, no bar, no pins", async () => {
    renderAt("/settings", ALL_ON, echo);
    await userEvent.click(await screen.findByRole("button", { name: "Computer" }, { timeout: 5000 }));
    expect(screen.queryByRole("heading", { name: /^In the bar/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Pin / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Unpin / })).toBeNull();
    // Every place is in a group on a desktop, pinned or not.
    // A desktop's default order is the sidebar's: group order, not bar first.
    expect(names(group("Daily"))).toEqual(["Dashboard", "Calendar", "Habits", "Books", "Notes"]);
    expect(names(group("Money"))).toEqual(["Entries", "Plan", "Grow"]);
  });

  it("reorders a desktop group across what a phone would call pinned, and keeps the pins", async () => {
    renderAt("/settings", ALL_ON, echo);
    await userEvent.click(await screen.findByRole("button", { name: "Computer" }, { timeout: 5000 }));
    // Habits is pinned, Books is not: on a desktop that makes no difference to the order.
    await userEvent.click(
      within(group("Daily")).getByRole("button", { name: "Move Habits down" }),
    );
    expect(names(group("Daily"))).toEqual(["Dashboard", "Calendar", "Books", "Habits", "Notes"]);

    await waitFor(() => expect(firstPatch()).toBeDefined());
    expect(Object.keys(firstPatch())).toEqual(["desktop"]);
    const items = firstPatch().desktop?.items ?? [];
    expect(pinnedIn(items).sort()).toEqual(["dashboard", "entries", "habits", "plan"]);
    expect(items.map((i) => i.id).indexOf("books")).toBeLessThan(
      items.map((i) => i.id).indexOf("habits"),
    );
    // The phone's bar is untouched.
    expect(tabs()).toEqual(["Dashboard", "Entries", "Habits", "Plan"]);
  });

  it("marks a place whose module is off, and still lets it be pinned and unpinned", async () => {
    const pinGym = prefsWith([
      { id: "gym", pinned: true },
      ...(DEFAULT_PREFERENCES.phone.items ?? [])
        .filter((i) => i.id !== "gym")
        .map((i) => ({ ...i, pinned: i.id === "dashboard" || i.id === "entries" })),
    ]);
    renderAt("/settings", off("gym", "moon"), echo, { ...pinGym, modules: off("gym", "moon") });
    const bar = await barList();
    // Off, so it takes no slot, but it is still listed and can be freed.
    expect(within(bar).getByText("(off)")).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Unpin Gym from the bar" })).toBeEnabled();
    expect(within(group("Tools")).getByText("(off)")).toBeInTheDocument();
    expect(within(group("Tools")).getByRole("button", { name: "Pin Moon to the bar" })).toBeEnabled();
    // The live bar does not show it.
    expect(tabs()).toEqual(["Dashboard", "Entries"]);
  });

  it("resets a layout only after asking", async () => {
    const custom = prefsWith([
      { id: "moon", pinned: true },
      { id: "gym", pinned: true },
      ...(DEFAULT_PREFERENCES.phone.items ?? [])
        .filter((i) => i.id !== "moon" && i.id !== "gym")
        .map((i) => ({ ...i, pinned: false })),
    ]);
    renderAt("/settings", ALL_ON, echo, custom);
    await waitFor(() => expect(tabs()).toEqual(["Moon", "Gym"]));
    await userEvent.click(screen.getByRole("button", { name: "Reset this layout" }));
    expect(
      screen.getByText("Put the phone places and cards back as they were?"),
    ).toBeInTheDocument();
    expect(firstPatch()).toBeUndefined();
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(tabs()).toEqual(["Dashboard", "Entries", "Habits", "Plan"]);
    await waitFor(() => expect(firstPatch()).toBeDefined());
    expect(pinnedIn(firstPatch().phone?.items ?? [])).toEqual(["dashboard", "entries", "habits", "plan"]);
    // The new client never writes `tabs`: a reset sends the items and the cards.
    expect(Object.keys(firstPatch().phone ?? {}).sort()).toEqual(["cards", "items"]);
  });

  it("saves only items and cards for a layout, never tabs", async () => {
    renderAt("/settings", ALL_ON, echo);
    await barList();
    await userEvent.click(screen.getByRole("button", { name: "Unpin Plan from the bar" }));
    await waitFor(() => expect(firstPatch()).toBeDefined());
    expect(Object.keys(firstPatch().phone ?? {}).sort()).toEqual(["cards", "items"]);
  });

  it("does not count a pinned place whose module is off against the bar", async () => {
    // Four pinned, one of them (gym) off: three are in the bar, so a fourth can be pinned.
    const gymPinned = prefsWith([
      { id: "dashboard", pinned: true },
      { id: "entries", pinned: true },
      { id: "gym", pinned: true },
      { id: "plan", pinned: true },
      ...(DEFAULT_PREFERENCES.phone.items ?? [])
        .filter((i) => !["dashboard", "entries", "gym", "plan"].includes(i.id))
        .map((i) => ({ ...i, pinned: false })),
    ]);
    renderAt("/settings", off("gym"), echo, { ...gymPinned, modules: off("gym") });
    await barList();
    expect(screen.getByRole("heading", { name: "In the bar (3 of 4)" })).toBeInTheDocument();
    expect(screen.queryByText(/The bar is full/)).toBeNull();
    const pin = screen.getByRole("button", { name: "Pin Notes to the bar" });
    expect(pin).toBeEnabled();
    await userEvent.click(pin);
    await waitFor(() => expect(firstPatch()).toBeDefined());
    expect(pinnedIn(firstPatch().phone?.items ?? [])).toEqual([
      "dashboard", "entries", "gym", "plan", "notes",
    ]);
  });

  it("scrolls the card into view for /settings#layout", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    try {
      renderAt("/settings#layout", ALL_ON, echo);
      await barList();
      await waitFor(() => expect(scroll).toHaveBeenCalled());
      expect(scroll.mock.instances[0]).toBe(document.getElementById("layout"));
    } finally {
      // @ts-expect-error jsdom has no scrollIntoView; put back what it had.
      delete Element.prototype.scrollIntoView;
    }
  });
});

describe("Settings → Layout → dashboard cards (story 33.5)", () => {
  const echo = (body: unknown) =>
    json({
      id: "u1",
      email: "sam@example.com",
      currency: "USD",
      created_at: "",
      preferences: { ...DEFAULT_PREFERENCES, ...(body as object) },
    });
  const firstPatch = () =>
    requests.find((r) => r.method === "PATCH")?.body as Record<string, { cards: unknown }>;

  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it("hides a card for this layout only", async () => {
    renderAt("/settings", ALL_ON, echo);
    const savings = await screen.findByRole("checkbox", { name: "Show Savings progress" });
    expect(savings).toBeChecked();
    await userEvent.click(savings);
    expect(screen.getByRole("checkbox", { name: "Show Savings progress" })).not.toBeChecked();
    await waitFor(() => expect(firstPatch()).toBeDefined());
    // jsdom has no matchMedia, so this screen is a desktop: only its layout is sent.
    expect(Object.keys(firstPatch())).toEqual(["desktop"]);
    expect(firstPatch().desktop?.cards).toContainEqual({ id: "savings", on: false });
  });

  it("moves a card, and not past either end", async () => {
    renderAt("/settings", ALL_ON, echo);
    expect(await screen.findByRole("button", { name: "Move Totals up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Expense by category down" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Move Budget vs actual up" }));
    await waitFor(() => expect(firstPatch()).toBeDefined());
    const ids = ((firstPatch().desktop?.cards ?? []) as { id: string }[]).map((c) => c.id);
    expect(ids.indexOf("budgets")).toBe(ids.indexOf("restock") - 1);
  });

  it("greys a card whose module is off, keeping its place", async () => {
    renderAt("/settings", off("books"), echo);
    const list = await screen.findByRole("list", { name: "Dashboard cards" });
    expect(within(list).getByText(/Reading now · La rubrique|Reading now · Books is turned off/))
      .toBeInTheDocument();
    expect(within(list).queryByRole("checkbox", { name: "Show Reading now" })).toBeNull();
    expect(within(list).getByRole("button", { name: "Move Reading now up" })).toBeEnabled();
  });
});

describe("the tour and a hidden budget card (story 33.5)", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  function Count() {
    const { numbered } = useTutorial();
    return <p>steps {numbered.join(",")}</p>;
  }

  async function stepsFor(budgetsOn: boolean) {
    const cards = DEFAULT_PREFERENCES.desktop.cards.map((c) =>
      c.id === "budgets" ? { ...c, on: budgetsOn } : c,
    );
    window.localStorage.setItem("everything-everywhere.token", "test-token");
    vi.stubGlobal("fetch", vi.fn(async () =>
      json({ id: "u1", email: "sam@example.com", currency: "USD", created_at: "",
        tutorial_completed: true,
        preferences: { ...DEFAULT_PREFERENCES, desktop: { ...DEFAULT_PREFERENCES.desktop, cards } } }),
    ));
    render(
      <AuthProvider>
        <MemoryRouter>
          <TutorialProvider>
            <Count />
          </TutorialProvider>
        </MemoryRouter>
      </AuthProvider>,
    );
    return (await screen.findByText(/^steps .*history/)).textContent;
  }

  it("counts the progress step only while the budget card is shown", async () => {
    expect(await stepsFor(true)).toBe("steps welcome,entry,history,budget,progress");
  });

  it("skips it, and counts it out, when the card is hidden", async () => {
    await waitFor(async () => undefined);
    expect(await stepsFor(false)).toBe("steps welcome,entry,history,budget");
  });
});
