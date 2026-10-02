import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import type { Exercise, HistoryPoint, RoutineDetail, Workout } from "../../api/types";
import { ToastProvider } from "../../components/Toast";
import { startSession, type ActiveSession } from "../../gym/session";
import { EMPTY_CACHE, writeActive, writeCache, type GymCache } from "../../gym/store";
import { GymPage } from "../GymPage";
import { USER_ID, mocks } from "./mockkit";

/**
 * Shared harness for the gym views' tests. The real `gym/` modules (session, store, format)
 * run; only the network (`api.*`) and the signed-in user are faked, so a test sees exactly
 * what the page does with the real offline store.
 *
 * A test file mocks with, at its top level (vi.mock is hoisted per file):
 *
 *   vi.mock("../../api/client", async (orig) => (await import("./mockkit")).mockClient(await orig()));
 *   vi.mock("../../auth/AuthContext", async () => (await import("./mockkit")).authModule());
 *   vi.mock("../../components/CheckInButton", () => ({ CheckInButton: () => null }));
 */

export const exercises: Exercise[] = [
  { id: "e1", name: "Bench press", kind: "reps", video_url: "https://youtu.be/abc", note: null, created_at: "" },
  { id: "e2", name: "Plank", kind: "duration", video_url: null, note: null, created_at: "" },
  { id: "e3", name: "Rowing", kind: "distance", video_url: null, note: null, created_at: "" },
];

export const pushDay: RoutineDetail = {
  id: "r1",
  name: "Push day",
  note: null,
  lines: [
    {
      id: "l1",
      exercise_id: "e1",
      exercise_name: "Bench press",
      kind: "reps",
      video_url: "https://youtu.be/abc",
      position: 0,
      target_sets: 4,
      target_reps: 8,
      target_seconds: null,
      target_distance_m: null,
      target_weight: "60.00",
      rest_seconds: 90,
      rest_after_seconds: null,
      note: null,
    },
    {
      id: "l2",
      exercise_id: "e2",
      exercise_name: "Plank",
      kind: "duration",
      video_url: null,
      position: 1,
      target_sets: 3,
      target_reps: null,
      target_seconds: 45,
      target_distance_m: null,
      target_weight: null,
      rest_seconds: 60,
      rest_after_seconds: null,
      note: null,
    },
  ],
};

export const cardio: RoutineDetail = {
  id: "r2",
  name: "Cardio",
  note: null,
  lines: [
    {
      id: "l3",
      exercise_id: "e3",
      exercise_name: "Rowing",
      kind: "distance",
      video_url: null,
      position: 0,
      target_sets: 1,
      target_reps: null,
      target_seconds: null,
      target_distance_m: 2000,
      target_weight: null,
      rest_seconds: null,
      rest_after_seconds: null,
      note: null,
    },
  ],
};

export const workout: Workout = {
  id: "w1",
  routine_id: "r1",
  performed_on: "2026-09-30",
  started_at: "2026-09-30T17:00:00Z",
  ended_at: "2026-09-30T17:45:00Z",
  rest_day: false,
  note: null,
  created_at: "",
};

export const lastBench: HistoryPoint = {
  performed_on: "2026-09-30",
  top_weight: "57.50",
  reps: 32,
  sets: 4,
  volume: "1840.00",
  best_seconds: null,
  total_seconds: null,
  best_distance_m: null,
  total_distance_m: null,
};

export function cacheWith(over: Partial<GymCache> = {}): GymCache {
  return {
    ...EMPTY_CACHE,
    routines: [pushDay, cardio],
    exercises,
    workouts: [workout],
    lastTime: { e1: lastBench },
    lastDone: { r1: "2026-09-30" },
    refreshedAt: "2026-10-01T08:00:00Z",
    ...over,
  };
}

/** Reset every fake and answer the way a healthy server would. */
export function resetServer(data: Partial<GymCache> = {}) {
  window.localStorage.clear();
  const cache = cacheWith(data);
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.listRoutinesFull.mockResolvedValue(cache.routines);
  mocks.listExercises.mockResolvedValue(cache.exercises);
  mocks.listWorkouts.mockResolvedValue(cache.workouts);
  mocks.listRecentWorkouts.mockResolvedValue([]);
  mocks.exerciseHistory.mockResolvedValue({ exercise_id: "e1", exercise_name: "Bench press", points: [] });
  mocks.completeWorkout.mockResolvedValue({ id: "w9", sets: [] });
  mocks.readWorkout.mockResolvedValue({ ...workout, sets: [] });
  for (const name of [
    "updateRoutine",
    "importRoutine",
    "reorderRoutine",
    "addRoutineLine",
    "updateRoutineLine",
    "removeRoutineLine",
    "deleteRoutine",
    "deleteWorkout",
    "updateExercise",
  ] as const) {
    mocks[name].mockResolvedValue({});
  }
  mocks.createRoutine.mockResolvedValue({ id: "r9", name: "Pull day", note: null, created_at: "" });
  // The device already holds what the server would send, as on any visit but the first.
  writeCache(USER_ID, cache);
}

let counter = 0;
export const ids = () => `id-${++counter}`;

/** A session in progress, written where the store reads it. */
export function seedActive(routine: RoutineDetail | null = pushDay, now = new Date()): ActiveSession {
  const session = startSession(routine, now, ids);
  writeActive(USER_ID, session);
  return session;
}

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname + location.search}</output>;
}

export function renderGym(path = "/gym") {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/gym/*" element={<GymPage />} />
        </Routes>
        <Where />
      </MemoryRouter>
    </ToastProvider>,
  );
}
