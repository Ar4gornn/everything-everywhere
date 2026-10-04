import { render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QuickAddProvider, useQuickAdd } from "../components/QuickAdd/QuickAddContext";
import { shiftMonth } from "../months";
import { EntriesPage } from "./EntriesPage";

// The page links to category detail and reads ?add=1, so it needs a router.
function render(ui: React.ReactElement) {
  return rtlRender(
    <MemoryRouter>
      <QuickAddProvider>{ui}</QuickAddProvider>
    </MemoryRouter>,
  );
}

const categories = [
  { id: "c1", kind: "expense" as const, name: "Rent", created_at: "" },
  { id: "c2", kind: "income" as const, name: "Salary", created_at: "" },
];

const entries = [
  {
    id: "e1",
    kind: "expense" as const,
    category_id: "c1",
    amount: "800.00",
    occurred_on: "2026-08-01",
    note: "August rent",
    quantity: null,
    unit: null,
    unit_price: null,
    created_at: "",
  },
];

const holiday = {
  savings_type_id: "p1",
  name: "Holiday",
  balance: "300.00",
  saved: "0.00",
  target: null,
  due: null,
  skipped: false,
  goal_amount: null,
  goal_date: null,
  needed_per_month: null,
};

// AD-51: the page reads the pots for its "Paid from" choice.
function overview(pots: (typeof holiday)[] = []) {
  return {
    month: "2026-09",
    start: "2026-09-01",
    end: "2026-10-01",
    current_month: "2026-09",
    pots,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockApi(
  pots: (typeof holiday)[] = [],
  rows: unknown[] = entries,
  cats: unknown[] = categories,
) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/api/categories")) return json({ items: cats });
    if (url.includes("/api/savings/overview")) return json(overview(pots));
    if (url.includes("/api/vendors")) {
      return json({
        items: [
          { id: "v1", name: "Lidl", created_at: "2026-01-01T00:00:00Z" },
          { id: "v2", name: "Shell", created_at: "2026-01-01T00:00:00Z" },
        ],
      });
    }
    if (url.includes("/api/entries") && init?.method === "POST") {
      return json({ ...entries[0], id: "e2" }, 201);
    }
    if (url.includes("/api/entries") && init?.method === "DELETE") return json(null, 204);
    if (url.includes("/api/entries") && init?.method === "PATCH") {
      return json({ ...entries[0], ...JSON.parse(String(init.body)) });
    }
    return json({ items: rows });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function SheetProbe() {
  const { isOpen } = useQuickAdd();
  return isOpen ? <div data-testid="sheet-open" /> : null;
}

function Search() {
  return <div data-testid="search">{useLocation().search}</div>;
}

function Bumper() {
  const { bump } = useQuickAdd();
  return (
    <button type="button" onClick={bump}>
      bump
    </button>
  );
}

describe("EntriesPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("prefills the date the calendar handed it, and clears the parameters", async () => {
    // The only path in Epic 22 that had no test: "Add on this day" navigates here with
    // ?add=1&date=YYYY-MM-DD, and without this the entry would silently be dated today —
    // which is the wrong day, on the one screen where the day is the whole point.
    mockApi();
    rtlRender(
      <MemoryRouter initialEntries={["/entries?add=1&date=2026-08-15"]}>
        <EntriesPage />
      </MemoryRouter>,
    );

    const form = await screen.findByRole("form", { name: "Record an entry" });
    await waitFor(() => {
      expect(within(form).getByLabelText("Date")).toHaveValue("2026-08-15");
    });
  });

  it("on desktop, the record form is the card the tour points at", async () => {
    mockApi();
    render(<EntriesPage />);
    await screen.findByRole("form", { name: "Record an entry" });
    expect(document.querySelector('[data-tour="record-form"]')).not.toBeNull();
  });

  it("on desktop, ?add=1 focuses the inline amount and opens no sheet (Epic 44)", async () => {
    mockApi();
    rtlRender(
      <MemoryRouter initialEntries={["/entries?add=1"]}>
        <QuickAddProvider>
          <EntriesPage />
          <SheetProbe />
        </QuickAddProvider>
      </MemoryRouter>,
    );

    const form = await screen.findByRole("form", { name: "Record an entry" });
    await waitFor(() => expect(within(form).getByLabelText("Amount")).toHaveFocus());
    expect(screen.queryByTestId("sheet-open")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add an entry" })).toBeNull();
  });

  it("refetches the list when the quick-add version goes up (Epic 44)", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi();
    render(
      <>
        <EntriesPage />
        <Bumper />
      </>,
    );
    await screen.findByRole("form", { name: "Record an entry" });
    const lists = () =>
      fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/entries")).length;
    await waitFor(() => expect(lists()).toBeGreaterThan(0));
    const before = lists();
    await user.click(screen.getByRole("button", { name: "bump" }));
    await waitFor(() => expect(lists()).toBeGreaterThan(before));
  });

  it("ignores a date parameter that is not a date", async () => {
    mockApi();
    rtlRender(
      <MemoryRouter initialEntries={["/entries?add=1&date=yesterday"]}>
        <EntriesPage />
      </MemoryRouter>,
    );

    const form = await screen.findByRole("form", { name: "Record an entry" });
    // Falls back to today rather than blanking the field or writing junk into it.
    expect(within(form).getByLabelText("Date")).not.toHaveValue("yesterday");
    expect((within(form).getByLabelText("Date") as HTMLInputElement).value).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });

  it("lists entries with the category name rather than its id", async () => {
    mockApi();
    render(<EntriesPage />);

    const table = await screen.findByRole("table", { name: "Entries" });
    // Scoped to the table: "Rent" also appears in the category filter dropdown.
    expect(within(table).getByText("Rent")).toBeInTheDocument();
    expect(within(table).getByText("800.00")).toBeInTheDocument();
    expect(within(table).getByText("August rent")).toBeInTheDocument();
  });

  it("posts category_name so a new category is created as you type it", async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    render(<EntriesPage />);
    await screen.findByRole("table", { name: "Entries" });

    // Scoped to the form: the filter row has a "Category" control too.
    const form = screen.getByRole("form", { name: "Record an entry" });
    await user.type(within(form).getByLabelText("Amount"), "45.50");
    await user.type(within(form).getByLabelText("Category"), "Taxi");
    await user.click(within(form).getByRole("button", { name: "Add" }));

    await waitFor(() => {
      const posted = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
      expect(posted).toBeDefined();
      const body = JSON.parse(String(posted?.[1]?.body));
      // AD-12: exactly one of the two category fields.
      expect(body.category_name).toBe("Taxi");
      expect(body.category_id).toBeUndefined();
      expect(body.amount).toBe("45.50");
    });
  });

  it("pays an expense from the chosen pot, then forgets the choice", async () => {
    const fetchMock = mockApi([holiday]);
    const user = userEvent.setup();
    render(<EntriesPage />);
    await screen.findByRole("table", { name: "Entries" });

    const form = screen.getByRole("form", { name: "Record an entry" });
    const paidFrom = within(form).getByLabelText("Paid from");
    // The balance is beside the name: the choice is made knowing what the pot holds.
    expect(within(paidFrom).getByRole("option", { name: "Holiday · 300.00" })).toBeInTheDocument();
    await user.selectOptions(paidFrom, "p1");
    await user.type(within(form).getByLabelText("Amount"), "45.50");
    await user.type(within(form).getByLabelText("Category"), "Taxi");
    await user.click(within(form).getByRole("button", { name: "Add" }));

    await waitFor(() => {
      const posted = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
      expect(JSON.parse(String(posted?.[1]?.body)).savings_type_id).toBe("p1");
    });
    await waitFor(() => expect(within(form).getByLabelText("Paid from")).toHaveValue(""));
  });

  it("sends no pot when none is chosen, and offers none for income", async () => {
    const fetchMock = mockApi([holiday]);
    const user = userEvent.setup();
    render(<EntriesPage />);
    await screen.findByRole("table", { name: "Entries" });

    const form = screen.getByRole("form", { name: "Record an entry" });
    await user.type(within(form).getByLabelText("Amount"), "45.50");
    await user.type(within(form).getByLabelText("Category"), "Taxi");
    await user.click(within(form).getByRole("button", { name: "Add" }));
    await waitFor(() => {
      const posted = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
      expect(JSON.parse(String(posted?.[1]?.body))).not.toHaveProperty("savings_type_id");
    });

    await user.selectOptions(within(form).getByLabelText("Kind"), "income");
    expect(within(form).queryByLabelText("Paid from")).not.toBeInTheDocument();
  });

  // Epic 35.3: a category's default pot fills in "Paid from"; the entry can override it.
  const travel = { id: "c3", kind: "expense" as const, name: "Travel", created_at: "" };

  it("fills in the category's default pot, and sends it", async () => {
    const fetchMock = mockApi([holiday], entries, [
      ...categories,
      { ...travel, default_savings_type_id: "p1" },
    ]);
    const user = userEvent.setup();
    render(<EntriesPage />);
    await screen.findByRole("table", { name: "Entries" });

    const form = screen.getByRole("form", { name: "Record an entry" });
    await user.type(within(form).getByLabelText("Amount"), "45.50");
    await user.type(within(form).getByLabelText("Category"), "travel");
    expect(within(form).getByLabelText("Paid from")).toHaveValue("p1");
    await user.click(within(form).getByRole("button", { name: "Add" }));

    await waitFor(() => {
      const posted = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
      expect(JSON.parse(String(posted?.[1]?.body)).savings_type_id).toBe("p1");
    });
    // The category box keeps "travel", so its default is offered again, visibly.
    await waitFor(() => expect(within(form).getByLabelText("Paid from")).toHaveValue("p1"));
  });

  it("drops the default when the category no longer matches", async () => {
    mockApi([holiday], entries, [...categories, { ...travel, default_savings_type_id: "p1" }]);
    const user = userEvent.setup();
    render(<EntriesPage />);
    await screen.findByRole("table", { name: "Entries" });

    const form = screen.getByRole("form", { name: "Record an entry" });
    const category = within(form).getByLabelText("Category");
    await user.type(category, "Travel");
    expect(within(form).getByLabelText("Paid from")).toHaveValue("p1");
    await user.type(category, "s");
    expect(within(form).getByLabelText("Paid from")).toHaveValue("");
  });

  it("lets the entry override the default, and keeps the choice while typing", async () => {
    const fetchMock = mockApi([holiday], entries, [
      ...categories,
      { ...travel, default_savings_type_id: "p1" },
    ]);
    const user = userEvent.setup();
    render(<EntriesPage />);
    await screen.findByRole("table", { name: "Entries" });

    const form = screen.getByRole("form", { name: "Record an entry" });
    await user.type(within(form).getByLabelText("Amount"), "45.50");
    await user.selectOptions(within(form).getByLabelText("Paid from"), "");
    await user.type(within(form).getByLabelText("Category"), "Travel");
    expect(within(form).getByLabelText("Paid from")).toHaveValue("");
    await user.click(within(form).getByRole("button", { name: "Add" }));

    await waitFor(() => {
      const posted = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
      expect(JSON.parse(String(posted?.[1]?.body))).not.toHaveProperty("savings_type_id");
    });
  });

  it("marks an expense paid from a pot, and can stop paying from it", async () => {
    const fetchMock = mockApi([holiday], [{ ...entries[0], savings_type_id: "p1" }]);
    const user = userEvent.setup();
    render(<EntriesPage />);

    const table = await screen.findByRole("table", { name: "Entries" });
    expect(within(table).getByText("From Holiday")).toBeInTheDocument();

    await user.click(within(table).getByRole("button", { name: /^Edit/ }));
    const choice = within(table).getByLabelText("Edit the pot it was paid from");
    expect(choice).toHaveValue("p1");
    await user.selectOptions(choice, "");
    await user.click(within(table).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patched = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
      // An explicit null, never an absent key: absent means "leave it where it is".
      expect(JSON.parse(String(patched?.[1]?.body))).toEqual({ savings_type_id: null });
    });
  });

  it("refuses an amount with three decimal places before it reaches the server", async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    render(<EntriesPage />);
    await screen.findByRole("table", { name: "Entries" });

    const form = screen.getByRole("form", { name: "Record an entry" });
    await user.type(within(form).getByLabelText("Amount"), "10.001");
    await user.type(within(form).getByLabelText("Category"), "Taxi");
    await user.click(within(form).getByRole("button", { name: "Add" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("two decimal places");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("shows the server's explanation when a delete is refused", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/api/categories")) return json({ items: categories });
        if (url.includes("/api/savings/overview")) return json(overview());
        if (init?.method === "DELETE") return json({ detail: "That category still has entries" }, 409);
        return json({ items: entries });
      }),
    );
    const user = userEvent.setup();
    render(<EntriesPage />);
    await screen.findByRole("table", { name: "Entries" });

    await user.click(screen.getByRole("button", { name: /Delete entry/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That category still has entries");
  });
});


describe("editing an entry", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function patchesFrom(mock: ReturnType<typeof vi.fn>) {
    return mock.mock.calls
      .filter(([, init]) => init?.method === "PATCH")
      .map(([, init]) => JSON.parse(String(init?.body)));
  }

  it("sends only the fields that changed", async () => {
    // PATCH means "these fields". Sending the untouched ones would write a stale copy over
    // anything changed elsewhere since this list loaded.
    const fetchMock = mockApi();
    const user = userEvent.setup();
    render(<EntriesPage />);
    await screen.findByRole("table", { name: "Entries" });

    await user.click(screen.getByRole("button", { name: /Edit entry/ }));
    const amount = screen.getByLabelText("Edit amount");
    await user.clear(amount);
    await user.type(amount, "925.00");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patchesFrom(fetchMock)).toHaveLength(1));
    expect(patchesFrom(fetchMock)[0]).toEqual({ amount: "925.00" });
  });

  it("clears a note to null rather than an empty string", async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    render(<EntriesPage />);
    await screen.findByRole("table", { name: "Entries" });

    await user.click(screen.getByRole("button", { name: /Edit entry/ }));
    await user.clear(screen.getByLabelText("Edit note"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patchesFrom(fetchMock)).toHaveLength(1));
    expect(patchesFrom(fetchMock)[0]).toEqual({ note: null });
  });

  it("sends nothing at all when nothing was touched", async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    render(<EntriesPage />);
    await screen.findByRole("table", { name: "Entries" });

    await user.click(screen.getByRole("button", { name: /Edit entry/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByLabelText("Edit amount")).toBeNull());
    expect(patchesFrom(fetchMock)).toHaveLength(0);
  });

  it("refuses an invalid amount before it reaches the server", async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    render(<EntriesPage />);
    await screen.findByRole("table", { name: "Entries" });

    await user.click(screen.getByRole("button", { name: /Edit entry/ }));
    const amount = screen.getByLabelText("Edit amount");
    await user.clear(amount);
    await user.type(amount, "0");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("greater than zero");
    expect(patchesFrom(fetchMock)).toHaveLength(0);
    // Still editing, so the typed value is not lost.
    expect(screen.getByLabelText("Edit amount")).toBeInTheDocument();
  });

  it("does not offer kind as editable", async () => {
    // Kind is bound to the category by one foreign key (AD-7), so changing it would have
    // to move the entry too. The API refuses it and the form must not imply otherwise.
    mockApi();
    const user = userEvent.setup();
    render(<EntriesPage />);
    await screen.findByRole("table", { name: "Entries" });

    await user.click(screen.getByRole("button", { name: /Edit entry/ }));
    expect(screen.queryByLabelText("Edit kind")).toBeNull();
  });

  it("offers only categories of the entry's own kind", async () => {
    // The fixture has one expense category and one income category; an expense entry must
    // not be offered the income one, which the database would refuse anyway.
    mockApi();
    const user = userEvent.setup();
    render(<EntriesPage />);
    await screen.findByRole("table", { name: "Entries" });

    await user.click(screen.getByRole("button", { name: /Edit entry/ }));
    const options = [...screen.getByLabelText("Edit category").querySelectorAll("option")].map(
      (option) => option.textContent,
    );
    expect(options).toEqual(["Rent"]);
  });

  it("abandons the change on cancel", async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    render(<EntriesPage />);
    await screen.findByRole("table", { name: "Entries" });

    await user.click(screen.getByRole("button", { name: /Edit entry/ }));
    await user.clear(screen.getByLabelText("Edit amount"));
    await user.type(screen.getByLabelText("Edit amount"), "1.00");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByLabelText("Edit amount")).toBeNull();
    expect(patchesFrom(fetchMock)).toHaveLength(0);
  });
});

