import { describe, expect, it } from "vitest";

import type { Layout, ModuleId, NavItem, NavItemId } from "../api/types";
import { DEFAULT_PREFERENCES, NAV_ITEMS } from "../layout/preferences";
import { NAV_DEFS, NAV_GROUPS, isAt, navModel, placeOf } from "./model";

const allOn = DEFAULT_PREFERENCES.modules;
const off = (...ids: ModuleId[]) => ({ ...allOn, ...Object.fromEntries(ids.map((id) => [id, false])) });
const layoutOf = (...pinned: NavItemId[]): Layout => ({
  tabs: DEFAULT_PREFERENCES.phone.tabs,
  cards: DEFAULT_PREFERENCES.phone.cards,
  items: [
    ...pinned.map((id): NavItem => ({ id, pinned: true })),
    ...NAV_ITEMS.filter((id) => !pinned.includes(id)).map((id): NavItem => ({ id, pinned: false })),
  ],
});
const ids = (defs: { id: string }[]) => defs.map((d) => d.id);

describe("navModel", () => {
  const model = navModel(DEFAULT_PREFERENCES.phone, allOn);

  it("pins the bar in the person's order", () => {
    expect(ids(model.pinned)).toEqual(["dashboard", "entries", "habits", "plan"]);
    expect(ids(navModel(layoutOf("moon", "dashboard"), allOn).pinned)).toEqual(["moon", "dashboard"]);
  });

  it("puts everything not pinned in the drawer, by group, in list order", () => {
    expect(model.drawer.map((g) => [g.id, ids(g.items)])).toEqual([
      ["daily", ["calendar", "books", "notes"]],
      ["money", ["grow"]],
      ["home", ["stock", "recipes", "gym"]],
      ["tools", ["clocks", "moon"]],
    ]);
  });

  it("shows every visible place in the sidebar, pinned or not", () => {
    expect(model.sidebar.map((g) => [g.id, ids(g.items)])).toEqual([
      ["daily", ["dashboard", "habits", "calendar", "books", "notes"]],
      ["money", ["entries", "plan", "grow"]],
      ["home", ["stock", "recipes", "gym"]],
      ["tools", ["clocks", "moon"]],
    ]);
  });

  it("keeps list order inside a group, so the person's reordering shows", () => {
    const reordered: Layout = {
      ...DEFAULT_PREFERENCES.phone,
      items: [...(DEFAULT_PREFERENCES.phone.items ?? [])].reverse(),
    };
    const next = navModel(reordered, allOn);
    expect(ids(next.drawer.find((g) => g.id === "home")?.items ?? [])).toEqual([
      "gym", "recipes", "stock",
    ]);
  });

  it("carries the group labels the renderers print", () => {
    expect(model.drawer.map((g) => g.label)).toEqual(NAV_GROUPS.map((g) => g.label));
  });

  it("drops a place whose module is off, from the bar, the drawer and the sidebar", () => {
    const next = navModel(layoutOf("dashboard", "habits", "gym"), off("habits", "gym"));
    expect(ids(next.pinned)).toEqual(["dashboard"]);
    const everywhere = [...next.drawer, ...next.sidebar].flatMap((g) => ids(g.items));
    expect(everywhere).not.toContain("habits");
    expect(everywhere).not.toContain("gym");
    expect(everywhere).toContain("books");
  });

  it("makes Habits and Books separate: one off leaves the other", () => {
    const booksOff = navModel(DEFAULT_PREFERENCES.phone, off("books"));
    expect(ids(booksOff.pinned)).toContain("habits");
    expect(ids(booksOff.sidebar.flatMap((g) => g.items))).not.toContain("books");
    const habitsOff = navModel(DEFAULT_PREFERENCES.phone, off("habits"));
    expect(ids(habitsOff.sidebar.flatMap((g) => g.items))).toContain("books");
  });

  it("drops a group left with nothing, and the places that never go off stay", () => {
    const next = navModel(DEFAULT_PREFERENCES.phone, off("clocks", "moon"));
    expect(next.drawer.map((g) => g.id)).toEqual(["daily", "money", "home"]);
    expect(next.sidebar.map((g) => g.id)).toEqual(["daily", "money", "home"]);
    // A drawer with everything pinned has no group at all; the bar is capped at four, so
    // only a layout the server would refuse can do it, but the model must not crash.
    const all = navModel(
      { ...DEFAULT_PREFERENCES.phone, items: NAV_ITEMS.map((id) => ({ id, pinned: true })) },
      allOn,
    );
    expect(all.drawer).toEqual([]);
  });

  it("ignores a stored id it does not know", () => {
    const stray: Layout = {
      ...DEFAULT_PREFERENCES.phone,
      items: [{ id: "chess" as NavItemId, pinned: true }, ...(DEFAULT_PREFERENCES.phone.items ?? [])],
    };
    expect(ids(navModel(stray, allOn).pinned)).toEqual(["dashboard", "entries", "habits", "plan"]);
  });

  it("reads a layout from a server older than Epic 52 through its tabs", () => {
    const { items: _items, ...older } = DEFAULT_PREFERENCES.phone;
    expect(ids(navModel(older, allOn).pinned)).toEqual(["dashboard", "entries", "habits", "stock"]);
  });
});

