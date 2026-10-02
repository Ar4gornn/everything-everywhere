import { render as rtlRender, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Leftover, SavingsType } from "../api/types";
import { AuthProvider } from "../auth/AuthContext";
import { LeftoverCard } from "./LeftoverCard";
import { ToastProvider } from "./Toast";

const august: Leftover = {
  month: "2026-08",
  start: "2026-08-01",
  end: "2026-08-31",
  income: "3000.00",
  expense: "2100.00",
  saved: "400.00",
  leftover: "500.00",
  dismissed: false,
};

const pots: SavingsType[] = [
  { id: "p1", name: "Holidays", created_at: "" },
  { id: "p2", name: "Car", created_at: "" },
];

function render(leftover: Leftover = august, onChange = vi.fn()) {
  const view = rtlRender(
    <MemoryRouter>
      <AuthProvider>
        <ToastProvider>
          <LeftoverCard leftover={leftover} onChange={onChange} />
        </ToastProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
  return { ...view, onChange };
}

type Answer = { status: number; body?: unknown };

function json(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockApi(
  answers: { types?: SavingsType[]; contribution?: Answer; dismiss?: Answer } = {},
) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url.startsWith("/api/savings/types")) return json({ items: answers.types ?? pots });
    if (url.startsWith("/api/savings/contributions") && method === "POST") {
      const a = answers.contribution;
      return a ? json(a.body ?? null, a.status) : json({ id: "new" }, 201);
    }
    if (url.startsWith("/api/dashboard/leftover/")) {
      const a = answers.dismiss;
      return a ? json(a.body ?? null, a.status) : json(null, 204);
    }
    return json({ items: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const calls = (fetchMock: ReturnType<typeof mockApi>, method: string, prefix: string) =>
  fetchMock.mock.calls.filter(
    ([url, init]) => String(url).startsWith(prefix) && (init?.method ?? "GET") === method,
  );

describe("LeftoverCard", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("says what the month left over, and where the figure comes from", async () => {
    mockApi();
    render();

    expect(
      await screen.findByText("August 2026 left $500.00 after spending and savings."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Income $3,000.00 · spent $2,100.00 · saved $400.00"),
    ).toBeInTheDocument();
  });

  it("proposes the whole leftover, and puts nothing aside until a pot is chosen", async () => {
    const fetchMock = mockApi();
    render();

    const put = await screen.findByRole("button", { name: "Put aside" });
    expect(screen.getByLabelText("Amount to put aside")).toHaveValue("500.00");
    // No pot is picked for the person (rejected at scoping: one default leftover pot).
    expect(screen.getByLabelText("Into which pot")).toHaveValue("");
    expect(put).toBeDisabled();
    expect(calls(fetchMock, "POST", "/api/savings/contributions")).toHaveLength(0);
  });

  it("deposits into the chosen pot on the month's last day, then asks again", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi();
    const { onChange } = render();

    await user.selectOptions(await screen.findByLabelText("Into which pot"), "p2");
    await user.click(screen.getByRole("button", { name: "Put aside" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const [post] = calls(fetchMock, "POST", "/api/savings/contributions");
    // Dated inside the closed month, so the deposit lowers the leftover it answers.
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      savings_type_id: "p2",
      amount: "500.00",
      occurred_on: "2026-08-31",
    });
    expect(await screen.findByText("$500.00 put aside")).toBeInTheDocument();
  });

  it("deposits part of it when the amount is changed", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi();
    render();

    await user.selectOptions(await screen.findByLabelText("Into which pot"), "p1");
    const amount = screen.getByLabelText("Amount to put aside");
    await user.clear(amount);
    await user.type(amount, "120,5");
    await user.click(screen.getByRole("button", { name: "Put aside" }));

    await waitFor(() =>
      expect(calls(fetchMock, "POST", "/api/savings/contributions")).toHaveLength(1),
    );
    const [post] = calls(fetchMock, "POST", "/api/savings/contributions");
    expect(JSON.parse(String(post?.[1]?.body)).amount).toBe("120.5");
  });

  it("proposes the new remainder after a partial deposit, not the old draft", async () => {
    const user = userEvent.setup();
    mockApi();
    const { rerender, onChange } = render();

    const amount = await screen.findByLabelText("Amount to put aside");
    await user.clear(amount);
    await user.type(amount, "120.00");
    rerender(
      <MemoryRouter>
        <AuthProvider>
          <ToastProvider>
            <LeftoverCard leftover={{ ...august, leftover: "380.00" }} onChange={onChange} />
          </ToastProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(screen.getByLabelText("Amount to put aside")).toHaveValue("380.00");
  });

  it("refuses an amount that is not money, without a request", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi();
    const { onChange } = render();

    await user.selectOptions(await screen.findByLabelText("Into which pot"), "p1");
    const amount = screen.getByLabelText("Amount to put aside");
    await user.clear(amount);
    await user.type(amount, "abc");
    await user.click(screen.getByRole("button", { name: "Put aside" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(calls(fetchMock, "POST", "/api/savings/contributions")).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows the server's refusal and keeps the card as it was", async () => {
    const user = userEvent.setup();
    mockApi({
      contribution: { status: 422, body: { detail: "nope", code: "validation" } },
    });
    const { onChange } = render();

    await user.selectOptions(await screen.findByLabelText("Into which pot"), "p1");
    await user.click(screen.getByRole("button", { name: "Put aside" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("dismisses the month, by its label", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi();
    const { onChange } = render();

    await user.click(await screen.findByRole("button", { name: "Not this time" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(calls(fetchMock, "PUT", "/api/dashboard/leftover/2026-08/dismissed")).toHaveLength(1);
    expect(calls(fetchMock, "POST", "/api/savings/contributions")).toHaveLength(0);
  });

  it("points to the Plan page when there is no pot to put it in", async () => {
    mockApi({ types: [] });
    render();

    const link = await screen.findByRole("link", {
      name: "Create a pot on the Plan page to put it aside.",
    });
    expect(link).toHaveAttribute("href", "/plan");
    expect(screen.queryByRole("button", { name: "Put aside" })).toBeNull();
    // It can still be dismissed.
    expect(screen.getByRole("button", { name: "Not this time" })).toBeEnabled();
  });
});
