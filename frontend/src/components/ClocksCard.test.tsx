import { render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClockPlace } from "../api/types";
import { AuthProvider } from "../auth/AuthContext";
import { LanguageProvider } from "../i18n";
import { DEFAULT_PREFERENCES } from "../layout/preferences";
import { ClocksCard } from "./ClocksCard";

/** The dashboard Clocks card (Epic 48.2). 2026-10-03 10:00 UTC: Paris 12:00, New York 06:00. */

const NOW = new Date("2026-10-03T10:00:00Z");

const place = (id: string, zone: string, label: string): ClockPlace => ({
  id,
  zone,
  label,
  hours: null,
});

const FIVE = [
  place("a", "America/New_York", "Mum"),
  place("b", "Asia/Tokyo", "Office"),
  place("c", "Europe/London", "Gran"),
  place("d", "Asia/Kolkata", "Fourth"),
  place("e", "Australia/Sydney", "Fifth"),
];

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function mount(places: ClockPlace[]) {
  window.localStorage.setItem("everything-everywhere.token", "test-token");
  const fetchMock = vi.fn(async (url: string) =>
    url.includes("/api/auth/me")
      ? json({
          id: "u1",
          email: "sam@example.com",
          currency: "USD",
          created_at: "",
          language: "en",
          timezone: "Europe/Paris",
          preferences: { ...DEFAULT_PREFERENCES, clocks: places },
        })
      : json({ items: [] }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return rtlRender(
    <MemoryRouter>
      <AuthProvider>
        <LanguageProvider>
          <div data-testid="host">
            <ClocksCard />
          </div>
        </LanguageProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the Clocks card", () => {
  it("draws nothing while there are no places", async () => {
    mount([]);
    // Wait for the account to arrive (the profile request), then check nothing came with it.
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByTestId("host")).toBeEmptyDOMElement();
  });

  it("shows your own time and the first three places, one line each", async () => {
    mount(FIVE);
    const list = await screen.findByRole("list", { name: "Time in other places" });
    const lines = within(list).getAllByRole("listitem");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toHaveTextContent("You");
    expect(lines[0]).toHaveTextContent("12:00");
    expect(lines[1]).toHaveTextContent("Mum");
    expect(lines[1]).toHaveTextContent("06:00");
    expect(lines[1]).toHaveTextContent("−6h");
    expect(lines[1]).toHaveTextContent("Night");
    expect(lines[3]).toHaveTextContent("Gran");
    expect(lines[3]).toHaveTextContent("11:00");
    expect(screen.queryByText("Fourth")).toBeNull();
    expect(screen.queryByText("Fifth")).toBeNull();
  });

  it("links its title to the clocks page", async () => {
    mount(FIVE);
    const link = await screen.findByRole("link", { name: "Open" });
    expect(link).toHaveAttribute("href", "/clocks");
  });
});
