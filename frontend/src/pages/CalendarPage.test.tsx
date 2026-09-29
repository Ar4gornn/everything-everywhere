import { fireEvent, render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CalendarPage } from "./CalendarPage";
import { AuthProvider } from "../auth/AuthContext";
import { monthOf } from "../months";

/**
 * The calendar grid (Epic 22, stories 22.2 and 22.3).
 *
 * The assertion that matters most is the ragged one: for an account whose month starts on
 * the 26th, the grid must cover 26 August to 25 September, because every total in the app
 * does. A calendar month here would be the one view that disagrees with the figure above it.
 */

function render(ui: React.ReactElement) {
  return rtlRender(
    <AuthProvider>
      <MemoryRouter>{ui}</MemoryRouter>
    </AuthProvider>,
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const me = {
  id: "u1",
  email: "sam@example.com",
  currency: "USD",
  weight_unit: "kg",
  budget_start_day: 26,
  created_at: "",
};

const entries = [
  {
    id: "e1",
    kind: "expense",
    category_id: "c1",
    vendor_id: null,
    amount: "40.00",
    occurred_on: "2026-09-02",
    note: "Petrol",
    quantity: null,
    unit: null,
    unit_price: null,
    created_at: "",
  },
  {
    id: "e2",
    kind: "income",
    category_id: "c2",
    vendor_id: null,
    amount: "1200.00",
    occurred_on: "2026-08-26",
    note: null,
    quantity: null,
    unit: null,
    unit_price: null,
    created_at: "",
  },
];

/**
 * Two meals on the 2nd (Epic 27): a recipe eaten in servings, and a bare food in grams.
 *
 * Their calorie figures are already derived — the layer renders what it was told and only
 * *sums* the day, which is the same thing the money line does with cents.
 */
const meals = [
  {
    id: "m1",
    eaten_on: "2026-09-02",
    recipe_id: "r1",
    recipe_name: "Rice and eggs",
    servings: "0.500",
    food_id: null,
    food_name: null,
    quantity: null,
    unit: null,
    note: null,
    nutrition: {
      kcal: "123.5000",
      protein: "6.0750",
      carbs: null,
      fat: null,
      unknown: { kcal: 0, protein: 0, carbs: 1, fat: 2 },
    },
  },
  {
    id: "m2",
    eaten_on: "2026-09-02",
    recipe_id: null,
    recipe_name: null,
    servings: null,
    food_id: "f1",
    food_name: "Rice",
    quantity: "150.000",
    unit: "g",
    note: null,
    nutrition: {
      kcal: "195.0000",
      protein: "4.0500",
      carbs: null,
      fat: null,
      unknown: { kcal: 0, protein: 0, carbs: 1, fat: 1 },
    },
  },
];

interface Options {
  startDay?: number;
  failStock?: boolean;
  /** One deposit and one withdrawal on 2026-09-03 (Epic 34). */
  savings?: boolean;
  /** Entries answered per requested month, as the server does, not all of them every time. */
  windowed?: boolean;
}

function mockApi(options: Options = {}) {
  window.localStorage.setItem("everything-everywhere.token", "test-token");
  const seen: string[] = [];
  const fetchMock = vi.fn(async (url: string) => {
    seen.push(url);
    if (url.includes("/api/auth/me")) {
      return json({ ...me, budget_start_day: options.startDay ?? 26 });
    }
    if (url.includes("/api/inventory/changes")) {
      if (options.failStock) return json({ detail: "boom" }, 500);
      return json({
        items: [
          {
            item_id: "i1",
            item_name: "Milk",
            quantity_before: 4,
            quantity_after: 1,
            changed_at: "2026-09-02T09:00:00+00:00",
          },
        ],
      });
    }
    if (url.includes("/api/entries")) {
      // The server's window, not every row: a week across the boundary asks for two months,
      // and a fixture that answered both with everything would count each entry twice.
      const month = new URL(url, "http://x").searchParams.get("month");
      return json({
        items: entries.filter(
          (row) => !options.windowed || !month || monthOf(new Date(`${row.occurred_on}T00:00:00`), options.startDay ?? 26) === month,
        ),
      });
    }
    if (url.includes("/api/categories")) {
      return json({
        items: [
          { id: "c1", name: "Fuel", kind: "expense", created_at: "" },
          { id: "c2", name: "Salary", kind: "income", created_at: "" },
        ],
      });
    }
    if (url.includes("/api/savings/types")) {
      return json({
        items: options.savings ? [{ id: "p1", name: "Holidays", created_at: "" }] : [],
      });
    }
    if (url.includes("/api/savings/contributions")) {
      if (!options.savings) return json({ items: [] });
      const row = { savings_type_id: "p1", occurred_on: "2026-09-03", note: null, created_at: "" };
      return json({
        items: [
          { ...row, id: "k1", kind: "deposit", amount: "50.00" },
          { ...row, id: "k2", kind: "withdrawal", amount: "20.00" },
        ],
      });
    }
    if (url.includes("/api/gym/workouts")) return json({ items: [] });
    if (url.includes("/api/habits/checkins")) {
      return json({
        items: [
          {
            id: "h1",
            habit_id: "hb1",
            habit_name: "Run",
            done_on: "2026-09-02",
            times: 2,
            note: null,
          },
        ],
      });
    }
    if (url.includes("/api/recurring/expected")) {
      return json({
        items: [
          {
            template_id: "t1",
            due_on: "2026-09-20",
            kind: "expense",
            category_id: "c1",
            category_name: "Rent",
            amount: "900.00",
            note: null,
            cadence: "monthly",
            auto: false,
          },
        ],
      });
    }
    if (url.includes("/api/recurring/pending")) return json({ items: [] });
    if (url.includes("/api/books/quotes/draw")) return json(null);
    if (url.includes("/api/meals")) return json({ items: meals });
    return json({ items: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, seen };
}

/**
 * The month input is the one control that names the period being shown.
 *
 * One change event carrying the whole value, which is what a real month picker emits.
 * Typing it character by character does not work here: the control falls back to the
 * account's current month for any value the input reports as invalid, and every prefix of
 * "2026-09" is invalid — so clear-then-type left the page on today's month, and these
 * tests only ever passed because that happened to be the month they asked for.
 */
async function setMonth(value: string) {
  const input = await screen.findByLabelText("Month");
  fireEvent.change(input, { target: { value } });
  await waitFor(() => expect((input as HTMLInputElement).value).toBe(value));
}

describe("CalendarPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    // Every test here names a month of 2026 and asserts which days fall inside the account's
    // period, so "now" is part of the fixture. Left to the real clock these assertions were
    // decoration: they passed while today happened to sit in the period they describe and
    // went red on the day it moved on (26 September 2026, in CI). Only Date is faked —
    // userEvent needs real timers.
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-08-10T12:00:00Z") });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("draws the account's period, not the calendar month", async () => {
    mockApi({ startDay: 26 });
    render(<CalendarPage />);

    await setMonth("2026-09");

    // 26 August is inside the period labelled September for this account, and 25 August is
    // not. Both are on the grid; only the first is a day of this period.
    await waitFor(() => {
      expect(screen.getByRole("gridcell", { name: /^2026-08-26/ })).toBeInTheDocument();
    });
    expect(screen.getByRole("gridcell", { name: /^2026-08-25.*outside this period/ }))
      .toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: /^2026-09-25/ }).className).not.toContain(
      "outside",
    );
    expect(screen.getByRole("gridcell", { name: /^2026-09-26.*outside this period/ }))
      .toBeInTheDocument();
    // Spelled out, so nobody has to infer what "September" covers.
    expect(screen.getByText("26 Aug – 25 Sep")).toBeInTheDocument();
  });

  it("is the plain calendar month for an account that never moved the boundary", async () => {
    mockApi({ startDay: 1 });
    render(<CalendarPage />);

    await setMonth("2026-09");

    await waitFor(() => {
      expect(screen.getByRole("gridcell", { name: /^2026-09-01/ }).className).not.toContain(
        "outside",
      );
    });
    expect(screen.getByRole("gridcell", { name: /^2026-08-31.*outside/ })).toBeInTheDocument();
  });

  it("asks every module for the same window", async () => {
    const { seen } = mockApi({ startDay: 26 });
    render(<CalendarPage />);
    await setMonth("2026-09");

    await waitFor(() => {
      expect(seen.some((url) => url.includes("/api/entries?month=2026-09"))).toBe(true);
    });
    for (const path of [
      "/api/savings/contributions?month=2026-09",
      "/api/inventory/changes?month=2026-09",
      "/api/habits/checkins?month=2026-09",
      "/api/recurring/expected?month=2026-09",
      "/api/meals?month=2026-09",
    ]) {
      expect(seen.some((url) => url.includes(path))).toBe(true);
    }
  });

  it("draws the day's meals and adds up what they came to", async () => {
    mockApi({ startDay: 26 });
    render(<CalendarPage />);
    await setMonth("2026-09");

    await userEvent.click(await screen.findByRole("gridcell", { name: /^2026-09-02/ }));
    const card = (await screen.findByText("Wed 2 September")).closest("section") as HTMLElement;

    // A recipe reads as a portion of itself; a bare food reads as a quantity in its unit.
    expect(within(card).getByRole("link", { name: "Rice and eggs" })).toBeInTheDocument();
    expect(within(card).getByText("× 0.5")).toBeInTheDocument();
    expect(within(card).getByText("150 g")).toBeInTheDocument();

    // 123.5 + 195 = 318.5, rounded to a whole calorie. Summed here, exactly as the money
    // line is summed, because each meal already carries its own derived figure.
    expect(within(card).getByText("319 kcal eaten")).toBeInTheDocument();
  });

  it("shows a day's records, and says a forecast is a forecast", async () => {
    mockApi({ startDay: 26 });
    render(<CalendarPage />);
    await setMonth("2026-09");

    const day = await screen.findByRole("gridcell", { name: /^2026-09-02/ });
    await userEvent.click(day);

    const panel = await screen.findByText("Wed 2 September");
    const card = panel.closest("section") as HTMLElement;
    expect(within(card).getByText("Fuel")).toBeInTheDocument();
    expect(within(card).getByText("$40.00")).toBeInTheDocument();
    expect(within(card).getByText(/Milk/)).toBeInTheDocument();
    expect(within(card).getByText("Run")).toBeInTheDocument();

    // The 20th carries a projected charge. It must read as something that has not happened.
    // Scoped to the day panel: since the wide layout also prints the day's labels inside the
    // cell, an unscoped getByText("Rent") now matches the grid as well as the panel.
    await userEvent.click(screen.getByRole("gridcell", { name: /^2026-09-20/ }));
    const forecastCard = (await screen.findByText("Sun 20 September")).closest(
      "section",
    ) as HTMLElement;
    const forecast = within(forecastCard).getByText("Rent").closest("li") as HTMLElement;
    expect(within(forecast).getByText("expected")).toBeInTheDocument();
    expect(forecast.textContent).toContain("will be proposed");
    // Nothing to confirm or skip: the one button is Epic 39's "Add to calendar".
    expect(
      within(forecast)
        .queryAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Add Rent to calendar"]);
  });

  it("says a withdrawal is money out, not money saved", async () => {
    mockApi({ startDay: 26, savings: true });
    render(<CalendarPage />);
    await setMonth("2026-09");

    await userEvent.click(await screen.findByRole("gridcell", { name: /^2026-09-03/ }));
    const card = (await screen.findByText("Thu 3 September")).closest("section") as HTMLElement;
    const rows = within(card)
      .getAllByRole("link", { name: "Holidays" })
      .map((link) => link.closest("li") as HTMLElement);
    expect(rows).toHaveLength(2);
    const [deposit, withdrawal] = rows as [HTMLElement, HTMLElement];
    expect(deposit.textContent).toContain("$50.00");
    expect(within(withdrawal).getByText("Withdrawal")).toBeInTheDocument();
    expect(withdrawal.textContent).toContain("-$20.00");
  });

  it("keeps the rest of the month when one module fails", async () => {
    mockApi({ startDay: 26, failStock: true });
    render(<CalendarPage />);
    await setMonth("2026-09");

    await waitFor(() => {
      expect(screen.getByText(/could not be loaded: Stock/)).toBeInTheDocument();
    });
    await userEvent.click(await screen.findByRole("gridcell", { name: /^2026-09-02/ }));
    const card = (await screen.findByText("Wed 2 September")).closest("section") as HTMLElement;
    expect(within(card).getByText("Fuel")).toBeInTheDocument();
    expect(within(card).queryByText(/Milk/)).toBeNull();
  });

  it("turning a layer off hides it and is remembered", async () => {
    mockApi({ startDay: 26 });
    const { unmount } = render(<CalendarPage />);
    await setMonth("2026-09");

    await userEvent.click(await screen.findByRole("button", { name: "Layers (8/8)" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Habits" }));
    await userEvent.click(await screen.findByRole("gridcell", { name: /^2026-09-02/ }));
    let card = (await screen.findByText("Wed 2 September")).closest("section") as HTMLElement;
    expect(within(card).queryByText("Run")).toBeNull();
    expect(within(card).getByText("Fuel")).toBeInTheDocument();

    unmount();
    render(<CalendarPage />);
    await setMonth("2026-09");
    expect(screen.getByRole("button", { name: "Layers (7/8)" })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("gridcell", { name: /^2026-09-02/ }));
    card = (await screen.findByText("Wed 2 September")).closest("section") as HTMLElement;
    expect(within(card).queryByText("Run")).toBeNull();
  });

  it("the layers menu counts what is on, keys it, and closes on Escape", async () => {
    mockApi({ startDay: 26 });
    render(<CalendarPage />);
    await setMonth("2026-09");

    const button = screen.getByRole("button", { name: "Layers (8/8)" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(screen.getByRole("checkbox", { name: "Stock" }));
    expect(button).toHaveTextContent("Layers (7/8)");

    const key = screen.getByRole("list", { name: "Key" });
    expect(within(key).queryByText("Stock")).toBeNull();
    expect(within(key).getByText("Habits")).toBeInTheDocument();

    screen.getByRole("checkbox", { name: "Habits" }).focus();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("checkbox")).toBeNull());
    expect(document.activeElement).toBe(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("the last layer on cannot be turned off", async () => {
    mockApi({ startDay: 26 });
    render(<CalendarPage />);
    await setMonth("2026-09");

    await userEvent.click(screen.getByRole("button", { name: "Layers (8/8)" }));
    const boxes = screen.getAllByRole("checkbox");
    for (const box of boxes.slice(1)) await userEvent.click(box);
    expect(screen.getByRole("button", { name: "Layers (1/8)" })).toBeInTheDocument();
    expect(boxes[0]).toBeChecked();
    expect(boxes[0]).toBeDisabled();
    expect(boxes[1]).toBeEnabled();
  });

  it("marks a day with one bar per layer, in the layers' own order", async () => {
    mockApi({ startDay: 26 });
    render(<CalendarPage />);
    await setMonth("2026-09");

    const day = await screen.findByRole("gridcell", { name: /^2026-09-02/ });
    await waitFor(() => expect(day.querySelectorAll(".cal-bar").length).toBe(4));
    const bars = [...day.querySelectorAll(".cal-bar")].map((bar) => bar.getAttribute("data-layer"));
    expect(bars).toEqual(["money", "stock", "habits", "meals"]);
  });

  it("writes four lines in a wide cell, or three and a count", async () => {
    mockApi({ startDay: 26 });
    render(<CalendarPage />);
    await setMonth("2026-09");

    // The 2nd holds five: Fuel, Milk, Run, and two meals.
    const day = await screen.findByRole("gridcell", { name: /^2026-09-02/ });
    await waitFor(() => expect(within(day).getByText("+2 more")).toBeInTheDocument());
    const lines = [...day.querySelectorAll(".cal-line[data-layer]")].map((line) => [
      line.getAttribute("data-layer"),
      line.textContent,
    ]);
    expect(lines).toEqual([
      ["money", "Fuel"],
      ["stock", "Milk"],
      ["habits", "Run"],
    ]);

    // Four fit as four: with meals off, no count.
    await userEvent.click(screen.getByRole("button", { name: "Layers (8/8)" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Meals" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Stock" }));
    expect(day.querySelectorAll(".cal-line[data-layer]")).toHaveLength(2);
    expect(within(day).queryByText(/more$/)).toBeNull();
  });

  it("a day outside the period moves to the period it belongs to", async () => {
    mockApi({ startDay: 26 });
    render(<CalendarPage />);
    await setMonth("2026-09");

    await userEvent.click(
      await screen.findByRole("gridcell", { name: /^2026-08-25.*outside this period/ }),
    );
    // 25 August belongs to the period labelled August for this account.
    await waitFor(() => {
      expect(screen.getByLabelText("Month")).toHaveValue("2026-08");
    });
  });

  // --------------------------------------------------------------- Epic 40.1

  it("rings today and opens on it beside the grid", async () => {
    mockApi({ startDay: 1 });
    render(<CalendarPage />);

    // "Now" is 10 August 2026 (see beforeEach). A desktop has room, so today's day is
    // already open; nobody has to click to learn what happened today.
    const today = await screen.findByRole("gridcell", { name: /^2026-08-10/ });
    expect(today).toHaveAttribute("aria-current", "date");
    expect(screen.getAllByRole("gridcell").filter((c) => c.hasAttribute("aria-current")))
      .toHaveLength(1);
    expect(await screen.findByRole("region", { name: "Mon 10 August" })).toBeInTheDocument();
  });

  it("keeps one day in the tab order and moves it with the arrows", async () => {
    mockApi({ startDay: 26 });
    render(<CalendarPage />);
    await setMonth("2026-09");

    const start = await screen.findByRole("gridcell", { name: /^2026-09-02/ });
    start.focus();
    const focused = () => (document.activeElement as HTMLElement).dataset.iso;

    await userEvent.keyboard("{ArrowRight}");
    expect(focused()).toBe("2026-09-03");
    await userEvent.keyboard("{ArrowDown}");
    expect(focused()).toBe("2026-09-10");
    await userEvent.keyboard("{End}");
    expect(focused()).toBe("2026-09-13");
    await userEvent.keyboard("{Home}");
    expect(focused()).toBe("2026-09-07");
    await userEvent.keyboard("{ArrowUp}");
    expect(focused()).toBe("2026-08-31");

    expect(screen.getAllByRole("gridcell").filter((c) => c.tabIndex === 0)).toHaveLength(1);

    // Moving only moves; Enter chooses.
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByRole("region", { name: "Mon 31 August" })).toBeInTheDocument();
  });

  it("an arrow past the drawn grid turns to the next period", async () => {
    mockApi({ startDay: 26 });
    render(<CalendarPage />);
    await setMonth("2026-09");

    // The September period ends on the 25th; its grid runs to Sunday 27 September.
    (await screen.findByRole("gridcell", { name: /^2026-09-27/ })).focus();
    await userEvent.keyboard("{ArrowDown}");

    await waitFor(() => expect(screen.getByLabelText("Month")).toHaveValue("2026-10"));
    await waitFor(() => {
      expect((document.activeElement as HTMLElement).dataset.iso).toBe("2026-10-04");
    });
  });

  it("Today goes back to this period and opens today", async () => {
    mockApi({ startDay: 1 });
    render(<CalendarPage />);
    await setMonth("2026-11");
    const button = screen.getByRole("button", { name: "Today" });
    expect(button).toBeEnabled();

    await userEvent.click(button);

    await waitFor(() => expect(screen.getByLabelText("Month")).toHaveValue("2026-08"));
    expect(await screen.findByRole("region", { name: "Mon 10 August" })).toBeInTheDocument();
    expect(button).toBeDisabled();
  });

  /** The figure under a label in the period's summary, or null when the label is absent. */
  function figure(group: HTMLElement, label: string): string | null {
    const term = within(group).queryByText(label, { selector: "dt" });
    return term ? (term.nextElementSibling?.textContent ?? "") : null;
  }

  it("sums the period above the grid and counts each layer that is on", async () => {
    mockApi({ startDay: 26 });
    render(<CalendarPage />);
    await setMonth("2026-09");

    const group = await screen.findByRole("group", { name: /in figures$/ });
    // 26 August is inside this account's September, so its salary counts; the net is
    // worked in cents, never as a float.
    await waitFor(() => expect(figure(group, "In")).toBe("$1,200.00"));
    expect(figure(group, "Out")).toBe("$40.00");
    expect(figure(group, "Net")).toBe("$1,160.00");
    expect(figure(group, "Stock")).toBe("1");
    expect(figure(group, "Habits")).toBe("1");
    expect(figure(group, "Meals")).toBe("2");
    expect(figure(group, "Due")).toBe("1");
    // A layer with nothing in the period takes no room, and money is the figures above.
    expect(figure(group, "Gym")).toBeNull();
    expect(figure(group, "Money")).toBeNull();
  });

  it("the summary follows the layers menu", async () => {
    mockApi({ startDay: 26 });
    render(<CalendarPage />);
    await setMonth("2026-09");
    const group = await screen.findByRole("group", { name: /in figures$/ });
    await waitFor(() => expect(figure(group, "Meals")).toBe("2"));

    await userEvent.click(screen.getByRole("button", { name: "Layers (8/8)" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Money" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Meals" }));
    expect(figure(group, "In")).toBeNull();
    expect(figure(group, "Net")).toBeNull();
    expect(figure(group, "Meals")).toBeNull();
    expect(figure(group, "Stock")).toBe("1");
  });

  it("counts only the period's own days, not the ragged edges", async () => {
    mockApi({ startDay: 1 });
    render(<CalendarPage />);
    // For a plain calendar month, the salary on 26 August belongs to August.
    await setMonth("2026-09");
    const group = await screen.findByRole("group", { name: /in figures$/ });
    await waitFor(() => expect(figure(group, "Out")).toBe("$40.00"));
    expect(figure(group, "In")).toBe("$0.00");
    expect(figure(group, "Net")).toBe("-$40.00");
  });

  describe("the week (Epic 40.4)", () => {
    const heading = () => screen.getByRole("heading", { level: 1 });
    const cells = () => screen.getAllByRole("gridcell").map((cell) => cell.dataset.iso);

    it("switches to the week and remembers it on this device", async () => {
      mockApi({ startDay: 1 });
      const first = render(<CalendarPage />);
      await screen.findByRole("gridcell", { name: /^2026-08-10/ });

      await userEvent.click(screen.getByRole("button", { name: "Week" }));

      // "Now" is Monday 10 August: the week that holds it, Monday first.
      await waitFor(() => expect(cells()).toHaveLength(7));
      expect(cells()[0]).toBe("2026-08-10");
      expect(cells()[6]).toBe("2026-08-16");
      expect(heading()).toHaveTextContent("10 Aug – 16 Aug 2026");
      expect(screen.getByRole("button", { name: "Week" })).toHaveAttribute("aria-pressed", "true");
      expect(window.localStorage.getItem("everything-everywhere.calendarView")).toBe("week");

      first.unmount();
      render(<CalendarPage />);
      await waitFor(() => expect(cells()).toHaveLength(7));
      expect(screen.getByRole("button", { name: "Month" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });

    it("draws every item of a day in full, with its amount, and keeps the chosen day", async () => {
      mockApi({ startDay: 26 });
      render(<CalendarPage />);
      await setMonth("2026-09");
      const monthCell = await screen.findByRole("gridcell", { name: /^2026-09-02/ });
      // Five lines: the month shows three and a count.
      await waitFor(() => expect(within(monthCell).getByText("+2 more")).toBeInTheDocument());
      await userEvent.click(monthCell);

      await userEvent.click(screen.getByRole("button", { name: "Week" }));

      await waitFor(() => expect(cells()).toHaveLength(7));
      expect(heading()).toHaveTextContent("31 Aug – 6 Sep 2026");
      const cell = screen.getByRole("gridcell", { name: /^2026-09-02/ });
      for (const text of ["Fuel", "Milk", "Run", "Rice and eggs", "Rice"]) {
        expect(within(cell).getByText(text)).toBeInTheDocument();
      }
      expect(within(cell).queryByText(/more$/)).toBeNull();
      // Exact rather than rounded: the net, and the entry's own line.
      expect(within(cell).getAllByText("-$40.00")).toHaveLength(2);
      expect(screen.getByRole("region", { name: "Wed 2 September" })).toBeInTheDocument();
    });

    it("asks for both months when a week crosses the account's boundary", async () => {
      const { seen } = mockApi({ startDay: 26 });
      render(<CalendarPage />);
      await setMonth("2026-09");
      await userEvent.click(await screen.findByRole("gridcell", { name: /^2026-09-21/ }));

      await userEvent.click(screen.getByRole("button", { name: "Week" }));

      // 21 to 25 September close this account's September; 26 and 27 open its October.
      await waitFor(() => expect(heading()).toHaveTextContent("21 Sep – 27 Sep 2026"));
      await waitFor(() => {
        expect(seen.some((url) => url.includes("/api/entries?month=2026-10"))).toBe(true);
      });
      for (const path of [
        "/api/savings/contributions?month=2026-10",
        "/api/inventory/changes?month=2026-10",
        "/api/habits/checkins?month=2026-10",
        "/api/recurring/expected?month=2026-10",
        "/api/meals?month=2026-10",
      ]) {
        expect(seen.some((url) => url.includes(path))).toBe(true);
      }
    });

    it("turns by seven days, sums only its own, and an arrow past Sunday opens the next", async () => {
      mockApi({ startDay: 26, windowed: true });
      render(<CalendarPage />);
      await setMonth("2026-09");
      await screen.findByRole("gridcell", { name: /^2026-09-02/ });

      // Nothing chosen and today elsewhere: the week holding the period's first day.
      await userEvent.click(screen.getByRole("button", { name: "Week" }));
      await waitFor(() => expect(heading()).toHaveTextContent("24 Aug – 30 Aug 2026"));
      const group = await screen.findByRole("group", { name: /in figures$/ });
      await waitFor(() => expect(figure(group, "In")).toBe("$1,200.00"));
      expect(figure(group, "Out")).toBe("$0.00");

      await userEvent.click(screen.getByRole("button", { name: "Next week" }));
      await waitFor(() => expect(heading()).toHaveTextContent("31 Aug – 6 Sep 2026"));

      (await screen.findByRole("gridcell", { name: /^2026-09-06/ })).focus();
      await userEvent.keyboard("{ArrowRight}");
      await waitFor(() => expect(heading()).toHaveTextContent("7 Sep – 13 Sep 2026"));
      await waitFor(() => {
        expect((document.activeElement as HTMLElement).dataset.iso).toBe("2026-09-07");
      });
    });

    it("back to the month keeps the chosen day, in the month it belongs to", async () => {
      // 26 September opens this account's October; the week began in its September.
      window.localStorage.setItem("everything-everywhere.calendarView", "week");
      mockApi({ startDay: 26 });
      render(<CalendarPage />);
      // A picked month opens the week that holds its first day.
      await setMonth("2026-10");
      await waitFor(() => expect(heading()).toHaveTextContent("21 Sep – 27 Sep 2026"));
      await userEvent.click(screen.getByRole("gridcell", { name: /^2026-09-26/ }));

      await userEvent.click(screen.getByRole("button", { name: "Month" }));

      await waitFor(() => expect(screen.getByLabelText("Month")).toHaveValue("2026-10"));
      expect(screen.getByRole("region", { name: "Sat 26 September" })).toBeInTheDocument();
      expect(window.localStorage.getItem("everything-everywhere.calendarView")).toBe("month");
    });
  });

  describe("on a phone", () => {
    beforeEach(() => {
      vi.stubGlobal("matchMedia", (query: string) => ({
        matches: query.includes("max-width: 720px"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }));
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("opens a day over the grid and Escape puts it away, back on the day", async () => {
      mockApi({ startDay: 26 });
      render(<CalendarPage />);
      await setMonth("2026-09");

      // Nothing covers the month on arrival.
      expect(screen.queryByRole("region")).toBeNull();

      const day = await screen.findByRole("gridcell", { name: /^2026-09-02/ });
      await userEvent.click(day);
      const panel = await screen.findByRole("region", { name: "Wed 2 September" });
      expect(within(panel).getByText("Fuel")).toBeInTheDocument();

      // From inside the panel: focus must land back on the day, not be lost with it.
      within(panel).getByRole("button", { name: "Close the day" }).focus();
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("region")).toBeNull());
      expect(document.activeElement).toBe(day);
    });

    it("closes from its button, from a tap outside, and from a second tap", async () => {
      mockApi({ startDay: 26 });
      render(<CalendarPage />);
      await setMonth("2026-09");
      const day = await screen.findByRole("gridcell", { name: /^2026-09-02/ });

      await userEvent.click(day);
      await userEvent.click(await screen.findByRole("button", { name: "Close the day" }));
      await waitFor(() => expect(screen.queryByRole("region")).toBeNull());

      await userEvent.click(day);
      await screen.findByRole("region", { name: "Wed 2 September" });
      await userEvent.click(screen.getByText("26 Aug – 25 Sep"));
      await waitFor(() => expect(screen.queryByRole("region")).toBeNull());

      await userEvent.click(day);
      await screen.findByRole("region", { name: "Wed 2 September" });
      await userEvent.click(day);
      await waitFor(() => expect(screen.queryByRole("region")).toBeNull());
    });

    it("keeps the panel's header on one line: Add is a sign named by its label", async () => {
      mockApi({ startDay: 26 });
      render(<CalendarPage />);
      await setMonth("2026-09");

      await userEvent.click(await screen.findByRole("gridcell", { name: /^2026-09-02/ }));
      const panel = await screen.findByRole("region", { name: "Wed 2 September" });
      const add = within(panel).getByRole("button", { name: "Add on this day" });
      expect(add).toHaveTextContent("+");
    });

    it("a tap on another day swaps the panel rather than closing it", async () => {
      mockApi({ startDay: 26 });
      render(<CalendarPage />);
      await setMonth("2026-09");

      await userEvent.click(await screen.findByRole("gridcell", { name: /^2026-09-02/ }));
      await screen.findByRole("region", { name: "Wed 2 September" });
      await userEvent.click(screen.getByRole("gridcell", { name: /^2026-09-03/ }));
      expect(await screen.findByRole("region", { name: "Thu 3 September" })).toBeInTheDocument();
    });

    /** One finger, from one point to another, over the grid. */
    function swipe(from: [number, number], to: [number, number]) {
      const grid = screen.getByRole("grid");
      fireEvent.touchStart(grid, { touches: [{ clientX: from[0], clientY: from[1] }] });
      fireEvent.touchEnd(grid, { touches: [], changedTouches: [{ clientX: to[0], clientY: to[1] }] });
    }

    it("a sideways swipe turns the month; a drifting scroll does not", async () => {
      mockApi({ startDay: 26 });
      render(<CalendarPage />);
      await setMonth("2026-09");
      const input = screen.getByLabelText("Month") as HTMLInputElement;
      await screen.findByRole("gridcell", { name: /^2026-09-02/ });

      swipe([250, 300], [100, 310]);
      await waitFor(() => expect(input.value).toBe("2026-10"));

      swipe([100, 300], [250, 290]);
      await waitFor(() => expect(input.value).toBe("2026-09"));

      // Mostly down: a scroll that drifted sideways, not a swipe.
      swipe([250, 100], [180, 300]);
      // Too short to be meant.
      swipe([250, 300], [220, 300]);
      // Two fingers is a pinch.
      const grid = screen.getByRole("grid");
      fireEvent.touchStart(grid, {
        touches: [
          { clientX: 250, clientY: 300 },
          { clientX: 200, clientY: 300 },
        ],
      });
      fireEvent.touchEnd(grid, { touches: [], changedTouches: [{ clientX: 50, clientY: 300 }] });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(input.value).toBe("2026-09");
    });

    it("in the week, a swipe turns the week and the hint says so", async () => {
      window.localStorage.setItem("everything-everywhere.calendarView", "week");
      mockApi({ startDay: 26 });
      render(<CalendarPage />);
      await setMonth("2026-09");
      const heading = screen.getByRole("heading", { level: 1 });
      await waitFor(() => expect(heading).toHaveTextContent("24 Aug – 30 Aug 2026"));
      expect(screen.getByText(/change week\.$/)).toBeInTheDocument();

      swipe([250, 300], [100, 310]);
      await waitFor(() => expect(heading).toHaveTextContent("31 Aug – 6 Sep 2026"));
      swipe([100, 300], [250, 290]);
      await waitFor(() => expect(heading).toHaveTextContent("24 Aug – 30 Aug 2026"));
    });
  });
});
