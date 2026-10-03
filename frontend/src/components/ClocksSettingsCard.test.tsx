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
    digest_time: "07:30",
  };
}

const PLACES = [
  { id: "p1", zone: "America/New_York", label: "Sam's flat", hours: null },
  { id: "p2", zone: "Asia/Kolkata", label: "Office", hours: null },
];

/** While set, the notification-schedule write waits for it (a slow server). */
let scheduleGate: Promise<void> | null = null;

function mockApi(patch: Partial<Preferences> = {}) {
  window.localStorage.setItem("everything-everywhere.token", "test-token");
  let user = me({ ...DEFAULT_PREFERENCES, ...patch });
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (url.startsWith("/api/auth/me/preferences")) {
      user = { ...user, preferences: { ...user.preferences!, ...body } };
      return json(user);
    }
    if (url.startsWith("/api/auth/me/notification-schedule")) {
      if (scheduleGate) await scheduleGate;
      user = { ...user, timezone: body.timezone, digest_time: body.digest_time };
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
    const from = await screen.findByLabelText("Working hours start");
    expect(from).toHaveValue("09:00");
    expect(screen.getByLabelText("Working hours end")).toHaveValue("18:00");
    expect(screen.getByLabelText("Night hours start")).toHaveValue("23:00");
    expect(screen.getByLabelText("Night hours end")).toHaveValue("07:00");
    expect(from.querySelectorAll("option")).toHaveLength(96);
  });

  it("saves a changed hour as the whole clock_hours", async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    render();
    await user.selectOptions(await screen.findByLabelText("Working hours start"), "08:45");
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

  it("shows your time zone and changes it by search, keeping the digest hour", async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    render();
    expect(await screen.findByText("Now: Paris (Europe/Paris)")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Search time zones"), "tokyo");
    await user.click(await screen.findByRole("button", { name: "Use Tokyo (Asia/Tokyo)" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls
          .filter(([url]) => String(url).startsWith("/api/auth/me/notification-schedule"))
          .map(([, init]) => JSON.parse(String((init as RequestInit).body))),
      ).toEqual([{ timezone: "Asia/Tokyo", digest_time: "07:30" }]),
    );
    // The profile was re-read, so the card shows the new zone and the search is cleared.
    expect(await screen.findByText("Now: Tokyo (Asia/Tokyo)")).toBeInTheDocument();
    expect(screen.getByLabelText("Search time zones")).toHaveValue("");
  });

  it("says Saving… while your zone saves, then focuses the line that shows it (round 5)", async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    render();
    expect(await screen.findByText("Now: Paris (Europe/Paris)")).toBeInTheDocument();
    let open: () => void = () => undefined;
    scheduleGate = new Promise<void>((resolve) => {
      open = () => resolve();
    });
    try {
      await user.type(screen.getByLabelText("Search time zones"), "tokyo");
      const pick = await screen.findByRole("button", { name: "Use Tokyo (Asia/Tokyo)" });
      await user.click(pick);
      await user.click(pick);
      expect(await screen.findByText("Saving…")).toBeInTheDocument();
    } finally {
      scheduleGate = null;
      open();
    }
    const line = (await screen.findByText("Now: Tokyo (Asia/Tokyo)")).closest("p");
    await waitFor(() => expect(line).toHaveFocus());
    expect(screen.queryByText("Saving…")).toBeNull();
    // The second press while saving was not a second write.
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).startsWith("/api/auth/me/notification-schedule"),
      ),
    ).toHaveLength(1);
  });

  it("says when the search finds nothing, and that the digest keeps its hour (round 4)", async () => {
    mockApi();
    const user = userEvent.setup();
    render();
    expect(
      await screen.findByText("Your daily summary keeps its hour in the new zone."),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("Search time zones"), "qqqq");
    expect(
      await screen.findByText("No match. Try the nearest big city, or a region like Asia/Kolkata."),
    ).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Search time zones"));
    await user.type(screen.getByLabelText("Search time zones"), "q");
    expect(screen.queryByText(/No match/)).toBeNull();
  });

  it("finds a zone by an alias here too, and says so", async () => {
    mockApi();
    const user = userEvent.setup();
    render();
    await user.type(await screen.findByLabelText("Search time zones"), "delhi");
    expect(
      await screen.findByRole("button", { name: "Use Delhi → Kolkata (Asia/Kolkata)" }),
    ).toBeInTheDocument();
  });

  it("makes one option per zone, naming every place in it, city last unless it is the name", async () => {
    mockApi({
      clocks: [
        ...PLACES,
        { id: "p3", zone: "America/New_York", label: "Dad", hours: null },
        { id: "p4", zone: "Europe/London", label: "london", hours: null },
      ],
    });
    render();
    const select = await screen.findByLabelText("Calendar: also show times in");
    expect(Array.from(select.querySelectorAll("option")).map((o) => o.textContent)).toEqual([
      "Off",
      "Sam's flat, Dad · New York",
      "Office · Kolkata",
      "London",
    ]);
  });

  it("selects the place for a zone saved under its legacy name", async () => {
    mockApi({
      clocks: [{ id: "p2", zone: "Asia/Kolkata", label: "Office", hours: null }],
      calendar_zone: "Asia/Calcutta",
    });
    render();
    const select = (await screen.findByLabelText("Calendar: also show times in")) as HTMLSelectElement;
    expect(select.value).toBe("Asia/Kolkata");
    expect(screen.queryByText("Not one of your places any more")).toBeNull();
  });

  it("keeps a zone whose place was removed in the select and says so", async () => {
    mockApi({ clocks: PLACES, calendar_zone: "Asia/Tokyo" });
    render();
    const select = (await screen.findByLabelText("Calendar: also show times in")) as HTMLSelectElement;
    expect(select.value).toBe("Asia/Tokyo");
    expect(Array.from(select.querySelectorAll("option")).map((o) => o.textContent)).toContain("Tokyo");
    expect(screen.getByText("Not one of your places any more")).toBeInTheDocument();
  });

  it("puts both hour rows in one grid, so the from and to selects line up", async () => {
    mockApi();
    render();
    const from = await screen.findByLabelText("Working hours start");
    const night = screen.getByLabelText("Night hours start");
    const grid = from.closest(".clocks-settings-hours");
    expect(grid).not.toBeNull();
    expect(grid).toContainElement(night);
    expect(from.closest("label")).toHaveClass("clocks-settings-pick");
  });

  it("does not offer a place in your own zone", async () => {
    mockApi({
      clocks: [...PLACES, { id: "p5", zone: "Europe/Paris", label: "Gran", hours: null }],
    });
    render();
    const select = await screen.findByLabelText("Calendar: also show times in");
    const texts = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
    expect(texts).toEqual(["Off", "Sam's flat · New York", "Office · Kolkata"]);
  });

  it("still shows your own zone when it was saved, and says it is your time", async () => {
    mockApi({
      clocks: [...PLACES, { id: "p5", zone: "Europe/Paris", label: "Gran", hours: null }],
      calendar_zone: "Europe/Paris",
    });
    render();
    const select = (await screen.findByLabelText("Calendar: also show times in")) as HTMLSelectElement;
    expect(select.value).toBe("Europe/Paris");
    expect(screen.getByText("Same as your own time")).toBeInTheDocument();
    expect(screen.queryByText("Not one of your places any more")).toBeNull();
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
