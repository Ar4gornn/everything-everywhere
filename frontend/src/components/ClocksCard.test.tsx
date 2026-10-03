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

function mount(places: ClockPlace[], language = "en") {
  window.localStorage.setItem("everything-everywhere.token", "test-token");
  const fetchMock = vi.fn(async (url: string) =>
    url.includes("/api/auth/me")
      ? json({
          id: "u1",
          email: "sam@example.com",
          currency: "USD",
          created_at: "",
          language,
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

  it("leaves the city out when the name says it, and keeps the custom-hours tag off the card", async () => {
    mount([
      place("a", "Europe/London", "london"),
      { ...place("b", "Asia/Tokyo", "Office"), hours: { work: ["08:00", "16:00"], night: ["22:00", "06:00"] } },
    ]);
    const list = await screen.findByRole("list", { name: "Time in other places" });
    const lines = within(list).getAllByRole("listitem");
    expect(lines[1]?.querySelector(".clocks-zone")).toBeNull();
    expect(lines[2]?.querySelector(".clocks-zone")?.textContent).toBe("Tokyo");
    expect(lines[2]).not.toHaveTextContent("Custom hours");
    expect(list.querySelector(".clocks-tag")).toBeNull();
  });

  it("says how many more places the page has, linked to it", async () => {
    mount(FIVE);
    const more = await screen.findByRole("link", { name: "2 more places on the Clocks page" });
    expect(more).toHaveTextContent("+2 more");
    expect(more).toHaveAttribute("href", "/clocks");
  });

  it("says nothing more at three places or fewer", async () => {
    mount(FIVE.slice(0, 3));
    await screen.findByText("Gran");
    expect(screen.queryByText(/more/)).toBeNull();
  });

  it("uses the French singular for one more place", async () => {
    mount(FIVE.slice(0, 4), "fr");
    const more = await screen.findByRole("link", { name: "1 autre lieu sur la page Horloges" });
    expect(more).toHaveTextContent("+1 autre");
  });

  it("names its Open link in both languages", async () => {
    mount(FIVE, "fr");
    expect(await screen.findByRole("link", { name: "Ouvrir les horloges" })).toHaveAttribute(
      "href",
      "/clocks",
    );
  });

  it("links its title to the clocks page", async () => {
    mount(FIVE);
    const link = await screen.findByRole("link", { name: "Open Clocks" });
    expect(link).toHaveAttribute("href", "/clocks");
  });
});
