import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { storeTokens } from "../api/client";
import { AuthProvider, useAuth } from "../auth/AuthContext";
import { LanguageProvider } from "../i18n";
import { MARKER_COOKIE, clearMarker, setMarker } from "./marker";

/** AD-66: the routing cookie that keeps a signed-in browser off the landing page. */

const hasMarker = () => document.cookie.split("; ").includes(`${MARKER_COOKIE}=1`);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const TOKEN = { access_token: "a", refresh_token: "r", token_type: "bearer", expires_in: 3600 };
const ME = { id: "u1", email: "sam@example.com", currency: "USD", weight_unit: "kg", budget_start_day: 1, created_at: "" };

beforeEach(() => {
  clearMarker();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.restoreAllMocks();
  clearMarker();
});

describe("marker cookie", () => {
  it("sets and clears ee_app=1", () => {
    expect(hasMarker()).toBe(false);
    setMarker();
    expect(hasMarker()).toBe(true);
    clearMarker();
    expect(hasMarker()).toBe(false);
  });

  function spyOnCookie(protocol: string): string[] {
    const writes: string[] = [];
    vi.stubGlobal("location", { ...window.location, protocol });
    vi.spyOn(document, "cookie", "set").mockImplementation((value: string) => void writes.push(value));
    return writes;
  }

  it("adds Secure only on https, and expires the cookie when cleared", () => {
    const http = spyOnCookie("http:");
    setMarker();
    expect(http[0]).toBe("ee_app=1; Path=/; Max-Age=34560000; SameSite=Lax");
    vi.restoreAllMocks();

    const https = spyOnCookie("https:");
    setMarker();
    clearMarker();
    expect(https[0]).toBe("ee_app=1; Path=/; Max-Age=34560000; SameSite=Lax; Secure");
    expect(https[1]).toBe("ee_app=; Path=/; Max-Age=0; SameSite=Lax; Secure");
  });

  it("does not throw when cookies are unavailable", () => {
    vi.spyOn(document, "cookie", "set").mockImplementation(() => {
      throw new Error("sandboxed");
    });
    expect(() => setMarker()).not.toThrow();
    expect(() => clearMarker()).not.toThrow();
  });
});

function Probe() {
  const { user, loading, signIn, register, signOut } = useAuth();
  if (loading) return <p>loading</p>;
  return (
    <div>
      <p>{user ? "in" : "out"}</p>
      <button type="button" onClick={() => void signIn("sam@example.com", "pw")}>sign-in</button>
      <button type="button" onClick={() => void register("sam@example.com", "pw", "code")}>register</button>
      <button type="button" onClick={signOut}>sign-out</button>
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

function stubApi(sessionEnded = false) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/api/auth/login")) return json(TOKEN);
      if (url.includes("/api/auth/register")) return json(ME, 201);
      if (url.includes("/api/auth/refresh")) return json({ detail: "no" }, 401);
      if (url.includes("/api/auth/me")) {
        return sessionEnded ? json({ detail: "expired" }, 401) : json(ME);
      }
      return json({ items: [] });
    }),
  );
}

describe("marker cookie and the session", () => {
  it("is not set when storage refuses the refresh token", () => {
    // Blocked storage: no token persists, so the server must keep showing the landing.
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    storeTokens(TOKEN);
    expect(hasMarker()).toBe(false);
  });

  it("is set on sign-in and cleared on sign-out", async () => {
    stubApi();
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "sign-in" }));
    await waitFor(() => expect(screen.getByText("in")).toBeInTheDocument());
    expect(hasMarker()).toBe(true);
    await user.click(screen.getByRole("button", { name: "sign-out" }));
    await waitFor(() => expect(screen.getByText("out")).toBeInTheDocument());
    expect(hasMarker()).toBe(false);
  });

  it("is set when registering", async () => {
    stubApi();
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "register" }));
    await waitFor(() => expect(screen.getByText("in")).toBeInTheDocument());
    expect(hasMarker()).toBe(true);
  });

  it("is set on boot when a refresh token is already stored", async () => {
    storeTokens(TOKEN);
    clearMarker(); // as if signed in before this change existed
    expect(hasMarker()).toBe(false);
    stubApi();
    mount();
    await waitFor(() => expect(screen.getByText("in")).toBeInTheDocument());
    expect(hasMarker()).toBe(true);
  });

  it("is cleared when the refresh fails and the session ends", async () => {
    storeTokens(TOKEN);
    stubApi(true);
    mount();
    await waitFor(() => expect(screen.getByText("out")).toBeInTheDocument());
    expect(hasMarker()).toBe(false);
  });
});
