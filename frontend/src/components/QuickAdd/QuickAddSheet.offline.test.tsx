import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { storeTokens } from "../../api/client";
import type { Category, Pot, QuickPicks, User } from "../../api/types";
import { AuthProvider, useOptionalAuth } from "../../auth/AuthContext";
import { readOutbox, writePicksCache, type QueuedEntry } from "../../entries/outbox";
import { LanguageProvider } from "../../i18n";
import { translator } from "../../i18n/catalogue";
import { ToastProvider } from "../Toast";
import { QuickAddProvider, useQuickAdd } from "./QuickAddContext";
import { QuickAddSheet } from "./QuickAddSheet";

/**
 * The quick-add sheet with an account (Epic 45, AD-61; spec docs/epic-45-offline-entries.md
 * §2 Device and §3). What is held: Save goes through the device queue and says whether the entry
 * was sent or only saved on the phone; Undo takes back a queued entry without the server; a
 * refused entry stays on the device and the next Save replaces it; a draft opens prefilled and
 * its Save keeps the same ref; the chips render from the device copy at once and offline.
 * Epic 44's behaviours without an account are in QuickAddSheet.test.tsx.
 */

const notify = vi.hoisted(() => vi.fn());
vi.mock("../Tutorial/useTutorial", () => ({ useTutorial: () => ({ notify }) }));

const en = translator("en");
const U = "u1";
const OUTBOX_KEY = `everything-everywhere.entries.${U}.outbox`;

const USER = {
  id: U,
  email: "alex@example.com",
  weight_unit: "kg",
  currency: "EUR",
  language: "en",
  budget_start_day: 1,
  created_at: "2031-01-01T00:00:00Z",
} as unknown as User;

beforeAll(() => {
  const proto = HTMLDialogElement.prototype;
  proto.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  proto.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

const PICKS: QuickPicks = {
  expense: {
    categories: [
      { id: "c1", name: "Groceries", uses: 9, default_savings_type_id: "p1" },
      { id: "c3", name: "Fuel", uses: 4, default_savings_type_id: null },
    ],
    combos: [],
  },
  income: {
    categories: [{ id: "c2", name: "Salary", uses: 2, default_savings_type_id: null }],
    combos: [],
  },
  vendors: [],
};

const CATEGORIES: Category[] = [
  { id: "c1", kind: "expense", name: "Groceries", default_savings_type_id: "p1", created_at: "" },
  { id: "c3", kind: "expense", name: "Fuel", created_at: "" },
];

const POTS = [{ savings_type_id: "p1", name: "Holiday", balance: "100.00" }] as unknown as Pot[];

function json(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown> | undefined;
}

let calls: Call[];
let picksAnswer: () => Promise<Response> | Response;
let createAnswer: () => Promise<Response> | Response;

function stubFetch() {
  calls = [];
  picksAnswer = () => json(PICKS);
  createAnswer = () => json({ id: "srv-1" }, 201);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.includes("/api/auth/me")) return json(USER);
      if (url.includes("/api/entries/quick-picks")) return picksAnswer();
      if (url.endsWith("/api/entries") && method === "POST") return createAnswer();
      if (/\/api\/entries\/[^/]+$/.test(url) && method === "DELETE") return json(undefined, 204);
      if (url.includes("/api/categories")) return json({ items: CATEGORIES });
      if (url.includes("/api/savings/overview")) return json({ pots: POTS });
      return json({ items: [] });
    }),
  );
}

const posts = () => calls.filter((c) => c.method === "POST" && c.url.endsWith("/api/entries"));
const deletes = () => calls.filter((c) => c.method === "DELETE");

function draftOf(over: Partial<QueuedEntry["body"]> = {}, refused: string | null = "pot_not_found") {
  return {
    client_ref: "11111111-1111-4111-8111-111111111111",
    body: {
      kind: "expense",
      amount: "12.5",
      occurred_on: "2031-05-04",
      category_name: "Pets",
      vendor_name: "Zoo Shop",
      note: "treats",
      savings_type_id: "p1",
      client_ref: "11111111-1111-4111-8111-111111111111",
      ...over,
    },
    category_name: over.category_name ?? "Pets",
    queued_at: "2031-05-04T10:00:00Z",
    refused,
  } as QueuedEntry;
}

