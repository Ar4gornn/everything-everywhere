import { render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StreakCard } from "./StreakCard";
import type { Streak, StreakState } from "../api/types";
import { AuthProvider } from "../auth/AuthContext";
import { LanguageProvider } from "../i18n";

/**
 * The overall streak card (Epic 41.1).
 *
 * What is held: the figures come from the server untouched, **Check in makes one request and
 * then reads as done**, the four weeks are twenty-eight list items each readable on its own
 * (state is never colour alone), and a server that predates the card leaves the dashboard
 * without one instead of crashing it.
 */

function render() {
  return rtlRender(
    <MemoryRouter>
      <AuthProvider>
        <LanguageProvider>
          <StreakCard collapseKey="test.streaks" />
        </LanguageProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Twenty-eight days ending on 2031-03-28, the last one in `last`'s state. */
function recent(last: StreakState, before: StreakState = "active"): Streak["recent"] {
  return Array.from({ length: 28 }, (_, index) => ({
    day: `2031-03-${String(index + 1).padStart(2, "0")}`,
    state: index === 27 ? last : index < 3 ? "missed" : before,
  }));
}

function overall(overrides: Partial<Streak> = {}): Streak {
  return {
    id: "overall",
    current: 24,
    best: 30,
    today_active: false,
    recent: recent("pending"),
    ...overrides,
  };
}

function mockApi(
  streak: Streak | null,
  options: { language?: string; checkIn?: () => Response } = {},
) {
  window.localStorage.setItem("everything-everywhere.token", "test-token");
  const calls: { url: string; method: string; body: string | null }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET", body: (init?.body as string) ?? null });
      if (url.includes("/api/auth/me")) {
        return json({
          id: "u1",
          email: "sam@example.com",
          currency: "USD",
          created_at: "",
          language: options.language ?? "en",
        });
      }
      if (url.endsWith("/api/streaks/check-in")) {
        return options.checkIn
          ? options.checkIn()
          : json({ ...(streak as Streak), current: 25, best: 30, today_active: true });
      }
      if (url.endsWith("/api/streaks")) {
        return json(streak === null ? { items: [] } : { today: "2031-03-28", streaks: [streak] });
      }
      return json({ items: [] });
    }),
  );
  return calls;
}

describe("StreakCard", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("shows the current run, the best, and the way to check in", async () => {
    mockApi(overall());
    render();
    expect(await screen.findByText("24")).toBeInTheDocument();
    expect(screen.getByText("days in a row")).toBeInTheDocument();
    expect(screen.getByText("Best: 30")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check in" })).toBeEnabled();
  });

  it("checks in once, names no day, and then reads as done", async () => {
    const calls = mockApi(overall());
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole("button", { name: "Check in" }));

    const done = await screen.findByRole("button", { name: "Checked in ✓" });
    expect(done).toBeDisabled();
    expect(screen.getByText("25")).toBeInTheDocument();
    const posts = calls.filter((call) => call.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toMatch(/\/api\/streaks\/check-in$/);
    // The server owns the day: the body carries the streak's name and nothing else.
    expect(JSON.parse(posts[0]?.body ?? "{}")).toEqual({ streak: "overall" });
  });

  it("is already checked in when today is active", async () => {
    mockApi(overall({ today_active: true, recent: recent("active") }));
    render();
    expect(await screen.findByRole("button", { name: "Checked in ✓" })).toBeDisabled();
  });

  it("draws twenty-eight dots, each readable as a day and a state", async () => {
    mockApi(overall());
    render();
    const list = await screen.findByRole("list", { name: "The last four weeks" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(28);
    expect(items[0]).toHaveTextContent(/: missed$/);
    expect(items[10]).toHaveTextContent(/: active$/);
    expect(items[27]).toHaveTextContent(/: today, not yet$/);
    expect(items[27]).toHaveClass("streak-dot-pending");
  });

  it("reads a day before the streak began as that, not as missed", async () => {
    mockApi(overall({ recent: recent("pending", "before") }));
    render();
    const list = await screen.findByRole("list", { name: "The last four weeks" });
    const item = within(list).getAllByRole("listitem")[10];
    expect(item).toHaveTextContent(/: before you started$/);
    expect(item).toHaveClass("streak-dot-before");
  });

  it("says what went wrong when the check-in is refused", async () => {
    mockApi(overall(), {
      checkIn: () => json({ detail: "x", code: "streak_unknown" }, 422),
    });
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole("button", { name: "Check in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That streak does not exist.");
    expect(screen.getByRole("button", { name: "Check in" })).toBeEnabled();
  });

  it("draws nothing for a server that predates streaks", async () => {
    const calls = mockApi(null);
    render();
    await waitFor(() => expect(calls.some((call) => call.url.endsWith("/api/streaks"))).toBe(true));
    expect(screen.queryByText("Streak")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("speaks French, singular at 1 and at 0", async () => {
    mockApi(overall({ current: 1, best: 1 }), { language: "fr" });
    render();
    expect(await screen.findByText("jour de suite")).toBeInTheDocument();
    expect(screen.getByText("Record : 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Valider aujourd’hui" })).toBeInTheDocument();
  });
});
