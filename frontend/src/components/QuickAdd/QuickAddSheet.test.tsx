import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Category, Pot, QuickPicks } from "../../api/types";
import { LanguageProvider } from "../../i18n";
import { translator } from "../../i18n/catalogue";
import { todayIso } from "../../months";
import { dayBefore } from "./picks";
import { ToastProvider } from "../Toast";
import { QuickAddProvider, useQuickAdd } from "./QuickAddContext";
import { QuickAddSheet } from "./QuickAddSheet";

/**
 * The quick-add sheet (Epic 44, AD-60; spec docs/epic-44-quick-add.md §4).
 *
 * What is held: it opens focused on the amount and on the right day; chips follow the kind;
 * a repeat chip only fills; a vendor names a category only when none is chosen; the default
 * pot is shown outside More; Save posts exactly the Entries page's body, closes, toasts,
 * bumps and can be undone; Save & add another keeps kind and date; a failed picks load
 * leaves the plain fields usable; an answer from a previous open is ignored.
 */

const notify = vi.hoisted(() => vi.fn());
vi.mock("../Tutorial/useTutorial", () => ({ useTutorial: () => ({ notify }) }));

const en = translator("en");
const TODAY = todayIso();
const YESTERDAY = dayBefore(TODAY);

beforeAll(() => {
  // jsdom has no showModal/close on <dialog>: model just what the sheet relies on.
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
      { id: "c4", name: "Rent", uses: 1, default_savings_type_id: null },
    ],
    combos: [
      {
        category_id: "c1",
        category_name: "Groceries",
        vendor_id: "v1",
        vendor_name: "Lidl",
        amount: "12.50",
      },
    ],
  },
  income: {
    categories: [{ id: "c2", name: "Salary", uses: 2, default_savings_type_id: null }],
    combos: [],
  },
  vendors: [
    { vendor_id: "v1", vendor_name: "Lidl", kind: "expense", category_id: "c1", category_name: "Groceries" },
    { vendor_id: "v3", vendor_name: "Shell", kind: "expense", category_id: "c3", category_name: "Fuel" },
  ],
};

const CATEGORIES: Category[] = [
  { id: "c1", kind: "expense", name: "Groceries", default_savings_type_id: "p1", created_at: "" },
  { id: "c3", kind: "expense", name: "Fuel", created_at: "" },
  { id: "c4", kind: "expense", name: "Rent", created_at: "" },
  { id: "c2", kind: "income", name: "Salary", created_at: "" },
];

const POTS = [
  { savings_type_id: "p1", name: "Holiday", balance: "100.00" },
] as unknown as Pot[];

function json(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Call {
  url: string;
  method: string;
  body: unknown;
}

let calls: Call[];
/** Replaces the answer to `quick-picks`; may be async or throw. */
let picksAnswer: () => Promise<Response> | Response;
let createAnswer: () => Promise<Response> | Response;
let deleteAnswer: () => Promise<Response> | Response;

function stubFetch() {
  calls = [];
  picksAnswer = () => json(PICKS);
  createAnswer = () => json({ id: "e-new" }, 201);
  deleteAnswer = () => json(undefined, 204);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.includes("/api/entries/quick-picks")) return picksAnswer();
      if (url.endsWith("/api/entries") && method === "POST") return createAnswer();
      if (/\/api\/entries\/[^/]+$/.test(url) && method === "DELETE") return deleteAnswer();
      if (url.includes("/api/categories")) return json({ items: CATEGORIES });
      if (url.includes("/api/savings/overview")) return json({ pots: POTS });
      return json({ items: [] });
    }),
  );
}

const posts = () => calls.filter((c) => c.method === "POST" && c.url.endsWith("/api/entries"));
const deletes = () => calls.filter((c) => c.method === "DELETE");

function Harness({ date }: { date?: string }) {
  const { open, close, isOpen, version } = useQuickAdd();
  return (
    <>
      <button type="button" onClick={() => open(date ? { date } : undefined)}>
        open-it
      </button>
      <button type="button" onClick={() => setTimeout(() => open(), 0)}>
        open-later
      </button>
      <button type="button" onClick={close}>
        close-it
      </button>
      <output aria-label="state">{isOpen ? "open" : "closed"}</output>
      <output aria-label="version">{String(version)}</output>
    </>
  );
}

