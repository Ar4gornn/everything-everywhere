import { readFileSync } from "node:fs";
import { join } from "node:path";

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
    balance?: number;
    buy?: () => Response;
    repair?: () => Response;
    preferences?: unknown;
    extra?: Streak[];
  } = {},
) {
  window.localStorage.setItem("everything-everywhere.token", "test-token");
  const calls: { url: string; method: string; body: string | null }[] = [];
  // The server after a check-in: the card reloads, so the GET must answer as it would.
  let checkedIn: Streak | null = null;
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
        if (options.checkIn) return options.checkIn();
        checkedIn = { ...(streak as Streak), current: 25, best: 30, today_active: true };
        return json(checkedIn);
      }
      if (url.endsWith("/api/streaks")) {
        return json(
          streak === null
            ? { items: [] }
            : {
                today: "2031-03-28",
                streaks: [checkedIn ?? streak, ...(options.extra ?? [])],
                ...(options.shop
                  ? {
                      ...SHOP,
                      points: {
                        ...SHOP.points,
                        balance: (options.balance ?? SHOP.points.balance) + (checkedIn ? 1 : 0),
                      },
                    }
                  : {}),
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
    expect(item).toHaveTextContent(/: frozen$/);
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
    expect(item).toHaveTextContent(/: repaired$/);
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
    // The body names the streak and the price the person confirmed: no day.
    expect(JSON.parse(posts[0]?.body ?? "{}")).toEqual({ streak: "overall", cost: 36 });
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

  it("offers a hidden tab streak's repair nowhere, and a shown one's", async () => {
    const gym = { ...overall(), id: "gym", repair: { days: 1, cost: 40 } };
    const prefs = (on: boolean) => ({
      ...DEFAULT_PREFERENCES,
      streaks: { ...DEFAULT_PREFERENCES.streaks, gym: on },
    });
    mockApi(overall(), { extra: [gym], preferences: prefs(false) });
    const first = render();
    await screen.findByText("24");
    expect(screen.queryByRole("button", { name: "Repair the Gym streak" })).toBeNull();
    first.unmount();

    window.localStorage.clear();
    mockApi(overall(), { extra: [gym], preferences: prefs(true) });
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

describe("QA polish (Story 41.7)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  const offered = (cost: number) => overall({ current: 0, repair: { days: 1, cost } });
  const repairButton = () => screen.getByRole("button", { name: "Repair the Overall streak" });

  it("keeps the repair banner but disables Repair when the balance cannot pay", async () => {
    mockApi(offered(35), { shop: true, balance: 7 });
    render();
    expect(await screen.findByText(/Repair it for 35 Points\?/)).toBeInTheDocument();
    expect(repairButton()).toBeDisabled();
    const line = screen.getByText("Your balance is too low to repair it yet.");
    expect(line).toBeInTheDocument();
    // The unit may be renamed, so the sentence names none.
    expect(line.textContent).not.toMatch(/points/i);
  });

  it("offers Repair when the balance is exactly the price, with no warning", async () => {
    mockApi(offered(35), { shop: true, balance: 35 });
    render();
    await screen.findByText(/Repair it for 35 Points\?/);
    expect(repairButton()).toBeEnabled();
    expect(screen.queryByText(/too low/)).toBeNull();
  });

  it("says it in French as well, in a sentence of its own", async () => {
    mockApi(offered(35), { shop: true, balance: 7, language: "fr" });
    render();
    await screen.findByText(/La réparer pour 35 Points/);
    expect(screen.getByRole("button", { name: "Réparer la série Général" })).toBeDisabled();
    expect(
      screen.getByText("Votre solde est trop bas pour la réparer pour l’instant."),
    ).toBeInTheDocument();
  });

  it("disables Buy for a freeze the balance cannot pay, and says so once", async () => {
    mockApi(overall({ held_freezes: 0 }), { shop: true, balance: 7 });
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole("button", { name: "Shop" }));
    expect(screen.getByRole("button", { name: "Buy a freeze for Overall" })).toBeDisabled();
    expect(screen.getByText("Your balance is too low to buy a freeze.")).toBeInTheDocument();
  });

  it("enables Buy at exactly the price, and disables it at the limit without the warning", async () => {
    mockApi(overall({ held_freezes: 0 }), { shop: true, balance: 20 });
    const user = userEvent.setup();
    const first = render();
    await user.click(await screen.findByRole("button", { name: "Shop" }));
    expect(screen.getByRole("button", { name: "Buy a freeze for Overall" })).toBeEnabled();
    expect(screen.queryByText(/too low/)).toBeNull();
    first.unmount();

    mockApi(overall({ held_freezes: 2 }), { shop: true, balance: 44 });
    render();
    await user.click(await screen.findByRole("button", { name: "Shop" }));
    expect(screen.getByRole("button", { name: "Buy a freeze for Overall" })).toBeDisabled();
    expect(screen.queryByText(/too low/)).toBeNull();
  });

  it("refreshes the balance after a check-in, so a Buy it now affords is enabled", async () => {
    const calls = mockApi(overall(), { shop: true, balance: 19 });
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole("button", { name: "Shop" }));
    expect(screen.getByRole("button", { name: "Buy a freeze for Overall" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Check in" }));
    await screen.findByText("20");
    expect(screen.getByRole("button", { name: "Buy a freeze for Overall" })).toBeEnabled();
    const reads = calls.filter((c) => c.method === "GET" && c.url.endsWith("/api/streaks"));
    expect(reads.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the balance label, number and dot in one nowrap unit, the name apart", async () => {
    mockApi(overall(), { shop: true, preferences: { ...DEFAULT_PREFERENCES, points_name: "A".repeat(24) } });
    render();
    await screen.findByText("24");
    const unit = document.querySelector(".streak-card-balance");
    expect(unit).not.toBeNull();
    expect(unit).toHaveTextContent("Balance: 44 ·");
    expect(unit).not.toHaveTextContent("A");
    const css = readFileSync(join(__dirname, "..", "styles.css"), "utf-8");
    expect(css).toMatch(/\.streak-card \.streak-card-balance\s*\{[^}]*white-space:\s*nowrap/);
  });

  it("reads a covered day as its state alone, in both languages", async () => {
    for (const [language, frozen, repaired] of [
      ["en", /: frozen$/, /: repaired$/],
      ["fr", / : gelé$/, / : réparé$/],
    ] as const) {
      const last = recent("pending");
      last[10] = { day: last[10]?.day ?? "", state: "frozen" };
      last[11] = { day: last[11]?.day ?? "", state: "repaired" };
      mockApi(overall({ recent: last }), { language });
      const { unmount } = render();
      const list = await screen.findByRole("list", {
        name: language === "en" ? "The last four weeks" : "Les quatre dernières semaines",
      });
      const items = within(list).getAllByRole("listitem");
      expect(items[10]).toHaveTextContent(frozen);
      expect(items[11]).toHaveTextContent(repaired);
      unmount();
    }
  });
});

describe("Card layout (run first, folded repairs, chips, weekday head)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  const showing = (...ids: string[]) => ({
    ...DEFAULT_PREFERENCES,
    streaks: {
      ...DEFAULT_PREFERENCES.streaks,
      ...Object.fromEntries(ids.map((id) => [id, true])),
    },
  });
  const broken = (id: string, cost: number, days = 1): Streak => ({
    ...overall({ current: 0 }),
    id: id as Streak["id"],
    repair: { days, cost },
  });
  const repairButton = (streak: string) =>
    screen.queryByRole("button", { name: `Repair the ${streak} streak` });

  it("puts the run before any repair offer", async () => {
    mockApi(overall({ current: 0, repair: { days: 1, cost: 36 } }));
    render();
    const offer = await screen.findByText(/^You missed yesterday on your Overall streak/);
    const figure = document.querySelector(".streak-card-figure");
    expect(figure).not.toBeNull();
    expect(
      (figure as Node).compareDocumentPosition(offer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("folds several offers into one block, a row each, overall first, the rest behind a toggle", async () => {
    mockApi(overall({ current: 0, repair: { days: 1, cost: 36 } }), {
      extra: [broken("gym", 70, 2), broken("notes", 40), broken("habits", 40)],
      preferences: showing("gym", "notes", "habits"),
    });
    const user = userEvent.setup();
    render();
    expect(await screen.findByText("4 streaks broke")).toBeInTheDocument();
    // One heading for all of them, not a sentence each.
    expect(screen.queryByText(/^You missed/)).toBeNull();
    const rows = document.querySelectorAll(".streak-repair-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Overall missed yesterday · 36 Points");
    // Tab rows follow the tabs' own order, as the chips do.
    expect(rows[1]).toHaveTextContent("Habits missed yesterday · 40 Points");
    expect(repairButton("Gym")).toBeNull();
    expect(repairButton("Notes")).toBeNull();

    const more = screen.getByRole("button", { name: "Show 2 more" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await user.click(more);
    expect(repairButton("Gym")).toBeEnabled();
    expect(repairButton("Notes")).toBeEnabled();
    const fewer = screen.getByRole("button", { name: "Show fewer" });
    expect(fewer).toHaveAttribute("aria-expanded", "true");
    await user.click(fewer);
    expect(repairButton("Notes")).toBeNull();
  });

  it("has no toggle when every offer fits", async () => {
    mockApi(overall({ current: 0, repair: { days: 1, cost: 36 } }), {
      extra: [broken("gym", 40)],
      preferences: showing("gym"),
    });
    render();
    expect(await screen.findByText("2 streaks broke")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Show / })).toBeNull();
  });

  it("repairs one row with the same two presses, naming that streak and its price", async () => {
    const calls = mockApi(overall({ current: 0, repair: { days: 1, cost: 36 } }), {
      extra: [broken("gym", 70, 2)],
      preferences: showing("gym"),
    });
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole("button", { name: "Repair the Gym streak" }));
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
    // Only the pressed row asks; the other still offers its plain Repair.
    expect(repairButton("Overall")).toBeEnabled();
    await user.click(
      screen.getByRole("button", { name: "Confirm: spend 70 Points to repair Gym" }),
    );
    await waitFor(() => expect(calls.filter((c) => c.method === "POST")).toHaveLength(1));
    const post = calls.find((c) => c.method === "POST");
    expect(post?.url).toMatch(/\/api\/streaks\/repairs$/);
    expect(JSON.parse(post?.body ?? "{}")).toEqual({ streak: "gym", cost: 70 });
  });

  it("disables only the rows the balance cannot pay, and says so on those rows", async () => {
    mockApi(overall({ current: 0, repair: { days: 1, cost: 36 } }), {
      shop: true,
      balance: 50,
      extra: [broken("gym", 70, 2)],
      preferences: showing("gym"),
    });
    render();
    await screen.findByText("2 streaks broke");
    expect(repairButton("Overall")).toBeEnabled();
    expect(repairButton("Gym")).toBeDisabled();
    const lines = screen.getAllByText("Your balance is too low to repair it yet.");
    expect(lines).toHaveLength(1);
    expect(lines[0]?.closest(".streak-repair-row")).toHaveTextContent(/^Gym/);
  });

  it("speaks French in the folded block", async () => {
    mockApi(overall({ current: 0, repair: { days: 1, cost: 36 } }), {
      language: "fr",
      extra: [broken("gym", 70, 2), broken("notes", 40)],
      preferences: showing("gym", "notes"),
    });
    render();
    expect(await screen.findByText("3 séries interrompues")).toBeInTheDocument();
    const rows = document.querySelectorAll(".streak-repair-row");
    expect(rows[0]).toHaveTextContent("manqué hier · 36 Points");
    expect(rows[1]).toHaveTextContent("2 jours manqués · 70 Points");
    expect(screen.getByRole("button", { name: "Afficher 1 de plus" })).toBeInTheDocument();
  });

  it("draws each shown tab streak as a chip, dimmed at zero, read with its days and best", async () => {
    mockApi(overall(), {
      extra: [
        { ...overall({ current: 3, best: 9, today_active: true }), id: "gym" },
        { ...overall({ current: 0, best: 4 }), id: "notes" },
      ],
      preferences: showing("gym", "notes"),
    });
    render();
    const list = await screen.findByRole("list", { name: "Streaks by tab" });
    const [gym, notes] = within(list).getAllByRole("listitem");
    expect(gym).toHaveTextContent("Gym 33 days ✓ active today Best: 9");
    expect(gym).toHaveClass("streak-chip");
    expect(gym).not.toHaveClass("streak-chip-idle");
    expect(notes).toHaveClass("streak-chip-idle");
    expect(notes).toHaveTextContent("Best: 4");
  });

  it("heads the dots with the weekday of each of the first seven days, in the account's language", async () => {
    // 2031-03-01 is a Saturday, so the columns run Saturday to Friday.
    for (const [language, initials] of [
      ["en", "SSMTWTF"],
      ["fr", "SDLMMJV"],
    ] as const) {
      mockApi(overall(), { language });
      const { unmount } = render();
      await screen.findByText("24");
      await waitFor(() =>
        expect(document.querySelector(".streak-dots-head")?.textContent).toBe(initials),
      );
      expect(document.querySelector(".streak-dots-head")).toHaveAttribute("aria-hidden", "true");
      unmount();
    }
  });

  it("rings today and no other day", async () => {
    mockApi(overall());
    render();
    const list = await screen.findByRole("list", { name: "The last four weeks" });
    const items = within(list).getAllByRole("listitem");
    expect(items[27]).toHaveClass("streak-dot-today");
    expect(items.filter((item) => item.classList.contains("streak-dot-today"))).toHaveLength(1);
  });

  it("gives a missed day a shape of its own, not a ring like pending", () => {
    const css = readFileSync(join(__dirname, "..", "styles.css"), "utf-8");
    const missed = css.match(/\.streak-card \.streak-dot-missed\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(missed).toMatch(/border:\s*none/);
    expect(missed).toMatch(/linear-gradient\(45deg/);
    expect(missed).toMatch(/linear-gradient\(-45deg/);
  });
});

describe("Desktop split", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("puts repairs and chips in a side column only when there is something for it", async () => {
    mockApi(overall());
    const first = render();
    await screen.findByText("24");
    expect(document.querySelector(".streak-card")).not.toHaveClass("streak-card-split");
    expect(document.querySelector(".streak-card-side")).toBeNull();
    first.unmount();

    window.localStorage.clear();
    mockApi(overall({ current: 0, repair: { days: 1, cost: 36 } }), {
      extra: [{ ...overall(), id: "gym" }],
      preferences: {
        ...DEFAULT_PREFERENCES,
        streaks: { ...DEFAULT_PREFERENCES.streaks, gym: true },
      },
    });
    render();
    const list = await screen.findByRole("list", { name: "Streaks by tab" });
    const side = document.querySelector(".streak-card-side");
    expect(document.querySelector(".streak-card")).toHaveClass("streak-card-split");
    expect(side).toContainElement(list);
    expect(side).toContainElement(screen.getByRole("button", { name: "Repair the Overall streak" }));
    // The run and the dots stay out of it, in the left column.
    expect(side).not.toContainElement(screen.getByRole("button", { name: "Check in" }));
    expect(side).not.toContainElement(screen.getByRole("list", { name: "The last four weeks" }));
    const css = readFileSync(join(__dirname, "..", "styles.css"), "utf-8");
    expect(css).toMatch(
      /@media \(min-width: 721px\)[\s\S]*?\.streak-card-split > \.card > \.streak-card-side\s*\{[^}]*grid-column:\s*2/,
    );
  });
});
