import { type KeyboardEvent, type TouchEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { ApiError, api } from "../api/client";
import { useOptionalAuth } from "../auth/AuthContext";
import type {
  Category,
  Checkin,
  Contribution,
  Entry,
  ExpectedEntry,
  Meal,
  PendingEntry,
  SavingsType,
  ModuleId,
  MoodDay,
  StockChange,
  Workout,
} from "../api/types";
import { MoodFace, moodWord } from "../components/MoodFace";
import { QuoteCard } from "../components/QuoteCard";
import { Card, Empty, ErrorBanner } from "../components/ui";
import { timeLabel } from "../schedule";
import { DASHBOARD_VIEWS, ViewSwitch } from "../components/ViewSwitch";
import { useModules } from "../layout/modules";
import { fromCents, toCents } from "../money";
import { formatEnergy, sumEnergy, trim } from "../nutrition";
import { useMoney } from "../useMoney";
import { type MessageKey, useT, type Translate } from "../i18n";
import { useLoad } from "../useLoad";
import { useDates } from "../useDates";
import { dueEvent } from "../ics";
import { AddToCalendar } from "../components/AddToCalendar";
import { useLayout } from "../layout/useLayout";
import { budgetMonth, monthBounds, monthOf, shiftMonth, todayIso } from "../months";

/**
 * One view of what happened, and what is due, day by day (Epic 22).
 *
 * **A window, not a workbench.** Everything here is read, with two exceptions that are
 * navigation rather than data entry: a day links to the records on it, and "Add on this
 * day" hands off to the entry form with the date filled in. Rebuilding five write forms
 * inside day cells would either duplicate the rules each of them enforces — the kind match
 * of AD-7, the quantity/unit pair of AD-29, create-by-name of AD-12, propose-before-write
 * of AD-33 — or quietly drop them.
 *
 * **It composes, it does not join.** Every layer below is one module's own endpoint,
 * merged here by date (AD-31, AD-37). A module that fails takes its own layer down and
 * nothing else, exactly as a dashboard card does.
 *
 * **The grid is the account's month, not the calendar's.** For an account paid on the 26th,
 * "September" runs 26 August to 25 September (AD-10). Drawing the calendar month instead
 * would make this the one view in the app that disagrees with every total above it. The
 * price is ragged edges: the first and last rows carry days from the neighbouring periods,
 * drawn muted, and tapping one moves to the period it belongs to.
 */

type LayerKey = "money" | "savings" | "stock" | "gym" | "habits" | "mood" | "meals" | "due";

/**
 * The layers, as message keys — the chips are drawn on every calendar.
 *
 * The mood layer keeps an English literal rather than a key: Epic 24 is not committed,
 * and the French pass stops at its edge deliberately (see the catalogue).
 */
const LAYERS: { key: LayerKey; label: string; glyph: string; literal?: boolean }[] = [
  { key: "money", label: "cal.layerMoney", glyph: "≡" },
  { key: "savings", label: "cal.layerSavings", glyph: "◎" },
  { key: "stock", label: "cal.layerStock", glyph: "▤" },
  { key: "gym", label: "cal.layerGym", glyph: "◈" },
  { key: "habits", label: "cal.layerHabits", glyph: "✓" },
  // A mood is a dated fact a person wrote down, which is exactly what this page shows;
  // the layer costs one more endpoint composed at the edge and nothing else (AD-37).
  { key: "mood", label: "Mood", glyph: "◉", literal: true },
  // Meals are a dated fact somebody wrote down, exactly like every layer above — one more
  // endpoint composed at the edge and nothing else (AD-37). It is a *record*: what was
  // eaten, never what is planned, so it never appears after today.
  { key: "meals", label: "cal.layerMeals", glyph: "◍" },
  { key: "due", label: "cal.layerDue", glyph: "◷" },
];

/** Epic 33: the module a layer belongs to. A layer with none is the budget's own. */
const LAYER_MODULE: Partial<Record<LayerKey, ModuleId>> = {
  stock: "stock",
  gym: "gym",
  habits: "habits",
  mood: "mood",
  meals: "recipes",
};

/** How many rows a day holds in one layer. Money counts entries, not the net: a day whose
 *  income and spending cancel out still happened. */
function countIn(bucket: DayBucket, key: LayerKey): number {
  switch (key) {
    case "money":
      return bucket.entries.length;
    case "savings":
      return bucket.contributions.length;
    case "stock":
      return bucket.stock.length;
    case "gym":
      return bucket.workouts.length;
    case "habits":
      return bucket.checkins.length;
    case "mood":
      return bucket.moods.length;
    case "meals":
      return bucket.meals.length;
    case "due":
      return bucket.due.length + bucket.expected.length;
  }
}

/** A line of a wide cell: the words, the layer that tints them, and — in the week, where
 *  there is room for everything — the amount, when the row has one. */
interface CellLine {
  layer: LayerKey;
  text: string;
  amount?: string;
}

/** A wide cell holds four lines; past that, three and a count, so a busy day is the same
 *  height as any other and no line is cut in half. */
const CELL_LINES = 4;

/** How far a finger has to travel sideways before the grid turns the period, in px. */
const SWIPE_MIN = 50;

/** A layer's name, in words. Mood's label is already a word, not a key. */
function layerName(layer: (typeof LAYERS)[number], t: Translate): string {
  return layer.literal ? layer.label : t(layer.label as Parameters<Translate>[0]);
}

/** What a failed layer is called in the partial-load notice: a key, or Mood's literal. */
type MissingLabel = MessageKey | "Mood";

const LAYER_KEY = "everything-everywhere.calendarLayers";

/** Remembered per device, like the collapsed sections and the trend window. */
function readLayers(): LayerKey[] {
  try {
    const raw = window.localStorage.getItem(LAYER_KEY);
    if (!raw) return LAYERS.map((layer) => layer.key);
    const parsed = JSON.parse(raw) as unknown;
    const keys = Array.isArray(parsed)
      ? LAYERS.map((l) => l.key).filter((key) => parsed.includes(key))
      : [];
    // An empty stored set would render a calendar that shows nothing and looks broken.
    return keys.length ? keys : LAYERS.map((layer) => layer.key);
  } catch {
    return LAYERS.map((layer) => layer.key);
  }
}

function writeLayers(keys: LayerKey[]): void {
  try {
    window.localStorage.setItem(LAYER_KEY, JSON.stringify(keys));
  } catch {
    /* a forgotten preference is not worth a crash */
  }
}

/** Month or week (Epic 40.4). */
type View = "month" | "week";

const VIEW_KEY = "everything-everywhere.calendarView";

/** Remembered per device, like the layers: a phone may prefer the week and a desk the month. */
function readView(): View {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "week" ? "week" : "month";
  } catch {
    return "month";
  }
}

