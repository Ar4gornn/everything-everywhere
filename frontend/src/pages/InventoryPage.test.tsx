import { fireEvent, render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InventoryPage } from "./InventoryPage";
import type { InventoryItem, Space } from "../api/types";
import { onAPhone } from "../test/phone";

function render(ui: React.ReactElement, path = "/inventory") {
  return rtlRender(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);
}

const spaces: Space[] = [
  { id: "fridge", name: "Fridge", created_at: "" },
  { id: "garage", name: "Garage", created_at: "" },
];

const item = (overrides: Partial<InventoryItem>): InventoryItem => ({
  id: "i",
  space_id: "fridge",
  name: "Milk",
  quantity: 2,
  restock_below: null,
  cost: null,
  note: null,
  needs_restock: false,
  restocked_at: null,
  created_at: "",
  updated_at: "",
  ...overrides,
});

const items: InventoryItem[] = [
  item({ id: "milk", name: "Milk", quantity: 0, restock_below: 1, needs_restock: true }),
  item({ id: "eggs", name: "Eggs", quantity: 6, restock_below: 2, cost: "3.20" }),
  item({ id: "oil", name: "Engine oil", space_id: "garage", quantity: 1, note: "5W-30" }),
];

function json(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockApi() {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/shopping-list")) {
      return json({ items: [], estimate: "0.00", without_cost: 0 });
    }
    if (url.includes("/api/inventory/spaces") && init?.method === "DELETE") {
      return json({ detail: "That space still has items" }, 409);
    }
    if (url.includes("/api/inventory/spaces")) return json({ items: spaces });
    if (url.includes("/api/inventory/restocks")) {
      return json({
        months: ["2026-08", "2026-09"],
        series: [{ space_id: "fridge", space_name: "Fridge", values: [1, 2] }],
      });
    }
    if (url.includes("/history")) {
      return json({
        items: [
          { quantity_before: 0, quantity_after: 2, changed_at: "2026-09-01T10:00:00Z" },
          { quantity_before: 2, quantity_after: 0, changed_at: "2026-09-04T10:00:00Z" },
        ],
      });
    }
    if (url.includes("/api/inventory/items") && init?.method === "POST") {
      return json(item({ id: "new", ...JSON.parse(String(init.body)) }), 201);
    }
    if (url.includes("/api/inventory/items") && init?.method === "PATCH") {
      return json(item(JSON.parse(String(init.body))));
    }
    if (url.includes("/api/inventory/items") && init?.method === "DELETE") return json(null, 204);
    return json({ items });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function patches(mock: ReturnType<typeof vi.fn>) {
  return mock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === "PATCH")
    .map(([url, init]) => ({ url: String(url), body: JSON.parse(String((init as RequestInit).body)) }));
}

