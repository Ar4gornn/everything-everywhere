import { describe, expect, it, vi } from "vitest";

import type { Preferences, PreferencesPatch } from "../api/types";
import {
  DEFAULT_PREFERENCES,
  PHONE_CAPS,
  PreferenceSaver,
  applyPatch,
  moveTab,
  normalizeTabs,
  preferencesOf,
  swapPartner,
  switchSlot,
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
      phone: { tabs, cards },
      desktop: { tabs, cards },
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

describe("moving tabs", () => {
  const tabs = DEFAULT_PREFERENCES.phone.tabs;
  const ids = (list: { id: string }[]) => list.map((t) => t.id);
  const count = (list: { slot: string }[], slot: string) =>
    list.filter((t) => t.slot === slot).length;

  it("moves one place within its own row, and not past either end", () => {
    expect(ids(moveTab(tabs, "entries", -1)).slice(0, 2)).toEqual(["entries", "dashboard"]);
    expect(moveTab(tabs, "dashboard", -1)).toEqual(tabs);
    // Gym is last in the tab bar; down would cross into the top bar, so it stays.
    expect(moveTab(tabs, "gym", 1)).toEqual(tabs);
    expect(moveTab(tabs, "plan", -1)).toEqual(tabs);
    expect(ids(moveTab(tabs, "grow", -1)).slice(5)).toEqual(["grow", "plan", "recipes"]);
  });

  it("swaps across on a phone, where both rows are full, and names who comes back", () => {
    expect(swapPartner(tabs, "gym", "phone")).toBe("recipes");
    expect(swapPartner(tabs, "plan", "phone")).toBe("gym");
    expect(switchSlot(tabs, "entries", "phone")).toEqual([
      { id: "dashboard", slot: "bar" },
      { id: "recipes", slot: "bar" },
      { id: "habits", slot: "bar" },
      { id: "stock", slot: "bar" },
      { id: "gym", slot: "bar" },
      { id: "plan", slot: "top" },
      { id: "grow", slot: "top" },
      { id: "entries", slot: "top" },
    ]);
  });

  it("keeps a phone within five and three whatever is moved, and every section once", () => {
    for (const tab of tabs) {
      const next = switchSlot(tabs, tab.id, "phone");
      expect(count(next, "bar")).toBeLessThanOrEqual(PHONE_CAPS.bar);
      expect(count(next, "top")).toBeLessThanOrEqual(PHONE_CAPS.top);
      expect(new Set(ids(next)).size).toBe(tabs.length);
    }
  });

  it("just moves across on a desktop, with no swap", () => {
    expect(swapPartner(tabs, "gym", "desktop")).toBeNull();
    const next = switchSlot(tabs, "gym", "desktop");
    expect(count(next, "bar")).toBe(4);
    expect(ids(next).at(-1)).toBe("gym");
  });

  it("writes tab bar first, then top bar", () => {
    const mixed = [tabs[5], tabs[0], tabs[6], tabs[1]].filter((t) => t !== undefined);
    expect(ids(normalizeTabs(mixed))).toEqual(["dashboard", "entries", "plan", "grow"]);
  });
});
