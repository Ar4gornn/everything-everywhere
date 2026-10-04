import { type ComponentType, lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";

import type { Layout, ModuleId, SectionId } from "./api/types";
import { useAuth } from "./auth/AuthContext";
import { ModuleGate } from "./components/ModuleOff";
import { BottomBar } from "./components/nav/BottomBar";
import { NavDrawer } from "./components/nav/NavDrawer";
import { Sidebar } from "./components/nav/Sidebar";
import { QuickAddProvider, useQuickAdd } from "./components/QuickAdd/QuickAddContext";
import { QuickAddSheet } from "./components/QuickAdd/QuickAddSheet";
import { TutorialModal } from "./components/Tutorial/TutorialModal";
import { TutorialProvider } from "./components/Tutorial/useTutorial";
import { type MessageKey, useT } from "./i18n";
import { SECTION_LABEL, useModules } from "./layout/modules";
import { useLayout, usePreferences } from "./layout/useLayout";
import { flushEntries, useEntryOutbox } from "./entries/outbox";
import { flushOutbox } from "./gym/store";
import { flushDrafts } from "./notes/drafts";
import { navModel } from "./nav/model";
import { SignInPage } from "./pages/SignInPage";
import { useTheme } from "./theme";

/**
 * Every page is its own chunk, fetched the first time its route is visited. Before this,
 * one 488 KB script carried all fourteen pages plus the charts, and the sign-in screen —
 * which renders none of them — paid for the lot before it could draw a form. The sign-in
 * page stays in the main chunk for that reason: it is the first paint for anyone signed
 * out, and a second round trip there would undo the gain.
 *
 * The pages are named exports, so each import is unwrapped into the `default` that
 * `lazy` wants. Vite still sees the `import()` and splits on it.
 */
function page<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return lazy(async () => {
    const component: ComponentType = (await load())[name];
    return { default: component };
  });
}

const DashboardPage = page(() => import("./pages/DashboardPage"), "DashboardPage");
const CalendarPage = page(() => import("./pages/CalendarPage"), "CalendarPage");
const EntriesPage = page(() => import("./pages/EntriesPage"), "EntriesPage");
const CategoryPage = page(() => import("./pages/CategoryPage"), "CategoryPage");
const PlanPage = page(() => import("./pages/PlanPage"), "PlanPage");
const ProjectionsPage = page(() => import("./pages/ProjectionsPage"), "ProjectionsPage");
const HabitsPage = page(() => import("./pages/HabitsPage"), "HabitsPage");
const BooksPage = page(() => import("./pages/BooksPage"), "BooksPage");
const GymPage = page(() => import("./pages/GymPage"), "GymPage");
const InventoryPage = page(() => import("./pages/InventoryPage"), "InventoryPage");
const RecipesPage = page(() => import("./pages/RecipesPage"), "RecipesPage");
const RecipePage = page(() => import("./pages/RecipePage"), "RecipePage");
const SettingsPage = page(() => import("./pages/SettingsPage"), "SettingsPage");
const NotesPage = page(() => import("./pages/NotesPage"), "NotesPage");
const NotePage = page(() => import("./pages/NotePage"), "NotePage");
const MoonPage = page(() => import("./pages/MoonPage"), "MoonPage");
const ClocksPage = page(() => import("./pages/ClocksPage"), "ClocksPage");
const InvitesPage = page(() => import("./pages/InvitesPage"), "InvitesPage");
// Epic 46: the one page with a default export (it is also rendered before sign-in).
const InstallPage = lazy(() => import("./pages/InstallPage"));

