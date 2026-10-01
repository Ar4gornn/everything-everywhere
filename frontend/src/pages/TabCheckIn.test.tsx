import { render as rtlRender, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ComponentType } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { BooksPage } from "./BooksPage";
import { EntriesPage } from "./EntriesPage";
import { GymPage } from "./GymPage";
import { HabitsPage } from "./HabitsPage";
import { InventoryPage } from "./InventoryPage";
import { NotesPage } from "./NotesPage";
import { PlanPage } from "./PlanPage";
import { ProjectionsPage } from "./ProjectionsPage";
import { RecipesPage } from "./RecipesPage";
import type { StreakModuleId } from "../api/types";
import { AuthProvider } from "../auth/AuthContext";
import { ToastProvider } from "../components/Toast";
import { LanguageProvider } from "../i18n";
import { DEFAULT_PREFERENCES } from "../layout/preferences";
import { preloadPages } from "../test/preloadPages";

/**
 * Story 41.2: a Check in on every tab that has a streak — Entries, Plan, Grow, Habits,
 * Books, Stock, Gym, Recipes and Notes — drawn only while that tab's streak is shown (the
 * off cases are held in `components/TabStreaks.test.tsx`).
 * Mood has none: recording a mood is its own check-in.
 */

const PAGES: [StreakModuleId, ComponentType][] = [
  ["entries", EntriesPage],
  ["plan", PlanPage],
  ["grow", ProjectionsPage],
  ["habits", HabitsPage],
  ["books", BooksPage],
  ["stock", InventoryPage],
  ["gym", GymPage],
  ["recipes", RecipesPage],
  ["notes", NotesPage],
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockApi(on: StreakModuleId) {
  window.localStorage.setItem("everything-everywhere.token", "test-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/api/auth/me")) {
        return json({
          id: "u1",
          email: "sam@example.com",
          currency: "USD",
          weight_unit: "kg",
          budget_start_day: 1,
          created_at: "",
          language: "en",
          preferences: {
            ...DEFAULT_PREFERENCES,
            streaks: { ...DEFAULT_PREFERENCES.streaks, [on]: true },
          },
        });
      }
      if (url.endsWith("/api/streaks")) {
        return json({
          today: "2031-03-28",
          streaks: [{ id: on, current: 1, best: 1, today_active: false, recent: [] }],
        });
      }
      // One body that every list, overview and summary these pages read can live with.
      return json({ items: [], pots: [], budgets: [], days: [], counts: [] });
    }),
  );
}

function render(Page: ComponentType) {
  return rtlRender(
    <MemoryRouter>
      <AuthProvider>
        <LanguageProvider>
          <ToastProvider>
            <Page />
          </ToastProvider>
        </LanguageProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

const button = (id: string) => document.querySelector(`button[data-streak="${id}"]`);

describe("a tab's Check in", () => {
  beforeAll(preloadPages);
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it.each(PAGES)("is on the %s page when its streak is shown", async (id, Page) => {
    mockApi(id);
    render(Page);
    await waitFor(() => expect(button(id)).toHaveTextContent("Check in"));
  });
});
