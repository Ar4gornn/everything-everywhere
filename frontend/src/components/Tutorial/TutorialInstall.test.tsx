import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { AuthProvider } from "../../auth/AuthContext";
import { LanguageProvider } from "../../i18n";
import { PRELOAD_TIMEOUT, preloadPages } from "../../test/preloadPages";
import { onAPhone } from "../../test/phone";
import { ThemeProvider } from "../../theme";
import { ToastProvider } from "../Toast";

/**
 * Epic 46 (AD-62 §4): on a phone that is not installed and has not answered, the tour's last
 * numbered step asks the install question. Driven through the real App, like Tutorial.test.
 */

const pwa = vi.hoisted(() => ({ installed: false }));
vi.mock("../../pwa", () => ({
  isInstalled: () => pwa.installed,
  registerServiceWorker: () => undefined,
}));
vi.mock("../../pages/InstallPage", () => ({ default: () => <p>install-guide-marker</p> }));

const CONSENT = "everything-everywhere.install.consent";

function json(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const profile = {
  id: "u1",
  email: "new@example.com",
  currency: "USD",
  weight_unit: "kg",
  budget_start_day: 1,
  language: "en",
  created_at: "",
  tutorial_completed: false,
  tutorial_skipped_at: null,
};

const trends = { months: [], income: [], expense: [], saved: [], expense_by_category: [] };

function renderApp() {
  window.localStorage.setItem("everything-everywhere.token", "test-token");
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/api/auth/me/tutorial")) return json(profile);
    if (url.includes("/api/auth/me")) return json(profile);
    if (url.includes("/api/dashboard/summary")) {
      return json({ month: "2026-09", income: "0.00", expense: "0.00", net: "0.00", saved: "0.00", budgets: [], savings: [] });
    }
    if (url.includes("/api/dashboard/trends")) return json(trends);
    if (url.includes("/api/savings/overview")) {
      return json({ month: "2026-09", start: "2026-09-01", end: "2026-10-01", current_month: "2026-09", pots: [] });
    }
    void init;
    return json({ items: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <AuthProvider>
      <LanguageProvider>
        <ToastProvider>
          <ThemeProvider>
            <MemoryRouter initialEntries={["/"]}>
              <App />
            </MemoryRouter>
          </ThemeProvider>
        </ToastProvider>
      </LanguageProvider>
    </AuthProvider>,
  );
  return fetchMock;
}

const dialog = () => screen.getByRole("dialog");

/** Press Next/Let's go until the install step (or the closing screen) is showing. */
async function toLastStep(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole("dialog");
  await user.click(within(dialog()).getByRole("button", { name: "Let’s go" }));
  for (let i = 0; i < 6; i++) {
    const next = within(dialog()).queryByRole("button", { name: "Next" });
    if (!next) break;
    await user.click(next);
  }
}

function outcomes(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls
    .filter(([url, init]) => String(url).includes("/api/auth/me/tutorial") && init?.method === "PATCH")
    .map(([, init]) => JSON.parse(String(init?.body)).outcome as string);
}

beforeEach(() => {
  window.localStorage.clear();
  pwa.installed = false;
  delete document.body.dataset.tourStep;
});

describe("the tour's install step on a phone", () => {
  onAPhone();
  beforeAll(preloadPages, PRELOAD_TIMEOUT);

  it("counts as a sixth numbered step", async () => {
    renderApp();
    await screen.findByRole("dialog");
    expect(within(dialog()).getByText("Step 1 of 6")).toBeInTheDocument();
  });

  it("ends the tour on the question, with Yes and No instead of Next", async () => {
    const user = userEvent.setup();
    renderApp();
    await toLastStep(user);
    expect(within(dialog()).getByText("Step 6 of 6")).toBeInTheDocument();
    expect(within(dialog()).getByText("Put it on your home screen")).toBeInTheDocument();
    expect(within(dialog()).getByRole("button", { name: "Yes, show me" })).toBeInTheDocument();
    expect(within(dialog()).getByRole("button", { name: "No thanks" })).toBeInTheDocument();
    expect(within(dialog()).queryByRole("button", { name: "Next" })).toBeNull();
  });

  it("Yes remembers it, finishes the tour and opens the guide", async () => {
    const user = userEvent.setup();
    const fetchMock = renderApp();
    await toLastStep(user);
    await user.click(within(dialog()).getByRole("button", { name: "Yes, show me" }));
    expect(window.localStorage.getItem(CONSENT)).toBe("yes");
    await waitFor(() => expect(outcomes(fetchMock)).toEqual(["completed"]));
    expect(await screen.findByText("install-guide-marker")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("No remembers it, finishes the tour and stays where it is", async () => {
    const user = userEvent.setup();
    const fetchMock = renderApp();
    await toLastStep(user);
    await user.click(within(dialog()).getByRole("button", { name: "No thanks" }));
    expect(window.localStorage.getItem(CONSENT)).toBe("no");
    await waitFor(() => expect(outcomes(fetchMock)).toEqual(["completed"]));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("install-guide-marker")).toBeNull();
  });

  it("is absent when the app is already installed", async () => {
    pwa.installed = true;
    renderApp();
    await screen.findByRole("dialog");
    expect(within(dialog()).getByText("Step 1 of 5")).toBeInTheDocument();
  });

  it("is absent once this device has answered", async () => {
    window.localStorage.setItem(CONSENT, "no");
    renderApp();
    await screen.findByRole("dialog");
    expect(within(dialog()).getByText("Step 1 of 5")).toBeInTheDocument();
  });
});

describe("the tour on a computer", () => {
  beforeAll(preloadPages, PRELOAD_TIMEOUT);

  it("has no install step", async () => {
    renderApp();
    await screen.findByRole("dialog");
    expect(within(dialog()).getByText("Step 1 of 5")).toBeInTheDocument();
  });
});
