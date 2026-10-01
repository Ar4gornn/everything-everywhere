import { render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StreakCard } from "./StreakCard";
import type { Streak, StreakState } from "../api/types";
import { AuthProvider } from "../auth/AuthContext";
import { LanguageProvider } from "../i18n";
import { DEFAULT_PREFERENCES } from "../layout/preferences";

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

const SHOP = {
  points: { balance: 44, earned: 44, spent: 0 },
  prices: { freeze: 20, max_held: 2, milestones: [{ days: 7, bonus: 10 }] },
};

function mockApi(
  streak: Streak | null,
  options: {
    language?: string;
    checkIn?: () => Response;
    shop?: boolean;
    buy?: () => Response;
    repair?: () => Response;
    preferences?: unknown;
    extra?: Streak[];
  } = {},
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
          ...(options.preferences ? { preferences: options.preferences } : {}),
        });
      }
      if (url.endsWith("/api/streaks/repairs")) {
        return options.repair
          ? options.repair()
          : json(
              {
                points: { balance: 8, earned: 44, spent: 36 },
                streak: { ...(streak as Streak), current: 13, repair: null },
              },
              201,
            );
      }
      if (url.endsWith("/api/streaks/freezes")) {
        return options.buy
          ? options.buy()
          : json(
              {
                points: { balance: 24, earned: 44, spent: 20 },
                streak: { ...(streak as Streak), held_freezes: 2 },
              },
              201,
            );
      }
      if (url.endsWith("/api/streaks/check-in")) {
        return options.checkIn
          ? options.checkIn()
          : json({ ...(streak as Streak), current: 25, best: 30, today_active: true });
      }
      if (url.endsWith("/api/streaks")) {
        return json(
          streak === null
            ? { items: [] }
            : {
                today: "2031-03-28",
                streaks: [streak, ...(options.extra ?? [])],
                ...(options.shop ? SHOP : {}),
              },
        );
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

describe("StreakCard shop (Story 41.4)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  const held = (n: number) => overall({ held_freezes: n });

  it("draws a day a freeze covered with a shape of its own and says so in words", async () => {
    const last = recent("pending");
    last[10] = { day: last[10]?.day ?? "", state: "frozen" };
    mockApi(overall({ recent: last }));
    render();
    const list = await screen.findByRole("list", { name: "The last four weeks" });
    const item = within(list).getAllByRole("listitem")[10];
    expect(item).toHaveTextContent(/: frozen, covered by a freeze$/);
    expect(item).toHaveClass("streak-dot-frozen");
    // Not the class of any other state, so the shape (CSS) is the only thing it can share.
    for (const other of ["active", "missed", "pending", "before"]) {
      expect(item).not.toHaveClass(`streak-dot-${other}`);
    }
  });

  it("has no shop on a server that predates it", async () => {
    mockApi(overall());
    render();
    await screen.findByText("24");
    expect(screen.queryByRole("button", { name: "Shop" })).toBeNull();
  });

  it("keeps the shop closed until it is opened, inside the card and not a dialog", async () => {
    mockApi(held(1), { shop: true });
    const user = userEvent.setup();
    render();
    const toggle = await screen.findByRole("button", { name: "Shop" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/Freeze · 20 Points/)).toBeNull();
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Freeze · 20 Points · held 1/2")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks for a second press before it spends, then buys once and updates the card", async () => {
    const calls = mockApi(held(1), { shop: true });
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole("button", { name: "Shop" }));

    await user.click(screen.getByRole("button", { name: "Buy a freeze for Overall" }));
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);

    await user.click(
      screen.getByRole("button", {
        name: "Confirm: spend 20 Points on a freeze for Overall",
      }),
    );
    await screen.findByText("Freeze · 20 Points · held 2/2");
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toMatch(/\/api\/streaks\/freezes$/);
    // The body names the streak and nothing else: no price, no day.
    expect(JSON.parse(posts[0]?.body ?? "{}")).toEqual({ streak: "overall" });
    // The new balance, read off the answer rather than guessed.
    expect(document.querySelector(".streak-card-points")).toHaveTextContent("24 · Points");
    expect(screen.getByRole("button", { name: "Buy a freeze for Overall" })).toBeDisabled();
  });

  it("backs out of a purchase without sending anything", async () => {
    const calls = mockApi(held(0), { shop: true });
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole("button", { name: "Shop" }));
    await user.click(screen.getByRole("button", { name: "Buy a freeze for Overall" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Buy a freeze for Overall" })).toBeEnabled();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it.each([
    ["freeze_limit", "That streak already holds as many freezes as it can."],
    ["points_insufficient", "Your balance is too low for that."],
  ])("says what the %s refusal means", async (code, sentence) => {
    mockApi(held(0), { shop: true, buy: () => json({ detail: "x", code }, 409) });
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole("button", { name: "Shop" }));
    await user.click(screen.getByRole("button", { name: "Buy a freeze for Overall" }));
    await user.click(screen.getByRole("button", { name: /^Confirm: spend 20 Points/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(sentence);
    // Back to the first state: the next press asks again rather than spending.
    expect(screen.getByRole("button", { name: "Buy a freeze for Overall" })).toBeEnabled();
  });

  it("speaks French, in the person's own word for points", async () => {
    mockApi(held(1), {
      shop: true,
      language: "fr",
      buy: () => json({ detail: "x", code: "points_insufficient" }, 409),
      preferences: { ...DEFAULT_PREFERENCES, points_name: "Étincelles" },
    });
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole("button", { name: "Boutique" }));
    expect(screen.getByText("Gel · 20 Étincelles · en réserve 1/2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Acheter un gel pour Général" }));
    await user.click(screen.getByRole("button", { name: /^Confirmer : dépenser 20 Étincelles/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Votre solde est insuffisant pour cela.",
    );
  });

  it("offers a freeze for each shown tab streak as well", async () => {
    mockApi(held(0), {
      shop: true,
      extra: [{ ...overall({ held_freezes: 0 }), id: "gym" }],
      preferences: {
        ...DEFAULT_PREFERENCES,
        streaks: { ...DEFAULT_PREFERENCES.streaks, gym: true },
      },
    });
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole("button", { name: "Shop" }));
    expect(await screen.findByRole("button", { name: "Buy a freeze for Gym" })).toBeInTheDocument();
  });
});

describe("StreakCard repair (Story 41.5)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  const offered = (days = 1, cost = 36) => overall({ current: 0, repair: { days, cost } });

  it("draws a repaired day with a shape of its own and says so in words", async () => {
    const last = recent("pending");
    last[10] = { day: last[10]?.day ?? "", state: "repaired" };
    mockApi(overall({ recent: last }));
    render();
    const list = await screen.findByRole("list", { name: "The last four weeks" });
    const item = within(list).getAllByRole("listitem")[10];
    expect(item).toHaveTextContent(/: repaired, covered by a repair$/);
    expect(item).toHaveClass("streak-dot-repaired");
    for (const other of ["active", "missed", "pending", "before", "frozen"]) {
      expect(item).not.toHaveClass(`streak-dot-${other}`);
    }
  });

  it("shows no offer when there is none, or on a server that predates repairs", async () => {
    mockApi(overall({ repair: null }));
    render();
    await screen.findByText("24");
    expect(screen.queryByRole("button", { name: /^Repair/ })).toBeNull();
  });

  it("offers the repair at the top of the card with its price in the person's word", async () => {
    mockApi(offered(), {
      preferences: { ...DEFAULT_PREFERENCES, points_name: "Sparks" },
    });
    render();
    expect(
      await screen.findByText(
        "You missed yesterday on your Overall streak. Repair it for 36 Sparks?",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Repair the Overall streak" })).toBeEnabled();
  });

  it("says how many days when there are two", async () => {
    mockApi(offered(2, 72));
    render();
    expect(
      await screen.findByText(
        "You missed the last 2 days of your Overall streak. Repair them for 72 Points?",
      ),
    ).toBeInTheDocument();
  });

  it("asks for a second press, then repairs once and refreshes the card from the answer", async () => {
    const calls = mockApi(offered(), { shop: true });
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole("button", { name: "Repair the Overall streak" }));
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);

    await user.click(
      screen.getByRole("button", { name: "Confirm: spend 36 Points to repair Overall" }),
    );
    await screen.findByText("13");
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toMatch(/\/api\/streaks\/repairs$/);
    // The body names the streak and nothing else: no price, no day.
    expect(JSON.parse(posts[0]?.body ?? "{}")).toEqual({ streak: "overall" });
    // The offer is gone and the balance is the one the answer carried.
    expect(screen.queryByRole("button", { name: "Repair the Overall streak" })).toBeNull();
    expect(document.querySelector(".streak-card-points")).toHaveTextContent("8 · Points");
  });

  it("backs out of a repair without sending anything", async () => {
    const calls = mockApi(offered());
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole("button", { name: "Repair the Overall streak" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Repair the Overall streak" })).toBeEnabled();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("says what points_insufficient means and offers the repair again", async () => {
    mockApi(offered(), {
      repair: () => json({ detail: "x", code: "points_insufficient" }, 409),
    });
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole("button", { name: "Repair the Overall streak" }));
    await user.click(screen.getByRole("button", { name: /^Confirm: spend 36 Points/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your balance is too low for that.");
    expect(screen.getByRole("button", { name: "Repair the Overall streak" })).toBeEnabled();
  });

  it("reads the card afresh when the offer turns out to be gone", async () => {
    const calls = mockApi(offered(), {
      repair: () => json({ detail: "x", code: "repair_unavailable" }, 409),
    });
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole("button", { name: "Repair the Overall streak" }));
    await user.click(screen.getByRole("button", { name: /^Confirm: spend 36 Points/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That streak can no longer be repaired.",
    );
    await waitFor(() =>
      expect(
        calls.filter((c) => c.method === "GET" && c.url.endsWith("/api/streaks")),
      ).toHaveLength(2),
    );
  });

  it("offers a repair for a shown tab streak as well", async () => {
    mockApi(overall(), {
      extra: [{ ...overall(), id: "gym", repair: { days: 2, cost: 70 } }],
      preferences: {
        ...DEFAULT_PREFERENCES,
        streaks: { ...DEFAULT_PREFERENCES.streaks, gym: true },
      },
    });
    render();
    expect(await screen.findByRole("button", { name: "Repair the Gym streak" })).toBeEnabled();
  });

  it("speaks French, in the person's own word for points", async () => {
    mockApi(offered(), {
      language: "fr",
      preferences: { ...DEFAULT_PREFERENCES, points_name: "Étincelles" },
    });
    const user = userEvent.setup();
    render();
    expect(
      await screen.findByText(
        "Vous avez manqué hier sur votre série Général. La réparer pour 36 Étincelles ?",
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Réparer la série Général" }));
    expect(
      screen.getByRole("button", {
        name: "Confirmer : dépenser 36 Étincelles pour réparer Général",
      }),
    ).toBeInTheDocument();
  });
});
