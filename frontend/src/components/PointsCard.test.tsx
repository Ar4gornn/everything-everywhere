import { render as rtlRender, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StreakCard } from "./StreakCard";
import { StreaksSettingsCard } from "./StreaksSettingsCard";
import type { Preferences, StreakPoints } from "../api/types";
import { AuthProvider } from "../auth/AuthContext";
import { LanguageProvider } from "../i18n";
import { DEFAULT_PREFERENCES } from "../layout/preferences";

/**
 * Story 41.3: points on the client.
 *
 * What is held: the card shows the server's balance beside the person's own word for points
 * (verbatim, never inflected) and "Points" in both languages when none is chosen; hiding a
 * streak never changes the figure shown; a server older than 41.3 leaves the balance out; and
 * the Settings field trims, sends "" for empty (the default) and cannot type past 24.
 */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const dots = Array.from({ length: 28 }, (_, i) => ({
  day: `2031-03-${String(i + 1).padStart(2, "0")}`,
  state: i === 27 ? ("pending" as const) : ("active" as const),
}));

function mockApi(
  options: {
    points?: StreakPoints | null;
    pointsName?: string | null;
    language?: string;
    streaks?: Preferences["streaks"];
  } = {},
) {
  window.localStorage.setItem("everything-everywhere.token", "test-token");
  let prefs: Preferences = {
    ...DEFAULT_PREFERENCES,
    streaks: options.streaks ?? DEFAULT_PREFERENCES.streaks,
    points_name: options.pointsName ?? null,
  };
  const calls: { url: string; method: string; body: string | null }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: (init?.body as string) ?? null });
      if (url.endsWith("/api/auth/me/preferences") && method === "PATCH") {
        prefs = { ...prefs, ...JSON.parse(String(init?.body)) };
      }
      if (url.includes("/api/auth/me")) {
        return json({
          id: "u1",
          email: "sam@example.com",
          currency: "USD",
          created_at: "",
          language: options.language ?? "en",
          preferences: prefs,
        });
      }
      if (url.endsWith("/api/streaks")) {
        const points = options.points === undefined ? { balance: 42, earned: 42, spent: 0 } : options.points;
        return json({
          today: "2031-03-28",
          ...(points ? { points, prices: { milestones: [{ days: 7, bonus: 10 }] } } : {}),
          streaks: [
            { id: "overall", current: 3, best: 3, today_active: false, recent: dots },
            { id: "gym", current: 2, best: 2, today_active: false, recent: dots },
          ],
        });
      }
      return json({ items: [] });
    }),
  );
  return calls;
}

function render() {
  return rtlRender(
    <MemoryRouter>
      <AuthProvider>
        <LanguageProvider>
          <StreaksSettingsCard />
          <StreakCard collapseKey="test.streaks" />
        </LanguageProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

const balance = () => document.querySelector(".streak-card-points");

describe("points on the card", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("shows the balance under the default name when none is chosen", async () => {
    mockApi();
    render();
    await waitFor(() => expect(balance()).not.toBeNull());
    expect(balance()).toHaveTextContent("Balance: 42 · Points");
  });

  it("has a default in French too", async () => {
    mockApi({ language: "fr" });
    render();
    await waitFor(() => expect(balance()).not.toBeNull());
    expect(balance()).toHaveTextContent("Solde : 42 · Points");
  });

  it("shows the person's own word verbatim, whatever the number", async () => {
    mockApi({ pointsName: "Sparks", points: { balance: 1, earned: 1, spent: 0 } });
    render();
    await waitFor(() => expect(balance()).toHaveTextContent("1 · Sparks"));
  });

  it("shows a zero balance as a zero", async () => {
    mockApi({ points: { balance: 0, earned: 0, spent: 0 } });
    render();
    await waitFor(() => expect(balance()).toHaveTextContent("0 · Points"));
  });

  it("does not change the figure when streaks are shown or hidden", async () => {
    mockApi({ streaks: { ...DEFAULT_PREFERENCES.streaks, gym: true } });
    const shown = render();
    await waitFor(() => expect(balance()).toHaveTextContent("42 · Points"));
    shown.unmount();
    mockApi({ streaks: { ...DEFAULT_PREFERENCES.streaks, gym: false } });
    render();
    await waitFor(() => expect(balance()).toHaveTextContent("42 · Points"));
  });

  it("leaves the balance out for a server that predates points", async () => {
    mockApi({ points: null });
    render();
    await screen.findByText("3");
    expect(balance()).toBeNull();
  });
});

describe("the points name in Settings", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  const field = () => screen.findByLabelText("Name for points");

  it("starts from the stored name and cannot type past 24 characters", async () => {
    mockApi({ pointsName: "Sparks" });
    render();
    const input = (await field()) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe("Sparks"));
    expect(input.maxLength).toBe(24);
  });

  it("sends the trimmed name and the card then shows it", async () => {
    const calls = mockApi();
    const user = userEvent.setup();
    render();
    await user.type(await field(), "  Sparks ");
    await user.click(screen.getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(balance()).toHaveTextContent("42 · Sparks"));
    const patch = calls.find((c) => c.method === "PATCH");
    expect(JSON.parse(patch?.body ?? "{}")).toEqual({ points_name: "Sparks" });
  });

  it("sends an empty string for an empty name, and the default comes back", async () => {
    const calls = mockApi({ pointsName: "Sparks" });
    const user = userEvent.setup();
    render();
    const input = await field();
    await waitFor(() => expect(balance()).toHaveTextContent("42 · Sparks"));
    await waitFor(() => expect((input as HTMLInputElement).value).toBe("Sparks"));
    await user.clear(input);
    await user.type(input, "   ");
    await user.click(screen.getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    const patch = calls.find((c) => c.method === "PATCH");
    expect(JSON.parse(patch?.body ?? "{}")).toEqual({ points_name: "" });
    await waitFor(() => expect(balance()).toHaveTextContent("42 · Points"));
  });

  it("speaks French", async () => {
    mockApi({ language: "fr" });
    render();
    expect(await screen.findByLabelText("Nom des points")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enregistrer le nom" })).toBeInTheDocument();
  });
});
