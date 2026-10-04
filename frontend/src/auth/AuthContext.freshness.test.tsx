import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { storeTokens } from "../api/client";
import type { Preferences, PreferencesPatch, User } from "../api/types";
import { LanguageProvider } from "../i18n";
import { applyPatch, DEFAULT_PREFERENCES, preferencesOf } from "../layout/preferences";
import { AuthProvider, REREAD_MS, useAuth } from "./AuthContext";

/**
 * A tab left open for days must not write its old copy of the preferences over a change
 * made since on another device. Two guards: the tab re-reads the account when it comes back
 * into view, and every write names the version it was made against, so the server refuses
 * one made against an old copy and the tab re-bases it.
 */

const USER = {
  id: "u1",
  email: "alex@example.com",
  weight_unit: "kg",
  currency: "EUR",
  language: "en",
  timezone: "Europe/Paris",
  budget_start_day: 1,
  created_at: "2031-01-01T00:00:00Z",
} as unknown as User;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** The server as the real one behaves: whole-subtree replace, `If-Match` checked when sent. */
function fakeServer() {
  const state = { prefs: DEFAULT_PREFERENCES as Preferences, version: 1, meReads: 0, refused: 0 };
  const me = () => ({ ...USER, preferences: state.prefs, preferences_version: `v${state.version}` });
  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url.endsWith("/api/auth/me") && (init.method ?? "GET") === "GET") {
      state.meReads += 1;
      return json(me());
    }
    if (url.endsWith("/api/auth/me/preferences") && init.method === "PATCH") {
      const match = new Headers(init.headers).get("If-Match");
      if (match !== null && match.replaceAll('"', "") !== `v${state.version}`) {
        state.refused += 1;
        return json({ detail: "changed", code: "preferences_changed" }, 409);
      }
      const patch = JSON.parse(String(init.body)) as PreferencesPatch;
      state.prefs = applyPatch(state.prefs, patch);
      state.version += 1;
      return json(me());
    }
    return json({ items: [] });
  });
  /** Another device saves: the server moves on and this tab is not told. */
  const elsewhere = (patch: PreferencesPatch) => {
    state.prefs = applyPatch(state.prefs, patch);
    state.version += 1;
  };
  return { state, fetch, elsewhere };
}

function Probe() {
  const { user, updatePreferences } = useAuth();
  if (!user) return <p>loading</p>;
  const prefs = preferencesOf(user);
  const gymOff = () =>
    void updatePreferences({ modules: { ...prefs.modules, gym: false } }).then(
      () => document.body.setAttribute("data-saved", "yes"),
      () => document.body.setAttribute("data-saved", "no"),
    );
  return (
    <div>
      <p>books {prefs.modules.books ? "on" : "off"}</p>
      <p>gym {prefs.modules.gym ? "on" : "off"}</p>
      <button type="button" onClick={gymOff}>
        gym off
      </button>
    </div>
  );
}

function mount() {
  return render(
    <LanguageProvider>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </LanguageProvider>,
  );
}

const booksOff = { modules: { ...DEFAULT_PREFERENCES.modules, books: false } };

let now = 1_000_000;

beforeEach(() => {
  window.localStorage.clear();
  document.body.removeAttribute("data-saved");
  vi.unstubAllGlobals();
  now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  storeTokens({ access_token: "a", refresh_token: "r", token_type: "bearer", expires_in: 3600 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a tab coming back into view", () => {
  it("re-reads the account, so its next save carries the other device's change", async () => {
    const server = fakeServer();
    vi.stubGlobal("fetch", server.fetch);
    mount();
    await screen.findByText("books on");

    server.elsewhere(booksOff);
    now += REREAD_MS + 1;
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(await screen.findByText("books off")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "gym off" }));
    await waitFor(() => expect(document.body.getAttribute("data-saved")).toBe("yes"));
    expect(server.state.prefs.modules.books).toBe(false);
    expect(server.state.prefs.modules.gym).toBe(false);
    expect(server.state.refused).toBe(0);
  });

  it("does not re-read on every glance", async () => {
    const server = fakeServer();
    vi.stubGlobal("fetch", server.fetch);
    mount();
    await screen.findByText("books on");
    const reads = server.state.meReads;

    now += REREAD_MS - 1;
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    now += REREAD_MS + 1;
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(server.state.meReads).toBe(reads + 1));
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.state.meReads).toBe(reads + 1);
  });
});

describe("a stale tab that saves without having re-read", () => {
  it("cannot write its old copy over the other device's change", async () => {
    // Two windows side by side: neither one leaves view, so nothing prompts a re-read.
    const server = fakeServer();
    vi.stubGlobal("fetch", server.fetch);
    mount();
    await screen.findByText("books on");

    server.elsewhere(booksOff);
    await userEvent.click(screen.getByRole("button", { name: "gym off" }));

    // Both changed `modules`, so the other device's value stands and the control is told.
    await waitFor(() => expect(document.body.getAttribute("data-saved")).toBe("no"));
    expect(server.state.prefs.modules.books).toBe(false);
    expect(server.state.prefs.modules.gym).toBe(true);
    expect(server.state.refused).toBe(1);
    // And the tab now shows the account as it is.
    expect(await screen.findByText("books off")).toBeInTheDocument();
    expect(screen.getByText("gym on")).toBeInTheDocument();
  });

  it("still saves a subtree the other device did not touch", async () => {
    const server = fakeServer();
    vi.stubGlobal("fetch", server.fetch);
    mount();
    await screen.findByText("books on");

    const phone = { ...DEFAULT_PREFERENCES.phone, cards: [] };
    server.elsewhere({ phone });
    await userEvent.click(screen.getByRole("button", { name: "gym off" }));

    await waitFor(() => expect(document.body.getAttribute("data-saved")).toBe("yes"));
    expect(server.state.prefs.modules.gym).toBe(false);
    expect(server.state.prefs.phone).toEqual(phone);
    expect(server.state.refused).toBe(1);
  });
});
