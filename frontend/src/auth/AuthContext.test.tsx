import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readRefreshToken, readToken, storeTokens } from "../api/client";
import type { User } from "../api/types";
import { useSignOut } from "../gym/useSignOut";
import { LanguageProvider } from "../i18n";
import { startSession } from "../gym/session";
import { readActive, writeActive } from "../gym/store";
import { AuthProvider, useAuth } from "./AuthContext";

/**
 * Epic 42, AD-58: the installed app must open at the gym with no signal. Only the server
 * saying "this session is over" (a 401) signs the person out; no network leaves them in,
 * on the last profile the server sent.
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

const SNAPSHOT_KEY = "everything-everywhere.user.snapshot";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function Probe() {
  const { user, loading, offline } = useAuth();
  const signOut = useSignOut();
  if (loading) return <p>loading</p>;
  return (
    <div>
      <p>{user ? `in:${user.email}` : "signed out"}</p>
      <p>{offline ? "offline" : "online"}</p>
      <button type="button" onClick={signOut}>
        out
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

/** Network down: every fetch rejects the way the browser's does. */
const offlineFetch = () => vi.fn(async () => Promise.reject(new TypeError("Failed to fetch")));

beforeEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("opening the app with no network", () => {
  it("keeps the person in on the last profile and says it is offline", async () => {
    storeTokens({ access_token: "a", refresh_token: "r", token_type: "bearer", expires_in: 3600 });
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(USER));
    vi.stubGlobal("fetch", offlineFetch());
    mount();
    expect(await screen.findByText("in:alex@example.com")).toBeInTheDocument();
    expect(screen.getByText("offline")).toBeInTheDocument();
    // the tokens are still there: nothing was signed out
    expect(readToken()).toBe("a");
    expect(readRefreshToken()).toBe("r");
  });

  it("also stays in through a refresh that cannot reach the server", async () => {
    // an expired access token: /me answers 401, and the refresh then fails for want of a network
    storeTokens({ access_token: "old", refresh_token: "r", token_type: "bearer", expires_in: 3600 });
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(USER));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/api/auth/refresh")) throw new TypeError("Failed to fetch");
        return json({ detail: "expired" }, 401);
      }),
    );
    mount();
    expect(await screen.findByText("in:alex@example.com")).toBeInTheDocument();
    expect(readRefreshToken()).toBe("r");
  });

  it("also stays in through a 503 from the refresh", async () => {
    storeTokens({ access_token: "old", refresh_token: "r", token_type: "bearer", expires_in: 3600 });
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(USER));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/api/auth/refresh") ? json({ detail: "restarting" }, 503) : json({ detail: "expired" }, 401),
      ),
    );
    mount();
    expect(await screen.findByText("in:alex@example.com")).toBeInTheDocument();
    expect(readRefreshToken()).toBe("r");
  });

  it("behaves as before with no snapshot: signed out, tokens gone", async () => {
    storeTokens({ access_token: "a", refresh_token: "r", token_type: "bearer", expires_in: 3600 });
    vi.stubGlobal("fetch", offlineFetch());
    mount();
    expect(await screen.findByText("signed out")).toBeInTheDocument();
    expect(readToken()).toBeNull();
  });

  it("signs out when the server says the session is over (401 from the refresh)", async () => {
    storeTokens({ access_token: "old", refresh_token: "r", token_type: "bearer", expires_in: 3600 });
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(USER));
    vi.stubGlobal("fetch", vi.fn(async () => json({ detail: "please sign in" }, 401)));
    mount();
    expect(await screen.findByText("signed out")).toBeInTheDocument();
    expect(readToken()).toBeNull();
    expect(readRefreshToken()).toBeNull();
    expect(window.localStorage.getItem(SNAPSHOT_KEY)).toBeNull();
  });

  it("keeps an unsent gym session through an expired session, so signing back in sends it", async () => {
    storeTokens({ access_token: "old", refresh_token: "r", token_type: "bearer", expires_in: 3600 });
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(USER));
    writeActive("u1", startSession(null, new Date(), () => crypto.randomUUID()));
    vi.stubGlobal("fetch", vi.fn(async () => json({ detail: "please sign in" }, 401)));
    mount();
    expect(await screen.findByText("signed out")).toBeInTheDocument();
    expect(readActive("u1")).not.toBeNull();
  });

  it("goes back online without a reload once the server answers", async () => {
    storeTokens({ access_token: "a", refresh_token: "r", token_type: "bearer", expires_in: 3600 });
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(USER));
    vi.stubGlobal("fetch", offlineFetch());
    mount();
    await screen.findByText("offline");
    vi.stubGlobal("fetch", vi.fn(async () => json({ ...USER, email: "new@example.com" })));
    window.dispatchEvent(new Event("online"));
    expect(await screen.findByText("in:new@example.com")).toBeInTheDocument();
    expect(screen.getByText("online")).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(SNAPSHOT_KEY) as string).email).toBe("new@example.com");
  });
});

describe("the snapshot", () => {
  it("is written when the server answers", async () => {
    storeTokens({ access_token: "a", refresh_token: "r", token_type: "bearer", expires_in: 3600 });
    vi.stubGlobal("fetch", vi.fn(async () => json(USER)));
    mount();
    await screen.findByText("in:alex@example.com");
    expect(JSON.parse(window.localStorage.getItem(SNAPSHOT_KEY) as string).id).toBe("u1");
  });
});

describe("explicit sign-out", () => {
  async function signedIn() {
    storeTokens({ access_token: "a", refresh_token: "r", token_type: "bearer", expires_in: 3600 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (url.includes("/api/auth/logout") ? json({}, 204) : json(USER))),
    );
    mount();
    await screen.findByText("in:alex@example.com");
  }

  it("removes the snapshot, the tokens and the gym store", async () => {
    await signedIn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    writeActive("u1", startSession(null, new Date(), () => crypto.randomUUID()));
    await userEvent.click(screen.getByRole("button", { name: "out" }));
    await screen.findByText("signed out");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(readActive("u1")).toBeNull();
    expect(window.localStorage.getItem(SNAPSHOT_KEY)).toBeNull();
    expect(readToken()).toBeNull();
  });

  it("asks first when gym data would be lost, and stays signed in on no", async () => {
    await signedIn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    writeActive("u1", startSession(null, new Date(), () => crypto.randomUUID()));
    await userEvent.click(screen.getByRole("button", { name: "out" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Signing out deletes it"));
    expect(screen.getByText("in:alex@example.com")).toBeInTheDocument();
    expect(readActive("u1")).not.toBeNull();
    expect(readToken()).toBe("a");
  });

  it("does not ask when there is nothing to lose", async () => {
    await signedIn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await userEvent.click(screen.getByRole("button", { name: "out" }));
    await waitFor(() => expect(screen.getByText("signed out")).toBeInTheDocument());
    expect(confirm).not.toHaveBeenCalled();
  });
});
