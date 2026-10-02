import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "../auth/AuthContext";
import { onAPhone } from "../test/phone";
import { DashboardPage } from "./DashboardPage";

vi.mock("../pwa", () => ({ isInstalled: () => false }));

/**
 * Epic 46: where "has used the app" comes from. The dashboard has no entry count, so it reads
 * the totals it already loaded: any recorded money in the window or the trend months.
 */

const ZERO = "0.00";

function summary(expense: string) {
  return {
    month: "2026-09",
    period: "month",
    label: "2026-09",
    start: "2026-09-01",
    end: "2026-09-30",
    income: ZERO,
    expense,
    net: ZERO,
    saved: ZERO,
    budgets: [],
    savings: [],
  };
}

function trends(expense: string) {
  return {
    months: ["2026-09"],
    income: [ZERO],
    expense: [expense],
    saved: [ZERO],
    expense_by_category: [],
  };
}

function stub(sum: string, trend: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      const body = u.includes("/api/streaks")
        ? { today: "2026-09-20", streaks: [] }
        : u.includes("/api/dashboard/leftover")
          ? null
          : u.includes("/summary")
            ? summary(sum)
            : u.includes("/trends")
              ? trends(trend)
              : u.includes("/api/books/quotes/draw")
                ? null
                : { items: [] };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
}

function show() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <DashboardPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("the dashboard's install offer", () => {
  onAPhone();
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("asks once money has been recorded", async () => {
    stub("12.50", ZERO);
    show();
    expect(await screen.findByText("Want help installing the app on this phone?")).toBeInTheDocument();
  });

  it("counts the trend months too", async () => {
    stub(ZERO, "40.00");
    show();
    expect(await screen.findByText("Want help installing the app on this phone?")).toBeInTheDocument();
  });

  it("does not ask an account with nothing recorded", async () => {
    stub(ZERO, ZERO);
    show();
    await waitFor(() => expect(document.querySelector('[data-stat="Income"]')).not.toBeNull());
    await expect(
      screen.findByText("Want help installing the app on this phone?", {}, { timeout: 300 }),
    ).rejects.toThrow();
  });
});