/**
 * The navigation answer, in full, because it is the constraint two new features collided
 * with rather than a styling preference.
 *
 * The bottom bar holds **five** items at 375px — measured, not guessed — and Grow was
 * already displaced to the top bar to make room for Gym (Epic 19). A calendar and a habits
 * tab would make seven. Both were resolved explicitly:
 *
 * 1. **Habits takes a bottom tab, and Plan moves to the top bar.** The bottom bar is for
 *    what is opened at the moment it is needed. A check-in is a several-times-a-day thumb
 *    action — the highest-frequency tap in the app for anyone who keeps habits — while a
 *    budget is a *standing* monthly amount (AD-11) and a recurring template is edited
 *    perhaps twice a year. Ranking the sections by how often they are opened puts Plan
 *    eighth and Habits third, so Plan is the one that goes up top beside Grow.
 * 2. **The calendar takes no tab at all: it is the Dashboard's second view.** The dashboard
 *    already answers "what happened, and what is due" — in totals. The calendar answers the
 *    same question day by day. They are two views of one section, switched by a control at
 *    the top of the page, and `/calendar` is a real route so it can be linked and shared.
 *    What that costs: the calendar is one tap deeper than a tab would be.
 *
 * 3. **Recipes joins the top bar, and the app's name leaves it on a phone (Epic 27).**
 *    Ranked the same way: a recipe is consulted while cooking and a food is typed once, so
 *    the book sits well below the five thumb tabs. The frequent act in this module is "I
 *    ate this", and that is not a page — it is one control on the recipe and a layer on the
 *    calendar. But a third link did not fit for free. Measured at 375px, the phone bar's
 *    content box is 335px, and in French the three links are 193px ("Budget · Épargne ·
 *    Recettes") against English's 154px — so brand + links + a 44px settings target came to
 *    363 and wrapped to two rows on every French phone, which is the thing item 1's note
 *    refuses. The name is the item a phone needs least: the bottom tab says which section
 *    you are in, the page says what it is, and the installed app's name is on the home
 *    screen. It is now visually hidden at that width — out of flow, still in the
 *    accessibility tree — which leaves French at 245 of 335 and English at 206.
 *
 * 4. **Books is the Habits tab's second view (Epic 28), the way the calendar is the
 *    Dashboard's.** Ranked the same way, a shelf sits far below the five thumb tabs: a book
 *    is added once and touched again a handful of times over weeks. It is not money, so
 *    it does not belong under Entries; it is not consulted while cooking, so not beside
 *    Recipes. What it shares with Habits is the question — what am I doing with my own
 *    time — and both are records a person keeps for themselves rather than a household
 *    ledger. A fourth top-bar link was measured first: French would have put
 *    "Budget · Épargne · Recettes · Livres" at roughly 300 of the 335px content box, which
 *    fits at 375 and does not at 320. A view costs one tap and no width at all. A previous
 *    attempt at this epic added a sixth bottom tab; it was reverted for the reason the
 *    next paragraph gives.
 *
 * Rejected: a sixth tab (does not fit — the labels wrap and the targets fall under 44px);
 * a "More" overflow tab (spends a slot to hide two sections and demotes Gym, which Epic 19
 * deliberately promoted); merging Habits into Gym (one page with two unrelated jobs, and it
 * contradicts the interview that scoped Gym). For Epic 27, also rejected: displacing Stock
 * from the bottom bar — eating is more frequent than checking the pantry, so the ranking
 * argues for it, but Stock is wired to the shopping list Epic 14 built around a thumb tap
 * in a shop; and hanging /recipes off Entries as a second view the way /calendar hangs off
 * Dashboard — an entry is money and a recipe is not, so the two would share a tab and
 * nothing else.
 *
 * Verified at 375px in a browser rather than asserted — and at 320px, and in both
 * languages, because French is the longer one and is where this broke.
 */

/**
 * Every section, by id (Epic 33). Which slot each sits in, and in what order, is the
 * account's per layout (AD-49); the defaults are the arrangement argued above — five
 * thumb-reachable tabs, Plan, Grow and Recipes in the top bar.
 *
 * `label` is a message key rather than a word: the bar is drawn on every page, so a word
 * baked in here would be the one English string a French reader could never get away from.
 */
export const SECTION_DEFS: Record<SectionId, Section & { module?: ModuleId }> = {
  // The Dashboard tab covers both of its views, so the calendar does not look like a place
  // outside the app while you are standing in it.
  // Notes (Epic 32) are reached from the Dashboard's note button, so the tab stays lit there.
  dashboard: { to: "/", label: SECTION_LABEL.dashboard, glyph: "◪", end: true, also: ["/calendar", "/notes"] },
  entries: { to: "/entries", label: SECTION_LABEL.entries, glyph: "≡", end: false, also: [] },
  // The Habits tab covers the books too (Epic 28): a second view of the same section, the
  // way the calendar is the Dashboard's.
  habits: { to: "/habits", label: SECTION_LABEL.habits, glyph: "✓", end: false, also: ["/books"] },
  stock: { to: "/inventory", label: SECTION_LABEL.stock, glyph: "▤", end: false, also: [], module: "stock" },
  // Gym is a thing you open at the gym, so by default it keeps a thumb-reachable tab.
  gym: { to: "/gym", label: SECTION_LABEL.gym, glyph: "◈", end: false, also: [], module: "gym" },
  plan: { to: "/plan", label: SECTION_LABEL.plan, glyph: "▦", end: false, also: [] },
  grow: { to: "/projections", label: SECTION_LABEL.grow, glyph: "↗", end: false, also: [] },
  // Epic 27; the measurement and the rejected alternatives are in the block above.
  recipes: { to: "/recipes", label: SECTION_LABEL.recipes, glyph: "◍", end: false, also: [], module: "recipes" },
};

