import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { storeTokens } from "../api/client";
import type { RoutineDetail, User } from "../api/types";
import { AuthProvider } from "../auth/AuthContext";
import { startSession } from "../gym/session";
import { EMPTY_CACHE, readActive, readOutbox, writeActive, writeCache } from "../gym/store";
import { todayIso } from "../months";
import { LanguageProvider } from "../i18n";
import { DEFAULT_PREFERENCES } from "../layout/preferences";
import { GymCard } from "./GymCard";
import { ToastProvider } from "./Toast";

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
        target_weight: "60.00", rest_seconds: null, rest_after_seconds: null, note: null, set_targets: null, target_rpe: null, target_rir: null, tempo: null, superset_group: null,
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
            <Route path="/gym/start" element={<p>the start page</p>} />
            <Route path="/gym/import" element={<p>the import page</p>} />
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
    expect(screen.getByRole("link", { name: /Ask an AI for a workout/ })).toHaveAttribute("href", "/gym/import");
    expect(screen.queryByText(/waiting to sync/)).not.toBeInTheDocument();
  });

  it("Start opens the chooser and starts nothing itself", async () => {
    stubOfflineGym();
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Start session" }));
    expect(await screen.findByText("the start page")).toBeInTheDocument();
    expect(readActive("u1")).toBeNull();
  });

  it("with no routine, the AI link opens the import hub", async () => {
    stubOfflineGym();
    mount();
    await userEvent.click(await screen.findByRole("link", { name: /Ask an AI for a workout/ }));
    expect(await screen.findByText("the import page")).toBeInTheDocument();
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
    expect(buttons.map((button) => button.textContent)).toEqual(["Start session", "Legs", "Pull", "Push", "Rest day"]);
    await userEvent.click(screen.getByRole("button", { name: "Start Pull" }));
    expect(await screen.findByText("the session page")).toBeInTheDocument();
    const active = readActive("u1");
    expect(active).toMatchObject({ routine_id: "r2", routine_name: "Pull" });
    expect(active?.exercises).toHaveLength(1);
    expect(screen.queryByRole("link", { name: /Ask an AI/ })).not.toBeInTheDocument();
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

  it("logs a rest day in one tap, offers Undo, and the button goes away", async () => {
    stubOfflineGym();
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Rest day" }));
    expect(await screen.findByText("Rest day logged")).toBeInTheDocument();
    const queued = readOutbox("u1");
    expect(queued).toHaveLength(1);
    expect(queued[0]?.body).toMatchObject({ rest_day: true, sets: [] });
    expect(screen.queryByRole("button", { name: "Rest day" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(readOutbox("u1")).toEqual([]);
    expect(await screen.findByRole("button", { name: "Rest day" })).toBeInTheDocument();
  });

  it("says so when Undo cannot delete the rest day", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/api/auth/me")) return json(USER);
        if (url.includes("/workouts/complete")) return json({ id: "srv-1", sets: [] }, 201);
        if (init?.method === "DELETE") throw new TypeError("Failed to fetch");
        throw new TypeError("Failed to fetch");
      }),
    );
    render(
      <MemoryRouter>
        <AuthProvider>
          <LanguageProvider>
            <ToastProvider>
              <GymCard collapseKey="test.gym" />
            </ToastProvider>
          </LanguageProvider>
        </AuthProvider>
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Rest day" }));
    await waitFor(() => expect(readOutbox("u1")).toEqual([]));
    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Could not undo the rest day. Try again in a moment.")).toBeInTheDocument();
  });

  it("Undo is offered for five seconds only, the logged line stays", async () => {
    stubOfflineGym();
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Rest day" }));
    expect(await screen.findByRole("button", { name: "Undo" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument(), {
      timeout: 6_500,
    });
    expect(screen.getByText("Rest day logged")).toBeInTheDocument();
    expect(readOutbox("u1")).toHaveLength(1);
  }, 10_000);

  it("offers no Rest day button when today's is already logged, or a session is running", async () => {
    stubOfflineGym();
    const today = todayIso(new Date());
    writeCache("u1", {
      ...EMPTY_CACHE,
      workouts: [
        { id: "w1", routine_id: null, performed_on: today, started_at: null, ended_at: null, rest_day: true, note: null, created_at: "" },
      ],
    });
    mount();
    expect(await screen.findByRole("button", { name: "Start session" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rest day" })).not.toBeInTheDocument();
    expect(screen.getByText("Rest day logged")).toBeInTheDocument();
  });

  it("offers no Rest day button during a session", async () => {
    stubOfflineGym();
    writeActive("u1", startSession(routine("r1", "Push"), new Date(), () => crypto.randomUUID()));
    mount();
    await screen.findByRole("button", { name: "Resume" });
    expect(screen.queryByRole("button", { name: "Rest day" })).not.toBeInTheDocument();
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
