import type { NavItemId } from "../api/types";

/**
 * Epic 52 (AD-65): the live hint under a tile or beside a sidebar entry. Only what the
 * device can compute without asking the server: Clocks (first place's time, e.g.
 * "Paris 14:05"), Moon (phase glyph + % lit, only once the lazy engine has loaded — never
 * load it just for a hint? decide: load it when the drawer opens), Calendar (today, short
 * date), Plan (days left in the budget month, from `budget_start_day`). Everything else: none.
 * Re-renders on the minute (`useNow`). SKELETON: builder A implements; builder B reads it.
 */
export function useNavHints(): Partial<Record<NavItemId, string>> {
  return {};
}
