import { useEffect, useState } from "react";

import type { NavItemId } from "../api/types";
import { useOptionalAuth } from "../auth/AuthContext";
import { clockHoursOf, clocksOf, preferencesOf } from "../layout/preferences";
import { useModule } from "../layout/modules";
import { useT } from "../i18n";
import { homeZone, hoursFor, readClock } from "../clocks/time";
import { useNow } from "../clocks/useNow";
import { budgetMonth, monthBounds, monthNameShort, weekdayNameShort } from "../months";
import { type MoonEngine, type PhaseName, loadMoonEngine } from "../moon/engine";
import { resolveHemisphere } from "../moon/hemisphere";
import { deviceZone } from "../push";

/** Phase glyphs as the northern hemisphere sees them; the south sees the lit side flipped. */
const NORTH: Record<PhaseName, string> = {
  new: "🌑",
  waxingCrescent: "🌒",
  firstQuarter: "🌓",
  waxingGibbous: "🌔",
  full: "🌕",
  waningGibbous: "🌖",
  lastQuarter: "🌗",
  waningCrescent: "🌘",
};
const SOUTH: Record<PhaseName, string> = {
  new: "🌑",
  waxingCrescent: "🌘",
  firstQuarter: "🌗",
  waxingGibbous: "🌖",
  full: "🌕",
  waningGibbous: "🌔",
  lastQuarter: "🌓",
  waningCrescent: "🌒",
};

/** Whole days from `today` to the last day of the budget month, counting today. */
export function daysLeftInMonth(startDay: number, today: Date): number {
  const [, end] = monthBounds(budgetMonth(startDay, today), startDay);
  const from = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const to = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((to - from) / 86400000) + 1;
}

/**
 * Epic 52 (AD-65 §6): the live hint under a drawer tile or beside a sidebar entry. Only what
 * the device can compute without asking the server: Clocks (the first place's name and
 * time), Moon (phase glyph and % lit), Calendar (today, short), Plan (days left in the
 * budget month, from `budget_start_day`). Everything else has none. Re-renders on the minute.
 *
 * `moon` says whether the lazy astronomy chunk may be requested: the drawer passes `open`,
 * the sidebar leaves the default (true, it is always on screen). A module that is off never
 * loads it either way.
 */
export function useNavHints(
  options: { moon?: boolean } = {},
): Partial<Record<NavItemId, string>> {
  const { moon: wantMoon = true } = options;
  const t = useT();
  const user = useOptionalAuth()?.user ?? null;
  const preferences = preferencesOf(user);
  const now = useNow();
  const moonOn = useModule("moon");
  const [engine, setEngine] = useState<MoonEngine | null>(null);

  useEffect(() => {
    if (!wantMoon || !moonOn) return;
    let live = true;
    // `Promise.resolve`: a test that stubs the engine module hands back nothing.
    Promise.resolve(loadMoonEngine()).then(
      (loaded) => {
        if (live && loaded) setEngine(loaded);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [wantMoon, moonOn]);

  const hints: Partial<Record<NavItemId, string>> = {};

  const first = clocksOf(preferences)[0];
  if (first) {
    try {
      const home = homeZone(user);
      const reading = readClock(first.zone, now, home, hoursFor(first, clockHoursOf(preferences)));
      hints.clocks = `${first.label} ${reading.time}`;
    } catch {
      // An unknown zone is the Clocks page's problem to explain, not a tile's.
    }
  }

  if (engine && moonOn) {
    const state = engine.stateAt(now);
    const south =
      resolveHemisphere(preferences.moon_hemisphere ?? null, user?.timezone ?? deviceZone()) ===
      "south";
    const glyph = (south ? SOUTH : NORTH)[state.phase];
    hints.moon = `${glyph} ${t("moon.lit", { percent: Math.round(state.illumination * 100) })}`;
  }

  hints.calendar = t("date.dayLong", {
    weekday: weekdayNameShort((now.getDay() + 6) % 7, t),
    day: now.getDate(),
    month: monthNameShort(now.getMonth() + 1, t),
  });

  hints.plan = t.n("nav.hint.planLeft", daysLeftInMonth(user?.budget_start_day ?? 1, now));

  return hints;
}
