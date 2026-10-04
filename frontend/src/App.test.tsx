import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { NavItemId, Preferences } from "./api/types";
import { App } from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { ToastProvider } from "./components/Toast";
import { DEFAULT_PREFERENCES, NAV_ITEMS } from "./layout/preferences";
import { onAPhone } from "./test/phone";
import { ThemeProvider } from "./theme";
import { PRELOAD_TIMEOUT, preloadPages } from "./test/preloadPages";

/**
 * The navigation answer (Epics 22, 23 and 52).
 *
 * The bottom bar holds five slots at 375px and that is the measured maximum: since Epic 52
 * (AD-65) it is four pinned places and More, and everything else is in the drawer. A test
 * rather than a comment, because "we will remember not to add a sixth" is not a constraint
 * anybody can enforce in review.
 */

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function renderAt(path: string, preferences?: Preferences) {
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
          ...(preferences ? { preferences } : {}),
        });
      }
      if (url.includes("/api/books/quotes/draw")) return json(null);
      return json({ items: [] });
    }),
  );
  return render(
    <AuthProvider>
      <ToastProvider>
        <ThemeProvider>
          <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
          </ThemeProvider>
      </ToastProvider>
    </AuthProvider>,
  );
}

const bottomBar = () => screen.getByRole("navigation", { name: "Sections" });
const barLabels = () =>
  within(bottomBar())
    .getAllByRole("link")
    .map((link) => link.textContent?.replace(/^\W+/, "").trim());
const moreTab = () => within(bottomBar()).getByRole("button", { name: "More" });

/** A phone layout whose bar holds exactly these places, in this order. */
function phonePinning(...pinned: NavItemId[]) {
  const { phone } = DEFAULT_PREFERENCES;
  return {
    ...DEFAULT_PREFERENCES,
    phone: {
      ...phone,
      items: [
        ...pinned.map((id) => ({ id, pinned: true })),
        ...NAV_ITEMS.filter((id) => !pinned.includes(id)).map((id) => ({ id, pinned: false })),
      ],
    },
  };
}

describe("navigation", () => {
  beforeAll(preloadPages, PRELOAD_TIMEOUT);

  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  describe("on a phone (Epic 52, AD-65)", () => {
    onAPhone();

    it("shows the four pinned places, then More: five slots, never six", async () => {
      renderAt("/");
      await waitFor(() => expect(bottomBar()).toBeInTheDocument());

      // The leading glyph is decorative and aria-hidden, so it is stripped here rather than
      // baked into the expectation. The bar holds five at 375px and that is the measured
      // maximum: four pinned places and More.
      expect(barLabels()).toEqual(["Dashboard", "Entries", "Habits", "Plan"]);
      expect(within(bottomBar()).getAllByRole("button")).toHaveLength(1);
      expect(moreTab()).toHaveAttribute("aria-haspopup", "dialog");
      expect(moreTab()).toHaveAttribute("aria-expanded", "false");
    });

    it("has no second row of links in the top bar any more", async () => {
      renderAt("/");
      await waitFor(() => expect(bottomBar()).toBeInTheDocument());

      // Plan, Grow and Recipes used to sit up there; they are places like any other now.
      expect(screen.queryByRole("navigation", { name: "More" })).not.toBeInTheDocument();
      const top = document.querySelector("header.topbar") as HTMLElement;
      expect(within(top).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
        "/settings",
      ]);
    });

    it("follows the account's own bar, in the account's order", async () => {
      renderAt("/", phonePinning("gym", "notes", "dashboard"));
      await waitFor(() => expect(bottomBar()).toBeInTheDocument());
      expect(barLabels()).toEqual(["Gym", "Notes", "Dashboard"]);
    });

    it("lights the pinned place you are in, and not More", async () => {
      renderAt("/plan");
      await waitFor(() => expect(bottomBar()).toBeInTheDocument());
      expect(within(bottomBar()).getByRole("link", { name: /Plan/ }).className).toContain("on");
      expect(within(bottomBar()).getByRole("link", { name: /Dashboard/ }).className).not.toContain("on");
      expect(moreTab().className).not.toContain("on");
    });

    it("lights More, not the Dashboard, while the calendar is open", async () => {
      renderAt("/calendar");
      await waitFor(() => expect(bottomBar()).toBeInTheDocument());

      // The calendar is the Dashboard section's second view, but it is its own place now and
      // lives in the drawer, so the bar says "somewhere under More".
      expect(moreTab().className).toContain("on");
      expect(within(bottomBar()).getByRole("link", { name: /Dashboard/ }).className).not.toContain("on");
    });

    it("lights More, not Habits, while the books are open (Epic 28)", async () => {
      renderAt("/books");
      await waitFor(() => expect(bottomBar()).toBeInTheDocument());

      expect(moreTab().className).toContain("on");
      expect(within(bottomBar()).getByRole("link", { name: /Habits/ }).className).not.toContain("on");
      // And the shelf is reached by its own route, with the switch back to habits beside it.
      const views = await screen.findByRole("group", { name: "Habits view" });
      expect(within(views).getByRole("link", { name: "Books" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      expect(within(views).getByRole("link", { name: "Habits" })).toHaveAttribute("href", "/habits");
    });

    it("lights Habits when Books is pinned beside it and the habits page is open", async () => {
      renderAt("/habits", phonePinning("habits", "books"));
      await waitFor(() => expect(bottomBar()).toBeInTheDocument());
      expect(within(bottomBar()).getByRole("link", { name: /Habits/ }).className).toContain("on");
      expect(within(bottomBar()).getByRole("link", { name: /Books/ }).className).not.toContain("on");
      expect(moreTab().className).not.toContain("on");
    });

    it("lights a place under a pinned one: a category is Entries", async () => {
      renderAt("/categories/abc");
      await waitFor(() => expect(bottomBar()).toBeInTheDocument());
      expect(within(bottomBar()).getByRole("link", { name: /Entries/ }).className).toContain("on");
    });

    it("hides a pinned place whose module is off, from the bar", async () => {
      renderAt("/", {
        ...phonePinning("dashboard", "gym", "entries"),
        modules: { ...DEFAULT_PREFERENCES.modules, gym: false },
      });
      await waitFor(() => expect(bottomBar()).toBeInTheDocument());
      expect(barLabels()).toEqual(["Dashboard", "Entries"]);
    });

    it("opens the More drawer from the bar", async () => {
      renderAt("/calendar");
      await waitFor(() => expect(bottomBar()).toBeInTheDocument());
      fireEvent.click(moreTab());
      await waitFor(() => expect(moreTab()).toHaveAttribute("aria-expanded", "true"));
    });
  });

  it("reaches the calendar and the habits page by their own routes", async () => {
    renderAt("/calendar");
    expect(await screen.findByRole("button", { name: /^Layers \(/ })).toBeInTheDocument();
  });
});