type Section = {
  to: string;
  label: MessageKey;
  glyph: string;
  end: boolean;
  also: readonly string[];
};

/**
 * One section as an account with these modules sees it, or null when it is gone. A section
 * with two views — Habits and Books — stays while either is on, and becomes the one that
 * is: with Habits off it is a Books tab pointing at `/books`.
 */
function visibleSection(id: SectionId, modules: Record<ModuleId, boolean>): Section | null {
  const section = SECTION_DEFS[id];
  if (id === "dashboard") return { ...section, also: modules.notes ? section.also : ["/calendar"] };
  if (id === "habits") {
    if (modules.habits) return { ...section, also: modules.books ? section.also : [] };
    return modules.books
      ? { to: "/books", label: "view.books", glyph: "▥", end: false, also: [] }
      : null;
  }
  return section.module && !modules[section.module] ? null : section;
}

/** The two bars for one layout: its tab order and slots, less what the modules hide. */
export function navFor(
  layout: Layout,
  modules: Record<ModuleId, boolean>,
): { bar: Section[]; top: Section[] } {
  const pick = (slot: "bar" | "top") =>
    layout.tabs
      .filter((tab) => tab.slot === slot)
      .map((tab) => visibleSection(tab.id, modules))
      .filter((section): section is Section => section !== null);
  return { bar: pick("bar"), top: pick("top") };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Where the quick-add `+` is not drawn (Epic 44): pages that own the bottom of the screen —
 * Gym's session and rest bars, and a note's editor. The notes list is not one of them.
 */
export function quickAddHidden(pathname: string): boolean {
  return pathname === "/gym" || pathname.startsWith("/gym/") || pathname.startsWith("/notes/");
}

/**
 * The phone half of quick add (AD-60): the `+`, the sheet, and the `?add=1` arrival. Lives
 * inside the provider, so it can read it. On desktop it renders nothing and consumes nothing:
 * EntriesPage keeps its own `?add=1` handling there, and each layout has exactly one owner.
 */
/**
 * Epic 45 (AD-61): entries queued on the device are sent when the app opens and when the
 * network returns, from whichever page is showing. A run that sent anything bumps the
 * provider so the pages behind refresh. Inside the provider, so it can; renders nothing.
 */
function EntriesFlusher() {
  const { user } = useAuth();
  const { bump } = useQuickAdd();
  const userId = user?.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `bump` is stable
  useEffect(() => {
    if (!userId) return;
    const flush = () =>
      void flushEntries(userId)
        .then((result) => {
          if (result.sent > 0) bump();
        })
        .catch(() => undefined);
    flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [userId]);
  return null;
}

function QuickAddHost({ pathname }: { pathname: string }) {
  const t = useT();
  const waiting = useEntryOutbox().length;
  const phone = useLayout() === "phone";
  const { isOpen, open, close } = useQuickAdd();
  const [searchParams, setSearchParams] = useSearchParams();
  const plusRef = useRef<HTMLButtonElement>(null);
  // Set when the sheet was opened from the +, so closing hands focus back to it.
  const fromPlus = useRef(false);

  const arriving = phone && searchParams.get("add") === "1";
  // biome-ignore lint/correctness/useExhaustiveDependencies: `open` and the setter are stable
  useEffect(() => {
    if (!arriving) return;
    const date = searchParams.get("date");
    open(date && ISO_DAY.test(date) ? { date } : {});
    const next = new URLSearchParams(searchParams);
    next.delete("add");
    next.delete("date");
    setSearchParams(next, { replace: true });
  }, [arriving]);

  // A tablet turned across the breakpoint: the sheet exists only on a phone.
  useEffect(() => {
    if (!phone && isOpen) close();
  }, [phone, isOpen, close]);

  // Not every browser focuses a button when it is tapped, and then the dialog has no element
  // to restore focus to on close: give it back to the + explicitly.
  useEffect(() => {
    if (isOpen || !fromPlus.current) return;
    fromPlus.current = false;
    plusRef.current?.focus();
  }, [isOpen]);

  if (!phone) return null;
  return (
    <>
      {/* Kept mounted while the sheet is open (just out of sight and inert), so it is still
          there for focus to return to. */}
      {!quickAddHidden(pathname) && (
        <button
          ref={plusRef}
          type="button"
          className={isOpen ? "fab fab-away" : "fab"}
          aria-label={waiting > 0 ? t.n("offline.plusWaiting", waiting) : t("nav.addEntry")}
          aria-hidden={isOpen || undefined}
          inert={isOpen}
          onClick={() => {
            fromPlus.current = true;
            open();
          }}
        >
          +
          {waiting > 0 && (
            <span className="fab-badge" aria-hidden="true">
              {waiting}
            </span>
          )}
        </button>
      )}
      <QuickAddSheet />
    </>
  );
}

export function App() {
  const { user, loading } = useAuth();
  const t = useT();
  const theme = useTheme();
  const dark = theme.resolved === "dark" || theme.resolved === "oled";
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // Read before the early returns below: a hook must run on every render.
  const modules = useModules();
  // The tabs are the account's, per layout (Epic 33): a phone and a laptop may differ.
  const { current, layout } = usePreferences();
  const desktop = layout === "desktop";
  // Epic 52 (AD-65): one model for the phone bar, the More drawer and the desktop sidebar.
  const nav = navModel(current, modules, layout);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // A window widened past the phone breakpoint with the drawer open: the sidebar takes over,
  // and a modal dialog left open would keep the whole page inert.
  useEffect(() => {
    if (desktop) setDrawerOpen(false);
  }, [desktop]);
  // A tap on a tile closes the drawer itself; this covers every other way the page changes
  // (back button, a link in a page) so the sheet never stays over the new one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the path is the trigger
  useEffect(() => setDrawerOpen(false), [pathname]);

  // Notes written with no network are sent when it comes back, and when the app opens —
  // whichever page is showing (Epic 32, AD-48).
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    const flush = () => void flushDrafts(userId).catch(() => 0);
    flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [userId]);

  // Gym sessions finished with no network are sent when it comes back and when the app opens,
  // from whichever page is showing (Epic 42, AD-58); the gym page and dashboard card also
  // flush on mount, and the store makes concurrent flushes one.
  const gymOn = modules.gym;
  useEffect(() => {
    if (!userId || !gymOn) return;
    const flush = () => void flushOutbox(userId).catch(() => undefined);
    flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [userId, gymOn]);

  // The pages the gym needs at the gym are lazy chunks, which the service worker caches only
  // once fetched — and the first fetch must not be at a gym with no signal. So once signed
  // in, in the built app only (the dev server has no worker), fetch the Dashboard and Gym
  // chunks when the browser is idle. The session, import and routine views are routes inside
  // the Gym chunk, so this covers all of them.
  useEffect(() => {
    if (!userId || !import.meta.env.PROD) return;
    const warm = () => {
      void import("./pages/DashboardPage").catch(() => undefined);
      if (gymOn) void import("./pages/GymPage").catch(() => undefined);
    };
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(warm);
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(warm, 2000);
    return () => window.clearTimeout(timer);
  }, [userId, gymOn]);

  // Without this the sign-in page flashes on every reload before /me answers.
  // Epic 46 (AD-62 §2.5): the install guide works signed out, so a link can be sent to
  // someone with no account. Signed in, `/install` is an ordinary route below.
  if ((pathname === "/install" || pathname === "/install/") && !user) {
    return (
      <Suspense fallback={null}>
        <InstallPage />
      </Suspense>
    );
  }
  if (loading) return <main className="shell" />;
  if (!user) return <SignInPage />;

  return (
    // The tour's provider sits here rather than in main.tsx so it is inside the router and
    // the auth provider, and so every test that mounts <App /> gets it for free.
    <TutorialProvider>
    <QuickAddProvider>
    <EntriesFlusher />
    <div className="shell">
      {/* Epic 52 (AD-65): every place, grouped, down the left of a desktop. CSS hides it
          on a phone, where the bottom bar and the More drawer do the same job. */}
      {/* biome-ignore lint/a11y/useValidAnchor: a skip link is an in-page anchor; the handler
          only keeps "#main" out of the URL and moves focus to the region */}
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        {t("nav.skip")}
      </a>
      {desktop ? <Sidebar model={nav} pathname={pathname} /> : null}
      {/* The desktop has no top bar: the sidebar carries the name, Settings (with who is
          signed in) and the theme switch. */}
      {desktop ? null : (
      <header className="topbar">
        <p className="brand">{t("app.name")}</p>
        {/* The email is the way into Settings: currency, password, recovery codes and
            sign-out all live there, so the top bar carries one link instead of a button
            for each. Six bottom tabs would not fit a phone; one link here does. */}
        <div className="identity">
          {/* One tap between light and dark; the other modes and the accent are in Settings. */}
          <button
            type="button"
            className="theme-toggle"
            onClick={theme.toggle}
            aria-label={t(dark ? "theme.toLight" : "theme.toDark")}
            data-tip={t(dark ? "theme.toLight" : "theme.toDark")}
          >
            <span aria-hidden="true">{dark ? "☀︎" : "☾"}</span>
          </button>
          <NavLink to="/settings" aria-label={t("nav.settings")} data-tip={t("nav.settings")}>
            <span className="glyph" aria-hidden="true">
              ⚙
            </span>
            <span className="email">{user.email}</span>
          </NavLink>
        </div>
      </header>
      )}

      <main id="main" tabIndex={-1}>
        {/* Nothing is drawn while a chunk loads: the bars above and below are already there,
            and a spinner for a fetch that is usually served from the worker's cache would
            flash more than it informs. */}
        <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/entries" element={<EntriesPage />} />
          <Route path="/categories/:categoryId" element={<CategoryPage />} />
          <Route path="/plan" element={<PlanPage />} />
          <Route path="/projections" element={<ProjectionsPage />} />
          <Route path="/habits" element={<ModuleGate module="habits"><HabitsPage /></ModuleGate>} />
          <Route path="/books" element={<ModuleGate module="books"><BooksPage /></ModuleGate>} />
          <Route path="/gym/*" element={<ModuleGate module="gym"><GymPage /></ModuleGate>} />
          <Route path="/inventory" element={<ModuleGate module="stock"><InventoryPage /></ModuleGate>} />
          <Route path="/recipes" element={<ModuleGate module="recipes"><RecipesPage /></ModuleGate>} />
          <Route path="/recipes/:recipeId" element={<ModuleGate module="recipes"><RecipePage /></ModuleGate>} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/install" element={<InstallPage />} />
          {/* AD-54: offered to an admin only; the server refuses anyone else regardless. */}
          <Route
            path="/invites"
            element={user.is_admin ? <InvitesPage /> : <Navigate to="/settings" replace />}
          />
          <Route path="/notes" element={<ModuleGate module="notes"><NotesPage /></ModuleGate>} />
          {/* One route for new and existing: `/notes/new` becomes `/notes/<id>` in place
              once there is something to keep, and the editor must not remount when it does. */}
          <Route path="/notes/:noteId" element={<ModuleGate module="notes"><NotePage /></ModuleGate>} />
          {/* Epic 47: reached from the dashboard line and the calendar's day panel, not a tab. */}
          <Route path="/moon" element={<ModuleGate module="moon"><MoonPage /></ModuleGate>} />
          {/* Epic 48: the Dashboard section's third view (ViewSwitch), not a tab. */}
          <Route path="/clocks" element={<ModuleGate module="clocks"><ClocksPage /></ModuleGate>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </main>

      {/* Quick add (Epic 44, AD-60): a phone's `+` opens a bottom sheet over whatever page
          this is, so recording a transaction never costs a navigation. */}
      <QuickAddHost pathname={pathname} />

      {/* Notes (Epic 32): quick capture from the Dashboard, a second button above the
          entry one rather than a menu behind it. A speed dial was the alternative, and it
          would have put a tap in front of recording an expense — the loop people repeat
          most — to make room for one that is used less. Phone only, like the other. */}
      {pathname === "/" && modules.notes && (
        <button
          type="button"
          className="fab fab-note"
          aria-label={t("nav.addNote")}
          onClick={() => navigate("/notes/new")}
        >
          <span aria-hidden="true">✎</span>
        </button>
      )}

      {/* Thumb-reachable navigation. This is the single thing that stops an installed PWA
          feeling like a website in a frameless window. */}
      <BottomBar
        model={nav}
        pathname={pathname}
        moreOpen={drawerOpen}
        onMore={() => setDrawerOpen(true)}
      />
      <NavDrawer model={nav} open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      {/* First sign-in only, or replayed from Settings (Epic 30). */}
      <TutorialModal />
    </div>
    </QuickAddProvider>
    </TutorialProvider>
  );
}
