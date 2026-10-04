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
import { type Hemisphere, resolveHemisphere } from "../moon/hemisphere";
import { moonOnDay } from "../moon/useMoonView";
import { deviceZone } from "../push";

/** What a renderer needs to draw the moon's phase beside the text (the app's `MoonGlyph`). */
export interface MoonHint {
  phase: PhaseName;
  angle: number;
  illumination: number;
  hemisphere: Hemisphere;
}

/** A clock hint in parts, so a renderer can shorten the place's name and never the time. */
export interface ClockHint {
  label: string;
  time: string;
  /** "tomorrow" / "yesterday" when the place's day is not yours. */
  day?: string;
}

/** One live hint: its words (whole, for a reader), for the moon the phase to draw before
 *  them, and for a clock the same words in parts. */
export interface NavHint {
  text: string;
  moon?: MoonHint;
  clock?: ClockHint;
}

/** A place name in a hint never runs past this many characters (the full name is one tap
 *  away on the Clocks page): a 32-character label must not break a tile or the sidebar. */
export const HINT_LABEL_MAX = 12;

/** `label` cut to `HINT_LABEL_MAX` characters (code points) plus an ellipsis. */
export function hintLabel(label: string): string {
  const chars = [...label];
  return chars.length > HINT_LABEL_MAX ? `${chars.slice(0, HINT_LABEL_MAX).join("")}…` : label;
}

/** Whole days from `today` to the last day of the budget month, counting today. */
export function daysLeftInMonth(startDay: number, today: Date): number {
  const [, end] = monthBounds(budgetMonth(startDay, today), startDay);
  const from = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const to = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((to - from) / 86400000) + 1;
}

/**
 * Epic 52 (AD-65 §6): the live hint under a drawer tile or beside a sidebar entry. Only what
 * the device can compute without asking the server: Clocks (the first place's name, time
 * and, when its day is not yours, the day word), Moon (phase and % lit, the same figure the
 * dashboard line shows), Calendar (today, short), Plan (days left in the budget month, from
 * `budget_start_day`). Everything else has none. Re-renders on the minute.
 *
 * `moon` says whether the lazy astronomy chunk may be requested: the drawer passes `open`,
 * the sidebar leaves the default (true, it is always on screen). A module that is off never
 * loads it either way.
 */
export function useNavHints(options: { moon?: boolean } = {}): Partial<Record<NavItemId, NavHint>> {
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

  const hints: Partial<Record<NavItemId, NavHint>> = {};

  const first = clocksOf(preferences)[0];
  if (first) {
    try {
      const home = homeZone(user);
      const reading = readClock(first.zone, now, home, hoursFor(first, clockHoursOf(preferences)));
      const label = hintLabel(first.label);
      const day =
        reading.dayShift === 1
          ? t("clocks.tomorrow")
          : reading.dayShift === -1
            ? t("clocks.yesterday")
            : undefined;
      const base = `${label} ${reading.time}`;
      hints.clocks = {
        text: day ? `${base} ${day}` : base,
        clock: day ? { label, time: reading.time, day } : { label, time: reading.time },
      };
    } catch {
      // An unknown zone is the Clocks page's problem to explain, not a tile's.
    }
  }

  if (engine && moonOn) {
    // The dashboard's line takes the moon on today's local noon; so does this.
    const state = moonOnDay(engine, now);
    const hemisphere = resolveHemisphere(
      preferences.moon_hemisphere ?? null,
      user?.timezone ?? deviceZone(),
    );
    hints.moon = {
      text: t("moon.lit", { percent: Math.round(state.illumination * 100) }),
      moon: { phase: state.phase, angle: state.angle, illumination: state.illumination, hemisphere },
    };
  }

  hints.calendar = {
    text: t("date.dayLong", {
      weekday: weekdayNameShort((now.getDay() + 6) % 7, t),
      day: now.getDate(),
      month: monthNameShort(now.getMonth() + 1, t),
    }),
  };

  hints.plan = { text: t.n("nav.hint.planLeft", daysLeftInMonth(user?.budget_start_day ?? 1, now)) };

  return hints;
}
