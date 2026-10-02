import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { storeTokens } from "../api/client";
import type { RoutineDetail, User } from "../api/types";
import { AuthProvider } from "../auth/AuthContext";
import { startSession } from "../gym/session";
import { EMPTY_CACHE, readActive, writeActive, writeCache } from "../gym/store";
import { LanguageProvider } from "../i18n";
import { DEFAULT_PREFERENCES } from "../layout/preferences";
import { GymCard } from "./GymCard";

/**
 * The dashboard's Gym card (Epic 42, §8). Everything it draws comes from the device's copy
 * of the gym, so most of these run with every gym request failing as it does offline.
 */

const USER = {
  id: "u1",
  email: "alex@example.com",
  weight_unit: "kg",
  currency: "EUR",
  language: "en",
  budget_start_day: 1,
  created_at: "2031-01-01T00:00:00Z",
} as unknown as User;

function routine(id: string, name: string): RoutineDetail {
  return {
    id,
    name,
    note: null,
    lines: [
      {
        id: `l-${id}`, exercise_id: `e-${id}`, exercise_name: "Bench", kind: "reps", video_url: null,
        position: 1, target_sets: 3, target_reps: 8, target_seconds: null, target_distance_m: null,
        target_weight: "60.00", rest_seconds: null, note: null,
      },
    ],
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** /me answers; every gym request fails like a missing network. */
function stubOfflineGym(user: User = USER) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/api/auth/me")) return json(user);
      throw new TypeError("Failed to fetch");
    }),
  );
}

function mount() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <LanguageProvider>
          <Routes>
            <Route path="/" element={<GymCard collapseKey="test.gym" />} />
            <Route path="/gym/session" element={<p>the session page</p>} />
          </Routes>
        </LanguageProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
  storeTokens({ access_token: "a", refresh_token: "r", token_type: "bearer", expires_in: 3600 });
});

describe("the Gym card", () => {
  it("offers an empty session and says what to do when there are no routines", async () => {
    stubOfflineGym();
    mount();
    expect(await screen.findByRole("button", { name: "Start session" })).toBeInTheDocument();
    expect(screen.getByText(/No routines yet/)).toBeInTheDocument();
    expect(screen.queryByText(/waiting to sync/)).not.toBeInTheDocument();
  });

  it("starts an empty session on the device and opens the live page", async () => {
    stubOfflineGym();
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Start session" }));
    expect(await screen.findByText("the session page")).toBeInTheDocument();
    const active = readActive("u1");
    expect(active).toMatchObject({ routine_id: null, exercises: [], sets: [] });
    expect(active?.client_ref).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("lists up to three routines, the most recently done first, and starts the one tapped", async () => {
    stubOfflineGym();
    writeCache("u1", {
      ...EMPTY_CACHE,
      routines: [routine("r1", "Push"), routine("r2", "Pull"), routine("r3", "Legs"), routine("r4", "Core")],
      lastDone: { r3: "2031-03-04", r1: "2031-03-01", r2: "2031-03-02" },
    });
    mount();
    await screen.findByRole("button", { name: "Start Legs" });
    const buttons = screen.getAllByRole("button").filter((button) => !button.textContent?.includes("Gym"));
    expect(buttons.map((button) => button.textContent)).toEqual(["Start session", "Legs", "Pull", "Push"]);
    await userEvent.click(screen.getByRole("button", { name: "Start Pull" }));
    expect(await screen.findByText("the session page")).toBeInTheDocument();
    const active = readActive("u1");
    expect(active).toMatchObject({ routine_id: "r2", routine_name: "Pull" });
    expect(active?.exercises).toHaveLength(1);
    expect(screen.queryByText(/No routines yet/)).not.toBeInTheDocument();
  });

  it("offers Resume, with the minutes elapsed, instead of starting another session", async () => {
    stubOfflineGym();
    const began = new Date(Date.now() - 12 * 60_000 - 5_000);
    writeActive("u1", startSession(routine("r1", "Push"), began, () => crypto.randomUUID()));
    mount();
    expect(await screen.findByText("Push · Session in progress · 12 min")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start session" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(await screen.findByText("the session page")).toBeInTheDocument();
    // resuming does not replace the session
    expect(readActive("u1")?.routine_name).toBe("Push");
  });

  it("says how many sessions are waiting to sync, in the right plural", async () => {
    stubOfflineGym();
    const entry = (ref: string, refused: string | null = null) => ({
      body: { client_ref: ref, performed_on: "2031-03-04", sets: [] },
      routine_name: null,
      queuedAt: "2031-03-04T10:00:00Z",
      refused,
    });
    window.localStorage.setItem("everything-everywhere.gym.u1.outbox", JSON.stringify([entry("a")]));
    const { unmount } = mount();
    expect(await screen.findByText("1 session waiting to sync")).toBeInTheDocument();
    unmount();
    window.localStorage.setItem(
      "everything-everywhere.gym.u1.outbox",
      JSON.stringify([entry("a"), entry("b"), entry("c", "bad")]),
    );
    mount();
    expect(await screen.findByText("2 sessions waiting to sync")).toBeInTheDocument();
    expect(screen.getByText("1 session was not accepted by the server")).toBeInTheDocument();
  });

  it("draws nothing when the Gym module is off", async () => {
    stubOfflineGym({
      ...USER,
      preferences: { ...DEFAULT_PREFERENCES, modules: { ...DEFAULT_PREFERENCES.modules, gym: false } },
    });
    const { container } = mount();
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Start session" })).not.toBeInTheDocument();
    expect(container.querySelector(".card")).toBeNull();
  });

  it("is in French when the account is", async () => {
    stubOfflineGym({ ...USER, language: "fr" });
    mount();
    expect(await screen.findByRole("button", { name: "Démarrer une séance" })).toBeInTheDocument();
  });
});
