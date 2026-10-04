import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { ToastProvider } from "./components/Toast";
import { PHONE_QUERY } from "./layout/useLayout";
import { PRELOAD_TIMEOUT, preloadPages } from "./test/preloadPages";
import { LanguageProvider } from "./i18n";
import { ThemeProvider } from "./theme";

/**
 * Small shell rules found by use: one h1 per page (the top bar's name is not a heading), and
 * one add-entry control on a phone (the floating +, not a second button on the page).
 */

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function layout(kind: "phone" | "desktop") {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === PHONE_QUERY && kind === "phone",
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

function renderApp(path: string) {
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
          tutorial_completed: true,
          tutorial_skipped_at: null,
        });
      }
      if (url.includes("/api/books/quotes/draw")) return json(null);
      if (url.includes("/api/savings/overview")) return json({ pots: [] });
      if (url.includes("/api/dashboard/summary")) return json({ budgets: [] });
      return json({ items: [] });
    }),
  );
  return render(
    <AuthProvider>
      <LanguageProvider>
      <ToastProvider>
        <ThemeProvider>
          <MemoryRouter initialEntries={[path]}>
            <App />
          </MemoryRouter>
        </ThemeProvider>
      </ToastProvider>
      </LanguageProvider>
    </AuthProvider>,
  );
}

beforeAll(preloadPages, PRELOAD_TIMEOUT);

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("one h1 per page", () => {
  for (const kind of ["phone", "desktop"] as const) {
    for (const path of ["/entries", "/plan", "/projections", "/settings"]) {
      it(`${path} on a ${kind} has exactly one, and it is the page's`, async () => {
        layout(kind);
        renderApp(path);
        await waitFor(() => expect(document.querySelector("main h1")).not.toBeNull());
        // Counted after the page's own heading is there: the shell's would already be.
        const all = [...document.querySelectorAll("h1")];
        expect(all).toHaveLength(1);
        expect(all[0]?.closest("main")).not.toBeNull();
        expect(document.querySelector(".topbar .brand, .topbar h1")?.tagName).not.toBe("H1");
      });
    }
  }
});

describe("adding an entry from the Entries page", () => {
  it("is the floating + alone on a phone, with no second button on the page", async () => {
    layout("phone");
    renderApp("/entries");
    await waitFor(() => expect(document.querySelector("main h1")).not.toBeNull());
    expect(document.querySelector("button.fab")).not.toBeNull();
    expect(document.querySelector(".add-entry-button")).toBeNull();
    expect(document.querySelector("main form[aria-label]")).toBeNull();
  });

  it("is the page's own form on a desktop, and no + at all", async () => {
    layout("desktop");
    renderApp("/entries");
    await waitFor(() => expect(document.querySelector("main h1")).not.toBeNull());
    expect(document.querySelector("main form[aria-label='Record an entry']")).not.toBeNull();
    expect(document.querySelector(".add-entry-button")).toBeNull();
    expect(document.querySelector("button.fab")).toBeNull();
  });
});
