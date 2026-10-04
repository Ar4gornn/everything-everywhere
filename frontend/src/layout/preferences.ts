import type {
  CardId,
  NavItem,
  NavItemId,
  ClockHours,
  ClockPlace,
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
import { NAV_DEFS } from "../nav/model";
import { ApiError } from "../api/client";

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
export const MODULES: ModuleId[] = [
  "habits",
  "books",
  "mood",
  "stock",
  "gym",
  "recipes",
  "notes",
  "moon",
  "clocks",
];
export const CARDS: CardId[] = [
  "stats",
  "streaks",
  "clocks",
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

/** Epic 52 (AD-65): every place, default order (mirrors `NAV_ITEMS` server-side). The
 *  list leads with the pinned four in bar order; drawer and sidebar group the rest. */
export const NAV_ITEMS: NavItemId[] = [
  "dashboard",
  "entries",
  "habits",
  "plan",
  "calendar",
  "books",
  "notes",
  "grow",
  "stock",
  "recipes",
  "gym",
  "clocks",
  "moon",
];
/** A desktop's default order: the sidebar's group order (`NAV_DEFS[*].group`), so its list
 *  reads as the sidebar draws it. A phone keeps `NAV_ITEMS`, the bar first. Server-side
 *  `NAV_ITEMS_GROUPED`. */
export const NAV_ITEMS_GROUPED: NavItemId[] = [
  "dashboard",
  "calendar",
  "habits",
  "books",
  "notes",
  "entries",
  "plan",
  "grow",
  "stock",
  "recipes",
  "gym",
  "clocks",
  "moon",
];
const catalogueOf = (name: LayoutName): NavItemId[] =>
  name === "phone" ? NAV_ITEMS : NAV_ITEMS_GROUPED;
export const NAV_DEFAULT_PINNED: NavItemId[] = ["dashboard", "entries", "habits", "plan"];
/** A phone's bottom bar: this many pinned places, then More. */
export const PHONE_PIN_CAP = 4;

export function defaultItems(name: LayoutName = "phone"): NavItem[] {
  return catalogueOf(name).map((id) => ({ id, pinned: NAV_DEFAULT_PINNED.includes(id) }));
}

function defaultLayout(name: LayoutName) {
  return {
    tabs: SECTIONS.map(([id, slot]) => ({ id, slot })),
    cards: CARDS.map((id) => ({ id, on: true })),
    items: defaultItems(name),
  };
}

/** Pinned places that are in the bar: a place whose module is off takes no slot. */
export function barCount(items: NavItem[], modules?: Record<ModuleId, boolean>): number {
  return items.filter((item) => {
    if (!item.pinned) return false;
    const module = NAV_DEFS[item.id]?.module;
    return !module || !modules || modules[module];
  }).length;
}

/**
 * A layout's places. The server resolves `items` (AD-65); this only covers a server older
 * than Epic 52, deriving them from `tabs` exactly as the server's `_resolve_items` does.
 */
export function itemsOf(layout: Layout, name: LayoutName = "phone"): NavItem[] {
  if (layout.items) return layout.items;
  const pinned = layout.tabs
    .filter((tab) => tab.slot === "bar")
    .map((tab) => tab.id as NavItemId)
    .slice(0, PHONE_PIN_CAP);
  return [
    ...pinned.map((id) => ({ id, pinned: true })),
    ...catalogueOf(name)
      .filter((id) => !pinned.includes(id))
      .map((id) => ({ id, pinned: false })),
  ];
}

/** Customise (AD-65): pin a place; refused (returns the list unchanged) when the bar already
 *  holds `PHONE_PIN_CAP`, or the place is already pinned or unknown. A newly pinned place goes
 *  last in the bar, i.e. straight after the last pinned place in the list. With `modules`,
 *  a pinned place whose module is off takes no slot (the server counts the same way). */
export function pinItem(
  items: NavItem[],
  id: NavItemId,
  modules?: Record<ModuleId, boolean>,
): NavItem[] {
  const item = items.find((i) => i.id === id);
  if (!item || item.pinned || barCount(items, modules) >= PHONE_PIN_CAP) return items;
  const rest = items.filter((i) => i.id !== id);
  const after = rest.map((i) => i.pinned).lastIndexOf(true);
  return [...rest.slice(0, after + 1), { id, pinned: true }, ...rest.slice(after + 1)];
}

/** Unpin a place; it returns to its group in the drawer, at its default place among the
 *  unpinned (before the first unpinned place that comes later in `NAV_ITEMS`). */
export function unpinItem(items: NavItem[], id: NavItemId): NavItem[] {
  const item = items.find((i) => i.id === id);
  if (!item?.pinned) return items;
  const rest = items.filter((i) => i.id !== id);
  const mine = NAV_ITEMS.indexOf(id);
  const before = rest.findIndex((i) => !i.pinned && NAV_ITEMS.indexOf(i.id) > mine);
  const at = before === -1 ? rest.length : before;
  return [...rest.slice(0, at), { id, pinned: false }, ...rest.slice(at)];
}

/** Move a place one step within its own list: among the pinned (bar order), or among the
 *  unpinned of its group (drawer/sidebar order). A move past either end is a no-op. */
export function moveItem(items: NavItem[], id: NavItemId, step: -1 | 1): NavItem[] {
  const from = items.findIndex((i) => i.id === id);
  const item = items[from];
  if (!item) return items;
  const peers = (other: NavItem) =>
    other.pinned === item.pinned && (item.pinned || NAV_DEFS[other.id].group === NAV_DEFS[id].group);
  const lane = items.map((other, index) => (peers(other) ? index : -1)).filter((index) => index >= 0);
  const to = lane[lane.indexOf(from) + step];
  const neighbour = to === undefined ? undefined : items[to];
  if (to === undefined || !neighbour) return items;
  const next = [...items];
  next[from] = neighbour;
  next[to] = item;
  return next;
}

/** Epic 48 (AD-64): places besides the account's own zone; the server refuses a 13th. */
export const CLOCKS_MAX = 12;
/** Until the person sets their own in Settings. Mirrors `CLOCK_HOURS_DEFAULT` server-side. */
export const CLOCK_HOURS_DEFAULT: ClockHours = {
  work: ["09:00", "18:00"],
  night: ["23:00", "07:00"],
};

export const DEFAULT_PREFERENCES: Preferences = {
  modules: Object.fromEntries(MODULES.map((id) => [id, true])) as Record<ModuleId, boolean>,
  notifications: Object.fromEntries(NOTIFICATIONS) as Record<NotificationKind, boolean>,
  streaks: Object.fromEntries(STREAKS.map((id) => [id, false])) as Record<StreakModuleId, boolean>,
  points_name: null,
  moon_hemisphere: null,
  clocks: [],
  clock_hours: CLOCK_HOURS_DEFAULT,
  calendar_zone: null,
  phone: defaultLayout("phone"),
  desktop: defaultLayout("desktop"),
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
  // A layout patch may leave `tabs` out (the new client never writes them): it lays over the
  // layout it replaces rather than dropping what it does not mention.
  const { phone, desktop, ...rest } = patch;
  return {
    ...prefs,
    ...rest,
    ...(phone ? { phone: { ...prefs.phone, ...phone } } : {}),
    ...(desktop ? { desktop: { ...prefs.desktop, ...desktop } } : {}),
  };
}

/** Preferences as the server sent them, with the version a later write must name. */
export interface Versioned {
  prefs: Preferences;
  /** `preferences_version`, or null from a server older than the check (nothing is sent). */
  version: string | null;
}

/** The server refused a write because the account changed since this client read it. */
export function isPreferencesChanged(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && error.code === "preferences_changed";
}

/** Same JSON value, whatever order an object's keys were written in. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => Object.hasOwn(right, key) && same(left[key], right[key]));
}

/** How many times one patch is re-based on a fresh read before the saver gives up. */
const REBASES = 3;

type PatchKey = keyof PreferencesPatch;

interface Caller {
  keys: PatchKey[];
  resolve: () => void;
  reject: (error: unknown) => void;
}

/** The subtrees another device changed first, and the refusal their callers are given. */
interface Lost {
  keys: Set<PatchKey>;
  error: unknown;
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
 *
 * **Never over a newer change.** Each write names the version it was made against. A tab
 * left open for days remembers subtrees another device has since changed; the server
 * refuses its write (409) and the saver re-reads the account. A subtree nobody else touched
 * is still this tab's to write and is sent again on the fresh version; one that changed
 * elsewhere keeps the other device's value, and the callers that asked for it are rejected
 * so their controls say the save did not happen.
 *
 * **Reads never undo writes.** A profile read that started before a write was sent or
 * answered may describe the account before that write; `confirm` with the read's `stamp`
 * ignores it, rather than briefly showing the person their change undone.
 */
export class PreferenceSaver {
  private confirmed: Preferences;
  private version: string | null;
  private readonly reload: (() => Promise<Versioned>) | null;
  private inflight: PreferencesPatch | null = null;
  private queued: PreferencesPatch | null = null;
  private waiting: Caller[] = [];
  private clock = 0;
  private lastWrite = 0;
  private lastRead = 0;

  constructor(
    initial: Preferences,
    private readonly send: (patch: PreferencesPatch, version: string | null) => Promise<Versioned>,
    private readonly onChange: (shown: Preferences) => void,
    options: { version?: string | null; reload?: () => Promise<Versioned> } = {},
  ) {
    this.confirmed = initial;
    this.version = options.version ?? null;
    this.reload = options.reload ?? null;
  }

  /** What the screen should show now. */
  get shown(): Preferences {
    return applyPatch(applyPatch(this.confirmed, this.inflight ?? {}), this.queued ?? {});
  }

  /** Taken just before a profile read starts, and handed back to `confirm` with its answer. */
  stamp(): number {
    this.clock += 1;
    return this.clock;
  }

  /**
   * The server said so from elsewhere (a profile read): adopt it under anything pending.
   * With a `stamp`, a read older than the last write or the last adopted read is ignored.
   * Returns whether it was adopted.
   */
  confirm(prefs: Preferences, version: string | null = null, stamp?: number): boolean {
    if (stamp !== undefined) {
      if (stamp < this.lastWrite || stamp < this.lastRead) return false;
      this.lastRead = stamp;
    }
    this.confirmed = prefs;
    this.version = version;
    this.onChange(this.shown);
    return true;
  }

  update(patch: PreferencesPatch): Promise<void> {
    this.queued = { ...this.queued, ...patch };
    const done = new Promise<void>((resolve, reject) => {
      this.waiting.push({ keys: Object.keys(patch) as PatchKey[], resolve, reject });
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
        const lost = await this.save(patch);
        this.inflight = null;
        this.onChange(this.shown);
        for (const caller of callers) {
          if (caller.keys.some((key) => lost.keys.has(key))) caller.reject(lost.error);
          else caller.resolve();
        }
      } catch (error) {
        this.inflight = null;
        this.onChange(this.shown);
        for (const caller of callers) caller.reject(error);
      }
    }
  }

  /** Writes `patch`, re-basing it on a fresh read when the server says the account moved. */
  private async save(patch: PreferencesPatch): Promise<Lost> {
    const lost: Lost = { keys: new Set(), error: null };
    let toSend = patch;
    for (let attempt = 0; ; attempt++) {
      const base = this.confirmed;
      this.lastWrite = this.stamp();
      try {
        const saved = await this.send(toSend, this.version);
        this.lastWrite = this.stamp();
        this.confirmed = saved.prefs;
        this.version = saved.version;
        return lost;
      } catch (error) {
        this.lastWrite = this.stamp();
        if (!isPreferencesChanged(error) || this.reload === null || attempt >= REBASES) {
          throw error;
        }
        const fresh = await this.reload();
        this.lastWrite = this.stamp();
        this.confirmed = fresh.prefs;
        this.version = fresh.version;
        const next: Record<string, unknown> = {};
        for (const key of Object.keys(toSend) as PatchKey[]) {
          const mine = toSend[key];
          // Untouched elsewhere: still this tab's to write. Changed elsewhere to exactly what
          // this tab asked for: nothing left to do. Anything else: the other device wins.
          if (same(fresh.prefs[key], base[key])) next[key] = mine;
          else if (!same(fresh.prefs[key], mine)) {
            lost.keys.add(key);
            lost.error = error;
          }
        }
        toSend = next as PreferencesPatch;
        this.inflight = toSend;
        this.onChange(this.shown);
        if (Object.keys(toSend).length === 0) return lost;
      }
    }
  }
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

/** Epic 48 (AD-64): the places, defaulted for a server older than Epic 48. */
export function clocksOf(prefs: Preferences): ClockPlace[] {
  return prefs.clocks ?? [];
}

/** The default shading hours, defaulted the same way. */
export function clockHoursOf(prefs: Preferences): ClockHours {
  return prefs.clock_hours ?? CLOCK_HOURS_DEFAULT;
}
