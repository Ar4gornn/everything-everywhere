import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api, storeTokens } from "../api/client";
import type { User } from "../api/types";
import * as outbox from "../entries/outbox";
import { startSession } from "../gym/session";
import { writeActive } from "../gym/store";
import { useSignOut } from "../gym/useSignOut";
import { LanguageProvider } from "../i18n";
import { AuthProvider, useAuth } from "./AuthContext";

/**
 * Epic 45 (AD-61) sign-out: one question when entries wait, the device cleared only on an
 * explicit sign-out, and an expired session keeping the queue. The queue is mocked.
 */

vi.mock("../entries/outbox", () => ({
  flushEntries: vi.fn(),
  useEntryOutbox: vi.fn(() => []),
  countUnsent: vi.fn(),
  discardEntry: vi.fn(),
  clearEntriesStore: vi.fn(),
}));

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
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function Probe() {
  const { user, loading } = useAuth();
  const signOut = useSignOut();
  if (loading) return <p>loading</p>;
  return (
    <div>
      <p>{user ? `in:${user.email}` : "signed out"}</p>
      <button type="button" onClick={signOut}>
        out
      </button>
      <button type="button" onClick={() => void api.listEntries({}).catch(() => undefined)}>
        poke
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

function signedIn() {
  storeTokens({ access_token: "a", refresh_token: "r", token_type: "bearer", expires_in: 3600 });
  window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(USER));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => (url.includes("/api/auth/me") ? json(USER) : json({}))),
  );
}

const ENTRIES_TEXT = "Some entries have not been sent and will be deleted from this device. Sign out anyway?";

beforeEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.mocked(outbox.countUnsent).mockReset();
  vi.mocked(outbox.clearEntriesStore).mockReset();
});

describe("signing out with entries on the device (Epic 45)", () => {
  it("asks once, and cancelling keeps the person in and the queue untouched", async () => {
    signedIn();
    vi.mocked(outbox.countUnsent).mockReturnValue(2);
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "out" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(ENTRIES_TEXT);
    expect(screen.getByText("in:alex@example.com")).toBeInTheDocument();
    expect(outbox.clearEntriesStore).not.toHaveBeenCalled();
  });

  it("confirming signs out and clears the entries store for that account", async () => {
    signedIn();
    vi.mocked(outbox.countUnsent).mockReturnValue(2);
    vi.stubGlobal("confirm", vi.fn(() => true));
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "out" }));
    expect(await screen.findByText("signed out")).toBeInTheDocument();
    expect(outbox.clearEntriesStore).toHaveBeenCalledWith("u1");
  });

  it("asks only once when the gym has unsent data too, in the entries' words", async () => {
    signedIn();
    vi.mocked(outbox.countUnsent).mockReturnValue(1);
    writeActive("u1", startSession(null, new Date(), () => crypto.randomUUID()));
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "out" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(ENTRIES_TEXT);
  });

  it("with only the gym unsent, asks the gym's question, not the entries'", async () => {
    signedIn();
    vi.mocked(outbox.countUnsent).mockReturnValue(0);
    writeActive("u1", startSession(null, new Date(), () => crypto.randomUUID()));
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "out" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalledWith(ENTRIES_TEXT);
  });

  it("asks nothing when nothing waits, and still clears the store", async () => {
    signedIn();
    vi.mocked(outbox.countUnsent).mockReturnValue(0);
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "out" }));
    expect(await screen.findByText("signed out")).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
    expect(outbox.clearEntriesStore).toHaveBeenCalledWith("u1");
  });

  it("an expired session (401) keeps the entries on the device", async () => {
    storeTokens({ access_token: "old", refresh_token: "r", token_type: "bearer", expires_in: 3600 });
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(USER));
    vi.stubGlobal("fetch", vi.fn(async () => json({ detail: "please sign in" }, 401)));
    mount();
    expect(await screen.findByText("signed out")).toBeInTheDocument();
    expect(outbox.clearEntriesStore).not.toHaveBeenCalled();
  });

  it("a session that expires mid-use keeps the entries too", async () => {
    signedIn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/api/auth/me") ? json(USER) : json({ detail: "please sign in" }, 401),
      ),
    );
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "poke" }));
    expect(await screen.findByText("signed out")).toBeInTheDocument();
    expect(outbox.clearEntriesStore).not.toHaveBeenCalled();
  });
});
