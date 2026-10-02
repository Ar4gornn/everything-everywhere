import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { ToastProvider } from "./components/Toast";
import { ThemeProvider } from "./theme";
import { PRELOAD_TIMEOUT, preloadPages } from "./test/preloadPages";
import { onAPhone } from "./test/phone";

// Builder B's sheet is not under test here: only that App mounts it and opens it.
vi.mock("./components/QuickAdd/QuickAddSheet", async () => {
  const { useQuickAdd } = await import("./components/QuickAdd/QuickAddContext");
  return {
    QuickAddSheet() {
      const { isOpen, options, close } = useQuickAdd();
      return isOpen ? (
        <div data-testid="quick-add-open" data-date={options.date ?? ""}>
          <button type="button" onClick={close}>
            close-sheet
          </button>
        </div>
      ) : null;
    },
  };
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function Where() {
  const { pathname, search } = useLocation();
  return <div data-testid="where">{pathname + search}</div>;
}

function renderAt(path: string) {
  window.localStorage.setItem("everything-everywhere.token", "test-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
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
      if (url.includes("/api/books/quotes/draw")) return json(null);
      if (url.includes("/api/mood/history")) return json({ days: [], counts: [] });
      if (url.includes("/api/savings/overview")) return json({ pots: [] });
      return json({ items: [] });
    }),
  );
  return render(
    <AuthProvider>
      <ToastProvider>
        <ThemeProvider>
          <MemoryRouter initialEntries={[path]}>
            <App />
            <Where />
          </MemoryRouter>
        </ThemeProvider>
      </ToastProvider>
    </AuthProvider>,
  );
}

const plus = () => screen.queryByRole("button", { name: "Add an entry" });
const ready = () => screen.findByRole("navigation", { name: "Sections" });

describe("quick add on a phone (Epic 44)", () => {
  onAPhone();
  beforeAll(preloadPages, PRELOAD_TIMEOUT);
  afterEach(() => vi.unstubAllGlobals());

  it.each(["/", "/calendar", "/inventory", "/habits", "/plan", "/projections", "/notes", "/settings"])(
    "draws the + on %s",
    async (path) => {
      renderAt(path);
      await ready();
      expect(plus()).toBeInTheDocument();
    },
  );

  it.each(["/gym", "/gym/history", "/notes/new", "/notes/abc"])(
    "does not draw the + on %s",
    async (path) => {
      renderAt(path);
      await ready();
      expect(plus()).toBeNull();
    },
  );

  it("opens the sheet on a tap, in place, and hides the + while it is open", async () => {
    const user = userEvent.setup();
    renderAt("/habits");
    await ready();
    await user.click(plus() as HTMLElement);

    expect(await screen.findByTestId("quick-add-open")).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/habits$/);
    expect(plus()).toBeNull();
  });

  it("keeps the + in the document while the sheet is open and hands focus back on close", async () => {
    const user = userEvent.setup();
    renderAt("/habits");
    await ready();
    await user.click(plus() as HTMLElement);
    await screen.findByTestId("quick-add-open");
    const fab = document.querySelector(".fab") as HTMLElement;
    // Out of sight and out of the way, but still the element focus can return to.
    expect(fab).not.toBeNull();
    expect(fab).toHaveAttribute("aria-hidden", "true");
    expect(fab.hasAttribute("inert")).toBe(true);

    await user.click(screen.getByRole("button", { name: "close-sheet" }));
    await waitFor(() => expect(screen.queryByTestId("quick-add-open")).toBeNull());
    await waitFor(() => expect(plus()).toHaveFocus());
    expect(document.querySelector(".fab")).toBe(fab);
    expect(fab.hasAttribute("inert")).toBe(false);
  });

  it("opens with the date of ?add=1&date=… on any route, and strips both params", async () => {
    renderAt("/calendar?add=1&date=2026-10-05");
    const sheet = await screen.findByTestId("quick-add-open");
    expect(sheet).toHaveAttribute("data-date", "2026-10-05");
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/calendar$/));
  });

  it("opens with today (no date) for ?add=1 alone, and ignores a malformed date", async () => {
    renderAt("/entries?add=1&date=yesterday");
    const sheet = await screen.findByTestId("quick-add-open");
    expect(sheet).toHaveAttribute("data-date", "");
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/entries$/));
  });

  it("shows no inline form on /entries: the button stands in for it", async () => {
    renderAt("/entries");
    await ready();
    expect(screen.queryByRole("form", { name: "Record an entry" })).toBeNull();
  });
});

describe("quick add on desktop (Epic 44)", () => {
  beforeAll(preloadPages, PRELOAD_TIMEOUT);
  afterEach(() => vi.unstubAllGlobals());

  it("draws no + and no sheet", async () => {
    renderAt("/habits");
    await ready();
    expect(plus()).toBeNull();
  });

  it("does not touch ?add=1 on other routes", async () => {
    renderAt("/calendar?add=1&date=2026-10-05");
    await ready();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByTestId("where")).toHaveTextContent("/calendar?add=1&date=2026-10-05");
  });

  it("leaves ?add=1 to the Entries page, which focuses its amount field", async () => {
    renderAt("/entries?add=1");
    const form = await screen.findByRole("form", { name: "Record an entry" });
    await waitFor(() => expect(within(form).getByLabelText("Amount")).toHaveFocus());
    expect(screen.queryByTestId("quick-add-open")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/entries$/));
  });
});