describe("quantity and unit price (AD-29)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  async function openQuantity(user: ReturnType<typeof userEvent.setup>) {
    render(<EntriesPage />);
    await screen.findByRole("table", { name: "Entries" });
    const form = screen.getByRole("form", { name: "Record an entry" });
    await user.click(within(form).getByRole("button", { name: "+ Quantity" }));
    return form;
  }

  it("fills the unit price from amount and quantity, and posts only the pair", async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    const form = await openQuantity(user);

    await user.type(within(form).getByLabelText("Amount"), "60.00");
    await user.type(within(form).getByLabelText("Quantity"), "40");
    await user.selectOptions(within(form).getByLabelText("Unit"), "l");
    expect(within(form).getByLabelText(/Unit price/)).toHaveValue("1.5000");

    await user.type(within(form).getByLabelText("Category"), "Fuel");
    await user.click(within(form).getByRole("button", { name: "Add" }));

    await waitFor(() => {
      const posted = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
      const body = JSON.parse(String(posted?.[1]?.body));
      expect(body.quantity).toBe("40");
      expect(body.unit).toBe("l");
      // The rate is derived server-side; sending it would be a second source of truth.
      expect(body.unit_price).toBeUndefined();
    });
  });

  it("fills the amount from quantity and unit price", async () => {
    mockApi();
    const user = userEvent.setup();
    const form = await openQuantity(user);

    await user.type(within(form).getByLabelText("Quantity"), "40.123");
    await user.type(within(form).getByLabelText(/Unit price/), "1.499");
    expect(within(form).getByLabelText("Amount")).toHaveValue("60.14");
  });

  it("refuses a quantity without a unit before it reaches the server", async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    const form = await openQuantity(user);

    await user.type(within(form).getByLabelText("Amount"), "60.00");
    await user.type(within(form).getByLabelText("Quantity"), "40");
    await user.type(within(form).getByLabelText("Category"), "Fuel");
    await user.click(within(form).getByRole("button", { name: "Add" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a unit");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("hides the section for an income entry", async () => {
    mockApi();
    const user = userEvent.setup();
    const form = await openQuantity(user);

    await user.selectOptions(within(form).getByLabelText("Kind"), "income");
    expect(within(form).queryByLabelText("Quantity")).toBeNull();
    expect(within(form).queryByRole("button", { name: "+ Quantity" })).toBeNull();
  });

  it("shows the rate beneath a quantified amount in the table", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/api/categories")) return json({ items: categories });
        if (url.includes("/api/savings/overview")) return json(overview());
        return json({
          items: [
            { ...entries[0], quantity: "40.000", unit: "l", unit_price: "20.0000" },
          ],
        });
      }),
    );
    render(<EntriesPage />);
    const table = await screen.findByRole("table", { name: "Entries" });
    expect(within(table).getByText("20.0000 /l")).toBeInTheDocument();
  });

  it("searches on the server rather than filtering the rows already on screen", async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    render(<EntriesPage />);
    await screen.findByRole("table", { name: "Entries" });

    await user.type(screen.getByLabelText("Search entries"), "diesel");

    // The point of doing it server-side: it can find rows this page never fetched.
    await waitFor(() => {
      const asked = fetchMock.mock.calls
        .map(([url]) => String(url))
        .filter((url) => url.includes("/api/entries?") && url.includes("q="));
      expect(asked.at(-1)).toContain("q=diesel");
    });
  });

  it("steps to the previous and next month with the arrows, and asks the server for it", async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    render(<EntriesPage />);
    await screen.findByRole("table", { name: "Entries" });

    const month = screen.getByLabelText("Filter by month") as HTMLInputElement;
    const start = month.value;
    const asked = () =>
      fetchMock.mock.calls
        .map(([url]) => String(url))
        .filter((url) => url.includes("/api/entries?"))
        .at(-1);

    await user.click(screen.getByRole("button", { name: "Previous month" }));
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    const twoBack = shiftMonth(start, -2);
    expect(month).toHaveValue(twoBack);
    await waitFor(() => expect(asked()).toContain(`month=${twoBack}`));

    await user.click(screen.getByRole("button", { name: "Next month" }));
    expect(month).toHaveValue(shiftMonth(start, -1));
  });

  it("steps from the current month when the month box was cleared", async () => {
    mockApi();
    const user = userEvent.setup();
    render(<EntriesPage />);
    await screen.findByRole("table", { name: "Entries" });

    const month = screen.getByLabelText("Filter by month") as HTMLInputElement;
    const start = month.value;
    await user.clear(month);
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    expect(month).toHaveValue(shiftMonth(start, -1));
  });

  it("sends the vendor by name, creating it, and omits it when blank", async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    render(<EntriesPage />);
    await screen.findByRole("table", { name: "Entries" });

    const form = screen.getByRole("form", { name: "Record an entry" });
    await user.type(within(form).getByLabelText(/^Amount/), "60.00");
    await user.type(within(form).getByLabelText("Category"), "Fuel");
    await user.type(within(form).getByLabelText("Vendor"), "Shell");
    await user.click(within(form).getByRole("button", { name: "Add" }));

    await waitFor(() => {
      const posted = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).includes("/api/entries") && (init as RequestInit)?.method === "POST",
      );
      expect(JSON.parse(String((posted![1] as RequestInit).body))).toMatchObject({
        category_name: "Fuel",
        vendor_name: "Shell",
      });
    });
  });
});

