import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "../auth/AuthContext";
import * as outbox from "../entries/outbox";
import { DashboardPage } from "../pages/DashboardPage";
import { EntriesPage } from "../pages/EntriesPage";
import { translator } from "../i18n/catalogue";
import { onAPhone } from "../test/phone";
import { QuickAddProvider, useQuickAdd } from "./QuickAdd/QuickAddContext";

/**
 * Epic 45 (AD-61): the "Waiting to send" card on Entries and the dashboard's one line. The
 * queue is mocked; what is asserted is what the page does with it.
 */

vi.mock("../entries/outbox", () => ({
  flushEntries: vi.fn(),
  useEntryOutbox: vi.fn(),
  countUnsent: vi.fn(),
  discardEntry: vi.fn(),
  clearEntriesStore: vi.fn(),
  useIsSending: vi.fn(() => false),
}));

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const entry = (ref: string, over: Partial<outbox.QueuedEntry> = {}) =>
  ({
    client_ref: ref,
    body: { kind: "expense", amount: "3.50", occurred_on: "2026-10-02", client_ref: ref },
    category_name: "Coffee",
    queued_at: "2026-10-02T08:00:00Z",
    refused: null,
    ...over,
  }) as outbox.QueuedEntry;

const summary = {
  month: "2026-10",
  period: "month",
  label: "2026-10",
  start: "2026-10-01",
  end: "2026-10-31",
  income: "0.00",
  expense: "0.00",
  net: "0.00",
  saved: "0.00",
  budgets: [],
  savings: [],
};

const trends = { months: [], income: [], expense: [], saved: [], expense_by_category: [] };

let fetchCalls: string[];

function setup(queue: outbox.QueuedEntry[]) {
  vi.mocked(outbox.useEntryOutbox).mockReturnValue(queue);
  fetchCalls = [];
  window.localStorage.setItem("everything-everywhere.token", "test-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchCalls.push(url);
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
      if (url.includes("/api/dashboard/summary")) return json(summary);
      if (url.includes("/api/dashboard/trends")) return json(trends);
      if (url.includes("/api/savings/overview")) return json({ pots: [] });
      return json({ items: [] });
    }),
  );
}

function SheetProbe() {
  const { isOpen, options, version } = useQuickAdd();
  return (
    <>
      <div data-testid="version">{version}</div>
      {isOpen && <div data-testid="sheet">{options.draft?.client_ref ?? "no-draft"}</div>}
    </>
  );
}

function mount(ui: React.ReactElement) {
  return render(
    <AuthProvider>
      <MemoryRouter>
        <QuickAddProvider>
          {ui}
          <SheetProbe />
        </QuickAddProvider>
      </MemoryRouter>
    </AuthProvider>,
  );
}