function Harness({ draft }: { draft?: QueuedEntry }) {
  const { open, isOpen, version } = useQuickAdd();
  const who = useOptionalAuth()?.user?.id ?? "nobody";
  return (
    <>
      <button type="button" onClick={() => open()}>
        open-it
      </button>
      <button type="button" onClick={() => open(draft ? { draft } : undefined)}>
        open-draft
      </button>
      <output aria-label="state">{isOpen ? "open" : "closed"}</output>
      <output aria-label="version">{String(version)}</output>
      <output aria-label="who">{who}</output>
    </>
  );
}

async function mount(draft?: QueuedEntry) {
  render(
    <MemoryRouter>
      <AuthProvider>
        <LanguageProvider>
          <ToastProvider>
            <QuickAddProvider>
              <Harness {...(draft ? { draft } : {})} />
              <QuickAddSheet />
            </QuickAddProvider>
          </ToastProvider>
        </LanguageProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
  // The queue is keyed by the account: wait until the sheet knows who is signed in.
  await waitFor(() => expect(screen.getByLabelText("who")).toHaveTextContent(U));
}

const amountInput = () => screen.getByLabelText("Amount in EUR") as HTMLInputElement;
const dialog = () => document.querySelector("dialog") as HTMLDialogElement;
const version = () => screen.getByLabelText("version").textContent;
const queue = () => readOutbox(U);

async function openSheet(user: ReturnType<typeof userEvent.setup>, name = "open-it") {
  await user.click(screen.getByRole("button", { name }));
  await screen.findByRole("button", { name: "Fuel" });
}

async function fillFuel(user: ReturnType<typeof userEvent.setup>, amount = "7") {
  await user.type(amountInput(), amount);
  await user.click(screen.getByRole("button", { name: "Fuel" }));
}

/** From now on the network is gone: every request rejects as `fetch` does offline. */
function goOffline() {
  const online = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/api/auth/me")) return online(input, init);
      throw new TypeError("Failed to fetch");
    }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  storeTokens({ access_token: "a", refresh_token: "r", token_type: "bearer", expires_in: 3600 });
  notify.mockClear();
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Save goes through the device queue", () => {
  it("says 'Entry saved' when the server took it, with the ref in the body and nothing left queued", async () => {
    const user = userEvent.setup();
    await mount();
    await openSheet(user);
    await fillFuel(user);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(dialog().open).toBe(false));
    expect(screen.getByText(en("quickAdd.saved"))).toBeInTheDocument();
    expect(posts()).toHaveLength(1);
    expect(posts()[0]?.body).toMatchObject({ category_name: "Fuel", amount: "7" });
    expect(posts()[0]?.body?.["client_ref"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(queue()).toEqual([]);
    expect(version()).toBe("1");
    expect(notify).toHaveBeenCalledWith("entry-created");
  });

  it("deletes the server's entry on Undo after a sent save", async () => {
    const user = userEvent.setup();
    await mount();
    await openSheet(user);
    await fillFuel(user);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(deletes()).toHaveLength(1));
    expect(deletes()[0]?.url).toMatch(/\/api\/entries\/srv-1$/);
    expect(version()).toBe("2");
  });

  it("says it is saved on the phone when the network is down, keeps the entry, does not bump", async () => {
    const user = userEvent.setup();
    await mount();
    await openSheet(user);
    goOffline();
    await fillFuel(user, "12,5");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(dialog().open).toBe(false));
    expect(screen.getByText(en("offline.savedQueued"))).toBeInTheDocument();
    expect(screen.queryByText(en("quickAdd.saved"))).toBeNull();
    expect(queue()).toHaveLength(1);
    expect(queue()[0]).toMatchObject({
      category_name: "Fuel",
      refused: null,
      body: { amount: "12.5", category_name: "Fuel" },
    });
    expect(version()).toBe("0");
    expect(notify).toHaveBeenCalledWith("entry-created");
  });

  it("takes a queued entry off the device on Undo, without asking the server", async () => {
    const user = userEvent.setup();
    await mount();
    await openSheet(user);
    goOffline();
    await fillFuel(user);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    await screen.findByText(en("quickAdd.undone"));
    expect(queue()).toEqual([]);
    expect(deletes()).toHaveLength(0);
    expect(version()).toBe("1");
  });

  it("shows the queued wording in the inline row of Save & add another, and Undo clears it", async () => {
    const user = userEvent.setup();
    await mount();
    await openSheet(user);
    goOffline();
    await fillFuel(user);
    await user.click(screen.getByRole("button", { name: "Save & add another" }));
    const row = () => within(dialog()).getByRole("status");
    await waitFor(() => expect(row()).toHaveTextContent(en("offline.savedQueued")));
    expect(dialog().open).toBe(true);
    await user.click(within(row()).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(row()).toHaveTextContent(en("quickAdd.undone")));
    expect(queue()).toEqual([]);
  });

  it("shows the sent wording in the inline row when the server took it", async () => {
    const user = userEvent.setup();
    await mount();
    await openSheet(user);
    await fillFuel(user);
    await user.click(screen.getByRole("button", { name: "Save & add another" }));
    await waitFor(() =>
      expect(within(dialog()).getByRole("status")).toHaveTextContent(en("quickAdd.saved")),
    );
    expect(version()).toBe("1");
  });
});

