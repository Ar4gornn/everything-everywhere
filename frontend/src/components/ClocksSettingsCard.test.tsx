/**
 * Epic 48 (AD-64): Settings → Clocks. Default hours save as `clock_hours`, the calendar's
 * zone as `calendar_zone` (null is "Off"), and a switched-off module draws nothing.
 */
import { render as rtlRender, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Preferences, User } from "../api/types";
import { AuthProvider } from "../auth/AuthContext";
import { LanguageProvider } from "../i18n";
import { DEFAULT_PREFERENCES } from "../layout/preferences";
import { ClocksSettingsCard } from "./ClocksSettingsCard";

function json(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function me(preferences: Preferences): User {
  return {
    id: "u1",
    email: "sam@example.com",
    currency: "USD",
    weight_unit: "kg",
    budget_start_day: 1,
    language: "en",
    created_at: "",
    tutorial_completed: true,
    tutorial_skipped_at: null,
    preferences,
    timezone: "Europe/Paris",
    digest_time: "19:00",
  };
}

const PLACES = [
  { id: "p1", zone: "America/New_York", label: "Sam's flat", hours: null },
  { id: "p2", zone: "Asia/Kolkata", label: "Office", hours: null },
];

function mockApi(patch: Partial<Preferences> = {}) {
  window.localStorage.setItem("everything-everywhere.token", "test-token");
  let user = me({ ...DEFAULT_PREFERENCES, ...patch });
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (url.startsWith("/api/auth/me/preferences")) {
      user = { ...user, preferences: { ...user.preferences!, ...body } };
      return json(user);
    }
    if (url.startsWith("/api/auth/me")) return json(user);
    return json({ items: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function bodiesOfPatches(fetchMock: ReturnType<typeof mockApi>): unknown[] {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).startsWith("/api/auth/me/preferences"))
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
}

function render() {
  return rtlRender(
    <AuthProvider>
      <LanguageProvider>
        <MemoryRouter>
          <ClocksSettingsCard />
        </MemoryRouter>
      </LanguageProvider>
    </AuthProvider>,
  );
}

describe("ClocksSettingsCard", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("shows the default hours and 96 quarter-hour choices", async () => {
    mockApi();
    render();
    const from = await screen.findByLabelText("Working hours from");
    expect(from).toHaveValue("09:00");
    expect(screen.getByLabelText("Working hours to")).toHaveValue("18:00");
    expect(screen.getByLabelText("Night hours from")).toHaveValue("23:00");
    expect(screen.getByLabelText("Night hours to")).toHaveValue("07:00");
    expect(from.querySelectorAll("option")).toHaveLength(96);
  });

  it("saves a changed hour as the whole clock_hours", async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    render();
    await user.selectOptions(await screen.findByLabelText("Working hours from"), "08:45");
    await waitFor(() =>
      expect(bodiesOfPatches(fetchMock)).toContainEqual({
        clock_hours: { work: ["08:45", "18:00"], night: ["23:00", "07:00"] },
      }),
    );
  });

  it("offers Off and each place, and saves the zone; Off saves an explicit null", async () => {
    const fetchMock = mockApi({ clocks: PLACES });
    const user = userEvent.setup();
    render();
    const select = await screen.findByLabelText("Calendar: also show times in");
    expect(Array.from(select.querySelectorAll("option")).map((o) => o.textContent)).toEqual([
      "Off",
      "Sam's flat · New York",
      "Office · Kolkata",
    ]);

    await user.selectOptions(select, "Asia/Kolkata");
    await waitFor(() =>
      expect(bodiesOfPatches(fetchMock)).toContainEqual({ calendar_zone: "Asia/Kolkata" }),
    );
    await user.selectOptions(select, "Off");
    await waitFor(() =>
      expect(bodiesOfPatches(fetchMock)).toContainEqual({ calendar_zone: null }),
    );
  });

  it("links to the Clocks page", async () => {
    mockApi();
    render();
    expect(await screen.findByRole("link", { name: "Open the Clocks page" })).toHaveAttribute(
      "href",
      "/clocks",
    );
  });

  it("draws nothing while the Clocks module is off", async () => {
    mockApi({ modules: { ...DEFAULT_PREFERENCES.modules, clocks: false } });
    render();
    // Wait for the account to arrive, so "nothing" is not just "not loaded yet".
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText("Default hours")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open the Clocks page" })).not.toBeInTheDocument();
  });
});
