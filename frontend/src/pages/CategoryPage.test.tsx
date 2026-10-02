import { render as rtlRender, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Entry, VendorPrice } from "../api/types";
import { ToastProvider } from "../components/Toast";
import { onAPhone } from "../test/phone";
import { CategoryPage } from "./CategoryPage";

function render() {
  return rtlRender(
    <MemoryRouter initialEntries={["/categories/c1"]}>
      <ToastProvider>
        <Routes>
          <Route path="/categories/:categoryId" element={<CategoryPage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const entries: Entry[] = [
  {
    id: "e1",
    kind: "expense",
    category_id: "c1",
    vendor_id: null,
    amount: "60.00",
    occurred_on: "2026-09-03",
    note: "Full tank before the trip",
    quantity: "40.000",
    unit: "l",
    unit_price: "1.5000",
    created_at: "",
  },
];

const vendors: VendorPrice[] = [
  { vendor_id: "v1", vendor_name: "Shell", unit: "l", spent: "90.00", entries: 2, unit_price: "1.5000" },
  { vendor_id: "v2", vendor_name: "Esso", unit: null, spent: "30.00", entries: 1, unit_price: null },
];

function mockApi() {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes("/api/dashboard/vendor-prices")) return json({ months: [], vendors });
    if (url.includes("/api/dashboard/unit-prices")) return json({ months: [], series: [] });
    if (url.includes("/api/dashboard/trends")) {
      return json({ months: [], income: [], expense: [], saved: [], expense_by_category: [] });
    }
    if (url.includes("/api/entries")) return json({ items: entries });
    if (url.includes("/api/categories")) {
      return json({ items: [{ id: "c1", kind: "expense", name: "Fuel", created_at: "" }] });
    }
    return json({ items: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("CategoryPage on a phone (Story 38.2)", () => {
  onAPhone();
  beforeEach(() => {
    mockApi();
  });

  it("draws each vendor as a static row: spent, rate and how many entries", async () => {
    render();

    const rows = await screen.findByRole("list", { name: "By vendor" });
    expect(screen.queryByRole("table", { name: "By vendor" })).toBeNull();
    expect(within(rows).queryByRole("button")).toBeNull();
    const shell = within(rows).getByText("Shell").closest("li") as HTMLElement;
    expect(shell).toHaveTextContent("1.5000 /l · 2 entries");
    expect(shell).toHaveTextContent("90.00");
    expect(within(rows).getByText("Esso").closest("li")).toHaveTextContent("1 entry");
  });

  it("draws an entry as its day, quantity and note, with Delete on opening", async () => {
    const user = userEvent.setup();
    render();

    const rows = await screen.findByRole("list", { name: "Category entries" });
    const head = within(rows).getByRole("button", { name: /3 September/ });
    expect(head).toHaveTextContent("40 l");
    expect(head).toHaveTextContent("Full tank before the trip");
    expect(head).toHaveTextContent("60.00");
    expect(within(rows).queryByRole("button", { name: "Delete" })).toBeNull();

    await user.click(head);
    expect(within(rows).getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });
});