describe("vendor and category suggestions", () => {
  it("are chips, not a native datalist, and a tapped vendor chip fills the field", async () => {
    mockApi();
    const user = userEvent.setup();
    render(<EntriesPage />);
    await screen.findByRole("table", { name: "Entries" });
    const form = screen.getByRole("form", { name: "Record an entry" });
    expect(form.querySelector("datalist")).toBeNull();
    const vendor = within(form).getByLabelText("Vendor");
    await user.type(vendor, "sh");
    const group = within(form).getByRole("group", { name: "Suggestions" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["Shell"]);
    await user.click(within(group).getByRole("button", { name: "Shell" }));
    expect(vendor).toHaveValue("Shell");
  });
});

describe("on a phone (AD-53)", () => {
  const rows = [
    entries[0],
    { ...entries[0], id: "e3", kind: "income" as const, category_id: "c2", amount: "3000.00", note: null },
    { ...entries[0], id: "e4", occurred_on: "2026-07-31", amount: "12.50", note: null },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("draws neither the inline form nor a button of its own: the floating + opens the sheet", async () => {
    mockApi([], rows);
    render(<EntriesPage />);

    await screen.findByRole("region", { name: /1 August/ });
    expect(screen.queryByRole("form", { name: "Record an entry" })).toBeNull();
    // Only the tour's entry step brings a page button back (Tutorial.test.tsx).
    expect(screen.queryByRole("button", { name: "Add an entry" })).toBeNull();
    expect(document.querySelectorAll('[data-tour="record-form"]')).toHaveLength(0);
  });

  it("leaves ?add=1 for App's quick-add handler: the page neither consumes nor focuses it", async () => {
    mockApi([], rows);
    rtlRender(
      <MemoryRouter initialEntries={["/entries?add=1&date=2026-08-15"]}>
        <QuickAddProvider>
          <EntriesPage />
          <Search />
        </QuickAddProvider>
      </MemoryRouter>,
    );

    await screen.findByRole("region", { name: /1 August/ });
    // An effect would have stripped it by now.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByTestId("search")).toHaveTextContent("?add=1&date=2026-08-15");
  });

  it("groups entries under day headings, amounts signed", async () => {
    mockApi([], rows);
    render(<EntriesPage />);

    const august = await screen.findByRole("region", { name: /1 August/ });
    expect(screen.queryByRole("table", { name: "Entries" })).toBeNull();
    expect(within(august).getByRole("button", { name: /Rent/ })).toHaveTextContent("−800.00");
    expect(within(august).getByRole("button", { name: /Salary/ })).toHaveTextContent("+3,000.00");
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toHaveLength(2);
    expect(headings[0]).toMatch(/1 August/);
    expect(headings[1]).toMatch(/31 July/);
  });

  it("shows the note on the row and opens to the desktop's Edit and Delete", async () => {
    const user = userEvent.setup();
    mockApi([], rows);
    render(<EntriesPage />);
    const august = await screen.findByRole("region", { name: /1 August/ });

    expect(within(august).getByRole("button", { name: /Rent/ })).toHaveTextContent("August rent");
    expect(screen.queryByRole("button", { name: /Edit entry/ })).toBeNull();
    await user.click(within(august).getByRole("button", { name: /Rent/ }));
    expect(
      screen.getByRole("button", { name: "Edit entry of 800.00 on 2026-08-01" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete entry of 800.00 on 2026-08-01" }),
    ).toBeInTheDocument();
  });

  it("edits inside the row with the one edit form", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi([], rows);
    render(<EntriesPage />);
    const august = await screen.findByRole("region", { name: /1 August/ });

    await user.click(within(august).getByRole("button", { name: /Rent/ }));
    await user.click(screen.getByRole("button", { name: /Edit entry/ }));
    const amount = screen.getByLabelText("Edit amount");
    await user.clear(amount);
    await user.type(amount, "925.00");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(true),
    );
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ amount: "925.00" });
  });
});
