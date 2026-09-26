/**
 * Epic 36 (AD-52): Settings → Notifications, the bells on rows, and the zone filled in at
 * sign-in. The browser's push machinery is stubbed: jsdom has none.
 */
import { render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MutedRow, Pot, PushPreview, User } from "../api/types";
import { AuthProvider } from "../auth/AuthContext";
import { DEFAULT_PREFERENCES } from "../layout/preferences";
import { LanguageProvider } from "../i18n";
import { resetPushEnabled } from "../push";
import { NotificationsCard } from "./NotificationsCard";
import { NotifyBell } from "./NotifyBell";
import { SavingsCard } from "./SavingsCard";
import { ToastProvider } from "./Toast";

const ENDPOINT = "https://push.example.com/this-device";

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
    timezone: "Europe/Paris",
    digest_time: "19:00",
    ...overrides,
  };
}

function preview(overrides: Partial<PushPreview> = {}): PushPreview {
  return {
    empty: false,
    title: "Everything Everywhere",
    body: "1 item needs restocking (Milk).",
    url: "/inventory",
    local_date: "2026-09-27",
    digest_time: "19:00",
    timezone: "Europe/Paris",
    ...overrides,
  };
}

type Answer = { status: number; body?: unknown };

interface Setup {
  user?: User;
  enabled?: boolean;
  devices?: number;
  muted?: MutedRow[];
  digest?: PushPreview;
  test?: Answer;
  pots?: Pot[];
}

