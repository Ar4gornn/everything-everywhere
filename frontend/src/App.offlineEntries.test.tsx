import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { ToastProvider } from "./components/Toast";
import * as outbox from "./entries/outbox";
import { onAPhone } from "./test/phone";
import { PRELOAD_TIMEOUT, preloadPages } from "./test/preloadPages";
import { ThemeProvider } from "./theme";

/**
 * Epic 45 (AD-61), the app-level wiring: entries on the device are sent when the app opens and
 * when the network returns, a send that landed refreshes the pages behind (the provider's
 * `version`), and the + says how many wait. The queue itself is Builder B's and is mocked here.
 */

vi.mock("./entries/outbox", () => ({
  flushEntries: vi.fn(),
  useEntryOutbox: vi.fn(),
  countUnsent: vi.fn(),
  discardEntry: vi.fn(),
  clearEntriesStore: vi.fn(),
}));

// The sheet is not under test; it shows the provider's version so a bump is observable.
vi.mock("./components/QuickAdd/QuickAddSheet", async () => {
  const { useQuickAdd } = await import("./components/QuickAdd/QuickAddContext");
  return {
    QuickAddSheet() {
      const { version } = useQuickAdd();
      return <div data-testid="version">{version}</div>;
    },
  };
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const entry = (ref: string, refused: string | null = null) =>
  ({
    client_ref: ref,
    body: { kind: "expense", amount: "3.50", occurred_on: "2026-10-02", client_ref: ref },
    category_name: "Coffee",
    queued_at: "2026-10-02T08:00:00Z",
    refused,
  }) as outbox.QueuedEntry;

function mount(queue: outbox.QueuedEntry[]) {
  vi.mocked(outbox.useEntryOutbox).mockReturnValue(queue);
  window.localStorage.setItem("everything-everywhere.token", "test-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/api/auth/me")) {
        return json({
          id: "u1",
          email: "sam@example.com",
          currency: "USD",
          weight_unit: "kg",
          budget_start_day: 1,
          created_at: "",
        });
      }
      if (url.includes("/api/books/quotes/draw")) return json(null);
      if (url.includes("/api/mood/history")) return json({ days: [], counts: [] });
      if (url.includes("/api/savings/overview")) return json({ pots: [] });
      return json({ items: [] });
    }),
  );
  return render(
    <AuthProvider>
      <ToastProvider>
        <ThemeProvider>
          <MemoryRouter initialEntries={["/entries"]}>
            <App />
          </MemoryRouter>
        </ThemeProvider>
      </ToastProvider>
    </AuthProvider>,
  );
}

const ready = () => screen.findByRole("navigation", { name: "Sections" });

beforeAll(() => preloadPages(), PRELOAD_TIMEOUT);

describe("sending entries from the app shell (Epic 45)", () => {
  onAPhone();
  beforeEach(() => {
    vi.mocked(outbox.flushEntries).mockReset();
    vi.mocked(outbox.flushEntries).mockResolvedValue({ sent: 0, pending: 0, refused: 0 });
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it("flushes the account's queue when the app opens", async () => {
    mount([]);
    await ready();
    await waitFor(() => expect(outbox.flushEntries).toHaveBeenCalledWith("u1"));
  });

  it("flushes again when the network comes back", async () => {
    mount([]);
    await ready();
    await waitFor(() => expect(outbox.flushEntries).toHaveBeenCalledTimes(1));
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(outbox.flushEntries).toHaveBeenCalledTimes(2));
  });

  it("refreshes the pages behind when something was sent", async () => {
    vi.mocked(outbox.flushEntries).mockResolvedValue({ sent: 2, pending: 0, refused: 0 });
    mount([]);
    await ready();
    await waitFor(() => expect(screen.getByTestId("version")).toHaveTextContent("1"));
  });

  it("does not refresh anything when nothing was sent", async () => {
    mount([]);
    await ready();
    await waitFor(() => expect(outbox.flushEntries).toHaveBeenCalled());
    // let the resolved promise settle before looking
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("version")).toHaveTextContent("0");
  });
});

describe("the + counts what waits (Epic 45)", () => {
  onAPhone();
  beforeEach(() => {
    vi.mocked(outbox.flushEntries).mockResolvedValue({ sent: 0, pending: 0, refused: 0 });
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it("names one waiting entry, in the singular, and draws the count", async () => {
    mount([entry("a")]);
    await ready();
    const plus = await screen.findByRole("button", { name: "Add an entry, 1 waiting to send" });
    expect(plus).toHaveTextContent("1");
  });

  it("names several, waiting and refused alike", async () => {
    mount([entry("a"), entry("b", "validation"), entry("c")]);
    await ready();
    const plus = await screen.findByRole("button", { name: "Add an entry, 3 waiting to send" });
    expect(plus).toHaveTextContent("3");
  });

  it("is plain when nothing waits", async () => {
    mount([]);
    await ready();
    await waitFor(() => expect(document.querySelector(".fab:not(.fab-note)")).not.toBeNull());
    const plus = document.querySelector(".fab:not(.fab-note)") as HTMLElement;
    expect(plus).toHaveAttribute("aria-label", "Add an entry");
    expect(plus.querySelector(".fab-badge")).toBeNull();
  });
});
