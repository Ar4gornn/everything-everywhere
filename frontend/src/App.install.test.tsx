import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { ToastProvider } from "./components/Toast";
import { LanguageProvider, useT } from "./i18n";
import { PRELOAD_TIMEOUT, preloadPages } from "./test/preloadPages";
import { ThemeProvider } from "./theme";

/** Epic 46 (AD-62 §2.5): `/install` is public, and an ordinary route once signed in. */

vi.mock("./pages/InstallPage", () => ({
  default: function Marker() {
    const t = useT();
    return <p>install-guide-marker: {t("install.card.title")}</p>;
  },
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderAt(path: string, signedIn: boolean) {
  if (signedIn) window.localStorage.setItem("everything-everywhere.token", "test-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/api/auth/me")) {
        if (!signedIn) return json({ detail: "no", code: "unauthorized" }, 401);
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

describe("/install", () => {
  beforeAll(preloadPages, PRELOAD_TIMEOUT);
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders signed out, inside the language provider, with no sign-in form", async () => {
    renderAt("/install", false);
    expect(await screen.findByText(/install-guide-marker: Install EEwhere/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).toBeNull();
  });

  it("a trailing slash is the same public page", async () => {
    renderAt("/install/", false);
    expect(await screen.findByText(/install-guide-marker: Install EEwhere/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).toBeNull();
  });

  it("follows the stored language signed out", async () => {
    window.localStorage.setItem("everything-everywhere.language", "fr");
    renderAt("/install", false);
    expect(await screen.findByText(/install-guide-marker: Installer EEwhere/)).toBeInTheDocument();
  });

  it("other paths still ask a signed-out visitor to sign in", async () => {
    renderAt("/entries", false);
    expect((await screen.findAllByLabelText(/password/i)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/install-guide-marker/)).toBeNull();
  });

  it("is a normal route inside the shell once signed in", async () => {
    renderAt("/install", true);
    // The shell first: while /me is in flight the public page is what shows (user unknown).
    expect(await screen.findByRole("navigation", { name: "Sections" })).toBeInTheDocument();
    expect(await screen.findByText(/install-guide-marker/)).toBeInTheDocument();
  });
});
