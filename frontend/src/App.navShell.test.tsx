import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { ToastProvider } from "./components/Toast";
import { PHONE_QUERY } from "./layout/useLayout";
import { loadMoonEngine } from "./moon/engine";
import { PRELOAD_TIMEOUT, preloadPages } from "./test/preloadPages";
import { ThemeProvider } from "./theme";

// A spy that still loads the real engine: the shell tests count who asks for it.
vi.mock("./moon/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./moon/engine")>();
  return { ...actual, loadMoonEngine: vi.fn(() => actual.loadMoonEngine()) };
});

/**
 * Epic 52 round 1: what the shell draws on each side of the 720px breakpoint, and what it
 * does when the window crosses it.
 */

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** A window whose width class can be flipped while the app is mounted. */
function viewport(initial: "phone" | "desktop") {
  let phone = initial === "phone";
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", (query: string) => ({
    // Only the layout's own query is flipped; the theme's (prefers dark) stays false.
    get matches() {
      return query === PHONE_QUERY && phone;
    },
    addEventListener: (_type: string, listener: () => void) => {
      if (query === PHONE_QUERY) listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  }));
  return (to: "phone" | "desktop") => {
    phone = to === "phone";
    act(() => {
      for (const listener of listeners) listener();
    });
  };
}

function renderApp(path = "/") {
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
          </MemoryRouter>
        </ThemeProvider>
      </ToastProvider>
    </AuthProvider>,
  );
}

const bottomBar = () => screen.getByRole("navigation", { name: "Sections" });
const moreTab = () => within(bottomBar()).getByRole("button", { name: "More" });
const sidebar = () => screen.getByRole("navigation", { name: "All places" });

describe("the shell on each side of the phone breakpoint", () => {
  beforeAll(preloadPages, PRELOAD_TIMEOUT);

  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(loadMoonEngine).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("draws no sidebar on a phone, and asks for the astronomy chunk only when the drawer opens", async () => {
    viewport("phone");
    renderApp("/entries");
    await waitFor(() => expect(bottomBar()).toBeInTheDocument());
    expect(screen.queryByRole("navigation", { name: "All places" })).not.toBeInTheDocument();
    expect(loadMoonEngine).not.toHaveBeenCalled();
    fireEvent.click(moreTab());
    await waitFor(() => expect(loadMoonEngine).toHaveBeenCalled());
  });

  it("keeps the phone's top bar, and gives the desktop a sidebar instead of one", async () => {
    const setViewport = viewport("phone");
    renderApp("/entries");
    await waitFor(() => expect(bottomBar()).toBeInTheDocument());
    expect(document.querySelector("header.topbar")).not.toBeNull();
    expect(within(document.querySelector("header.topbar") as HTMLElement).getByText("sam@example.com")).toBeInTheDocument();

    setViewport("desktop");
    expect(document.querySelector("header.topbar")).toBeNull();
    expect(within(sidebar()).getByText("sam@example.com")).toBeInTheDocument();
  });

  it("closes the drawer when the window is widened past the phone breakpoint", async () => {
    const setViewport = viewport("phone");
    renderApp("/entries");
    await waitFor(() => expect(bottomBar()).toBeInTheDocument());
    fireEvent.click(moreTab());
    await waitFor(() => expect(moreTab()).toHaveAttribute("aria-expanded", "true"));
    const dialog = document.querySelector("dialog.nav-drawer") as HTMLDialogElement;
    expect(dialog.open).toBe(true);

    setViewport("desktop");
    await waitFor(() => expect(moreTab()).toHaveAttribute("aria-expanded", "false"));
    expect(dialog.open).toBe(false);
  });

  it("starts with a skip link to the main region, and the sidebar's groups are not headings", async () => {
    viewport("desktop");
    renderApp("/entries");
    await waitFor(() => expect(sidebar()).toBeInTheDocument());
    const first = document.querySelector<HTMLElement>("a[href], button");
    expect(first?.textContent).toBe("Skip to content");
    const main = document.querySelector("main") as HTMLElement;
    expect(main.id).toBe("main");
    expect(main.getAttribute("tabindex")).toBe("-1");
    fireEvent.click(first as HTMLElement);
    expect(document.activeElement).toBe(main);

    expect(within(sidebar()).queryAllByRole("heading")).toHaveLength(0);
    expect(within(sidebar()).getByRole("group", { name: "Daily" })).toBeInTheDocument();
  });
});