describe("InventoryPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows every space on one page, grouped, with low items badged", async () => {
    mockApi();
    render(<InventoryPage />);

    const fridge = await screen.findByRole("table", { name: "Fridge items" });
    const garage = screen.getByRole("table", { name: "Garage items" });
    expect(within(fridge).getByText("Milk")).toBeInTheDocument();
    expect(within(fridge).getByText("Eggs")).toBeInTheDocument();
    expect(within(garage).getByText("Engine oil")).toBeInTheDocument();
    expect(within(garage).getByText("5W-30")).toBeInTheDocument();
    // The badge comes from the server's flag, not a client-side recomputation.
    expect(within(fridge).getAllByText("restock")).toHaveLength(1);
  });

  it("filters to what needs restocking, and arrives filtered from the dashboard link", async () => {
    mockApi();
    render(<InventoryPage />, "/inventory?filter=restock");

    const fridge = await screen.findByRole("table", { name: "Fridge items" });
    expect(within(fridge).getByText("Milk")).toBeInTheDocument();
    expect(within(fridge).queryByText("Eggs")).toBeNull();
    expect(screen.queryByRole("table", { name: "Garage items" })).toBeNull();
    expect(screen.getByRole("button", { name: /Needs restocking · 1/ })).toBeInTheDocument();
  });

  it("changes a quantity with the stepper as an absolute PATCH", async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    render(<InventoryPage />);
    await screen.findByRole("table", { name: "Fridge items" });

    await user.click(screen.getByRole("button", { name: "One more Eggs" }));
    await waitFor(() => expect(patches(fetchMock)).toEqual([{ url: expect.stringContaining("/items/eggs"), body: { quantity: 7 } }]));
  });

  it("will not step below zero", async () => {
    mockApi();
    render(<InventoryPage />);
    await screen.findByRole("table", { name: "Fridge items" });
    expect(screen.getByRole("button", { name: "One less Milk" })).toBeDisabled();
  });

  it("marks an item as running low by raising the threshold, never the quantity", async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    render(<InventoryPage />);
    await screen.findByRole("table", { name: "Garage items" });

    // Engine oil is at 1: the threshold becomes 1, the quantity is untouched, so the
    // append-only log records no change that did not happen.
    await user.click(screen.getByRole("button", { name: "Engine oil is running low" }));
    await waitFor(() =>
      expect(patches(fetchMock)[0]).toEqual({
        url: expect.stringContaining("/items/oil"),
        body: { restock_below: 1 },
      }),
    );
  });

  it("ignores a second stepper click while the first is in flight", async () => {
    const fetchMock = mockApi();
    render(<InventoryPage />);
    await screen.findByRole("table", { name: "Fridge items" });

    // Two clicks in the same tick: with only state as the guard both would send 7, and the
    // second click would be silently lost once the list reloaded.
    const more = screen.getByRole("button", { name: "One more Eggs" });
    fireEvent.click(more);
    fireEvent.click(more);
    await waitFor(() => expect(patches(fetchMock).length).toBeGreaterThan(0));
    await waitFor(() => expect(more).not.toBeDisabled());
    expect(patches(fetchMock).map((p) => p.body.quantity)).toEqual([7]);
  });

  it("creates an item into a space by name", async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    render(<InventoryPage />);
    await screen.findByRole("table", { name: "Fridge items" });

    const form = screen.getByRole("form", { name: "Add an item" });
    await user.type(within(form).getByLabelText("Name"), "Batteries");
    await user.clear(within(form).getByLabelText("Quantity"));
    await user.type(within(form).getByLabelText("Quantity"), "8");
    await user.type(within(form).getByLabelText("Space"), "House stuff");
    await user.type(within(form).getByLabelText("Restock threshold"), "2");
    await user.click(within(form).getByRole("button", { name: "Add" }));

    await waitFor(() => {
      const posted = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
      const body = JSON.parse(String(posted?.[1]?.body));
      expect(body).toEqual({ name: "Batteries", quantity: 8, space_name: "House stuff", restock_below: 2 });
    });
  });

  it("a space chip fills the field and is what the item is created into", async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    render(<InventoryPage />);
    await screen.findByRole("table", { name: "Fridge items" });

    const form = screen.getByRole("form", { name: "Add an item" });
    await user.click(within(form).getByLabelText("Name"));
    await user.paste("Jump leads");
    await user.type(within(form).getByLabelText("Space"), "Ga");
    await user.click(within(form).getByRole("button", { name: "Garage" }));
    expect(within(form).getByLabelText("Space")).toHaveValue("Garage");
    await user.click(within(form).getByRole("button", { name: "Add" }));

    await waitFor(() => {
      const posted = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
      expect(JSON.parse(String(posted?.[1]?.body))).toMatchObject({
        name: "Jump leads",
        space_name: "Garage",
      });
    });
  });

  it("shows the server's explanation when a space delete is refused", async () => {
    mockApi();
    const user = userEvent.setup();
    render(<InventoryPage />);
    await screen.findByRole("table", { name: "Fridge items" });

    await user.click(screen.getByRole("button", { name: "Delete Fridge" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That space still has items");
  });

  it("unfolds an item's history as an inline SVG step chart", async () => {
    mockApi();
    const user = userEvent.setup();
    render(<InventoryPage />);
    await screen.findByRole("table", { name: "Fridge items" });

    await user.click(screen.getByRole("button", { name: "History of Milk" }));
    expect(await screen.findByRole("img", { name: "Milk quantity over time" })).toBeInTheDocument();
  });

  it("draws restocks per space per month", async () => {
    mockApi();
    render(<InventoryPage />);
    expect(await screen.findByRole("img", { name: "Fridge restocks per month" })).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Restocks per space" });
    expect(within(table).getByText("3")).toBeInTheDocument();
  });

  it("explains what a space is when there are none", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/restocks")) return json({ months: [], series: [] });
        return json({ items: [] });
      }),
    );
    render(<InventoryPage />);
    expect(await screen.findByText(/A space is anywhere you keep things/)).toBeInTheDocument();
  });
});

