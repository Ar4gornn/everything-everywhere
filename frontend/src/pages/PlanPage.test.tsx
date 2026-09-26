import { render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PlanPage } from "./PlanPage";
import { MemoryRouter } from "react-router-dom";

import { AuthProvider } from "../auth/AuthContext";
import { ToastProvider } from "../components/Toast";

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
function mockApi(
  opts: { budgets?: unknown[]; spent?: Parameters<typeof summary>[0] } = {},
) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url.includes("/api/savings/overview")) {
      return json({
        month: "2026-09",
        start: "2026-09-01",
        end: "2026-10-01",
        current_month: "2026-09",
        pots: [],
      });
    }
    if (url.includes("/api/categories")) return json({ items: categories });
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