describe("a refused entry", () => {
  it("stays open with the reason, stays on the device marked, and the next Save replaces it", async () => {
    createAnswer = () => json({ detail: "nope", code: "pot_not_found" }, 422);
    const user = userEvent.setup();
    await mount();
    await openSheet(user);
    await fillFuel(user);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(dialog().open).toBe(true);
    expect(queue()).toHaveLength(1);
    expect(queue()[0]?.refused).toBe("pot_not_found");
    expect(version()).toBe("0");
    expect(notify).not.toHaveBeenCalled();
    const firstRef = queue()[0]?.client_ref;

    createAnswer = () => json({ id: "srv-2" }, 201);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(dialog().open).toBe(false));
    // One entry, one ref: the fix replaced the refused item instead of queueing a second.
    expect(posts()).toHaveLength(2);
    expect(posts()[1]?.body?.["client_ref"]).toBe(firstRef);
    expect(queue()).toEqual([]);
    expect(screen.getByText(en("quickAdd.saved"))).toBeInTheDocument();
  });
});

describe("opened from a refused entry (a draft)", () => {
  it("prefills every field from the queued body", async () => {
    const user = userEvent.setup();
    await mount(draftOf({ quantity: "2", unit: "kg" }));
    await openSheet(user, "open-draft");
    expect(amountInput()).toHaveValue("12.5");
    expect(screen.getByLabelText("Date")).toHaveValue("2031-05-04");
    expect(screen.getByLabelText("Category")).toHaveValue("Pets");
    expect(screen.getByLabelText("Vendor")).toHaveValue("Zoo Shop");
    expect(screen.getByLabelText("Note")).toHaveValue("treats");
    expect(screen.getByLabelText("Paid from")).toHaveValue("p1");
    expect(screen.getByLabelText("Quantity")).toHaveValue("2");
    expect(screen.getByLabelText("Unit")).toHaveValue("kg");
    expect(screen.getByRole("button", { name: "Expense" })).toHaveAttribute("aria-pressed", "true");
  });

  it("selects the chip when the draft's category is one of the chips", async () => {
    const user = userEvent.setup();
    await mount(draftOf({ category_name: "Fuel", savings_type_id: undefined }));
    await openSheet(user, "open-draft");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Fuel" })).toHaveAttribute("aria-pressed", "true"),
    );
  });

  it("Save sends the draft's own client_ref and replaces the item", async () => {
    window.localStorage.setItem(OUTBOX_KEY, JSON.stringify([draftOf()]));
    const user = userEvent.setup();
    await mount(draftOf());
    await openSheet(user, "open-draft");
    await user.clear(amountInput());
    await user.type(amountInput(), "9");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(dialog().open).toBe(false));
    // The sheet's open also tries the queue; the refused item is not resent by it.
    expect(posts()).toHaveLength(1);
    expect(posts()[0]?.body).toMatchObject({
      client_ref: "11111111-1111-4111-8111-111111111111",
      amount: "9",
      category_name: "Pets",
      vendor_name: "Zoo Shop",
    });
    expect(queue()).toEqual([]);
  });

  it("a plain open afterwards does not carry the draft's ref", async () => {
    window.localStorage.setItem(OUTBOX_KEY, JSON.stringify([draftOf()]));
    const user = userEvent.setup();
    await mount(draftOf());
    await openSheet(user, "open-draft");
    await user.click(screen.getByRole("button", { name: "Close" }));
    await openSheet(user);
    expect(amountInput()).toHaveValue("");
    await fillFuel(user);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]?.body?.["client_ref"]).not.toBe("11111111-1111-4111-8111-111111111111");
    expect(queue().map((entry) => entry.client_ref)).toEqual([
      "11111111-1111-4111-8111-111111111111",
    ]);
  });
});