describe("InventoryPage restocks on a phone (Story 38.2)", () => {
  onAPhone();

  it("draws a static row per space: its bars and its total", async () => {
    mockApi();
    render(<InventoryPage />);

    const rows = await screen.findByRole("list", { name: "Restocks per space" });
    expect(screen.queryByRole("table", { name: "Restocks per space" })).toBeNull();
    expect(within(rows).getByRole("img", { name: "Fridge restocks per month" })).toBeInTheDocument();
    expect(within(rows).getByText("Fridge").closest("li")).toHaveTextContent("3");
    expect(within(rows).queryByRole("button")).toBeNull();
  });
});

describe("InventoryPage item rows on a phone (Story 38.3)", () => {
  onAPhone();

  it("counts from the row: the stepper sits beside the head and works closed", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi();
    render(<InventoryPage />);

    const fridge = await screen.findByRole("list", { name: "Fridge items" });
    expect(screen.queryByRole("table", { name: "Fridge items" })).toBeNull();
    const head = within(fridge).getByRole("button", { name: /^Eggs/ });
    const more = within(fridge).getByRole("button", { name: "One more Eggs" });
    expect(head.contains(more)).toBe(false);
    expect(within(fridge).getByRole("status", { name: "Eggs quantity" })).toHaveTextContent("6");

    await user.click(more);
    await waitFor(() => expect(patches(fetchMock)).toHaveLength(1));
    expect(patches(fetchMock)[0]).toMatchObject({ body: { quantity: 7 } });
    expect(head).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps the rest one tap away: threshold, cost, and the desktop's actions", async () => {
    const user = userEvent.setup();
    mockApi();
    render(<InventoryPage />);

    const fridge = await screen.findByRole("list", { name: "Fridge items" });
    expect(within(fridge).getByRole("button", { name: /^Milk/ })).toHaveTextContent("restock");
    expect(screen.queryByRole("button", { name: "Edit Eggs" })).toBeNull();

    await user.click(within(fridge).getByRole("button", { name: /^Eggs/ }));
    expect(fridge).toHaveTextContent("Remind at 2 · Cost $3.20");
    for (const name of ["Eggs is running low", "History of Eggs", "Edit Eggs", "Delete Eggs"]) {
      expect(within(fridge).getByRole("button", { name })).toBeInTheDocument();
    }

    await user.click(within(fridge).getByRole("button", { name: "History of Eggs" }));
    expect(await within(fridge).findByRole("img", { name: /Eggs/ })).toBeInTheDocument();
  });

  it("folds a row's history when the row closes", async () => {
    const user = userEvent.setup();
    mockApi();
    render(<InventoryPage />);

    const fridge = await screen.findByRole("list", { name: "Fridge items" });
    const head = within(fridge).getByRole("button", { name: /^Eggs/ });
    await user.click(head);
    await user.click(within(fridge).getByRole("button", { name: "History of Eggs" }));
    await within(fridge).findByRole("img", { name: /Eggs/ });

    await user.click(head);
    await user.click(head);
    expect(within(fridge).getByRole("button", { name: "History of Eggs" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(within(fridge).queryByRole("img", { name: /Eggs/ })).toBeNull();
  });

  it("edits inside the row with the one edit form", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi();
    render(<InventoryPage />);

    const garage = await screen.findByRole("list", { name: "Garage items" });
    expect(within(garage).getByRole("button", { name: /^Engine oil/ })).toHaveTextContent("5W-30");
    await user.click(within(garage).getByRole("button", { name: /^Engine oil/ }));
    await user.click(within(garage).getByRole("button", { name: "Edit Engine oil" }));

    const cost = within(garage).getByLabelText("Edit cost");
    await user.type(cost, "12.50");
    await user.click(within(garage).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patches(fetchMock)).toHaveLength(1));
    expect(patches(fetchMock)[0]).toMatchObject({ body: { cost: "12.50" } });
  });
});
