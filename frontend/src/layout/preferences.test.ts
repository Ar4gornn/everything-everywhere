import { describe, expect, it, vi } from "vitest";

import type { Layout, NavItem, NavItemId, Preferences, PreferencesPatch } from "../api/types";
import {
  DEFAULT_PREFERENCES,
  NAV_ITEMS,
  NAV_ITEMS_GROUPED,
  PHONE_PIN_CAP,
  PreferenceSaver,
  applyPatch,
  barCount,
  defaultItems,
  itemsOf,
  moveItem,
  pinItem,
  preferencesOf,
  unpinItem,
  type Versioned,
} from "./preferences";
import { ApiError } from "../api/client";

/** A send whose answers the test releases by hand, in whatever order it likes. */
function controlledSend() {
  const calls: {
    patch: PreferencesPatch;
    version: string | null;
    resolve: (p: Preferences, version?: string | null) => void;
    reject: (e: unknown) => void;
  }[] = [];
  const send = vi.fn(
    (patch: PreferencesPatch, version: string | null) =>
      new Promise<Versioned>((resolve, reject) => {
        calls.push({
          patch,
          version,
          resolve: (prefs, next = null) => resolve({ prefs, version: next }),
          reject,
        });
      }),
  );
  return { send, calls };
}

/** The i-th request, or a clear failure if it was never sent. */
function at<T>(list: T[], i: number): T {
  const found = list[i];
  if (found === undefined) throw new Error(`request ${i} was never sent`);
  return found;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const gymOff: PreferencesPatch = { modules: { ...DEFAULT_PREFERENCES.modules, gym: false } };
const gymAndBooksOff: PreferencesPatch = {
  modules: { ...DEFAULT_PREFERENCES.modules, gym: false, books: false },
};
const phoneStatsHidden: PreferencesPatch = {
  phone: {
    ...DEFAULT_PREFERENCES.phone,
    cards: DEFAULT_PREFERENCES.phone.cards.map((c) => (c.id === "stats" ? { ...c, on: false } : c)),
  },
};

describe("the defaults", () => {
  it("are the app as it was, and equal the server's resolve({})", () => {
    // Same literal as DEFAULT in backend/tests/test_preferences.py.
    const tabs = [
      { id: "dashboard", slot: "bar" },
      { id: "entries", slot: "bar" },
      { id: "habits", slot: "bar" },
      { id: "stock", slot: "bar" },
      { id: "gym", slot: "bar" },
      { id: "plan", slot: "top" },
      { id: "grow", slot: "top" },
      { id: "recipes", slot: "top" },
    ];
    const cards = [
      "stats", "streaks", "clocks", "gym", "pending", "leftover", "reading", "quote", "restock",
      "budgets", "savings", "trends", "categories",
    ].map((id) => ({ id, on: true }));
    // Epic 52 (AD-65): every place once, the bar's four pinned; same literal as
    // DEFAULT_ITEMS in backend/tests/test_preferences.py.
    const items = [
      "dashboard", "entries", "habits", "plan", "calendar", "books", "notes", "grow",
      "stock", "recipes", "gym", "clocks", "moon",
    ].map((id) => ({ id, pinned: ["dashboard", "entries", "habits", "plan"].includes(id) }));
    const desktopItems = [
      "dashboard", "calendar", "habits", "books", "notes", "entries", "plan", "grow",
      "stock", "recipes", "gym", "clocks", "moon",
    ].map((id) => ({ id, pinned: ["dashboard", "entries", "habits", "plan"].includes(id) }));
    expect(DEFAULT_PREFERENCES).toEqual({
      modules: { habits: true, books: true, mood: true, stock: true, gym: true, recipes: true, notes: true, moon: true, clocks: true },
      notifications: { stock: true, recurring: true, habits: true, due_tomorrow: false, savings: false, streak: false, moon: false },
      // Epic 41: every tab streak is opt-in, and the list is pinned against the server's.
      streaks: {
        entries: false, plan: false, grow: false, habits: false, mood: false,
        books: false, stock: false, gym: false, recipes: false, notes: false,
      },
      points_name: null,
      // Epic 47: null is "from the account's time zone", as the server resolves it.
      moon_hemisphere: null,
      // Epic 48: no places, the default hours, no second zone on the calendar.
      clocks: [],
      clock_hours: { work: ["09:00", "18:00"], night: ["23:00", "07:00"] },
      calendar_zone: null,
      phone: { tabs, cards, items },
      // Round 1: a desktop's default list is in the sidebar's group order, the same four pinned.
      desktop: { tabs, cards, items: desktopItems },
    });
  });

  it("stand in for a server older than migration 0025", () => {
    expect(preferencesOf(null)).toBe(DEFAULT_PREFERENCES);
    expect(preferencesOf({ id: "u", email: "", currency: "USD", weight_unit: "kg",
      budget_start_day: 1, language: "en", created_at: "" })).toBe(DEFAULT_PREFERENCES);
  });

  it("fill in the notification kinds for a server between 0025 and 0028", () => {
    const { notifications: _dropped, streaks: _alsoDropped, ...older } = DEFAULT_PREFERENCES;
    const prefs = preferencesOf({ id: "u", email: "", currency: "USD", weight_unit: "kg",
      budget_start_day: 1, language: "en", created_at: "",
      preferences: older as typeof DEFAULT_PREFERENCES });
    expect(prefs.notifications).toEqual(DEFAULT_PREFERENCES.notifications);
    // ...and for one older than Epic 41, which has no streak switches either.
    expect(prefs.streaks).toEqual(DEFAULT_PREFERENCES.streaks);
  });

  it("a layout patch without tabs lays over the layout it replaces, keeping its tabs", () => {
    const items = DEFAULT_PREFERENCES.phone.items?.slice().reverse() ?? [];
    const next = applyPatch(DEFAULT_PREFERENCES, {
      phone: { cards: DEFAULT_PREFERENCES.phone.cards, items },
    });
    expect(next.phone.items).toEqual(items);
    expect(next.phone.tabs).toBe(DEFAULT_PREFERENCES.phone.tabs);
    expect(next.desktop).toBe(DEFAULT_PREFERENCES.desktop);
  });

  it("a patch replaces whole subtrees, like the server", () => {
    const next = applyPatch(DEFAULT_PREFERENCES, gymOff);
    expect(next.modules.gym).toBe(false);
    expect(next.phone).toBe(DEFAULT_PREFERENCES.phone);
  });
});

describe("PreferenceSaver", () => {
  it("shows a change at once, before the server answers", () => {
    const { send } = controlledSend();
    const shown = vi.fn();
    const saver = new PreferenceSaver(DEFAULT_PREFERENCES, send, shown);
    void saver.update(gymOff);
    expect(shown).toHaveBeenLastCalledWith(applyPatch(DEFAULT_PREFERENCES, gymOff));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("never has two requests out, so the last asked is the last applied", async () => {
    // The server applies patches in the order they arrive. Were both sent at once, the
    // first could land second and leave the account with Books on while the screen said off.
    const { send, calls } = controlledSend();
    const shown = vi.fn();
    const saver = new PreferenceSaver(DEFAULT_PREFERENCES, send, shown);

    const first = saver.update(gymOff);
    const second = saver.update(gymAndBooksOff);
    expect(send).toHaveBeenCalledTimes(1);
    expect(shown).toHaveBeenLastCalledWith(applyPatch(DEFAULT_PREFERENCES, gymAndBooksOff));

    at(calls, 0).resolve(applyPatch(DEFAULT_PREFERENCES, gymOff));
    await first;
    // The first answer does not pull the screen back to "only Gym off".
    expect(shown).toHaveBeenLastCalledWith(applyPatch(DEFAULT_PREFERENCES, gymAndBooksOff));
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(at(calls, 1).patch).toEqual(gymAndBooksOff);

    at(calls, 1).resolve(applyPatch(DEFAULT_PREFERENCES, gymAndBooksOff));
    await second;
    expect(saver.shown).toEqual(applyPatch(DEFAULT_PREFERENCES, gymAndBooksOff));
  });

  it("merges the changes queued behind one request into the next", async () => {
    const { send, calls } = controlledSend();
    const saver = new PreferenceSaver(DEFAULT_PREFERENCES, send, vi.fn());
    void saver.update(gymOff);
    const a = saver.update(gymAndBooksOff);
    const b = saver.update(phoneStatsHidden);

    at(calls, 0).resolve(applyPatch(DEFAULT_PREFERENCES, gymOff));
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(at(calls, 1).patch).toEqual({ ...gymAndBooksOff, ...phoneStatsHidden });

    at(calls, 1).resolve(applyPatch(applyPatch(DEFAULT_PREFERENCES, gymAndBooksOff), phoneStatsHidden));
    await Promise.all([a, b]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("reverts a failed change to what the server last confirmed, and says so", async () => {
    const { send, calls } = controlledSend();
    const shown = vi.fn();
    const saver = new PreferenceSaver(DEFAULT_PREFERENCES, send, shown);
    const done = saver.update(gymOff);

    at(calls, 0).reject(new Error("offline"));
    await expect(done).rejects.toThrow("offline");
    expect(shown).toHaveBeenLastCalledWith(DEFAULT_PREFERENCES);
    expect(saver.shown).toEqual(DEFAULT_PREFERENCES);
  });

  it("drops only the failed patch, keeping what was queued behind it", async () => {
    const { send, calls } = controlledSend();
    const saver = new PreferenceSaver(DEFAULT_PREFERENCES, send, vi.fn());
    const failed = saver.update(gymOff);
    const kept = saver.update(phoneStatsHidden);

    at(calls, 0).reject(new Error("500"));
    await expect(failed).rejects.toThrow("500");
    expect(saver.shown).toEqual(applyPatch(DEFAULT_PREFERENCES, phoneStatsHidden));
    await flush();
    expect(at(calls, 1).patch).toEqual(phoneStatsHidden);

    at(calls, 1).resolve(applyPatch(DEFAULT_PREFERENCES, phoneStatsHidden));
    await kept;
    expect(saver.shown.modules.gym).toBe(true);
  });

  it("adopts a state confirmed elsewhere under whatever is still pending", () => {
    const { send } = controlledSend();
    const saver = new PreferenceSaver(DEFAULT_PREFERENCES, send, vi.fn());
    void saver.update(phoneStatsHidden);
    saver.confirm(applyPatch(DEFAULT_PREFERENCES, gymOff));
    expect(saver.shown.modules.gym).toBe(false);
    expect(saver.shown.phone).toEqual(phoneStatsHidden.phone);
  });
});

describe("PreferenceSaver against a newer change elsewhere", () => {
  const changed = () => new ApiError(409, "changed", "preferences_changed");
  const booksOff: PreferencesPatch = { modules: { ...DEFAULT_PREFERENCES.modules, books: false } };

  /** A saver whose re-read answers `fresh`, as the account now is on the server. */
  function stale(fresh: Versioned) {
    const { send, calls } = controlledSend();
    const reload = vi.fn(async () => fresh);
    const saver = new PreferenceSaver(DEFAULT_PREFERENCES, send, vi.fn(), { version: "v1", reload });
    return { saver, send, calls, reload };
  }

  it("names the version it read, then the one each write answered", async () => {
    const { saver, calls } = stale({ prefs: DEFAULT_PREFERENCES, version: "v1" });
    const first = saver.update(gymOff);
    expect(at(calls, 0).version).toBe("v1");
    at(calls, 0).resolve(applyPatch(DEFAULT_PREFERENCES, gymOff), "v2");
    await first;
    void saver.update(phoneStatsHidden);
    expect(at(calls, 1).version).toBe("v2");
  });

  it("re-reads and sends again a subtree nobody else touched", async () => {
    // This tab hides a card; another device switched Books off meanwhile.
    const { saver, calls, reload } = stale({ prefs: applyPatch(DEFAULT_PREFERENCES, booksOff), version: "v2" });
    const done = saver.update(phoneStatsHidden);
    at(calls, 0).reject(changed());
    await flush();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(at(calls, 1)).toMatchObject({ patch: phoneStatsHidden, version: "v2" });
    expect(saver.shown.modules.books).toBe(false);
    expect(saver.shown.phone).toEqual(phoneStatsHidden.phone);

    at(calls, 1).resolve(applyPatch(applyPatch(DEFAULT_PREFERENCES, booksOff), phoneStatsHidden), "v3");
    await done;
    expect(saver.shown.modules.books).toBe(false);
    expect(saver.shown.phone).toEqual(phoneStatsHidden.phone);
  });

  it("keeps the other device's value for a subtree both changed, and says so", async () => {
    // The stale tab's modules still have Books on; writing them would switch it back.
    const { saver, calls, send } = stale({ prefs: applyPatch(DEFAULT_PREFERENCES, booksOff), version: "v2" });
    const done = saver.update(gymOff);
    at(calls, 0).reject(changed());
    await expect(done).rejects.toMatchObject({ status: 409, code: "preferences_changed" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(saver.shown.modules.books).toBe(false);
    expect(saver.shown.modules.gym).toBe(true);
  });

  it("rejects only the callers whose subtree was lost", async () => {
    const { saver, calls } = stale({ prefs: applyPatch(DEFAULT_PREFERENCES, booksOff), version: "v2" });
    void saver.update(phoneStatsHidden);
    const lost = saver.update(gymOff);
    const kept = saver.update({ desktop: phoneStatsHidden.phone });
    at(calls, 0).resolve(applyPatch(DEFAULT_PREFERENCES, phoneStatsHidden), "v1b");
    await flush();
    at(calls, 1).reject(changed());
    await flush();
    expect(at(calls, 2).patch).toEqual({ desktop: phoneStatsHidden.phone });
    at(calls, 2).resolve(DEFAULT_PREFERENCES, "v3");
    await expect(lost).rejects.toMatchObject({ status: 409 });
    await expect(kept).resolves.toBeUndefined();
  });

  it("counts a subtree changed elsewhere to exactly what was asked as done", async () => {
    const { saver, calls, send } = stale({ prefs: applyPatch(DEFAULT_PREFERENCES, gymOff), version: "v2" });
    const done = saver.update(gymOff);
    at(calls, 0).reject(changed());
    await expect(done).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not let a read that started before a write show it undone", async () => {
    const { saver, calls } = stale({ prefs: DEFAULT_PREFERENCES, version: "v1" });
    const before = saver.stamp();
    const done = saver.update(gymOff);
    at(calls, 0).resolve(applyPatch(DEFAULT_PREFERENCES, gymOff), "v2");
    await done;
    expect(saver.confirm(DEFAULT_PREFERENCES, "v1", before)).toBe(false);
    expect(saver.shown.modules.gym).toBe(false);

    const after = saver.stamp();
    expect(saver.confirm(applyPatch(DEFAULT_PREFERENCES, booksOff), "v3", after)).toBe(true);
    expect(saver.shown.modules.books).toBe(false);
  });
});

/** A list's ids, with an asterisk on each pinned one: the bar reads left to right. */
const shape = (items: NavItem[]) => items.map((i) => (i.pinned ? `*${i.id}` : i.id));
/** Every place once, `pinned` first in that order, the rest in default order. */
const listOf = (...pinned: NavItemId[]): NavItem[] => [
  ...pinned.map((id) => ({ id, pinned: true })),
  ...NAV_ITEMS.filter((id) => !pinned.includes(id)).map((id) => ({ id, pinned: false })),
];
const base = DEFAULT_PREFERENCES.phone.items ?? [];

describe("pinItem", () => {
  it("puts a newly pinned place last in the bar, in the list straight after the last pinned", () => {
    expect(shape(pinItem(listOf("dashboard", "entries"), "notes"))).toEqual([
      "*dashboard", "*entries", "*notes", "habits", "plan", "calendar", "books", "grow",
      "stock", "recipes", "gym", "clocks", "moon",
    ]);
  });

  it("pins first when nothing is pinned, and keeps the rest in order", () => {
    expect(shape(pinItem(listOf(), "gym")).slice(0, 3)).toEqual(["*gym", "dashboard", "entries"]);
  });

  it("is refused, unchanged, when the bar is full", () => {
    expect(base.filter((i) => i.pinned)).toHaveLength(PHONE_PIN_CAP);
    expect(pinItem(base, "notes")).toBe(base);
  });

  it("fills the bar to the cap and no further", () => {
    let items = listOf();
    for (const id of NAV_ITEMS) items = pinItem(items, id);
    expect(items.filter((i) => i.pinned).map((i) => i.id)).toEqual(NAV_ITEMS.slice(0, PHONE_PIN_CAP));
  });

  it("leaves an already pinned or unknown place alone", () => {
    expect(pinItem(listOf("gym"), "gym")).toEqual(listOf("gym"));
    // Not moved to the end of the bar by being pinned again.
    const two = listOf("gym", "notes");
    expect(pinItem(two, "gym")).toBe(two);
    expect(pinItem(listOf("gym"), "chess" as NavItemId)).toEqual(listOf("gym"));
  });

  it("does not count a pinned place whose module is off against the bar", () => {
    const modules = { ...DEFAULT_PREFERENCES.modules, books: false };
    // Four pinned, one of them (books) off: a fifth may be pinned, and is last in the bar.
    const items = listOf("dashboard", "entries", "books", "plan");
    expect(barCount(items, modules)).toBe(3);
    expect(pinItem(items, "gym", modules).filter((i) => i.pinned).map((i) => i.id)).toEqual([
      "dashboard", "entries", "books", "plan", "gym",
    ]);
    // With the module on (or no modules given) the same bar is full.
    expect(pinItem(items, "gym")).toBe(items);
    expect(pinItem(items, "gym", DEFAULT_PREFERENCES.modules)).toBe(items);
  });

  it("does not mutate its input", () => {
    const before = structuredClone(listOf("gym"));
    const input = listOf("gym");
    pinItem(input, "notes");
    expect(input).toEqual(before);
  });
});

describe("unpinItem", () => {
  it("returns a place to its default spot among the unpinned", () => {
    // Plan was pinned from far down the list; unpinned, it sits before "calendar" again,
    // which follows it by default.
    expect(shape(unpinItem(listOf("plan", "gym"), "plan"))).toEqual([
      "*gym", "dashboard", "entries", "habits", "plan", "calendar", "books", "notes", "grow",
      "stock", "recipes", "clocks", "moon",
    ]);
  });

  it("keeps the order of the other pinned places", () => {
    expect(shape(unpinItem(listOf("gym", "notes", "moon"), "notes")).slice(0, 2)).toEqual([
      "*gym",
      "*moon",
    ]);
  });

  it("puts a place that comes after everything at the end", () => {
    const items = [
      ...listOf("dashboard").filter((i) => i.id !== "moon"),
      { id: "moon" as const, pinned: true },
    ];
    expect(unpinItem(items, "moon").at(-1)).toEqual({ id: "moon", pinned: false });
  });

  it("leaves an unpinned or unknown place alone", () => {
    expect(unpinItem(base, "notes")).toBe(base);
    expect(unpinItem(base, "chess" as NavItemId)).toBe(base);
  });

  it("round-trips with pin: pin then unpin is the list it was", () => {
    const items = listOf("dashboard", "entries");
    expect(unpinItem(pinItem(items, "stock"), "stock")).toEqual(items);
  });
});

describe("moveItem", () => {
  it("moves a pinned place within the bar, and not past either end", () => {
    expect(shape(moveItem(base, "entries", -1)).slice(0, 3)).toEqual([
      "*entries",
      "*dashboard",
      "*habits",
    ]);
    expect(shape(moveItem(base, "dashboard", 1)).slice(0, 2)).toEqual(["*entries", "*dashboard"]);
    expect(moveItem(base, "dashboard", -1)).toEqual(base);
    expect(moveItem(base, "plan", 1)).toEqual(base);
  });

  it("moves an unpinned place within its own group only", () => {
    // Daily's unpinned are calendar, books, notes; Money's is grow.
    expect(shape(moveItem(base, "books", -1)).slice(4, 7)).toEqual(["books", "calendar", "notes"]);
    expect(shape(moveItem(base, "notes", -1)).slice(4, 7)).toEqual(["calendar", "notes", "books"]);
    expect(moveItem(base, "calendar", -1)).toEqual(base);
    expect(moveItem(base, "notes", 1)).toEqual(base);
    // Grow is alone in Money once the bar holds Entries and Plan: nowhere to go.
    expect(moveItem(base, "grow", 1)).toEqual(base);
    expect(moveItem(base, "grow", -1)).toEqual(base);
  });

  it("steps over another group's place that sits between two of a group", () => {
    // Daily places with Money's grow between them: calendar, grow, books.
    const spread: NavItem[] = [
      ...listOf("dashboard", "entries", "habits", "plan").slice(0, 4),
      { id: "calendar", pinned: false },
      { id: "grow", pinned: false },
      { id: "books", pinned: false },
      ...NAV_ITEMS.filter((id) => !["dashboard", "entries", "habits", "plan", "calendar", "grow", "books"].includes(id)).map(
        (id) => ({ id, pinned: false }),
      ),
    ];
    expect(shape(moveItem(spread, "books", -1)).slice(4, 7)).toEqual(["books", "grow", "calendar"]);
  });

  it("never lets a pinned place trade places with an unpinned one", () => {
    expect(moveItem(base, "plan", 1)).toEqual(base);
    expect(shape(moveItem(base, "calendar", -1)).slice(3, 5)).toEqual(["*plan", "calendar"]);
  });

  it("keeps every place exactly once, and does not mutate", () => {
    const before = structuredClone(base);
    for (const item of base) {
      for (const step of [-1, 1] as const) {
        const next = moveItem(base, item.id, step);
        expect(next.map((i) => i.id).sort()).toEqual([...NAV_ITEMS].sort());
      }
    }
    expect(base).toEqual(before);
  });

  it("ignores an unknown place", () => {
    expect(moveItem(base, "chess" as NavItemId, 1)).toBe(base);
  });
});

describe("itemsOf", () => {
  const layout = (tabs: Layout["tabs"], items?: NavItem[]): Layout => ({
    tabs,
    cards: DEFAULT_PREFERENCES.phone.cards,
    ...(items ? { items } : {}),
  });

  it("returns the server's items as they are", () => {
    const items = listOf("moon", "gym");
    expect(itemsOf(layout(DEFAULT_PREFERENCES.phone.tabs, items))).toBe(items);
  });

  it("derives them from tabs for a server older than Epic 52: the first four bar tabs", () => {
    // The old default bar is dashboard, entries, habits, stock, gym: gym is the fifth.
    const items = itemsOf(layout(DEFAULT_PREFERENCES.phone.tabs));
    expect(shape(items).slice(0, 5)).toEqual(["*dashboard", "*entries", "*habits", "*stock", "plan"]);
    expect(items.map((i) => i.id).sort()).toEqual([...NAV_ITEMS].sort());
  });

  it("keeps a customised bar's order", () => {
    const tabs = DEFAULT_PREFERENCES.phone.tabs;
    const reordered = [tabs[4], tabs[3], tabs[0], tabs[1], tabs[2], ...tabs.slice(5)].filter(
      (tab): tab is (typeof tabs)[number] => tab !== undefined,
    );
    expect(
      itemsOf(layout(reordered))
        .filter((i) => i.pinned)
        .map((i) => i.id),
    ).toEqual(["gym", "stock", "dashboard", "entries"]);
  });

  it("lists a desktop's unpinned places in group order, a phone's bar-first", () => {
    const phone = itemsOf(layout(DEFAULT_PREFERENCES.phone.tabs), "phone");
    const desktop = itemsOf(layout(DEFAULT_PREFERENCES.phone.tabs), "desktop");
    expect(desktop.slice(0, 4).map((i) => i.id)).toEqual(["dashboard", "entries", "habits", "stock"]);
    expect(desktop.slice(4).map((i) => i.id)).toEqual(
      NAV_ITEMS_GROUPED.filter((id) => !["dashboard", "entries", "habits", "stock"].includes(id)),
    );
    expect(phone.slice(4).map((i) => i.id)).toEqual(
      NAV_ITEMS.filter((id) => !["dashboard", "entries", "habits", "stock"].includes(id)),
    );
    expect(defaultItems("desktop").map((i) => i.id)).toEqual(NAV_ITEMS_GROUPED);
    expect(defaultItems("phone").map((i) => i.id)).toEqual(NAV_ITEMS);
  });

  it("has nothing pinned when no tab is in the bar", () => {
    const tabs = DEFAULT_PREFERENCES.phone.tabs.map((tab) => ({ ...tab, slot: "top" as const }));
    expect(itemsOf(layout(tabs)).some((i) => i.pinned)).toBe(false);
  });
});