function mockApi(setup: Setup = {}) {
  window.localStorage.setItem("everything-everywhere.token", "test-token");
  let user = setup.user ?? me();
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (url.startsWith("/api/push/status")) {
      return json({ enabled: setup.enabled ?? true, devices: setup.devices ?? 1 });
    }
    if (url.startsWith("/api/push/preview")) return json(setup.digest ?? preview());
    if (url.startsWith("/api/push/muted")) return json({ items: setup.muted ?? [] });
    if (url.startsWith("/api/push/test")) {
      const answer = setup.test ?? { status: 204 };
      return json(answer.body ?? null, answer.status);
    }
    if (url.startsWith("/api/auth/me/preferences")) {
      user = { ...user, preferences: { ...user.preferences!, ...body } };
      return json(user);
    }
    if (url.startsWith("/api/auth/me/notification-schedule")) {
      user = { ...user, ...body };
      return json(user);
    }
    if (url.startsWith("/api/auth/me")) return json(user);
    if (url.startsWith("/api/savings/overview")) {
      return json({
        month: "2026-09",
        start: "2026-09-01",
        end: "2026-10-01",
        current_month: "2026-09",
        pots: setup.pots ?? [],
      });
    }
    if (method === "PATCH") return json({});
    return json({ items: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const calls = (fetchMock: ReturnType<typeof mockApi>, method: string, prefix: string) =>
  fetchMock.mock.calls.filter(
    ([url, init]) => String(url).startsWith(prefix) && (init?.method ?? "GET") === method,
  );

const bodyOf = (call: unknown[] | undefined) =>
  JSON.parse(String((call?.[1] as RequestInit | undefined)?.body));

/** jsdom has no push: give it a service worker holding one subscription (or none). */
function stubBrowserPush(subscribed = true) {
  const registration = {
    pushManager: {
      getSubscription: vi.fn(async () => (subscribed ? { endpoint: ENDPOINT } : null)),
    },
  };
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { ready: Promise.resolve(registration) },
  });
  vi.stubGlobal("PushManager", function PushManager() {});
  vi.stubGlobal("Notification", { permission: "granted", requestPermission: vi.fn() });
}

function render(ui: React.ReactElement) {
  return rtlRender(
    <AuthProvider>
      <LanguageProvider>
        <ToastProvider>{ui}</ToastProvider>
      </LanguageProvider>
    </AuthProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  resetPushEnabled();
  stubBrowserPush();
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("NotificationsCard", () => {
  it("is not drawn when the instance cannot send pushes", async () => {
    const fetchMock = mockApi({ enabled: false });
    render(<NotificationsCard />);
    await waitFor(() => expect(calls(fetchMock, "GET", "/api/push/status")).toHaveLength(1));
    expect(screen.queryByRole("heading", { name: "Notifications" })).not.toBeInTheDocument();
  });

  it("shows each kind with its default, and saves a change as the whole subtree", async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    render(<NotificationsCard />);

    expect(await screen.findByRole("checkbox", { name: "Items to restock" })).toBeChecked();
    const due = screen.getByRole("checkbox", { name: "Recurring entries due tomorrow" });
    expect(due).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Savings goals falling behind" })).not.toBeChecked();

    await user.click(due);
    await waitFor(() => expect(calls(fetchMock, "PATCH", "/api/auth/me/preferences")).toHaveLength(1));
    expect(bodyOf(calls(fetchMock, "PATCH", "/api/auth/me/preferences")[0])).toEqual({
      notifications: { ...DEFAULT_PREFERENCES.notifications, due_tomorrow: true },
    });
    // The preview is asked again, since what it says just changed.
    await waitFor(() => expect(calls(fetchMock, "GET", "/api/push/preview").length).toBeGreaterThan(1));
  });

  it("disables a kind whose module is off, and says why", async () => {
    mockApi({
      user: me({
        preferences: {
          ...DEFAULT_PREFERENCES,
          modules: { ...DEFAULT_PREFERENCES.modules, stock: false },
        },
      }),
    });
    render(<NotificationsCard />);
    const stock = await screen.findByRole("checkbox", { name: /Items to restock/ });
    expect(stock).toBeDisabled();
    expect(stock).not.toBeChecked();
    expect(screen.getByText(/module turned off/)).toBeInTheDocument();
  });

  it("previews tonight's words, or says nothing would be sent", async () => {
    mockApi();
    const first = render(<NotificationsCard />);
    expect(await screen.findByText("1 item needs restocking (Milk).")).toBeInTheDocument();
    expect(screen.getByText(/At 19:00 \(Europe\/Paris\)/)).toBeInTheDocument();
    first.unmount();

    mockApi({ digest: preview({ empty: true, body: null, timezone: null }) });
    render(<NotificationsCard />);
    expect(await screen.findByText(/Nothing to say right now/)).toBeInTheDocument();
    expect(screen.getByText(/the server’s clock/)).toBeInTheDocument();
  });

  it("saves the hour and the zone together", async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    render(<NotificationsCard />);

    await screen.findByText("1 item needs restocking (Milk).");
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled(); // nothing changed yet
    const time = screen.getByLabelText("Arrives at");
    await user.clear(time);
    await user.type(time, "07:30");
    await user.selectOptions(screen.getByLabelText("Time zone"), "UTC");
    await user.click(save);

    await waitFor(() =>
      expect(calls(fetchMock, "PATCH", "/api/auth/me/notification-schedule")).toHaveLength(1),
    );
    expect(bodyOf(calls(fetchMock, "PATCH", "/api/auth/me/notification-schedule")[0])).toEqual({
      timezone: "UTC",
      digest_time: "07:30",
    });
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  it("offers nothing to save while the account is still loading", async () => {
    const fetchMock = mockApi();
    const answered = fetchMock.getMockImplementation()!;
    // /me never answers: the fields show defaults, which are not a change to save.
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      url === "/api/auth/me" ? new Promise<Response>(() => {}) : answered(url, init),
    );
    render(<NotificationsCard />);
    expect(await screen.findByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("lists every muted row and unmutes each through its own endpoint", async () => {
    const fetchMock = mockApi({
      muted: [
        { kind: "recurring", id: "r1", name: "Flat" },
        { kind: "savings", id: "s1", name: "Car" },
        { kind: "stock", id: "i1", name: "Eggs" },
      ],
    });
    const user = userEvent.setup();
    render(<NotificationsCard />);

    const list = await screen.findByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);

    for (const [name, prefix] of [
      ["Flat", "/api/recurring/templates/r1"],
      ["Car", "/api/savings/types/s1"],
      ["Eggs", "/api/inventory/items/i1"],
    ] as const) {
      await user.click(
        screen.getByRole("button", { name: `Mention ${name} in notifications again` }),
      );
      await waitFor(() => expect(calls(fetchMock, "PATCH", prefix)).toHaveLength(1));
      expect(bodyOf(calls(fetchMock, "PATCH", prefix)[0])).toEqual({ notify: true });
    }
  });

  it("says when nothing is muted, and where the bells are", async () => {
    mockApi();
    render(<NotificationsCard />);
    expect(await screen.findByText(/Nothing is muted/)).toBeInTheDocument();
  });

  it("sends a test to this device's endpoint and says it does not count as today's", async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    render(<NotificationsCard />);

    await user.click(await screen.findByRole("button", { name: "Send a test" }));
    await waitFor(() => expect(calls(fetchMock, "POST", "/api/push/test")).toHaveLength(1));
    expect(bodyOf(calls(fetchMock, "POST", "/api/push/test")[0])).toEqual({ endpoint: ENDPOINT });
    expect(
      await screen.findByText("Sent to this device. It does not count as today’s notification."),
    ).toBeInTheDocument();
  });

  it("words a second test inside the minute from its code", async () => {
    mockApi({
      test: { status: 429, body: { detail: "too soon", code: "push_test_too_soon" } },
    });
    const user = userEvent.setup();
    render(<NotificationsCard />);
    await user.click(await screen.findByRole("button", { name: "Send a test" }));
    expect(
      await screen.findByText(/A test went to this device less than a minute ago/),
    ).toBeInTheDocument();
  });

  it("asks for the device to be turned on when this browser is not subscribed", async () => {
    stubBrowserPush(false);
    const fetchMock = mockApi();
    const user = userEvent.setup();
    render(<NotificationsCard />);
    await user.click(await screen.findByRole("button", { name: "Send a test" }));
    expect(await screen.findByText(/Turn them on first/)).toBeInTheDocument();
    expect(calls(fetchMock, "POST", "/api/push/test")).toHaveLength(0);
  });

  it("reads in French", async () => {
    mockApi({ user: me({ language: "fr" }) });
    render(<NotificationsCard />);
    expect(
      await screen.findByRole("checkbox", { name: "Opérations récurrentes prévues demain" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Envoyer un test" })).toBeInTheDocument();
  });
});

describe("NotifyBell", () => {
  it("is a toggle that names the row and asks for the opposite", async () => {
    mockApi();
    const onToggle = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<NotifyBell on name="Milk" onToggle={onToggle} />);
    const bell = await screen.findByRole("button", { name: "Stop mentioning Milk in notifications" });
    expect(bell).toHaveAttribute("aria-pressed", "true");
    await user.click(bell);
    expect(onToggle).toHaveBeenCalledWith(false);

    rerender(
      <AuthProvider>
        <LanguageProvider>
          <NotifyBell on={false} name="Milk" onToggle={onToggle} />
        </LanguageProvider>
      </AuthProvider>,
    );
    expect(
      await screen.findByRole("button", { name: "Mention Milk in notifications again" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("appears on a pot only when the instance can push, and mutes it", async () => {
    const pot: Pot = {
      savings_type_id: "p1",
      name: "Holidays",
      balance: "300.00",
      saved: "0.00",
      target: null,
      due: null,
      skipped: false,
      goal_amount: null,
      goal_date: null,
      needed_per_month: null,
      notify: true,
    };
    const fetchMock = mockApi({ pots: [pot] });
    const user = userEvent.setup();
    render(<SavingsCard />);
    await user.click(
      await screen.findByRole("button", { name: "Stop mentioning Holidays in notifications" }),
    );
    await waitFor(() => expect(calls(fetchMock, "PATCH", "/api/savings/types/p1")).toHaveLength(1));
    expect(bodyOf(calls(fetchMock, "PATCH", "/api/savings/types/p1")[0])).toEqual({ notify: false });
  });

  it("is not drawn on a pot when the instance cannot push", async () => {
    const fetchMock = mockApi({
      enabled: false,
      pots: [
        {
          savings_type_id: "p1",
          name: "Holidays",
          balance: "300.00",
          saved: "0.00",
          target: null,
          due: null,
          skipped: false,
          goal_amount: null,
          goal_date: null,
          needed_per_month: null,
          notify: true,
        },
      ],
    });
    render(<SavingsCard />);
    expect(await screen.findByText("Balance $300.00")).toBeInTheDocument();
    await waitFor(() => expect(calls(fetchMock, "GET", "/api/push/status")).toHaveLength(1));
    expect(screen.queryByRole("button", { name: /in notifications/ })).not.toBeInTheDocument();
  });
});

describe("the account's zone", () => {
  it("is filled from this browser once, when the account has none", async () => {
    const fetchMock = mockApi({ user: me({ timezone: null }) });
    render(<p>signed in</p>);
    await waitFor(() =>
      expect(calls(fetchMock, "PATCH", "/api/auth/me/notification-schedule")).toHaveLength(1),
    );
    const sent = bodyOf(calls(fetchMock, "PATCH", "/api/auth/me/notification-schedule")[0]);
    expect(sent).toEqual({
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      digest_time: "19:00",
    });
  });

  it("is never overwritten, and never sent to a server that predates it", async () => {
    for (const user of [me({ timezone: "Asia/Tokyo" }), me({ timezone: undefined })]) {
      const fetchMock = mockApi({ user });
      const view = render(<p>signed in</p>);
      await waitFor(() => expect(calls(fetchMock, "GET", "/api/auth/me")).toHaveLength(1));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(calls(fetchMock, "PATCH", "/api/auth/me/notification-schedule")).toHaveLength(0);
      view.unmount();
    }
  });
});
