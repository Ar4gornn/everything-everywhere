import type {
  CardId,
  Layout,
  LayoutName,
  ModuleId,
  NotificationKind,
  Preferences,
  PreferencesPatch,
  SectionId,
  StreakModuleId,
  User,
} from "../api/types";

/**
 * The account's layout preferences on the client (Epic 33, AD-49).
 *
 * The server always answers resolved, so the only default the client needs is for a
 * server older than migration 0025, which sends no `preferences` at all. It is the app as
 * it was, and it must stay equal to the server's `resolve({})` — both sides pin the same
 * literal in their tests.
 */
const SECTIONS: [SectionId, "bar" | "top"][] = [
  ["dashboard", "bar"],
  ["entries", "bar"],
  ["habits", "bar"],
  ["stock", "bar"],
  ["gym", "bar"],
  ["plan", "top"],
  ["grow", "top"],
  ["recipes", "top"],
];
export const MODULES: ModuleId[] = ["habits", "books", "mood", "stock", "gym", "recipes", "notes", "moon"];
export const CARDS: CardId[] = [
  "stats",
  "streaks",
  "gym",
  "pending",
  "leftover",
  "reading",
  "quote",
  "restock",
  "budgets",
  "savings",
  "trends",
  "categories",
];
/** Epic 41 (AD-57): the module streaks, in Settings order. All off by default. */
export const STREAKS: StreakModuleId[] = [
  "entries",
  "plan",
  "grow",
  "habits",
  "mood",
  "books",
  "stock",
  "gym",
  "recipes",
  "notes",
];
export const LAYOUTS: LayoutName[] = ["phone", "desktop"];

/** Epic 36 (AD-52): what the digest may mention, in Settings order, and each default —
 *  what existed before stays on, the two new kinds are opt-in. Pinned against the server. */
export const NOTIFICATIONS: [NotificationKind, boolean][] = [
  ["stock", true],
  ["recurring", true],
  ["habits", true],
  ["due_tomorrow", false],
  ["savings", false],
  ["streak", false],
  ["moon", false],
];

function defaultLayout() {
  return {
    tabs: SECTIONS.map(([id, slot]) => ({ id, slot })),
    cards: CARDS.map((id) => ({ id, on: true })),
  };
}

export const DEFAULT_PREFERENCES: Preferences = {
  modules: Object.fromEntries(MODULES.map((id) => [id, true])) as Record<ModuleId, boolean>,
  notifications: Object.fromEntries(NOTIFICATIONS) as Record<NotificationKind, boolean>,
  streaks: Object.fromEntries(STREAKS.map((id) => [id, false])) as Record<StreakModuleId, boolean>,
  points_name: null,
  moon_hemisphere: null,
  phone: defaultLayout(),
  desktop: defaultLayout(),
};

/** The account's preferences, or the app as it was when the server predates them. */
export function preferencesOf(user: User | null | undefined): Preferences {
  if (!user?.preferences) return DEFAULT_PREFERENCES;
  const { notifications, streaks, points_name } = user.preferences;
  // A server between 0025 and 0028 resolves everything but the notification kinds, and one
  // older than Epic 41 has no streak switches: each falls back to its default.
  return notifications && streaks && points_name !== undefined
    ? user.preferences
    : {
        ...user.preferences,
        notifications: notifications ?? DEFAULT_PREFERENCES.notifications,
        streaks: streaks ?? DEFAULT_PREFERENCES.streaks,
        points_name: points_name ?? null,
      };
}

/**
 * The tab streaks to show: the preference is on **and** its module is on (§2.7). A core
 * section (entries, plan, grow) has no module and cannot be off. Off hides UI only, so the
 * streak goes on earning while it is out of sight.
 */
export function shownStreaks(prefs: Preferences): StreakModuleId[] {
  return STREAKS.filter((id) => {
    const module = STREAK_MODULE[id];
    return prefs.streaks[id] && (module === undefined || prefs.modules[module]);
  });
}

/** The module that hides a streak when it is off; none for the three core sections. */
export const STREAK_MODULE: Partial<Record<StreakModuleId, ModuleId>> = {
  habits: "habits",
  books: "books",
  mood: "mood",
  stock: "stock",
  gym: "gym",
  recipes: "recipes",
  notes: "notes",
};

/** What the server does with a patch: each top-level key present replaces that subtree. */
export function applyPatch(prefs: Preferences, patch: PreferencesPatch): Preferences {
  return { ...prefs, ...patch };
}

/**
 * Saves preferences one request at a time, and shows the person their latest choice at once.
 *
 * **One request in flight, never two.** The server applies patches in the order they
 * *arrive*, not the order they were asked; two in flight could land the older one last and
 * leave the account disagreeing with the screen. So a change made while a request is out is
 * queued, and changes queued together are merged — they replace whole subtrees, so the
 * merge is exactly what sending them in turn would have done — and sent as one.
 *
 * **What is shown** is always the last state the server confirmed with the in-flight and
 * queued patches laid over it. A request that fails drops its own patch and nothing else:
 * the screen falls back to the confirmed state plus whatever is still queued, and the
 * promise each caller got for that patch rejects, so the control that asked can say so.
 */
