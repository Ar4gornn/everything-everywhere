import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "./auth/AuthContext";
import { QuickAddProvider, useQuickAdd } from "./components/QuickAdd/QuickAddContext";
import { ToastProvider } from "./components/Toast";
import { CalendarPage } from "./pages/CalendarPage";
import { CategoryPage } from "./pages/CategoryPage";
import { DashboardPage } from "./pages/DashboardPage";

/**
 * A write through the quick-add sheet bumps the provider's `version`; the pages that show
 * entries list it among their load dependencies, so the page behind the sheet refetches
 * (Epic 44, AD-60 decision 3). One test per page: mutation-checked by removing `version`
 * from that page's dependency list.
 */

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const summary = {
  month: "2026-08",
  period: "month",
  label: "2026-08",
  start: "2026-08-01",
  end: "2026-08-31",
  income: "0.00",
  expense: "0.00",
  net: "0.00",
  saved: "0.00",
  budgets: [],
  savings: [],
};
const trends = { months: [], income: [], expense: [], saved: [], expense_by_category: [] };
const me = {
  id: "u1",
  email: "sam@example.com",
  currency: "USD",
  weight_unit: "kg",
  budget_start_day: 1,
  created_at: "",
};

let urls: string[];

beforeEach(() => {
  urls = [];
  window.localStorage.setItem("everything-everywhere.token", "test-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/api/auth/me")) return json(me);
      if (url.includes("/api/dashboard/summary")) return json(summary);
      if (url.includes("/api/dashboard/trends")) return json(trends);
      if (url.includes("/api/dashboard/vendor-prices")) return json({ months: [], vendors: [] });
      if (url.includes("/api/dashboard/unit-prices")) return json({ months: [], series: [] });
      if (url.includes("/api/categories")) {
        return json({ items: [{ id: "c1", kind: "expense", name: "Fuel", created_at: "" }] });
      }
      return json({ items: [] });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function Bump() {
  const { bump } = useQuickAdd();
  return (
    <button type="button" onClick={bump}>
      bump-it
    </button>
  );
}

function mount(path: string, page: React.ReactElement) {
  render(
    <AuthProvider>
      <ToastProvider>
        <QuickAddProvider>
          <MemoryRouter initialEntries={[path]}>
            <Bump />
            <Routes>
              <Route path="*" element={page} />
            </Routes>
          </MemoryRouter>
        </QuickAddProvider>
      </ToastProvider>
    </AuthProvider>,
  );
}

const count = (part: string) => urls.filter((url) => url.includes(part)).length;

async function bumpAndExpectRefetch(part: string) {
  await waitFor(() => expect(count(part)).toBeGreaterThan(0));
  // Let the page settle (StrictMode-free, but loads chain), then judge by the difference.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  const before = count(part);
  await act(async () => {
    screen.getByRole("button", { name: "bump-it" }).click();
  });
  await waitFor(() => expect(count(part)).toBeGreaterThan(before));
}

describe("the page behind the quick-add sheet refreshes after a write", () => {
  it("Dashboard reloads its summary", async () => {
    mount("/", <DashboardPage />);
    await bumpAndExpectRefetch("/api/dashboard/summary");
  });

  it("Category reloads its entries", async () => {
    mount("/categories/c1", <CategoryPage />);
    await bumpAndExpectRefetch("/api/entries");
  });

  it("Calendar reloads its entries", async () => {
    mount("/calendar", <CalendarPage />);
    await bumpAndExpectRefetch("/api/entries");
  });
});
