import { render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PlanPage } from "./PlanPage";
import { MemoryRouter } from "react-router-dom";

import { AuthProvider } from "../auth/AuthContext";
import { ToastProvider } from "../components/Toast";
import { onAPhone } from "../test/phone";

// PlanPage formats amounts in the account's currency, so it reads the auth context. Rendering
// it inside a real provider rather than stubbing the hook keeps the test honest about that.
function render(ui: React.ReactElement) {
  return rtlRender(
    <MemoryRouter>
      <AuthProvider>
        <ToastProvider>{ui}</ToastProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

const categories = [{ id: "c1", kind: "expense" as const, name: "Rent", created_at: "" }];

function json(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function summary(budgets: { category_id: string; budget: string | null; actual: string }[]) {
  return {
    month: "2026-09",
    period: "month",
    label: "2026-09",
    start: "2026-09-01",
    end: "2026-09-30",
    income: "0.00",
    expense: "0.00",
    net: "0.00",
    saved: "0.00",
    budgets: budgets.map((row) => ({ ...row, category_name: "Rent" })),
    savings: [],
  };
}

/** No budget set yet, and no savings pots — the savings card has its own tests. */
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

function mockApi(
  opts: {
    budgets?: unknown[];
    spent?: Parameters<typeof summary>[0];
    pots?: (typeof holiday)[];
    categories?: unknown[];
  } = {},
) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url.includes("/api/savings/overview")) {
      return json({
        month: "2026-09",
        start: "2026-09-01",
        end: "2026-10-01",
        current_month: "2026-09",
        pots: opts.pots ?? [],
      });
    }
    if (url.includes("/api/categories") && method === "PATCH") return json({});
    if (url.includes("/api/categories")) return json({ items: opts.categories ?? categories });
    if (url.includes("/api/budgets") && method === "PUT") return json({}, 200);
    if (url.includes("/api/budgets")) return json({ items: opts.budgets ?? [] });
    if (url.includes("/api/dashboard/summary")) return json(summary(opts.spent ?? []));
    return json({ items: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("PlanPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("asks for the current budget month's summary, the dashboard's own figures", async () => {
    const fetchMock = mockApi();
    render(<PlanPage />);
    await screen.findByLabelText("Monthly amount for Rent");
    expect(
      fetchMock.mock.calls.some(([url]) => /^\/api\/dashboard\/summary\?month=\d{4}-\d{2}$/.test(String(url))),
    ).toBe(true);
  });

  it("shows what a category has spent this month, and what is left of its budget", async () => {
    mockApi({
      budgets: [{ category_id: "c1", monthly_amount: "500.00", updated_at: "" }],
      spent: [{ category_id: "c1", budget: "500.00", actual: "120.00" }],
    });
    render(<PlanPage />);

    const row = (await screen.findByLabelText("Monthly amount for Rent")).closest("tr") as HTMLElement;
    expect(row).toHaveTextContent("120.00");
    expect(row).toHaveTextContent("380.00 left");
    expect(within(row).getByRole("meter", { name: /Rent/ })).toHaveAttribute("aria-valuenow", "24");
  });

  it("says by how much a category is over its budget", async () => {
    mockApi({
      budgets: [{ category_id: "c1", monthly_amount: "100.00", updated_at: "" }],
      spent: [{ category_id: "c1", budget: "100.00", actual: "130.00" }],
    });
    render(<PlanPage />);

    const row = (await screen.findByLabelText("Monthly amount for Rent")).closest("tr") as HTMLElement;
    expect(row).toHaveTextContent("30.00 over");
    expect(row).not.toHaveTextContent("left");
  });

  it("shows zero spent and no bar for a category with neither budget nor spending", async () => {
    mockApi();
    render(<PlanPage />);

    const row = (await screen.findByLabelText("Monthly amount for Rent")).closest("tr") as HTMLElement;
    expect(row).toHaveTextContent("0.00");
    expect(within(row).queryByRole("meter")).toBeNull();
  });

  it("offers no default pot when there are no pots", async () => {
    mockApi();
    render(<PlanPage />);
    await screen.findByLabelText("Monthly amount for Rent");
    expect(screen.queryByLabelText("Default pot for Rent")).toBeNull();
  });

  it("shows a category's default pot and saves a new one at once", async () => {
    const fetchMock = mockApi({ pots: [holiday] });
    const user = userEvent.setup();
    render(<PlanPage />);

    const choice = await screen.findByLabelText("Default pot for Rent");
    expect(choice).toHaveValue("");
    await user.selectOptions(choice, "p1");

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([url, init]) => String(url) === "/api/categories/c1" && init?.method === "PATCH",
      );
      expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ default_savings_type_id: "p1" });
    });
  });

  it("clears a default pot with an explicit null", async () => {
    const fetchMock = mockApi({
      pots: [holiday],
      categories: [{ ...categories[0], default_savings_type_id: "p1" }],
    });
    const user = userEvent.setup();
    render(<PlanPage />);

    const choice = await screen.findByLabelText("Default pot for Rent");
    expect(choice).toHaveValue("p1");
    await user.selectOptions(choice, "");

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
      expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ default_savings_type_id: null });
    });
  });

  it("saves a budget amount with a PUT carrying a two-place decimal string, never a POST", async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    render(<PlanPage />);

    const input = await screen.findByLabelText("Monthly amount for Rent");
    await user.type(input, "150.00");
    await user.click(within(input.closest("tr") as HTMLElement).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        ([url, init]) => String(url) === "/api/budgets/c1" && init?.method === "PUT",
      );
      expect(put).toBeDefined();
      expect(JSON.parse(String(put?.[1]?.body))).toEqual({ monthly_amount: "150.00" });
    });
    // AD-11: setting a budget is always an update, so a POST must never be issued for it.
    expect(
      fetchMock.mock.calls.some(([url, init]) => String(url).startsWith("/api/budgets") && init?.method === "POST"),
    ).toBe(false);
  });

  it("saves a budget typed with a decimal comma as a dotted amount", async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    render(<PlanPage />);

    const input = await screen.findByLabelText("Monthly amount for Rent");
    await user.type(input, "150,5");
    await user.click(within(input.closest("tr") as HTMLElement).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        ([url, init]) => String(url) === "/api/budgets/c1" && init?.method === "PUT",
      );
      expect(JSON.parse(String(put?.[1]?.body))).toEqual({ monthly_amount: "150.5" });
    });
  });

  it("refuses an amount with three decimal places or a negative value, inside the budget card", async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    render(<PlanPage />);

    const input = await screen.findByLabelText("Monthly amount for Rent");
    const row = input.closest("tr") as HTMLElement;
    const card = screen.getByRole("heading", { name: "Monthly budgets" }).closest("section");

    await user.type(input, "10.001");
    await user.click(within(row).getByRole("button", { name: "Save" }));
    expect(await within(card as HTMLElement).findByRole("alert")).toHaveTextContent(
      "at most two decimal places",
    );

    await user.clear(input);
    await user.type(input, "-5.00");
    await user.click(within(row).getByRole("button", { name: "Save" }));
    expect(await within(card as HTMLElement).findByRole("alert")).toHaveTextContent(
      "at most two decimal places",
    );

    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
  });
});

describe("PlanPage on a phone (Story 38.2)", () => {
  onAPhone();

  it("draws a budget as a row with a bar, and the amount inside the open row", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({
      budgets: [{ category_id: "c1", monthly_amount: "500.00", updated_at: "" }],
      spent: [{ category_id: "c1", budget: "500.00", actual: "120.00" }],
    });
    render(<PlanPage />);

    const rows = await screen.findByRole("list", { name: "Monthly budgets" });
    const head = within(rows).getByRole("button", { name: /Rent/ });
    expect(head).toHaveTextContent("120.00");
    expect(rows).toHaveTextContent("of 500.00");
    expect(within(rows).getByRole("meter", { name: /Rent/ })).toHaveAttribute("aria-valuenow", "24");
    expect(screen.queryByLabelText("Monthly amount for Rent")).toBeNull();

    await user.click(head);
    expect(rows).toHaveTextContent("380.00 left");
    const amount = screen.getByLabelText("Monthly amount for Rent");
    await user.clear(amount);
    await user.type(amount, "450");
    await user.click(within(rows).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true),
    );
    expect(within(rows).getByRole("button", { name: "Delete Rent" })).toBeInTheDocument();
  });
});
