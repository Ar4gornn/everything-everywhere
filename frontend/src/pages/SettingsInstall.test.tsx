import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "../auth/AuthContext";
import { ToastProvider } from "../components/Toast";
import { LanguageProvider } from "../i18n";
import { ThemeProvider } from "../theme";
import { SettingsPage } from "./SettingsPage";

const pwa = vi.hoisted(() => ({ installed: false }));
vi.mock("../pwa", () => ({ isInstalled: () => pwa.installed }));

const me = {
  id: "u1",
  email: "sam@example.com",
  currency: "USD",
  weight_unit: "kg",
  budget_start_day: 1,
  created_at: "",
};

function renderSettings() {
  window.localStorage.setItem("everything-everywhere.token", "test-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = String(url).includes("/api/auth/me") ? me : { items: [] };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return render(
    <ThemeProvider>
      <AuthProvider>
        <LanguageProvider>
          <ToastProvider>
            <MemoryRouter>
              <SettingsPage />
            </MemoryRouter>
          </ToastProvider>
        </LanguageProvider>
      </AuthProvider>
    </ThemeProvider>,
  );
}

const section = async () =>
  (await screen.findByRole("heading", { name: "Install the app" })).closest("section") as HTMLElement;

beforeEach(() => {
  window.localStorage.clear();
  pwa.installed = false;
});

describe("Settings → Install the app (Epic 46)", () => {
  it("links to the guide from a browser tab", async () => {
    renderSettings();
    const card = within(await section());
    expect(card.getByRole("link", { name: "Open the guide" })).toHaveAttribute("href", "/install");
    expect(card.queryByText("Installed on this device.")).toBeNull();
  });

  it("says so when the app is installed, with no link", async () => {
    pwa.installed = true;
    renderSettings();
    const card = within(await section());
    expect(card.getByText("Installed on this device.")).toBeInTheDocument();
    expect(card.queryByRole("link")).toBeNull();
  });
});
