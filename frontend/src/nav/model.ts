/**
 * Epic 52 (AD-65): what the navigation shows, for one layout and one set of modules.
 *
 * One model for three renderers: the phone's bottom bar (the pinned places, then More),
 * the More drawer (everything else, grouped), and the desktop sidebar (everything, grouped;
 * pinned is ignored there). A place whose module is off is gone from all three. Settings is
 * not a place here: it is always last in the drawer and sidebar, and in the phone top bar.
 */
import type { Layout, LayoutName, ModuleId, NavItemId } from "../api/types";
import type { MessageKey } from "../i18n";
import { itemsOf } from "../layout/preferences";

export type NavGroupId = "daily" | "money" | "home" | "tools";

export interface NavDef {
  id: NavItemId;
  to: string;
  label: MessageKey;
  glyph: string;
  group: NavGroupId;
  /** Hidden while this module is off. Dashboard, Entries, Plan, Grow, Calendar never are. */
  module?: ModuleId;
  /** Exact match on `to` ("/" would otherwise own every path). */
  end?: boolean;
  /** Paths under this place besides `to` itself (a recipe, a category, a note). */
  also?: readonly string[];
}

export const NAV_DEFS: Record<NavItemId, NavDef> = {
  dashboard: { id: "dashboard", to: "/", label: "nav.dashboard", glyph: "◪", group: "daily", end: true },
  calendar: { id: "calendar", to: "/calendar", label: "view.calendar", glyph: "▦", group: "daily" },
  habits: { id: "habits", to: "/habits", label: "nav.habits", glyph: "✓", group: "daily", module: "habits" },
  books: { id: "books", to: "/books", label: "view.books", glyph: "▥", group: "daily", module: "books" },
  notes: { id: "notes", to: "/notes", label: "module.notes", glyph: "✎", group: "daily", module: "notes" },
  entries: {
    id: "entries",
    to: "/entries",
    label: "nav.entries",
    glyph: "≡",
    group: "money",
    also: ["/categories/"],
  },
  plan: { id: "plan", to: "/plan", label: "nav.plan", glyph: "◫", group: "money" },
  grow: { id: "grow", to: "/projections", label: "nav.grow", glyph: "↗", group: "money" },
  stock: { id: "stock", to: "/inventory", label: "nav.stock", glyph: "▤", group: "home", module: "stock" },
  recipes: { id: "recipes", to: "/recipes", label: "nav.recipes", glyph: "◍", group: "home", module: "recipes" },
  gym: { id: "gym", to: "/gym", label: "nav.gym", glyph: "◈", group: "home", module: "gym" },
  clocks: { id: "clocks", to: "/clocks", label: "clocks.module", glyph: "◷", group: "tools", module: "clocks" },
  moon: { id: "moon", to: "/moon", label: "moon.module", glyph: "☾", group: "tools", module: "moon" },
};

export const NAV_GROUPS: readonly { id: NavGroupId; label: MessageKey }[] = [
  { id: "daily", label: "nav.group.daily" },
  { id: "money", label: "nav.group.money" },
  { id: "home", label: "nav.group.home" },
  { id: "tools", label: "nav.group.tools" },
];

export interface NavModel {
  /** The phone's bottom bar, in the person's order (at most 4). */
  pinned: NavDef[];
  /** Drawer: every group with what is not pinned, in list order; empty groups dropped. */
  drawer: { id: NavGroupId; label: MessageKey; items: NavDef[] }[];
  /** Sidebar: every group with every visible place, in list order; empty groups dropped. */
  sidebar: { id: NavGroupId; label: MessageKey; items: NavDef[] }[];
}

export function navModel(
  layout: Layout,
  modules: Record<ModuleId, boolean>,
  name: LayoutName = "phone",
): NavModel {
  const visible = itemsOf(layout, name).filter((item) => {
    const def = NAV_DEFS[item.id];
    return def !== undefined && (!def.module || modules[def.module]);
  });
  const grouped = (keep: (pinned: boolean) => boolean) =>
    NAV_GROUPS.map((group) => ({
      ...group,
      items: visible
        .filter((item) => keep(item.pinned) && NAV_DEFS[item.id].group === group.id)
        .map((item) => NAV_DEFS[item.id]),
    })).filter((group) => group.items.length > 0);
  return {
    pinned: visible.filter((item) => item.pinned).map((item) => NAV_DEFS[item.id]),
    drawer: grouped((pinned) => !pinned),
    sidebar: grouped(() => true),
  };
}

/** Is `pathname` inside this place? */
export function isAt(def: NavDef, pathname: string): boolean {
  if (def.end) return pathname === def.to;
  if (pathname === def.to || pathname.startsWith(`${def.to}/`)) return true;
  return (def.also ?? []).some((prefix) => pathname.startsWith(prefix));
}

/** The place `pathname` belongs to, if any (Settings, Install and Invites belong to none). */
export function placeOf(pathname: string): NavItemId | null {
  for (const def of Object.values(NAV_DEFS)) if (isAt(def, pathname)) return def.id;
  return null;
}