export class PreferenceSaver {
  private confirmed: Preferences;
  private inflight: PreferencesPatch | null = null;
  private queued: PreferencesPatch | null = null;
  private waiting: { resolve: () => void; reject: (error: unknown) => void }[] = [];

  constructor(
    initial: Preferences,
    private readonly send: (patch: PreferencesPatch) => Promise<Preferences>,
    private readonly onChange: (shown: Preferences) => void,
  ) {
    this.confirmed = initial;
  }

  /** What the screen should show now. */
  get shown(): Preferences {
    return applyPatch(applyPatch(this.confirmed, this.inflight ?? {}), this.queued ?? {});
  }

  /** The server said so from elsewhere (a profile refresh): adopt it under anything pending. */
  confirm(prefs: Preferences): void {
    this.confirmed = prefs;
    this.onChange(this.shown);
  }

  update(patch: PreferencesPatch): Promise<void> {
    this.queued = { ...this.queued, ...patch };
    const done = new Promise<void>((resolve, reject) => {
      this.waiting.push({ resolve, reject });
    });
    this.onChange(this.shown);
    if (this.inflight === null) void this.drain();
    return done;
  }

  private async drain(): Promise<void> {
    while (this.queued !== null) {
      const patch = this.queued;
      const callers = this.waiting;
      this.queued = null;
      this.waiting = [];
      this.inflight = patch;
      try {
        this.confirmed = await this.send(patch);
        this.inflight = null;
        this.onChange(this.shown);
        for (const caller of callers) caller.resolve();
      } catch (error) {
        this.inflight = null;
        this.onChange(this.shown);
        for (const caller of callers) caller.reject(error);
      }
    }
  }
}

type Tab = Layout["tabs"][number];
type Slot = Tab["slot"];

/** A phone's tab bar holds five and its top bar three (measured, AD-49); a desktop has room. */
export const PHONE_CAPS: Record<Slot, number> = { bar: 5, top: 3 };

const other = (slot: Slot): Slot => (slot === "bar" ? "top" : "bar");

/** Tab bar first, then top bar, each in its own order: the one shape the editor writes. */
export function normalizeTabs(tabs: Tab[]): Tab[] {
  return [...tabs.filter((t) => t.slot === "bar"), ...tabs.filter((t) => t.slot === "top")];
}

/** One place up (-1) or down (+1) within its own slot. Unchanged at either end. */
export function moveTab(tabs: Tab[], id: SectionId, step: -1 | 1): Tab[] {
  const list = normalizeTabs(tabs);
  const from = list.findIndex((t) => t.id === id);
  const to = from + step;
  const tab = list[from];
  const neighbour = list[to];
  if (!tab || !neighbour || neighbour.slot !== tab.slot) return list;
  list[from] = neighbour;
  list[to] = tab;
  return list;
}

/**
 * Who comes back across when `id` moves to the other slot, or null if nobody has to.
 *
 * On a phone both slots are full whenever every section exists — the caps add up to the
 * eight sections — so a move across is a swap: the last of the full slot takes the moving
 * section's place. Saying who, before the tap, is what makes that a choice rather than a
 * surprise.
 */
export function swapPartner(tabs: Tab[], id: SectionId, layout: LayoutName): SectionId | null {
  const tab = tabs.find((t) => t.id === id);
  if (!tab || layout !== "phone") return null;
  const target = normalizeTabs(tabs).filter((t) => t.slot === other(tab.slot));
  return target.length >= PHONE_CAPS[other(tab.slot)] ? (target.at(-1)?.id ?? null) : null;
}

/** Move `id` to the end of the other slot, swapping per `swapPartner` when that slot is full. */
export function switchSlot(tabs: Tab[], id: SectionId, layout: LayoutName): Tab[] {
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return normalizeTabs(tabs);
  const partner = swapPartner(tabs, id, layout);
  const list = normalizeTabs(tabs);
  if (partner) {
    // The partner steps into the mover's place; the mover goes last in the partner's slot,
    // which is exactly where the partner was.
    return normalizeTabs(
      list.map((t) =>
        t.id === id ? { id: partner, slot: tab.slot } : t.id === partner ? { id, slot: other(tab.slot) } : t,
      ),
    );
  }
  return normalizeTabs([...list.filter((t) => t.id !== id), { id, slot: other(tab.slot) }]);
}

type Card = Layout["cards"][number];

/** One dashboard card one place up (-1) or down (+1). Unchanged at either end. */
export function moveCard(cards: Card[], id: CardId, step: -1 | 1): Card[] {
  const list = [...cards];
  const from = list.findIndex((c) => c.id === id);
  const to = from + step;
  const card = list[from];
  const neighbour = list[to];
  if (!card || !neighbour) return list;
  list[from] = neighbour;
  list[to] = card;
  return list;
}