function writeView(view: View): void {
  try {
    window.localStorage.setItem(VIEW_KEY, view);
  } catch {
    /* a forgotten preference is not worth a crash */
  }
}

/** Local calendar day as `YYYY-MM-DD`. Built from the local parts, never from toISOString,
 *  which would shift the day for anybody west of UTC. */
function isoOf(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Monday-first index, 0..6. */
const weekIndex = (date: Date): number => (date.getDay() + 6) % 7;

const addDays = (date: Date, by: number): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + by);

/** The Monday a week starts on, Monday first like every schedule in the app. */
const mondayOf = (date: Date): Date => addDays(date, -weekIndex(date));

/** `YYYY-MM-DD` as local midnight — never `new Date(iso)`, which is UTC midnight. */
const dateOf = (iso: string): Date => new Date(`${iso}T00:00:00`);

/**
 * The UTC day a stored instant falls on.
 *
 * `changed_at` is a `TIMESTAMPTZ` — the moment a quantity moved — not a day anybody chose,
 * so it has no calendar day of its own until one is picked. UTC is picked, explicitly, and
 * said so on the page: it is what the restocks chart already does, so the calendar and the
 * chart cannot disagree, and unlike the browser's zone it puts the same row on the same day
 * for every device in the household. Stated limitation, unchanged: a restock at 00:30 local,
 * east of UTC, lands on the previous day here.
 */
const utcDayOf = (instant: string): string => new Date(instant).toISOString().slice(0, 10);

interface DayBucket {
  entries: Entry[];
  contributions: Contribution[];
  workouts: Workout[];
  stock: StockChange[];
  checkins: Checkin[];
  moods: MoodDay[];
  meals: Meal[];
  due: PendingEntry[];
  expected: ExpectedEntry[];
}

const emptyBucket = (): DayBucket => ({
  entries: [],
  contributions: [],
  workouts: [],
  stock: [],
  checkins: [],
  moods: [],
  meals: [],
  due: [],
  expected: [],
});

interface Loaded {
  entries: Entry[];
  contributions: Contribution[];
  workouts: Workout[];
  stock: StockChange[];
  checkins: Checkin[];
  moods: MoodDay[];
  meals: Meal[];
  due: PendingEntry[];
  expected: ExpectedEntry[];
}

const NOTHING: Loaded = {
  entries: [],
  contributions: [],
  workouts: [],
  stock: [],
  checkins: [],
  moods: [],
  meals: [],
  due: [],
  expected: [],
};

/** The month's load, before it has answered. */
const UNLOADED = { layers: NOTHING, missing: [] as MissingLabel[], stale: false, allFailed: false };