describe("isAt and placeOf", () => {
  const at = (id: NavItemId, path: string) => isAt(NAV_DEFS[id], path);

  it('matches "/" exactly, so the Dashboard does not own every path', () => {
    expect(at("dashboard", "/")).toBe(true);
    expect(at("dashboard", "/entries")).toBe(false);
    expect(at("dashboard", "/calendar")).toBe(false);
    expect(placeOf("/")).toBe("dashboard");
  });

  it("matches a place's own path and what is under it", () => {
    expect(at("gym", "/gym")).toBe(true);
    expect(at("gym", "/gym/session")).toBe(true);
    expect(placeOf("/gym/session")).toBe("gym");
    expect(at("gym", "/gymnasium")).toBe(false);
    expect(at("notes", "/notes/abc")).toBe(true);
    expect(placeOf("/notes/abc")).toBe("notes");
    expect(placeOf("/recipes/42")).toBe("recipes");
  });

  it("puts a category page under Entries", () => {
    expect(at("entries", "/categories/x")).toBe(true);
    expect(placeOf("/categories/x")).toBe("entries");
    expect(placeOf("/categories")).toBeNull();
  });

  it("gives each of the five views its own place", () => {
    expect(placeOf("/calendar")).toBe("calendar");
    expect(placeOf("/books")).toBe("books");
    expect(placeOf("/notes")).toBe("notes");
    expect(placeOf("/clocks")).toBe("clocks");
    expect(placeOf("/moon")).toBe("moon");
    expect(placeOf("/habits")).toBe("habits");
    expect(placeOf("/projections")).toBe("grow");
    expect(placeOf("/inventory")).toBe("stock");
    expect(placeOf("/plan")).toBe("plan");
  });

  it("belongs to no place for Settings, Install and anything unknown", () => {
    for (const path of ["/settings", "/install", "/invites", "/nowhere"]) {
      expect(placeOf(path)).toBeNull();
    }
  });

  it("claims every path for at most one place", () => {
    for (const path of ["/", "/entries", "/categories/x", "/gym/a", "/notes/1", "/moon"]) {
      expect(Object.values(NAV_DEFS).filter((def) => isAt(def, path))).toHaveLength(1);
    }
  });
});

describe("the catalogue", () => {
  it("defines every place of NAV_ITEMS once, in a known group", () => {
    expect(Object.keys(NAV_DEFS).sort()).toEqual([...NAV_ITEMS].sort());
    const groups = NAV_GROUPS.map((g) => g.id);
    for (const def of Object.values(NAV_DEFS)) expect(groups).toContain(def.group);
  });
});