function mount(date?: string) {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <ToastProvider>
          <QuickAddProvider>
            <Harness date={date} />
            <QuickAddSheet />
          </QuickAddProvider>
        </ToastProvider>
      </LanguageProvider>
    </MemoryRouter>,
  );
}

const amountInput = () => screen.getByLabelText("Amount in USD") as HTMLInputElement;
const dialog = () => document.querySelector("dialog") as HTMLDialogElement;
const version = () => screen.getByLabelText("version").textContent;
const pressed = (name: string | RegExp) =>
  screen.getByRole("button", { name }).getAttribute("aria-pressed");

async function openSheet(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "open-it" }));
  // The chips arrive with the picks.
  await screen.findByRole("button", { name: "Groceries" });
}

async function openMore(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "More" }));
}

beforeEach(() => {
  notify.mockClear();
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("opening", () => {
  it("opens a modal dialog with the amount focused and today chosen", async () => {
    const user = userEvent.setup();
    mount();
    await openSheet(user);
    expect(dialog().open).toBe(true);
    expect(dialog().getAttribute("data-tour")).toBe("record-form");
    expect(dialog()).toHaveAccessibleName("Add an entry");
    await waitFor(() => expect(amountInput()).toHaveFocus());
    expect(pressed("Today")).toBe("true");
    expect(pressed("Yesterday")).toBe("false");
  });

  it("starts on the date it was opened with", async () => {
    const user = userEvent.setup();
    mount("2026-03-14");
    await openSheet(user);
    expect(screen.getByLabelText("Date")).toHaveValue("2026-03-14");
    expect(screen.getByRole("button", { name: "2026-03-14" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(pressed("Today")).toBe("false");
  });

  it("ignores a date that is not YYYY-MM-DD", async () => {
    const user = userEvent.setup();
    mount("tomorrow");
    await openSheet(user);
    expect(pressed("Today")).toBe("true");
  });

  it("fetches the picks, categories, vendors and pots on every open", async () => {
    const user = userEvent.setup();
    mount();
    await openSheet(user);
    await user.click(screen.getByRole("button", { name: "Close" }));
    await openSheet(user);
    const urls = calls.map((c) => c.url);
    expect(urls.filter((u) => u.includes("quick-picks"))).toHaveLength(2);
    expect(urls.filter((u) => u.includes("/api/categories"))).toHaveLength(2);
    expect(urls.filter((u) => u.includes("/api/vendors"))).toHaveLength(2);
    expect(urls.filter((u) => u.includes("/api/savings/overview"))).toHaveLength(2);
  });

  it("closes the context when the dialog closes itself (Escape)", async () => {
    const user = userEvent.setup();
    mount();
    await openSheet(user);
    act(() => {
      dialog().close();
    });
    expect(screen.getByLabelText("state")).toHaveTextContent("closed");
  });

  it("resets the form on the next open", async () => {
    const user = userEvent.setup();
    mount();
    await openSheet(user);
    await user.type(amountInput(), "9");
    await user.click(screen.getByRole("button", { name: "Fuel" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(dialog().open).toBe(false);
    await openSheet(user);
    expect(amountInput()).toHaveValue("");
    expect(pressed("Fuel")).toBe("false");
  });
});

describe("chips follow the kind", () => {
  it("shows this kind's category and repeat chips and switches with the toggle", async () => {
    const user = userEvent.setup();
    mount();
    await openSheet(user);
    for (const name of ["Groceries", "Fuel", "Rent"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: "Salary" })).toBeNull();
    expect(screen.getByRole("button", { name: /Fill in Groceries/ })).toBeInTheDocument();

    expect(pressed("Expense")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Income" }));
    expect(pressed("Income")).toBe("true");
    expect(screen.getByRole("button", { name: "Salary" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Groceries" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Fill in/ })).toBeNull();
  });

  it("clears the category, the pot line and the quantity when the kind changes", async () => {
    const user = userEvent.setup();
    mount();
    await openSheet(user);
    await user.click(screen.getByRole("button", { name: "Groceries" }));
    expect(screen.getByText("Paid from Holiday")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Income" }));
    await user.click(screen.getByRole("button", { name: "Expense" }));
    expect(pressed("Groceries")).toBe("false");
    expect(screen.queryByText("Paid from Holiday")).toBeNull();
  });

  it("selects a category chip and lets a second tap clear it", async () => {
    const user = userEvent.setup();
    mount();
    await openSheet(user);
    await user.click(screen.getByRole("button", { name: "Fuel" }));
    expect(pressed("Fuel")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Fuel" }));
    expect(pressed("Fuel")).toBe("false");
  });
});

describe("repeat chips", () => {
  it("fill category, vendor and amount, and record nothing", async () => {
    const user = userEvent.setup();
    mount();
    await openSheet(user);
    await user.click(screen.getByRole("button", { name: /Fill in Groceries/ }));
    expect(amountInput()).toHaveValue("12.50");
    expect(pressed("Groceries")).toBe("true");
    // A vendor that was filled is shown, not applied unseen: More opens itself.
    expect(screen.getByLabelText("Vendor")).toHaveValue("Lidl");
    expect(screen.getByText("Paid from Holiday")).toBeInTheDocument();
    // A save would be a request a few ticks later: give it the time to show itself.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(posts()).toHaveLength(0);
    expect(dialog().open).toBe(true);
  });

  it("show the vendor-less label when there is no vendor", async () => {
    picksAnswer = () =>
      json({
        ...PICKS,
        expense: {
          ...PICKS.expense,
          combos: [
            { category_id: "c3", category_name: "Fuel", vendor_id: null, vendor_name: null, amount: "40.00" },
          ],
        },
      });
    const user = userEvent.setup();
    mount();
    await openSheet(user);
    expect(screen.getByRole("button", { name: /Fill in Fuel/ })).toHaveTextContent(
      "Fuel · $40.00",
    );
  });
});

describe("saving", () => {
  it("posts exactly the Entries page body for a category chip", async () => {
    const user = userEvent.setup();
    mount("2026-03-14");
    await openSheet(user);
    await user.type(amountInput(), "12,5");
    await user.click(screen.getByRole("button", { name: "Fuel" }));
    await openMore(user);
    await user.type(screen.getByLabelText("Vendor"), "  Shell ");
    await user.type(screen.getByLabelText("Note"), " weekly ");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]?.body).toEqual({
      kind: "expense",
      amount: "12.5",
      occurred_on: "2026-03-14",
      category_name: "Fuel",
      vendor_name: "Shell",
      note: "weekly",
    });
  });

  it("omits vendor, note, quantity and pot when they are empty", async () => {
    const user = userEvent.setup();
    mount();
    await openSheet(user);
    await user.type(amountInput(), "3");
    await user.click(screen.getByRole("button", { name: "Fuel" }));
    await user.click(screen.getByRole("button", { name: "Yesterday" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]?.body).toEqual({
      kind: "expense",
      amount: "3",
      occurred_on: YESTERDAY,
      category_name: "Fuel",
    });
  });

  it("records a typed new category through Other…", async () => {
    const user = userEvent.setup();
    mount();
    await openSheet(user);
    await user.type(amountInput(), "5");
    expect(screen.queryByLabelText("Category")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Other…" }));
    await user.type(screen.getByLabelText("Category"), "Pets");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]?.body).toMatchObject({ category_name: "Pets" });
  });

  it("sends the default pot that the Paid from line shows", async () => {
    const user = userEvent.setup();
    mount();
    await openSheet(user);
    await user.type(amountInput(), "20");
    await user.click(screen.getByRole("button", { name: "Groceries" }));
    expect(screen.getByText("Paid from Holiday")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]?.body).toMatchObject({ savings_type_id: "p1" });
  });

  it("shows no Paid from line for a category without a default pot", async () => {
    const user = userEvent.setup();
    mount();
    await openSheet(user);
    await user.click(screen.getByRole("button", { name: "Fuel" }));
    expect(screen.queryByText(/Paid from/)).toBeNull();
  });

  it("closes, toasts, bumps the version and tells the tour", async () => {
    const user = userEvent.setup();
    mount();
    await openSheet(user);
    expect(version()).toBe("0");
    await user.type(amountInput(), "7");
    await user.click(screen.getByRole("button", { name: "Fuel" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(dialog().open).toBe(false));
    expect(screen.getByLabelText("state")).toHaveTextContent("closed");
    expect(screen.getByText("Entry saved")).toBeInTheDocument();
    expect(version()).toBe("1");
    expect(notify).toHaveBeenCalledWith("entry-created");
  });

  it("deletes the new entry on Undo, bumps again and says so", async () => {
    const user = userEvent.setup();
    mount();
    await openSheet(user);
    await user.type(amountInput(), "7");
    await user.click(screen.getByRole("button", { name: "Fuel" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(deletes()).toHaveLength(1));
    expect(deletes()[0]?.url).toMatch(/\/api\/entries\/e-new$/);
    await screen.findByText("Entry removed");
    expect(version()).toBe("2");
  });

  it("keeps kind and date on Save & add another, clears the rest, stays open", async () => {
    const user = userEvent.setup();
    mount();
    await openSheet(user);
    await user.click(screen.getByRole("button", { name: "Income" }));
    await user.click(screen.getByRole("button", { name: "Yesterday" }));
    await user.type(amountInput(), "100");
    await user.click(screen.getByRole("button", { name: "Salary" }));
    await user.click(screen.getByRole("button", { name: "Save & add another" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]?.body).toEqual({
      kind: "income",
      amount: "100",
      occurred_on: YESTERDAY,
      category_name: "Salary",
    });
    await screen.findByText("Entry saved");
    await waitFor(() => expect(amountInput()).toHaveValue(""));
    expect(dialog().open).toBe(true);
    expect(pressed("Income")).toBe("true");
    expect(pressed("Yesterday")).toBe("true");
    expect(pressed("Salary")).toBe("false");
    expect(version()).toBe("1");
    expect(notify).toHaveBeenCalledWith("entry-created");
    await waitFor(() => expect(amountInput()).toHaveFocus());
  });

  it("disables both buttons while it saves", async () => {
    let release: (r: Response) => void = () => undefined;
    createAnswer = () => new Promise<Response>((resolve) => (release = resolve));
    const user = userEvent.setup();
    mount();
    await openSheet(user);
    await user.type(amountInput(), "7");
    await user.click(screen.getByRole("button", { name: "Fuel" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Save & add another" })).toBeDisabled();
    await act(async () => release(json({ id: "e1" }, 201)));
    await waitFor(() => expect(dialog().open).toBe(false));
  });

  it("keeps the sheet open and shows the failure when the save is refused", async () => {
    createAnswer = () => json({ detail: "nope", code: "unknown" }, 500);
    const user = userEvent.setup();
    mount();
    await openSheet(user);
    await user.type(amountInput(), "7");
    await user.click(screen.getByRole("button", { name: "Fuel" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(dialog().open).toBe(true);
    expect(version()).toBe("0");
    expect(screen.queryByText("Entry saved")).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });
});

describe("validation", () => {
  it("refuses a missing or malformed amount", async () => {
    const user = userEvent.setup();
    mount();
    await openSheet(user);
    await user.click(screen.getByRole("button", { name: "Fuel" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText(en("entries.badAmount"))).toBeInTheDocument();
    await user.type(amountInput(), "1.234");
    await user.click(screen.getByRole("button", { name: "Save & add another" }));
    expect(screen.getByText(en("entries.badAmount"))).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it("asks for a category", async () => {
    const user = userEvent.setup();
    mount();
    await openSheet(user);
    await user.type(amountInput(), "5");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText(en("quickAdd.needCategory"))).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it("refuses a quantity without a unit, and a bad quantity", async () => {
    const user = userEvent.setup();
    mount();
    await openSheet(user);
    await user.type(amountInput(), "15");
    await user.click(screen.getByRole("button", { name: "Fuel" }));
    await openMore(user);
    await user.click(screen.getByRole("button", { name: "+ Quantity" }));
    await user.type(screen.getByLabelText("Quantity"), "abc");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText(en("entries.badQuantity"))).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Quantity"));
    await user.type(screen.getByLabelText("Quantity"), "10");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText(en("entries.needUnit"))).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });
});

describe("vendor auto-fill", () => {
  it("names the category when none is chosen yet", async () => {
    const user = userEvent.setup();
    mount();
    await openSheet(user);
    await openMore(user);
    await user.type(screen.getByLabelText("Vendor"), "SHELL");
    expect(pressed("Fuel")).toBe("true");
  });

  it("never overwrites a chosen category", async () => {
    const user = userEvent.setup();
    mount();
    await openSheet(user);
    await user.click(screen.getByRole("button", { name: "Rent" }));
    await openMore(user);
    await user.type(screen.getByLabelText("Vendor"), "Shell");
    expect(pressed("Rent")).toBe("true");
    expect(pressed("Fuel")).toBe("false");
  });

  it("fills the default pot of the implied category", async () => {
    const user = userEvent.setup();
    mount();
    await openSheet(user);
    await openMore(user);
    await user.type(screen.getByLabelText("Vendor"), "lidl");
    expect(pressed("Groceries")).toBe("true");
    expect(screen.getByText("Paid from Holiday")).toBeInTheDocument();
  });
});

describe("More: the three-way solve", () => {
  it("fills the unit price from amount and quantity, and posts quantity with its unit", async () => {
    const user = userEvent.setup();
    mount();
    await openSheet(user);
    await user.type(amountInput(), "15");
    await user.click(screen.getByRole("button", { name: "Fuel" }));
    await openMore(user);
    await user.click(screen.getByRole("button", { name: "+ Quantity" }));
    await user.type(screen.getByLabelText("Quantity"), "10");
    expect(screen.getByLabelText("Unit price in USD")).toHaveValue("1.5000");
    await user.selectOptions(screen.getByLabelText("Unit"), "l");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]?.body).toMatchObject({ quantity: "10", unit: "l" });
  });

  it("lets Paid from override the default pot", async () => {
    const user = userEvent.setup();
    mount();
    await openSheet(user);
    await user.type(amountInput(), "15");
    await user.click(screen.getByRole("button", { name: "Fuel" }));
    await openMore(user);
    await user.selectOptions(screen.getByLabelText("Paid from"), "p1");
    expect(screen.getByText("Paid from Holiday")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]?.body).toMatchObject({ savings_type_id: "p1" });
  });

  it("is a disclosure that starts closed", async () => {
    const user = userEvent.setup();
    mount();
    await openSheet(user);
    const toggle = screen.getByRole("button", { name: "More" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Vendor")).toBeNull();
    await user.click(toggle);
    expect(screen.getByRole("button", { name: "Less" })).toHaveAttribute("aria-expanded", "true");
    expect(
      document.getElementById(toggle.getAttribute("aria-controls") ?? "x"),
    ).toContainElement(screen.getByLabelText("Vendor"));
  });
});

describe("when the picks cannot load", () => {
  it("says so and still lets the entry be typed and saved", async () => {
    picksAnswer = () => json({ detail: "boom", code: "unknown" }, 500);
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole("button", { name: "open-it" }));
    await screen.findByText(en("quickAdd.picksFailed"));
    await user.type(amountInput(), "4");
    await user.click(screen.getByRole("button", { name: "Other…" }));
    await user.type(screen.getByLabelText("Category"), "Coffee");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]?.body).toMatchObject({ category_name: "Coffee", amount: "4" });
  });
});

describe("a stale answer", () => {
  it("from an earlier open does not replace the current one", async () => {
    const stale: QuickPicks = {
      ...PICKS,
      expense: {
        ...PICKS.expense,
        categories: [{ id: "x", name: "StaleChip", uses: 1, default_savings_type_id: null }],
      },
    };
    let releaseStale: (r: Response) => void = () => undefined;
    let first = true;
    picksAnswer = () => {
      if (first) {
        first = false;
        return new Promise<Response>((resolve) => (releaseStale = resolve));
      }
      return json(PICKS);
    };
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole("button", { name: "open-it" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    await openSheet(user);
    await act(async () => releaseStale(json(stale)));
    // Let the late answer settle before judging.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.queryByRole("button", { name: "StaleChip" })).toBeNull();
    expect(screen.getByRole("button", { name: "Groceries" })).toBeInTheDocument();
  });
});

describe("Save & add another keeps Undo reachable (the toast sits under the modal dialog)", () => {
  async function saveAnother(user: ReturnType<typeof userEvent.setup>, amount: string) {
    await user.type(amountInput(), amount);
    await user.click(screen.getByRole("button", { name: "Fuel" }));
    await user.click(screen.getByRole("button", { name: "Save & add another" }));
  }
  const row = () => within(dialog()).getByRole("status");

  it("shows an inline status row inside the dialog, not a global toast", async () => {
    const user = userEvent.setup();
    mount();
    await openSheet(user);
    await saveAnother(user, "7");
    await waitFor(() => expect(row()).toHaveTextContent("Entry saved"));
    expect(row()).toHaveAttribute("aria-live", "polite");
    expect(within(row()).getByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(document.querySelector(".toasts")).not.toHaveTextContent("Entry saved");
  });

  it("deletes that entry on Undo, bumps, and replaces the row with the undone text", async () => {
    const user = userEvent.setup();
    mount();
    await openSheet(user);
    await saveAnother(user, "7");
    await user.click(await within(dialog()).findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(deletes()).toHaveLength(1));
    expect(deletes()[0]?.url).toMatch(/\/api\/entries\/e-new$/);
    await waitFor(() => expect(row()).toHaveTextContent("Entry removed"));
    expect(within(row()).queryByRole("button", { name: "Undo" })).toBeNull();
    expect(version()).toBe("2");
  });

  it("targets the newest entry once a newer save replaced the row", async () => {
    let n = 0;
    createAnswer = () => json({ id: `e-${++n}` }, 201);
    const user = userEvent.setup();
    mount();
    await openSheet(user);
    await saveAnother(user, "7");
    await waitFor(() => expect(row()).toHaveTextContent("Entry saved"));
    await waitFor(() => expect(amountInput()).toHaveValue(""));
    await saveAnother(user, "8");
    await waitFor(() => expect(posts()).toHaveLength(2));
    await waitFor(() => expect(amountInput()).toHaveValue(""));
    await user.click(within(dialog()).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(deletes()).toHaveLength(1));
    expect(deletes()[0]?.url).toMatch(/\/api\/entries\/e-2$/);
  });

  it("shows a failed delete inline, in the same row", async () => {
    deleteAnswer = () => json({ detail: "nope", code: "error" }, 500);
    const user = userEvent.setup();
    mount();
    await openSheet(user);
    await saveAnother(user, "7");
    await user.click(await within(dialog()).findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(row()).not.toHaveTextContent("Entry saved"));
    expect(row()).not.toHaveTextContent("Entry removed");
    expect(row().textContent?.length).toBeGreaterThan(0);
    expect(version()).toBe("1");
  });

  it("is gone after close and reopen", async () => {
    const user = userEvent.setup();
    mount();
    await openSheet(user);
    await saveAnother(user, "7");
    await waitFor(() => expect(row()).toHaveTextContent("Entry saved"));
    await user.click(screen.getByRole("button", { name: "Close" }));
    await openSheet(user);
    expect(within(dialog()).queryByRole("status")).toBeNull();
  });

  it("leaves plain Save on the global toast", async () => {
    const user = userEvent.setup();
    mount();
    await openSheet(user);
    await user.type(amountInput(), "7");
    await user.click(screen.getByRole("button", { name: "Fuel" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(document.querySelector(".toasts")).toHaveTextContent("Entry saved"));
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });
});

describe("a slow Save & add another", () => {
  it("does not wipe the form of a sheet that was closed and reopened meanwhile", async () => {
    let release: (r: Response) => void = () => undefined;
    createAnswer = () => new Promise<Response>((resolve) => (release = resolve));
    const user = userEvent.setup();
    mount();
    await openSheet(user);
    await user.type(amountInput(), "7");
    await user.click(screen.getByRole("button", { name: "Fuel" }));
    await user.click(screen.getByRole("button", { name: "Save & add another" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "Close" }));
    await openSheet(user);
    await user.type(amountInput(), "42");
    await user.click(screen.getByRole("button", { name: "Rent" }));
    await act(async () => release(json({ id: "e-slow" }, 201)));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(amountInput()).toHaveValue("42");
    expect(pressed("Rent")).toBe("true");
    expect(within(dialog()).queryByRole("status")).toBeNull();
    // The entry was saved all the same.
    expect(version()).toBe("1");
  });
});

describe("a reopened sheet", () => {
  afterEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("never paints the previous form: the reset lands in the same task as the open", async () => {
    const user = userEvent.setup();
    mount();
    await openSheet(user);
    await user.type(amountInput(), "9");
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(dialog().open).toBe(false);

    // Outside act, effects keep their real timing: a passive effect from a timer-driven
    // update runs in a later task, a layout effect is flushed with the commit. A mutation
    // observer callback runs after the task's synchronous work and before any later task, so
    // it sees what a paint right after the commit would show.
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    let seen: string | undefined;
    const watch = new MutationObserver(() => {
      const field = document.querySelector<HTMLInputElement>("input.qa-amount");
      if (seen === undefined && field) seen = field.value;
    });
    watch.observe(dialog(), { childList: true, subtree: true });
    screen.getByRole("button", { name: "open-later" }).click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    watch.disconnect();
    expect(seen).toBe("");
  });
});