export function CalendarPage() {
  const money = useMoney();
  const t = useT();
  const dates = useDates();
  const startDay = useOptionalAuth()?.user?.budget_start_day ?? 1;
  const navigate = useNavigate();

  const [month, setMonth] = useState(() => budgetMonth(startDay));
  // Epic 40.4: the week is its own position, a Monday, rather than a place inside the
  // month — a week crosses a month's boundary whenever it likes.
  const [view, setView] = useState<View>(readView);
  const [week, setWeek] = useState(() => isoOf(mondayOf(new Date())));
  const weekly = view === "week";
  const [active, setActive] = useState<LayerKey[]>(readLayers);
  // A module that is off loses its chip, its dots and its request (Epic 33). The stored
  // choice of layers is left alone, so switching the module back on restores it.
  const modules = useModules();
  const layerOn = (key: LayerKey) => {
    const module = LAYER_MODULE[key];
    return !module || modules[module];
  };
  const available = LAYERS.filter((layer) => layerOn(layer.key));
  const shownActive = active.filter(layerOn);
  // Epic 40: the day's detail sits beside the grid on a wide screen and over its lower half
  // on a phone, so the two differ in what "nothing selected" means. Beside the grid there
  // is room to show today straight away; over it, an open panel on arrival would hide the
  // month the person came to see.
  const phone = useLayout() === "phone";
  const today = todayIso();
  const [selected, setSelected] = useState<string | null>(() => (phone ? null : today));
  // The one cell in the tab order (roving tabindex): arrows move it, Enter opens it.
  const [focusIso, setFocusIso] = useState<string | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const sideRef = useRef<HTMLDivElement>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [savingsTypes, setSavingsTypes] = useState<SavingsType[]>([]);

  // Reference data changes rarely and is not month-shaped, so it is fetched once rather
  // than on every month change.
  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([api.listCategories(), api.listSavingsTypes()]).then(
      ([cats, types]) => {
        if (cancelled) return;
        if (cats.status === "fulfilled") setCategories(cats.value);
        if (types.status === "fulfilled") setSavingsTypes(types.value);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const [periodStart, periodEnd] = useMemo((): [Date, Date] => {
    if (!weekly) return monthBounds(month, startDay);
    const monday = dateOf(week);
    return [monday, addDays(monday, 6)];
  }, [weekly, week, month, startDay]);

  // Every endpoint below speaks in budget months (AD-10). A month is one of them; a week is
  // one or, when it straddles the account's boundary, two — asked for separately and
  // joined here, since no module has a date-range query to ask instead.
  const firstMonth = monthOf(periodStart, startDay);
  const lastMonth = monthOf(periodEnd, startDay);

  const {
    data: { layers: data, missing, stale, allFailed },
    loading,
    failure,
  } = useLoad(
    async () => {
      const months = firstMonth === lastMonth ? [firstMonth] : [firstMonth, lastMonth];
      // One layer, over every month the period touches: it fails as one, as it always has.
      const each = <T,>(fetch: (month: string) => Promise<T[]>): Promise<T[]> =>
        Promise.all(months.map(fetch)).then((parts) => parts.flat());
      const none = Promise.resolve([]);
      // allSettled, not all: this page is a composition of six independent modules, and one
      // of them being down must cost that layer only. `Promise.all` would blank the month.
      const results = await Promise.allSettled([
        each((month) => api.listEntries({ month })),
        each((month) => api.listContributions({ month })),
        modules.gym ? each((month) => api.listWorkouts({ month, limit: 200 })) : none,
        modules.stock ? each((month) => api.stockChanges(month)) : none,
        modules.habits ? each((month) => api.listCheckins({ month })) : none,
        modules.mood ? each((month) => api.moodDays(month)) : none,
        modules.recipes ? each((month) => api.listMeals({ month })) : none,
        api.listPending(),
        each((month) => api.expectedEntries(month)),
      ]);
      const [entries, contributions, workouts, stock, checkins, moods, meals, due, expected] =
        results;
      // Labels are kept as keys and put into words at render, so the notice follows the
      // language without the month being fetched again.
      const failed: MissingLabel[] = [];
      // Tracked separately from the labels: every one of these endpoints is a fixed path, so
      // a 404 cannot mean "that row is missing" — it can only mean the route is not there,
      // which is an API older than the page. Saying so turns a shrug into an instruction.
      let allMissing = true;
      const value = <T,>(result: PromiseSettledResult<T[]>, label: MissingLabel): T[] => {
        if (result.status === "fulfilled") return result.value;
        failed.push(label);
        if (!(result.reason instanceof ApiError) || result.reason.status !== 404) {
          allMissing = false;
        }
        return [];
      };
      const layers: Loaded = {
        entries: value(entries, "cal.layerMoney"),
        contributions: value(contributions, "cal.layerSavings"),
        workouts: value(workouts, "cal.layerGym"),
        stock: value(stock, "cal.layerStock"),
        checkins: value(checkins, "cal.layerHabits"),
        moods: value(moods, "Mood"),
        meals: value(meals, "cal.layerMeals"),
        due: value(due, "cal.layerWhatIsDue"),
        expected: value(expected, "cal.layerForecast"),
      };
      return {
        layers,
        missing: failed,
        stale: failed.length > 0 && allMissing,
        allFailed: failed.length === results.length,
      };
    },
    UNLOADED,
    [firstMonth, lastMonth, modules.gym, modules.stock, modules.habits, modules.mood, modules.recipes],
    "cal.couldNotLoad",
  );
  // Nothing above throws (allSettled), so `failure` is only ever a bug's; the page's own
  // "could not load" is every layer having failed.
  const error = failure ?? (allFailed ? t("cal.couldNotLoad") : null);

  const categoryName = useMemo(() => {
    const lookup = new Map(categories.map((c) => [c.id, c.name]));
    return (id: string) => lookup.get(id) ?? "—";
  }, [categories]);

  const savingsName = useMemo(() => {
    const lookup = new Map(savingsTypes.map((t) => [t.id, t.name]));
    return (id: string) => lookup.get(id) ?? "—";
  }, [savingsTypes]);

  /** What the period is called: the month's name, or the week's first and last days. */
  const periodName = weekly
    ? `${t("date.range", {
        from: t("date.dayShort", {
          day: periodStart.getDate(),
          month: dates.monthNameShort(periodStart.getMonth() + 1),
        }),
        to: t("date.dayShort", {
          day: periodEnd.getDate(),
          month: dates.monthNameShort(periodEnd.getMonth() + 1),
        }),
      })} ${periodEnd.getFullYear()}`
    : dates.month(month);

  // Whole weeks, Monday first. The period's own first and last days sit wherever they fall.
  const weeks = useMemo(() => {
    const gridStart = addDays(periodStart, -weekIndex(periodStart));
    const gridEnd = addDays(periodEnd, 6 - weekIndex(periodEnd));
    const rows: Date[][] = [];
    for (let cursor = gridStart; cursor <= gridEnd; cursor = addDays(cursor, 7)) {
      rows.push(Array.from({ length: 7 }, (_, offset) => addDays(cursor, offset)));
    }
    return rows;
  }, [periodStart, periodEnd]);

  const byDay = useMemo(() => {
    const map = new Map<string, DayBucket>();
    const at = (iso: string): DayBucket => {
      let bucket = map.get(iso);
      if (!bucket) {
        bucket = emptyBucket();
        map.set(iso, bucket);
      }
      return bucket;
    };
    for (const row of data.entries) at(row.occurred_on).entries.push(row);
    for (const row of data.contributions) at(row.occurred_on).contributions.push(row);
    for (const row of data.workouts) at(row.performed_on).workouts.push(row);
    for (const row of data.stock) at(utcDayOf(row.changed_at)).stock.push(row);
    for (const row of data.checkins) at(row.done_on).checkins.push(row);
    for (const row of data.moods) at(row.on).moods.push(row);
    for (const row of data.meals) at(row.eaten_on).meals.push(row);
    for (const row of data.due) at(row.due_on).due.push(row);
    for (const row of data.expected) at(row.due_on).expected.push(row);
    return map;
  }, [data]);

  const on = (key: LayerKey) => shownActive.includes(key);

  /**
   * The period in figures, above the grid (Epic 40.3): money in, out and net, and how many
   * rows each other layer holds. Only the period's own days count — the ragged edges belong
   * to the neighbouring periods, and the due list is not month-shaped at all — so the net
   * here is the net of the grid's in-period cells, in cents (AD-5).
   */
  const summary = useMemo(() => {
    const first = isoOf(periodStart);
    const last = isoOf(periodEnd);
    let inCents = 0;
    let outCents = 0;
    const counts = new Map<LayerKey, number>();
    for (const [iso, bucket] of byDay) {
      if (iso < first || iso > last) continue;
      for (const entry of bucket.entries) {
        if (entry.kind === "income") inCents += toCents(entry.amount);
        else outCents += toCents(entry.amount);
      }
      for (const layer of LAYERS) {
        counts.set(layer.key, (counts.get(layer.key) ?? 0) + countIn(bucket, layer.key));
      }
    }
    return { inCents, outCents, counts };
  }, [byDay, periodStart, periodEnd]);
  const counted = LAYERS.filter(
    (layer) => layer.key !== "money" && on(layer.key) && (summary.counts.get(layer.key) ?? 0) > 0,
  );

  // A horizontal swipe over the grid turns the period (Epic 40.3). Touch only: a mouse has
  // the arrows beside the month. Decided on release, and only for a stroke that is clearly
  // sideways, so a vertical scroll that drifts is still a scroll.
  const swipeFrom = useRef<{ x: number; y: number } | null>(null);
  function onSwipeStart(event: TouchEvent) {
    const touch = event.touches[0];
    swipeFrom.current =
      event.touches.length === 1 && touch ? { x: touch.clientX, y: touch.clientY } : null;
  }
  function onSwipeEnd(event: TouchEvent) {
    const from = swipeFrom.current;
    const touch = event.changedTouches[0];
    swipeFrom.current = null;
    if (!from || !touch) return;
    const dx = touch.clientX - from.x;
    const dy = touch.clientY - from.y;
    if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < 2 * Math.abs(dy)) return;
    turn(dx < 0 ? 1 : -1);
  }

  const inPeriodIso = (iso: string | null): iso is string =>
    iso !== null && iso >= isoOf(periodStart) && iso <= isoOf(periodEnd);
  const onGrid = (iso: string | null): iso is string =>
    iso !== null &&
    iso >= isoOf(weeks[0]?.[0] as Date) &&
    iso <= isoOf(weeks[weeks.length - 1]?.[6] as Date);
  const tabbable = onGrid(focusIso)
    ? focusIso
    : inPeriodIso(selected)
      ? selected
      : inPeriodIso(today)
        ? today
        : isoOf(periodStart);

  const cellOf = (iso: string) =>
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-iso="${iso}"]`) ?? null;

  // Focus follows the arrows after the render that drew the target — which, past the edge
  // of the grid, is the render of the neighbouring period.
  useEffect(() => {
    const iso = pendingFocus.current;
    if (!iso) return;
    const cell = cellOf(iso);
    if (cell) {
      pendingFocus.current = null;
      cell.focus();
    }
  });

  function goToMonth(next: string) {
    setSelected(null);
    setFocusIso(null);
    setMonth(next);
  }

  /** The period, in the view on screen, that holds this day. */
  function goToDay(day: Date) {
    if (!weekly) return goToMonth(monthOf(day, startDay));
    setSelected(null);
    setFocusIso(null);
    setWeek(isoOf(mondayOf(day)));
  }

  /** The next period, or the previous one: a month, or seven days. */
  function turn(by: number) {
    if (weekly) goToDay(addDays(periodStart, 7 * by));
    else goToMonth(shiftMonth(month, by));
  }

  /**
   * Month to week and back, keeping the place: the chosen day if there is one, else today
   * if it is on screen, else the period's first day. The chosen day stays chosen — it is
   * inside the new period by construction.
   */
  function changeView(next: View) {
    if (next === view) return;
    const anchor = dateOf(selected ?? (inPeriodIso(today) ? today : isoOf(periodStart)));
    if (next === "week") setWeek(isoOf(mondayOf(anchor)));
    else setMonth(monthOf(anchor, startDay));
    setFocusIso(null);
    setView(next);
    writeView(next);
  }

  function closeDay(refocus: boolean) {
    const was = selected;
    setSelected(null);
    if (refocus && was) cellOf(was)?.focus();
  }

  // The phone panel is a disclosure, not a modal (see MoodCheckin for why the app has
  // none): nothing is trapped and the page stays live. Escape and a tap outside both put
  // it away, which is what a panel covering half the screen has to offer.
  useEffect(() => {
    if (!phone || !selected) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closeDay(true);
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (sideRef.current?.contains(target) || gridRef.current?.contains(target)) return;
      closeDay(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  });

  // A day low in the month would open under the panel; bring it up above it. The margin
  // that makes "nearest" mean "above the panel" is in styles.css.
  useEffect(() => {
    if (!phone || !selected) return;
    gridRef.current
      ?.querySelector(`[data-iso="${selected}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [phone, selected]);

  /** Arrows by day and week, Home and End to the week's ends — the grid pattern's keys. */
  function onCellKey(event: KeyboardEvent<HTMLButtonElement>, day: Date) {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let target: Date | null = null;
    if (event.key in step) target = addDays(day, step[event.key] as number);
    else if (event.key === "Home") target = addDays(day, -weekIndex(day));
    else if (event.key === "End") target = addDays(day, 6 - weekIndex(day));
    if (!target) return;
    event.preventDefault();
    const iso = isoOf(target);
    // Off the drawn grid is the neighbouring period, exactly as tapping a muted day is.
    if (!onGrid(iso)) goToDay(target);
    setFocusIso(iso);
    pendingFocus.current = iso;
  }

  function toggle(key: LayerKey) {
    setActive((was) => {
      const next = was.includes(key) ? was.filter((k) => k !== key) : [...was, key];
      // Turning the last layer off would leave an empty grid that reads as "no data" —
      // counting only the layers on screen, since a module that is off hides its own.
      const kept = next.some(layerOn) ? next : was;
      writeLayers(kept);
      return kept;
    });
  }

  /**
   * What a day holds, in words, for the wide layout.
   *
   * A mark is all that fits in a 43px phone cell, but a desktop cell is 142px and a row of
   * anonymous marks there is a puzzle rather than a summary — it makes you click a day to
   * learn it was the electricity bill. Each line carries its layer, which tints it with the
   * colour the phone's bars and the legend use (Epic 40.2), so the two layouts read alike.
   */
  function labelsFor(bucket: DayBucket, withAmounts: boolean): CellLine[] {
    const lines: CellLine[] = [];
    const add = (layer: LayerKey, rows: { text: string; amount?: string }[]) => {
      if (on(layer)) lines.push(...rows.map((row) => ({ layer, ...row })));
    };
    // Exact and signed, the way the day panel writes them; only where there is room.
    const sum = (value: string) => (withAmounts ? money.amount(value) : undefined);
    add(
      "money",
      bucket.entries.map((e) => ({
        text: categoryName(e.category_id),
        amount: sum(e.kind === "income" ? e.amount : `-${e.amount}`),
      })),
    );
    add(
      "savings",
      bucket.contributions.map((c) => ({
        text: savingsName(c.savings_type_id),
        // AD-50: a withdrawal is money out of the pot.
        amount: sum(c.kind === "withdrawal" ? `-${c.amount}` : c.amount),
      })),
    );
    add("stock", bucket.stock.map((row) => ({ text: row.item_name })));
    add("gym", bucket.workouts.map(() => ({ text: t("cal.workout") })));
    add("habits", bucket.checkins.map((row) => ({ text: row.habit_name })));
    add(
      "mood",
      bucket.moods.map((row) => ({ text: row.mood === null ? "Mood" : moodWord(row.mood) })),
    );
    add("meals", bucket.meals.map((row) => ({ text: row.recipe_name ?? row.food_name ?? "" })));
    add("due", [
      ...bucket.due.map((row) => ({ text: row.category_name, amount: sum(row.amount) })),
      ...bucket.expected.map((row) => ({ text: row.category_name, amount: sum(row.amount) })),
    ]);
    return lines;
  }

  /** Net for a day, in cents, so nothing is added as a float (AD-5). */
  function netCents(bucket: DayBucket): number {
    return bucket.entries.reduce(
      (total, entry) =>
        total + (entry.kind === "income" ? toCents(entry.amount) : -toCents(entry.amount)),
      0,
    );
  }

  const selectedBucket = selected ? (byDay.get(selected) ?? emptyBucket()) : null;

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 18, margin: 0 }}>{periodName}</h1>
          {!weekly && dates.monthRange(month, startDay) && (
            <p className="hint" style={{ margin: 0 }}>
              {dates.monthRange(month, startDay)}
            </p>
          )}
        </div>
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <ViewSwitch label="view.dashboardView" views={DASHBOARD_VIEWS} current="/calendar" />
          <div className="month-nav">
            <button
              type="button"
              className="quiet"
              aria-label={t(weekly ? "cal.previousWeek" : "month.previous")}
              onClick={() => turn(-1)}
            >
              ←
            </button>
            <label style={{ textTransform: "none" }}>
              {/* In the week, the month a week ends in — which is the month picked, since
                  a picked month opens on the week holding its first day. */}
              <input
                type="month"
                aria-label={t("dash.month")}
                value={weekly ? lastMonth : month}
                onChange={(event) => {
                  const next = event.target.value || budgetMonth(startDay);
                  if (weekly) goToDay(monthBounds(next, startDay)[0]);
                  else goToMonth(next);
                }}
              />
            </label>
            <button
              type="button"
              className="quiet"
              aria-label={t(weekly ? "cal.nextWeek" : "month.next")}
              onClick={() => turn(1)}
            >
              →
            </button>
            <button
              type="button"
              className="quiet"
              disabled={inPeriodIso(today) && (phone || selected === today)}
              onClick={() => {
                goToDay(dateOf(today));
                if (!phone) setSelected(today);
                setFocusIso(today);
              }}
            >
              {t("cal.today")}
            </button>
          </div>
        </div>
      </div>

      <ErrorBanner message={error} />
      {missing.length > 0 && !error && (
        <div className="error" role="status">
          {t(weekly ? "cal.partialWeek" : "cal.partial", {
            layers: missing.map((label) => (label === "Mood" ? label : t(label))).join(", "),
          })}
          {stale && t("cal.partialStale")}
        </div>
      )}

      <div className="cal-toolbar">
        <LayersMenu layers={available} isOn={on} onToggle={toggle} t={t} />
        {/* Two pressed-or-not buttons rather than a ViewSwitch: that one changes the page,
            this one changes how much of it the grid shows. */}
        <div className="cal-views" role="group" aria-label={t("cal.view")}>
          {(["month", "week"] as const).map((name) => (
            <button
              key={name}
              type="button"
              className="quiet"
              aria-pressed={view === name}
              onClick={() => changeView(name)}
            >
              {t(name === "month" ? "cal.viewMonth" : "cal.viewWeek")}
            </button>
          ))}
        </div>
      </div>

      {(on("money") || counted.length > 0) && (
        // A group, not a region: a named region is a landmark, and the day panel is the
        // page's one landmark besides the grid.
        <div role="group" aria-label={t("cal.summary", { month: periodName })}>
        <dl className="cal-summary">
          {on("money") && (
            <>
              <div>
                <dt>{t("cal.in")}</dt>
                <dd className="in">{money.amount(fromCents(summary.inCents))}</dd>
              </div>
              <div>
                <dt>{t("cal.out")}</dt>
                <dd className="out">{money.amount(fromCents(summary.outCents))}</dd>
              </div>
              <div>
                <dt>{t("dash.net")}</dt>
                <dd>{money.amount(fromCents(summary.inCents - summary.outCents))}</dd>
              </div>
            </>
          )}
          {counted.map((layer) => (
            <div key={layer.key} className="cal-count">
              <dt>
                <span className="cal-swatch" data-layer={layer.key} aria-hidden="true" />
                {layerName(layer, t)}
              </dt>
              <dd>{summary.counts.get(layer.key)}</dd>
            </div>
          ))}
        </dl>
        </div>
      )}

      <div className={`cal-layout${phone && selected ? " cal-sheet-open" : ""}`}>
      <Card>
        <div
          ref={gridRef}
          className={weekly ? "cal-grid week" : "cal-grid"}
          role="grid"
          aria-label={
            weekly
              ? t("cal.weekGridAria", { range: periodName })
              : t("cal.gridAria", { month: dates.month(month) })
          }
          onTouchStart={onSwipeStart}
          onTouchEnd={onSwipeEnd}
        >
          {/* The week names its own days in each cell: on a phone they are stacked, and a
              row of headings would sit over the first one only. */}
          {!weekly && (
            // biome-ignore lint/a11y/useFocusableInteractive: the cells are the buttons; a row only groups them
            <div className="cal-head" role="row">
              {[0, 1, 2, 3, 4, 5, 6].map((weekday) => (
                // biome-ignore lint/a11y/useFocusableInteractive: a weekday heading has nothing to do on focus
                <div key={weekday} role="columnheader" className="cal-weekday">
                  {dates.weekdayShort(weekday)}
                </div>
              ))}
            </div>
          )}
          {weeks.map((row) => (
            // biome-ignore lint/a11y/useFocusableInteractive: the cells are the buttons; a row only groups them
            <div key={isoOf(row[0] as Date)} className="cal-week" role="row">
              {row.map((day) => {
                const iso = isoOf(day);
                const inPeriod = day >= periodStart && day <= periodEnd;
                const bucket = byDay.get(iso);
                const net = bucket && on("money") ? netCents(bucket) : 0;
                // Every layer with something on the day, in the fixed order of LAYERS, so a
                // bar's place says which layer it is as well as its colour does.
                const present = bucket
                  ? LAYERS.filter((layer) => on(layer.key) && countIn(bucket, layer.key) > 0)
                  : [];
                // The net already names money in the label; a day that nets to zero does not.
                const named = net ? present.filter((layer) => layer.key !== "money") : present;
                // The week draws every line, with its amount (Epic 40.4); the month keeps a
                // busy day as tall as any other.
                const lines = inPeriod && bucket ? labelsFor(bucket, weekly) : [];
                const drawn =
                  !weekly && lines.length > CELL_LINES ? lines.slice(0, CELL_LINES - 1) : lines;
                // Built in pieces rather than one template: a day's accessible name is
                // a date, then optionally a net, then optionally a list of layers, and
                // French joins those differently from English.
                const withNet = net
                  ? t("cal.dayNet", { date: iso, amount: money.plain(fromCents(net)) })
                  : iso;
                const label = inPeriod
                  ? named.length
                    ? t("cal.dayWith", {
                        label: withNet,
                        layers: named.map((d) => layerName(d, t)).join(", "),
                      })
                    : withNet
                  : t("cal.dayOutside", {
                      date: iso,
                      month: dates.month(monthOf(day, startDay)),
                    });
                return (
                  <button
                    key={iso}
                    type="button"
                    role="gridcell"
                    // Outside the period, the cell is still a way in: it moves to the period
                    // that day belongs to rather than pretending nothing happened on it.
                    className={[
                      "cal-day",
                      inPeriod ? "" : "outside",
                      selected === iso ? "on" : "",
                      iso === today ? "today" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    data-iso={iso}
                    tabIndex={iso === tabbable ? 0 : -1}
                    aria-label={label}
                    aria-selected={selected === iso}
                    aria-current={iso === today ? "date" : undefined}
                    onKeyDown={(event) => onCellKey(event, day)}
                    onFocus={() => setFocusIso(iso)}
                    onClick={() => {
                      if (!inPeriod) {
                        goToDay(day);
                        setFocusIso(iso);
                        return;
                      }
                      // On a phone a second tap puts the panel away; beside the grid the
                      // panel is always there, so a tap only ever chooses.
                      setSelected(phone && selected === iso ? null : iso);
                    }}
                  >
                    <span className="cal-num">
                      {weekly ? `${dates.weekdayShort(weekIndex(day))} ${day.getDate()}` : day.getDate()}
                    </span>
                    {inPeriod && net !== 0 && (
                      // Rounded to whole units in a month's cell, exact in the day panel —
                      // a cell is about 47px wide on a phone and two decimals do not fit.
                      // The week has the room, so it is exact there too. The rounding is
                      // display only; the arithmetic above is in cents.
                      <span className={`cal-net ${net > 0 ? "in" : "out"}`}>
                        {weekly
                          ? `${net > 0 ? "+" : ""}${money.amount(fromCents(net))}`
                          : `${net > 0 ? "+" : "−"}${Math.abs(Math.round(net / 100))}`}
                      </span>
                    )}
                    {drawn.length > 0 && (
                      <span className="cal-lines" aria-hidden="true">
                        {drawn.map((line, index) => (
                          <span
                            // biome-ignore lint/suspicious/noArrayIndexKey: two lines can read the same; never reordered
                            key={`${line.text}-${index}`}
                            className="cal-line"
                            data-layer={line.layer}
                          >
                            <span className="cal-line-text">{line.text}</span>
                            {line.amount && <span className="cal-line-amount">{line.amount}</span>}
                          </span>
                        ))}
                        {lines.length > drawn.length && (
                          <span className="cal-line more">
                            {t("cal.more", { count: lines.length - drawn.length })}
                          </span>
                        )}
                      </span>
                    )}
                    {inPeriod && present.length > 0 && (
                      // The phone's summary: one bar per layer, full width, in LAYERS order.
                      <span className="cal-bars" aria-hidden="true">
                        {present.map((layer) => (
                          <span key={layer.key} className="cal-bar" data-layer={layer.key} />
                        ))}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <ul className="cal-legend" aria-label={t("cal.legend")}>
          {LAYERS.filter((layer) => on(layer.key)).map((layer) => (
            <li key={layer.key}>
              <span className="cal-swatch" data-layer={layer.key} aria-hidden="true" />
              {layerName(layer, t)}
            </li>
          ))}
        </ul>
        <p className="hint" style={{ marginTop: 10 }}>
          {t(weekly ? "cal.gridHintWeek" : "cal.gridHint")}
          {phone && ` ${t(weekly ? "cal.swipeHintWeek" : "cal.swipeHint")}`}
        </p>
      </Card>


      <div
        ref={sideRef}
        className="cal-side"
        role="region"
        aria-label={selected ? dates.day(selected) : t("cal.dayPanel")}
        hidden={phone && !selected}
      >
        {selected && selectedBucket ? (
          <Card
            title={dates.day(selected)}
            actions={
              <>
                {/* On a phone the words beside Close pushed the date onto a line of its own
                    (92px of a 45vh panel, 40.1); a sign named by its label does not. */}
                <button
                  type="button"
                  className={phone ? "quiet cal-close" : "quiet"}
                  aria-label={phone ? t("cal.addOnThisDay") : undefined}
                  onClick={() => navigate(`/entries?add=1&date=${selected}`)}
                >
                  {phone ? "+" : t("cal.addOnThisDay")}
                </button>
                {phone && (
                  <button
                    type="button"
                    className="quiet cal-close"
                    aria-label={t("cal.closeDay")}
                    onClick={() => closeDay(true)}
                  >
                    ×
                  </button>
                )}
              </>
            }
          >
            <DayDetail
              bucket={selectedBucket}
              active={shownActive}
              categoryName={categoryName}
              savingsName={savingsName}
              t={t}
            />
          </Card>
        ) : (
          <Card>
            <p className="hint" style={{ margin: 0 }}>
              {t("cal.pickADay")}
            </p>
          </Card>
        )}
      </div>
      </div>

      {/* A line from a book, when one is kept (Epic 31). Absent otherwise. */}
      {modules.books && <QuoteCard collapseKey="calendar.quote" />}

      {loading && <p className="hint">{t("state.loading")}</p>}
    </>
  );
}

/**
 * The layers, as one menu rather than a row of eight chips (Epic 40.2).
 *
 * The chips took two or three lines of a phone's screen above the month, every visit, for a
 * choice made once. The button says how many are on, so a hidden layer is never a surprise.
 * A disclosure, not a modal, for MoodCheckin's reasons: Escape and a tap outside put it
 * away, nothing is trapped. The last layer on cannot be turned off — an empty grid reads as
 * "no data" — and its box says so by being disabled rather than by ignoring a click.
 */
function LayersMenu({
  layers,
  isOn,
  onToggle,
  t,
}: {
  layers: typeof LAYERS;
  isOn: (key: LayerKey) => boolean;
  onToggle: (key: LayerKey) => void;
  t: Translate;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const count = layers.filter((layer) => isOn(layer.key)).length;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <div className="cal-layers" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className="quiet cal-layers-button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((was) => !was)}
      >
        {t("cal.layersCount", { on: count, total: layers.length })}{" "}
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <fieldset id={panelId} className="card cal-layers-panel">
          <legend className="visually-hidden">{t("cal.layers")}</legend>
          {layers.map((layer) => {
            const checked = isOn(layer.key);
            return (
              <label key={layer.key} className="check cal-layer-option">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={checked && count === 1}
                  onChange={() => onToggle(layer.key)}
                />
                <span className="cal-swatch" data-layer={layer.key} aria-hidden="true" />
                {layerName(layer, t)}
              </label>
            );
          })}
        </fieldset>
      )}
    </div>
  );
}

function DayDetail({
  bucket,
  active,
  categoryName,
  savingsName,
  t,
}: {
  bucket: DayBucket;
  active: LayerKey[];
  categoryName: (id: string) => string;
  savingsName: (id: string) => string;
  t: Translate;
}) {
  const money = useMoney();
  const on = (key: LayerKey) => active.includes(key);

  /** A meal's own energy, already derived on the server; blank when it carried none. */
  const kcalOf = (meal: Meal): string | null => {
    const shown = formatEnergy(meal.nutrition.kcal);
    return shown === null ? null : `${shown} ${t("rec.kcalUnit")}`;
  };

  const rows: React.ReactNode[] = [];

  if (on("money")) {
    for (const entry of bucket.entries) {
      rows.push(
        <li key={`e-${entry.id}`}>
          <span className={`tag ${entry.kind}`}>
            {entry.kind === "income" ? t("cal.tagIn") : t("cal.tagOut")}
          </span>{" "}
          {/* The way back to the record: the category page holds this entry and its
              history, and is the only page that can be linked to by id. */}
          <Link to={`/categories/${entry.category_id}`}>{categoryName(entry.category_id)}</Link>{" "}
          <strong>{money.amount(entry.amount)}</strong>
          {entry.note ? <span className="hint"> — {entry.note}</span> : null}
        </li>,
      );
    }
  }
  if (on("savings")) {
    for (const row of bucket.contributions) {
      rows.push(
        <li key={`c-${row.id}`}>
          {/* AD-50: a withdrawal is money out of the pot, never "saved". */}
          <span className="tag">
            {t(row.kind === "withdrawal" ? "pots.withdrawal" : "cal.tagSaved")}
          </span>{" "}
          <Link to="/plan">{savingsName(row.savings_type_id)}</Link>{" "}
          <strong>
            {money.amount(row.kind === "withdrawal" ? `-${row.amount}` : row.amount)}
          </strong>
        </li>,
      );
    }
  }
  if (on("stock")) {
    for (const row of bucket.stock) {
      const added = row.quantity_before === row.quantity_after;
      rows.push(
        <li key={`s-${row.item_id}-${row.changed_at}`}>
          <span className="tag">{t("cal.tagStock")}</span>{" "}
          <Link to="/inventory">{row.item_name}</Link>{" "}
          {added
            ? t("cal.stockAdded", { quantity: row.quantity_after })
            : t("cal.stockMoved", {
                before: row.quantity_before,
                after: row.quantity_after,
              })}
        </li>,
      );
    }
  }
  if (on("gym")) {
    for (const row of bucket.workouts) {
      rows.push(
        <li key={`w-${row.id}`}>
          <span className="tag">{t("cal.tagGym")}</span>{" "}
          <Link to="/gym">{t("cal.workout")}</Link>
          {row.note ? <span className="hint"> — {row.note}</span> : null}
        </li>,
      );
    }
  }
  if (on("habits")) {
    for (const row of bucket.checkins) {
      rows.push(
        <li key={`h-${row.id}`}>
          <span className="tag">{t("cal.tagHabit")}</span>{" "}
          <Link to="/habits">{row.habit_name}</Link>
          {/* One row per occurrence since Epic 26, so three doses are three lines rather
              than one line with a multiplier — and each one can say what time it was. */}
          {row.done_at ? <span className="hint"> {timeLabel(row.done_at)}</span> : null}
          {row.note ? <span className="hint"> — {row.note}</span> : null}
        </li>,
      );
    }
  }
  if (on("mood")) {
    for (const row of bucket.moods) {
      rows.push(
        <li key={`m-${row.on}`}>
          <span className="tag">mood</span>{" "}
          {row.mood !== null && (
            <>
              <MoodFace point={row.mood} size={16} />{" "}
            </>
          )}
          <Link to="/habits">{row.mood === null ? "no face" : moodWord(row.mood)}</Link>
          {/* Three states, kept apart: nothing is said about a day nobody judged. */}
          {row.day_ok === null ? "" : row.day_ok ? " — a good day" : " — not a good day"}
          {row.note ? <span className="hint"> — {row.note}</span> : null}
        </li>,
      );
    }
  }
  if (on("meals")) {
    for (const row of bucket.meals) {
      rows.push(
        <li key={`f-${row.id}`}>
          <span className="tag">{t("cal.tagMeal")}</span>{" "}
          <Link to={row.recipe_id ? `/recipes/${row.recipe_id}` : "/recipes"}>
            {row.recipe_name ?? row.food_name}
          </Link>{" "}
          {/* Servings for a recipe, a quantity for a bare food — the two shapes a meal log
              may take, and the row carries exactly one of them. */}
          <span className="hint">
            {row.servings === null
              ? `${trim(row.quantity ?? "")}${row.unit === "unit" ? "" : ` ${row.unit}`}`
              : `× ${trim(row.servings)}`}
          </span>
          {kcalOf(row) ? <strong> {kcalOf(row)}</strong> : null}
          {row.note ? <span className="hint"> — {row.note}</span> : null}
        </li>,
      );
    }
    // One line for the day, summed in whole ten-thousandths the way the money line is
    // summed in whole cents. Null when nothing eaten carried a calorie figure — which is
    // not the same as having eaten nothing.
    const energy = formatEnergy(sumEnergy(bucket.meals));
    if (energy !== null) {
      rows.push(
        <li key="f-total" className="hint">
          {t("cal.dayEnergy", { kcal: energy })}
        </li>,
      );
    }
  }
  if (on("due")) {
    for (const row of bucket.due) {
      rows.push(
        <li key={`p-${row.id}`}>
          <span className="tag due">{t("cal.tagWaiting")}</span>{" "}
          <Link to="/">{row.category_name}</Link>{" "}
          <strong>{money.amount(row.amount)}</strong>
          <span className="hint">{t("cal.proposedNotRecorded")}</span>{" "}
          <AddToCalendar
            name={row.category_name}
            event={dueEvent(
              row.template_id,
              row.due_on,
              row.category_name,
              money.amount(row.amount),
              row.note,
            )}
          />
        </li>,
      );
    }
    for (const row of bucket.expected) {
      rows.push(
        <li key={`x-${row.template_id}-${row.due_on}`}>
          <span className="tag expected">{t("cal.tagExpected")}</span>{" "}
          <Link to="/plan">{row.category_name}</Link> <strong>{money.amount(row.amount)}</strong>
          {/* A forecast, computed and never written (AD-39). There is no row yet, so there
              is nothing here to confirm or skip — saying so is the point. */}
          <span className="hint">
            {row.auto ? t("cal.willBeAutomatic") : t("cal.willBeProposed")}
          </span>{" "}
          <AddToCalendar
            name={row.category_name}
            event={dueEvent(
              row.template_id,
              row.due_on,
              row.category_name,
              money.amount(row.amount),
              row.note,
            )}
          />
        </li>,
      );
    }
  }

  if (rows.length === 0) return <Empty>{t("cal.emptyDay")}</Empty>;
  return <ul className="day-list">{rows}</ul>;
}