beforeEach(() => {
  vi.mocked(outbox.flushEntries).mockReset();
  vi.mocked(outbox.discardEntry).mockReset();
  vi.mocked(outbox.useIsSending).mockReset();
  vi.mocked(outbox.useIsSending).mockReturnValue(false);
});
afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("the Waiting card on Entries (desktop)", () => {
  it("is absent when nothing waits", async () => {
    setup([]);
    mount(<EntriesPage />);
    await screen.findByRole("form", { name: "Record an entry" });
    expect(screen.queryByText("Waiting to send")).toBeNull();
  });

  it("lists each entry: category, amount, date; and the hint", async () => {
    setup([entry("a"), entry("b", { category_name: "Bread" })]);
    mount(<EntriesPage />);
    const card = (await screen.findByText("Waiting to send")).closest("section") as HTMLElement;
    expect(within(card).getByText(/on this device only/i)).toBeInTheDocument();
    expect(within(card).getByText("Coffee")).toBeInTheDocument();
    expect(within(card).getByText("Bread")).toBeInTheDocument();
    expect(within(card).getAllByText("−3.50")).toHaveLength(2);
  });

  it("shows why a refused entry was not sent, with no Edit on a desktop", async () => {
    setup([entry("a", { refused: "validation" })]);
    mount(<EntriesPage />);
    const card = (await screen.findByText("Waiting to send")).closest("section") as HTMLElement;
    expect(within(card).getByText(/^Not sent: /)).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Edit" })).toBeNull();
    expect(within(card).getByRole("button", { name: "Discard" })).toBeInTheDocument();
  });

  it("translates a code the app has a sentence for", async () => {
    setup([entry("a", { refused: "network" })]);
    mount(<EntriesPage />);
    const row = await screen.findByText(/^Not sent: /);
    expect(row.textContent).not.toBe("Not sent: network");
  });

  it("falls back to the translated generic sentence when no sentence exists for the code", async () => {
    setup([entry("a", { refused: "zz_unknown_code" })]);
    mount(<EntriesPage />);
    expect(
      await screen.findByText(`Not sent: ${translator("en")("entries.couldNotSave")}`),
    ).toBeInTheDocument();
    expect(screen.queryByText(/zz_unknown_code/)).toBeNull();
  });

  it("discards after a yes", async () => {
    setup([entry("a")]);
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    mount(<EntriesPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Discard" }));
    expect(confirm).toHaveBeenCalledWith(translator("en")("offline.discardWaitingConfirm"));
    expect(translator("en")("offline.discardWaitingConfirm")).not.toMatch(/never recorded/);
    expect(outbox.discardEntry).toHaveBeenCalledWith("u1", "a");
  });

  it("a refused entry's confirm still says it was never recorded", async () => {
    setup([entry("a", { refused: "validation" })]);
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    mount(<EntriesPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Discard" }));
    expect(confirm).toHaveBeenCalledWith(translator("en")("offline.discardConfirm"));
  });

  it("hides Discard while that entry is being sent", async () => {
    setup([entry("a")]);
    vi.mocked(outbox.useIsSending).mockReturnValue(true);
    mount(<EntriesPage />);
    await screen.findByText("Waiting to send");
    expect(screen.queryByRole("button", { name: "Discard" })).toBeNull();
  });

  it("keeps the entry after a no", async () => {
    setup([entry("a")]);
    vi.stubGlobal("confirm", vi.fn(() => false));
    mount(<EntriesPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Discard" }));
    expect(outbox.discardEntry).not.toHaveBeenCalled();
  });

  it("Send now flushes, then refreshes the list when something went", async () => {
    setup([entry("a")]);
    vi.mocked(outbox.flushEntries).mockResolvedValue({ sent: 1, pending: 0, refused: 0 });
    mount(<EntriesPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Send now" }));
    expect(outbox.flushEntries).toHaveBeenCalledWith("u1");
    await waitFor(() => expect(screen.getByTestId("version")).toHaveTextContent("1"));
  });

  it("Send now leaves the list alone when nothing went", async () => {
    setup([entry("a")]);
    vi.mocked(outbox.flushEntries).mockResolvedValue({ sent: 0, pending: 1, refused: 0 });
    mount(<EntriesPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Send now" }));
    await waitFor(() => expect(outbox.flushEntries).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button", { name: "Send now" })).toBeEnabled());
    expect(screen.getByTestId("version")).toHaveTextContent("0");
  });
});

describe("the Waiting card on Entries (phone)", () => {
  onAPhone();

  it("Edit on a refused entry opens the sheet with that entry as the draft", async () => {
    const refused = entry("r1", { refused: "validation" });
    setup([entry("a"), refused]);
    mount(<EntriesPage />);
    const card = (await screen.findByText("Waiting to send")).closest("section") as HTMLElement;
    // a merely waiting entry cannot be edited: only the refused one carries Edit
    expect(within(card).getAllByRole("button", { name: "Edit" })).toHaveLength(1);
    await userEvent.click(within(card).getByRole("button", { name: "Edit" }));
    await waitFor(() => expect(screen.getByTestId("sheet")).toHaveTextContent("r1"));
  });
});

describe("the dashboard line (Epic 45)", () => {
  it("says one entry has not been sent, linking to Entries", async () => {
    setup([entry("a")]);
    mount(<DashboardPage />);
    const link = await screen.findByRole("link", {
      name: "1 entry not sent yet — not in these totals",
    });
    expect(link).toHaveAttribute("href", "/entries");
  });

  it("is its own line: it shows even before the stats card has any data", async () => {
    setup([entry("a")]);
    const answer = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        String(input).includes("/api/dashboard/summary")
          ? new Promise<Response>(() => undefined)
          : answer(input, init),
      ),
    );
    mount(<DashboardPage />);
    const link = await screen.findByRole("link", {
      name: "1 entry not sent yet — not in these totals",
    });
    expect(link.closest(".grid")).toBeNull();
    expect(screen.queryByText("Net")).toBeNull();
  });

  it("says how many, in the plural", async () => {
    setup([entry("a"), entry("b", { refused: "validation" })]);
    mount(<DashboardPage />);
    expect(
      await screen.findByRole("link", { name: "2 entries not sent yet — not in these totals" }),
    ).toBeInTheDocument();
  });

  it("draws nothing at zero", async () => {
    setup([]);
    mount(<DashboardPage />);
    await waitFor(() => expect(fetchCalls.some((u) => u.includes("/api/dashboard/summary"))).toBe(true));
    await screen.findByText("Net");
    expect(screen.queryByText(/not sent yet/)).toBeNull();
  });
});