describe("the chips on the device", () => {
  const cached = () =>
    writePicksCache(U, { picks: PICKS, categories: CATEGORIES, vendors: [], pots: POTS });

  it("renders from the device copy before the server answers, then from the answer", async () => {
    cached();
    let release: (r: Response) => void = () => undefined;
    picksAnswer = () => new Promise<Response>((resolve) => (release = resolve));
    const user = userEvent.setup();
    await mount();
    await user.click(screen.getByRole("button", { name: "open-it" }));
    // Nothing has come from the server yet, and the chips are already there.
    expect(screen.getByRole("button", { name: "Fuel" })).toBeInTheDocument();
    expect(screen.queryByText(en("quickAdd.picksFailed"))).toBeNull();
    const fresh: QuickPicks = {
      ...PICKS,
      expense: {
        ...PICKS.expense,
        categories: [{ id: "c9", name: "Newest", uses: 1, default_savings_type_id: null }],
      },
    };
    await act(async () => release(json(fresh)));
    await screen.findByRole("button", { name: "Newest" });
    expect(screen.queryByRole("button", { name: "Fuel" })).toBeNull();
  });

  it("writes the copy after a good load", async () => {
    const user = userEvent.setup();
    await mount();
    await openSheet(user);
    await waitFor(() =>
      expect(window.localStorage.getItem(`everything-everywhere.entries.${U}.picks`)).toContain(
        "Groceries",
      ),
    );
  });

  it("offline: keeps the copy, shows a quiet note and no error banner", async () => {
    cached();
    picksAnswer = () => {
      throw new TypeError("Failed to fetch");
    };
    const user = userEvent.setup();
    await mount();
    await user.click(screen.getByRole("button", { name: "open-it" }));
    await screen.findByText(en("offline.cachedChips"));
    expect(screen.getByRole("button", { name: "Fuel" })).toBeInTheDocument();
    expect(screen.queryByText(en("quickAdd.picksFailed"))).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("with no copy and no network: the plain form and the banner", async () => {
    picksAnswer = () => {
      throw new TypeError("Failed to fetch");
    };
    const user = userEvent.setup();
    await mount();
    await user.click(screen.getByRole("button", { name: "open-it" }));
    await screen.findByText(en("quickAdd.picksFailed"));
    expect(screen.queryByText(en("offline.cachedChips"))).toBeNull();
  });

  it("does not show the note when the server answered", async () => {
    cached();
    const user = userEvent.setup();
    await mount();
    await openSheet(user);
    expect(screen.queryByText(en("offline.cachedChips"))).toBeNull();
  });
});

describe("opening the sheet sends what waits", () => {
  it("flushes the queue on open and bumps when something went", async () => {
    window.localStorage.setItem(OUTBOX_KEY, JSON.stringify([{ ...draftOf(), refused: null }]));
    const user = userEvent.setup();
    await mount();
    await openSheet(user);
    await waitFor(() => expect(posts()).toHaveLength(1));
    await waitFor(() => expect(queue()).toEqual([]));
    await waitFor(() => expect(version()).toBe("1"));
  });
});
