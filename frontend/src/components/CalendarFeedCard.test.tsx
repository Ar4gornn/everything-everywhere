/**
 * Epic 39 (AD-55): Settings → Calendar apps. The link is shown once, from the answer that
 * minted it, and never again; everything else is ordinary settings.
 */
import { render as rtlRender, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CalendarFeed, User } from "../api/types";
import { AuthProvider } from "../auth/AuthContext";
import { LanguageProvider } from "../i18n";
import { DEFAULT_PREFERENCES } from "../layout/preferences";
import { CalendarFeedCard } from "./CalendarFeedCard";

const TOKEN = "A".repeat(43);
const PATH = `/api/calendar/feed/${TOKEN}.ics`;

function json(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function me(overrides: Partial<User> = {}): User {
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
    preferences: DEFAULT_PREFERENCES,
    timezone: null,
    digest_time: "19:00",
    ...overrides,
  };
}

const ON: CalendarFeed = {
  on: true,
  layers: ["due"],
  detailed: false,
  alarm: false,
  created_at: "2026-09-28T10:00:00Z",
  last_fetched_at: null,
};
const OFF: CalendarFeed = { ...ON, on: false, layers: [], created_at: null };

function mockApi(initial: CalendarFeed = OFF, user: User = me()) {
  window.localStorage.setItem("everything-everywhere.token", "test-token");
  let feed = initial;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (url.startsWith("/api/calendar/feed/rotate")) return json({ ...feed, path: PATH });
    if (url.startsWith("/api/calendar/feed")) {
      if (method === "POST") {
        feed = ON;
        return json({ ...feed, path: PATH }, 201);
      }
      if (method === "PATCH") {
        feed = { ...feed, ...body };
        return json(feed);
      }
      if (method === "DELETE") {
        feed = OFF;
        return json(null, 204);
      }
      return json(feed);
    }
    if (url.startsWith("/api/auth/me")) return json(user);
    return json({ items: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const calls = (fetchMock: ReturnType<typeof mockApi>, method: string, prefix: string) =>
  fetchMock.mock.calls.filter(
    ([url, init]) => String(url).startsWith(prefix) && (init?.method ?? "GET") === method,
  );

function render() {
  return rtlRender(
    <AuthProvider>
      <LanguageProvider>
        <CalendarFeedCard />
      </LanguageProvider>
    </AuthProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CalendarFeedCard", () => {
  it("shows the link once, as an absolute URL, and never after a reload", async () => {
    const fetchMock = mockApi();
    const view = render();
    await userEvent.click(await screen.findByRole("button", { name: "Create a subscribe link" }));

    const field = await screen.findByLabelText("Subscribe link");
    expect((field as HTMLInputElement).value).toBe(`${window.location.origin}${PATH}`);
    expect(calls(fetchMock, "POST", "/api/calendar/feed")).toHaveLength(1);

    view.unmount();
    render();
    await screen.findByText(/It is not shown again/);
    expect(screen.queryByLabelText("Subscribe link")).toBeNull();
    expect(document.body.textContent).not.toContain(TOKEN);
  });

  it("sends the chosen layers and leaves out one whose module is off", async () => {
    const off = { ...DEFAULT_PREFERENCES, modules: { ...DEFAULT_PREFERENCES.modules, gym: false } };
    const fetchMock = mockApi(ON, me({ preferences: off }));
    render();

    const gym = await screen.findByRole("checkbox", { name: /Workouts/ });
    await waitFor(() => expect(gym).toBeDisabled());

    await userEvent.click(screen.getByRole("checkbox", { name: "Meals" }));
    await waitFor(() => expect(calls(fetchMock, "PATCH", "/api/calendar/feed")).toHaveLength(1));
    const [, init] = calls(fetchMock, "PATCH", "/api/calendar/feed")[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({ layers: ["due", "meals"] });
  });

  it("switches names and amounts on", async () => {
    const fetchMock = mockApi(ON);
    render();
    await userEvent.click(await screen.findByRole("checkbox", { name: /Show names and amounts/ }));
    await waitFor(() => expect(calls(fetchMock, "PATCH", "/api/calendar/feed")).toHaveLength(1));
    const [, init] = calls(fetchMock, "PATCH", "/api/calendar/feed")[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({ detailed: true });
  });

  it("asks before a new link, and does nothing when the answer is no", async () => {
    const fetchMock = mockApi(ON);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render();
    await userEvent.click(await screen.findByRole("button", { name: "New link" }));
    expect(confirm).toHaveBeenCalled();
    expect(calls(fetchMock, "POST", "/api/calendar/feed/rotate")).toHaveLength(0);

    confirm.mockReturnValue(true);
    await userEvent.click(screen.getByRole("button", { name: "New link" }));
    expect(await screen.findByLabelText("Subscribe link")).toBeInTheDocument();
  });

  it("turns off after asking, and offers to start again", async () => {
    const fetchMock = mockApi(ON);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render();
    await userEvent.click(await screen.findByRole("button", { name: "Turn off" }));
    expect(calls(fetchMock, "DELETE", "/api/calendar/feed")).toHaveLength(1);
    expect(
      await screen.findByRole("button", { name: "Create a subscribe link" }),
    ).toBeInTheDocument();
  });
});
