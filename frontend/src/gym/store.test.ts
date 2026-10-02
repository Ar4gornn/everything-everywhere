import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../api/client";
import type { HistoryPoint, RoutineDetail, Workout, WorkoutComplete } from "../api/types";

const mocks = vi.hoisted(() => ({
  completeWorkout: vi.fn(),
  listRecentWorkouts: vi.fn(),
  deleteWorkout: vi.fn(),
  listRoutinesFull: vi.fn(),
  listExercises: vi.fn(),
  listWorkouts: vi.fn(),
  exerciseHistory: vi.fn(),
}));

vi.mock("../api/client", async (original) => {
  const real = await original<typeof import("../api/client")>();
  return { ...real, api: { ...real.api, ...mocks } };
});
vi.mock("../auth/AuthContext", () => ({ useOptionalAuth: () => ({ user: { id: "u1" } }) }));

import { startSession, logSet, type ActiveSession } from "./session";
import {
  clearGymStore,
  discardOutboxEntry,
  EMPTY_CACHE,
  FINISH_TIMEOUT_MS,
  finishActive,
  flushOutbox,
  hasRestDay,
  hasUnsentGym,
  logRestDay,
  readRecent,
  undoRestDay,
  readActive,
  readCache,
  readOutbox,
  refreshCache,
  retryOutboxEntry,
  subscribe,
  useGymData,
  writeActive,
  writeCache,
} from "./store";

const USER = "u1";
const NOW = new Date("2031-03-04T10:00:00Z");

function ids() {
  let n = 0;
  return () => `id-${++n}`;
}

/** An active session with one rep set logged, under a fixed client_ref. */
function session(ref: string, name: string | null = "Push"): ActiveSession {
  const base = startSession(
    { id: "r1", name: name ?? "", note: null, lines: [
      { id: "l1", exercise_id: "e1", exercise_name: "Bench", kind: "reps", video_url: null, position: 1,
        target_sets: 1, target_reps: 5, target_seconds: null, target_distance_m: null, target_weight: null, rest_seconds: null, rest_after_seconds: null, note: null },
    ] },
    NOW,
    ids(),
  );
  const withSet = logSet(base, base.exercises[0]!.key, { reps: 5, weight: null, duration_seconds: null, distance_m: null }, NOW, ids());
  return { ...withSet, client_ref: ref, routine_name: name };
}

const done = (ref: string) => ({ id: `w-${ref}`, client_ref: ref });

beforeEach(() => {
  window.localStorage.clear();
  clearGymStore(USER);
  clearGymStore("u2");
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.listRoutinesFull.mockResolvedValue([]);
  mocks.listExercises.mockResolvedValue([]);
  mocks.listWorkouts.mockResolvedValue([]);
  mocks.listRecentWorkouts.mockResolvedValue([]);
  mocks.exerciseHistory.mockResolvedValue({ exercise_id: "", exercise_name: "", points: [] });
});

describe("the outbox", () => {
  it("keeps a session whose network failed, pending, and clears the active one", async () => {
    mocks.completeWorkout.mockRejectedValue(new TypeError("Failed to fetch"));
    writeActive(USER, session("ref-1"));
    const result = await finishActive(USER, NOW);
    expect(result).toEqual({ sent: 0, pending: 1, refused: 0 });
    expect(readActive(USER)).toBeNull();
    const [entry] = readOutbox(USER);
    expect(entry).toMatchObject({ routine_name: "Push", refused: null });
    expect(entry?.body.client_ref).toBe("ref-1");
    expect(entry?.body.sets).toHaveLength(1);
  });

  it("removes an entry the server accepted", async () => {
    mocks.completeWorkout.mockResolvedValue(done("ref-1"));
    writeActive(USER, session("ref-1"));
    expect(await finishActive(USER, NOW)).toEqual({ sent: 1, pending: 0, refused: 0 });
    expect(readOutbox(USER)).toEqual([]);
    expect(mocks.completeWorkout).toHaveBeenCalledTimes(1);
    expect(mocks.completeWorkout.mock.calls[0]?.[0]).toMatchObject({ client_ref: "ref-1" });
  });

  it("marks a 4xx refused with its code, keeps it, and never retries it", async () => {
    mocks.completeWorkout.mockRejectedValue(new ApiError(422, "bad", "set_missing_measure"));
    writeActive(USER, session("ref-1"));
    expect(await finishActive(USER, NOW)).toEqual({ sent: 0, pending: 0, refused: 1 });
    expect(readOutbox(USER)[0]).toMatchObject({ refused: "set_missing_measure" });
    await flushOutbox(USER);
    await flushOutbox(USER);
    expect(mocks.completeWorkout).toHaveBeenCalledTimes(1);
    // the person has seen it: it can be dropped
    discardOutboxEntry(USER, "ref-1");
    expect(readOutbox(USER)).toEqual([]);
  });

  it.each([
    ["a 5xx", new ApiError(503, "down", null)],
    ["a 401 (sign back in to send it)", new ApiError(401, "expired", "session_expired")],
    ["a 429", new ApiError(429, "slow down", null)],
    ["a 408", new ApiError(408, "timeout", null)],
    ["a network failure", new TypeError("Failed to fetch")],
  ])("keeps it pending on %s", async (_name, failure) => {
    mocks.completeWorkout.mockRejectedValue(failure);
    writeActive(USER, session("ref-1"));
    expect(await finishActive(USER, NOW)).toEqual({ sent: 0, pending: 1, refused: 0 });
    expect(readOutbox(USER)[0]?.refused).toBeNull();
  });

  it("is safe to replay: the same session finished twice is one entry", async () => {
    mocks.completeWorkout.mockRejectedValue(new TypeError("offline"));
    writeActive(USER, session("ref-1"));
    await finishActive(USER, NOW);
    // a crash between "queued" and "active cleared" leaves both; finishing again replaces
    writeActive(USER, session("ref-1"));
    await finishActive(USER, NOW);
    expect(readOutbox(USER)).toHaveLength(1);
  });

  it("sends oldest first, stops at the first network failure, and goes past a refusal", async () => {
    mocks.completeWorkout.mockRejectedValue(new TypeError("offline"));
    for (const ref of ["a", "b", "c"]) {
      writeActive(USER, session(ref));
      await finishActive(USER, NOW);
    }
    mocks.completeWorkout.mockReset();
    mocks.completeWorkout.mockImplementation(async (body: WorkoutComplete) => {
      if (body.client_ref === "a") throw new ApiError(422, "no", "bad");
      if (body.client_ref === "b") return done("b");
      throw new TypeError("offline again");
    });
    expect(await flushOutbox(USER)).toEqual({ sent: 1, pending: 1, refused: 1 });
    expect(mocks.completeWorkout.mock.calls.map((call) => (call[0] as WorkoutComplete).client_ref)).toEqual(["a", "b", "c"]);
    expect(readOutbox(USER).map((entry) => [entry.body.client_ref, entry.refused])).toEqual([
      ["a", "bad"],
      ["c", null],
    ]);
  });

  it("is single-flight: two flushes at once send each session once", async () => {
    mocks.completeWorkout.mockRejectedValue(new TypeError("offline"));
    writeActive(USER, session("ref-1"));
    await finishActive(USER, NOW);
    mocks.completeWorkout.mockReset();
    let release: () => void = () => undefined;
    mocks.completeWorkout.mockImplementation(
      () => new Promise((resolve) => { release = () => resolve(done("ref-1")); }),
    );
    const first = flushOutbox(USER);
    const second = flushOutbox(USER);
    expect(second).toBe(first);
    await waitFor(() => expect(mocks.completeWorkout).toHaveBeenCalledTimes(1));
    release();
    expect(await first).toEqual({ sent: 1, pending: 0, refused: 0 });
    expect(mocks.completeWorkout).toHaveBeenCalledTimes(1);
    // and the lock is released afterwards
    expect(flushOutbox(USER)).not.toBe(first);
  });

  it("keeps the active session when storage cannot take the outbox, trying the server directly", async () => {
    mocks.completeWorkout.mockResolvedValue(done("ref-1"));
    writeActive(USER, session("ref-1"));
    const real = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
      if (key.endsWith(".outbox")) throw new DOMException("full", "QuotaExceededError");
      return real.call(this, key, value);
    });
    try {
      expect(await finishActive(USER, NOW)).toEqual({ sent: 1, pending: 0, refused: 0 });
    } finally {
      spy.mockRestore();
    }
    expect(mocks.completeWorkout).toHaveBeenCalledTimes(1);
    expect(readActive(USER)).toBeNull();
  });

  it("does nothing when there is no active session", async () => {
    expect(await finishActive(USER, NOW)).toEqual({ sent: 0, pending: 0, refused: 0 });
    expect(mocks.completeWorkout).not.toHaveBeenCalled();
  });
});

describe("sign-out", () => {
  it("knows when something would be lost", () => {
    expect(hasUnsentGym(USER)).toBe(false);
    writeActive(USER, session("ref-1"));
    expect(hasUnsentGym(USER)).toBe(true);
    writeActive(USER, null);
    expect(hasUnsentGym(USER)).toBe(false);
  });

  it("counts a queued session, refused or not", async () => {
    mocks.completeWorkout.mockRejectedValue(new ApiError(422, "no", "bad"));
    writeActive(USER, session("ref-1"));
    await finishActive(USER, NOW);
    expect(hasUnsentGym(USER)).toBe(true);
  });

  it("removes cache, active session and outbox for that user only", async () => {
    mocks.completeWorkout.mockRejectedValue(new TypeError("offline"));
    writeActive(USER, session("ref-1"));
    await finishActive(USER, NOW);
    writeActive(USER, session("ref-2"));
    writeCache(USER, { ...EMPTY_CACHE, refreshedAt: "2031-03-04T00:00:00Z" });
    writeActive("u2", session("other"));
    clearGymStore(USER);
    expect(readActive(USER)).toBeNull();
    expect(readOutbox(USER)).toEqual([]);
    expect(readCache(USER)).toEqual(EMPTY_CACHE);
    expect(Object.keys(window.localStorage).filter((key) => key.includes(`.gym.${USER}.`))).toEqual([]);
    expect(readActive("u2")?.client_ref).toBe("other");
  });

  it("does not let a refresh that was in flight put the data back", async () => {
    let release: (value: never[]) => void = () => undefined;
    mocks.listRoutinesFull.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const pending = refreshCache(USER);
    clearGymStore(USER);
    release([]);
    await pending;
    expect(readCache(USER)).toEqual(EMPTY_CACHE);
  });
});

describe("storage that cannot be trusted", () => {
  it("reads garbage as nothing", () => {
    window.localStorage.setItem(`everything-everywhere.gym.${USER}.cache`, "{not json");
    window.localStorage.setItem(`everything-everywhere.gym.${USER}.active`, '{"client_ref": 3}');
    window.localStorage.setItem(`everything-everywhere.gym.${USER}.outbox`, '"x"');
    expect(readCache(USER)).toEqual(EMPTY_CACHE);
    expect(readActive(USER)).toBeNull();
    expect(readOutbox(USER)).toEqual([]);
  });

  it("fills in what an older cache lacks", () => {
    window.localStorage.setItem(`everything-everywhere.gym.${USER}.cache`, '{"routines": [{"id": "r"}]}');
    const cache = readCache(USER);
    expect(cache.routines).toHaveLength(1);
    expect(cache.lastTime).toEqual({});
    expect(cache.refreshedAt).toBeNull();
  });

  it("does not throw when storage is blocked", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    try {
      expect(readCache(USER)).toEqual(EMPTY_CACHE);
      expect(readActive(USER)).toBeNull();
      expect(readOutbox(USER)).toEqual([]);
      expect(hasUnsentGym(USER)).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("round-trips the active session and tells subscribers", () => {
    const heard = vi.fn();
    const stop = subscribe(heard);
    const active = session("ref-1");
    writeActive(USER, active);
    expect(readActive(USER)).toEqual(active);
    expect(heard).toHaveBeenCalled();
    stop();
    heard.mockClear();
    writeActive(USER, null);
    expect(heard).not.toHaveBeenCalled();
  });

  it("hears another tab's write through the storage event", () => {
    const heard = vi.fn();
    const stop = subscribe(heard);
    window.dispatchEvent(new StorageEvent("storage", { key: `everything-everywhere.gym.${USER}.active` }));
    window.dispatchEvent(new StorageEvent("storage", { key: "everything-everywhere.language" }));
    stop();
    expect(heard).toHaveBeenCalledTimes(1);
  });
});

describe("refreshing the cache", () => {
  const routine: RoutineDetail = {
    id: "r1", name: "Push", note: null,
    lines: [
      { id: "l1", exercise_id: "e1", exercise_name: "Bench", kind: "reps", video_url: null, position: 1,
        target_sets: null, target_reps: null, target_seconds: null, target_distance_m: null, target_weight: null, rest_seconds: null, rest_after_seconds: null, note: null },
      { id: "l2", exercise_id: "e2", exercise_name: "Plank", kind: "duration", video_url: null, position: 2,
        target_sets: null, target_reps: null, target_seconds: null, target_distance_m: null, target_weight: null, rest_seconds: null, rest_after_seconds: null, note: null },
    ],
  };
  const workout = (id: string, day: string, routineId: string | null = "r1"): Workout => ({
    id, routine_id: routineId, performed_on: day, started_at: null, ended_at: null, rest_day: false, note: null, created_at: day,
  });
  const point = (day: string, top: string): HistoryPoint => ({
    performed_on: day, top_weight: top, reps: 8, sets: 3, volume: null,
    best_seconds: null, total_seconds: null, best_distance_m: null, total_distance_m: null,
  });

  it("stores routines, exercises, workouts, last-done days and the latest point per exercise", async () => {
    mocks.listRoutinesFull.mockResolvedValue([routine]);
    mocks.listExercises.mockResolvedValue([{ id: "e1" }, { id: "e2" }]);
    mocks.listWorkouts.mockResolvedValue([workout("w2", "2031-03-02"), workout("w1", "2031-02-20"), workout("w0", "2031-02-10", null)]);
    mocks.exerciseHistory.mockImplementation(async (id: string) => ({
      exercise_id: id, exercise_name: id,
      points: id === "e1" ? [point("2031-03-02", "70.00"), point("2031-02-20", "65.00")] : [],
    }));
    const cache = await refreshCache(USER);
    expect(mocks.listWorkouts).toHaveBeenCalledWith({ limit: 20 });
    expect(cache.lastDone).toEqual({ r1: "2031-03-02" });
    expect(cache.lastTime["e1"]?.top_weight).toBe("70.00");
    expect(cache.lastTime["e2"]).toBeUndefined();
    expect(cache.refreshedAt).not.toBeNull();
    expect(readCache(USER)).toEqual(cache);
  });

  it("ignores a history that failed, and asks once per exercise", async () => {
    mocks.listRoutinesFull.mockResolvedValue([routine]);
    mocks.exerciseHistory.mockRejectedValue(new TypeError("offline"));
    const cache = await refreshCache(USER);
    expect(cache.lastTime).toEqual({});
    expect(mocks.exerciseHistory).toHaveBeenCalledTimes(2);
  });

  it("does not re-ask for known figures when nothing new was logged", async () => {
    mocks.listRoutinesFull.mockResolvedValue([routine]);
    mocks.listWorkouts.mockResolvedValue([workout("w1", "2031-03-02")]);
    mocks.exerciseHistory.mockResolvedValue({ exercise_id: "x", exercise_name: "x", points: [point("2031-03-02", "70.00")] });
    await refreshCache(USER);
    mocks.exerciseHistory.mockClear();
    await refreshCache(USER);
    expect(mocks.exerciseHistory).not.toHaveBeenCalled();
    mocks.listWorkouts.mockResolvedValue([workout("w2", "2031-03-05"), workout("w1", "2031-03-02")]);
    await refreshCache(USER);
    expect(mocks.exerciseHistory).toHaveBeenCalledTimes(2);
  });

  it("rejects offline and leaves the previous cache alone", async () => {
    mocks.listRoutinesFull.mockResolvedValue([routine]);
    await refreshCache(USER);
    mocks.listRoutinesFull.mockRejectedValue(new TypeError("offline"));
    await expect(refreshCache(USER)).rejects.toBeInstanceOf(TypeError);
    expect(readCache(USER).routines).toHaveLength(1);
  });

  it("is one request set for concurrent callers", async () => {
    const [a, b] = await Promise.all([refreshCache(USER), refreshCache(USER)]);
    expect(a).toBe(b);
    expect(mocks.listRoutinesFull).toHaveBeenCalledTimes(1);
  });
});

describe("useGymData", () => {
  it("reads the device first, flushes the outbox, then refreshes", async () => {
    mocks.completeWorkout.mockRejectedValueOnce(new TypeError("offline"));
    writeActive(USER, session("ref-1"));
    await finishActive(USER, NOW);
    mocks.completeWorkout.mockResolvedValue(done("ref-1"));
    mocks.listRoutinesFull.mockResolvedValue([{ id: "r1", name: "Push", note: null, lines: [] }]);

    const { result } = renderHook(() => useGymData());
    // cache first: the pending entry is visible before the network answers
    expect(result.current.outbox).toHaveLength(1);
    await waitFor(() => expect(result.current.outbox).toHaveLength(0));
    await waitFor(() => expect(result.current.cache.routines).toHaveLength(1));
    expect(result.current.offline).toBe(false);
  });

  it("says offline when the refresh cannot reach the server, and not for a 4xx", async () => {
    mocks.listRoutinesFull.mockRejectedValue(new TypeError("offline"));
    const { result } = renderHook(() => useGymData());
    await waitFor(() => expect(result.current.offline).toBe(true));
    mocks.listRoutinesFull.mockRejectedValue(new ApiError(404, "nf", null));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.offline).toBe(false);
  });

  it("refreshes and flushes again when the browser comes back online", async () => {
    const { result } = renderHook(() => useGymData());
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    mocks.listRoutinesFull.mockClear();
    window.dispatchEvent(new Event("online"));
    await waitFor(() => expect(mocks.listRoutinesFull).toHaveBeenCalledTimes(1));
  });

  it("persists and broadcasts the active session through setActive", async () => {
    const { result } = renderHook(() => useGymData());
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    act(() => result.current.setActive(session("ref-9")));
    expect(result.current.active?.client_ref).toBe("ref-9");
    expect(readActive(USER)?.client_ref).toBe("ref-9");
    act(() => result.current.setActive(null));
    expect(result.current.active).toBeNull();
  });
});

describe("recoverable refusals", () => {
  it.each([
    ["a 404", new ApiError(404, "nf", null)],
    ["a 405", new ApiError(405, "no", null)],
    ["a 413", new ApiError(413, "big", null)],
    ["a failed token refresh", new ApiError(400, "Request failed (400).", "refresh_failed")],
  ])("keeps it pending on %s", async (_name, failure) => {
    mocks.completeWorkout.mockRejectedValue(failure);
    writeActive(USER, session("ref-1"));
    expect(await finishActive(USER, NOW)).toEqual({ sent: 0, pending: 1, refused: 0 });
  });

  it.each([400, 409, 422])("a %i is a refusal", async (status) => {
    mocks.completeWorkout.mockRejectedValue(new ApiError(status, "no", "bad"));
    writeActive(USER, session("ref-1"));
    expect((await finishActive(USER, NOW)).refused).toBe(1);
  });

  it("retryOutboxEntry clears the refusal and sends it", async () => {
    mocks.completeWorkout.mockRejectedValueOnce(new ApiError(422, "no", "bad"));
    writeActive(USER, session("ref-1"));
    await finishActive(USER, NOW);
    expect(readOutbox(USER)[0]?.refused).toBe("bad");
    mocks.completeWorkout.mockResolvedValue(done("ref-1"));
    expect(await retryOutboxEntry(USER, "ref-1")).toEqual({ sent: 1, pending: 0, refused: 0 });
    expect(readOutbox(USER)).toEqual([]);
  });

  it("clearGymStore drops the import draft too", () => {
    const key = `everything-everywhere.gym.import.${USER}`;
    window.sessionStorage.setItem(key, "{}");
    window.localStorage.setItem(key, "{}");
    clearGymStore(USER);
    expect(window.sessionStorage.getItem(key)).toBeNull();
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it("Finish stops waiting after the timeout and leaves the entry pending", async () => {
    vi.useFakeTimers();
    try {
      mocks.completeWorkout.mockReturnValue(new Promise(() => undefined));
      writeActive(USER, session("ref-1"));
      const result = finishActive(USER, NOW);
      await vi.advanceTimersByTimeAsync(FINISH_TIMEOUT_MS + 1);
      expect(await result).toEqual({ sent: 0, pending: 1, refused: 0 });
      expect(readOutbox(USER)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

const workoutRow = (id: string, day: string, routineId: string | null): Workout => ({
  id, routine_id: routineId, performed_on: day, started_at: null, ended_at: null, rest_day: false, note: null, created_at: day,
});

describe("rest days (Epic 43)", () => {
  // Its own user: an earlier test leaves a never-answered flush in flight for USER.
  const U = "u3";
  const DAY = "2031-03-04";
  beforeEach(() => clearGymStore(U));

  it("logRestDay queues a rest_day body, shows it in the cache at once, then flushes", async () => {
    mocks.completeWorkout.mockResolvedValue({ id: "srv-1" });
    const ref = await logRestDay(U, DAY, NOW);
    expect(mocks.completeWorkout).toHaveBeenCalledTimes(1);
    expect(mocks.completeWorkout.mock.calls[0]?.[0]).toEqual({
      client_ref: ref,
      performed_on: DAY,
      rest_day: true,
      sets: [],
    });
    expect(readOutbox(U)).toEqual([]);
    expect(readCache(U).workouts).toMatchObject([{ rest_day: true, performed_on: DAY }]);
    expect(hasRestDay(U, DAY)).toBe(true);
    expect(hasRestDay(U, "2031-03-05")).toBe(false);
  });

  it("offline: stays in the outbox, still counts, and is not logged twice", async () => {
    mocks.completeWorkout.mockRejectedValue(new TypeError("Failed to fetch"));
    const ref = await logRestDay(U, DAY, NOW);
    expect(readOutbox(U)).toHaveLength(1);
    expect(readOutbox(U)[0]?.body).toMatchObject({ client_ref: ref, rest_day: true, sets: [] });
    expect(hasRestDay(U, DAY)).toBe(true);
    expect(await logRestDay(U, DAY, NOW)).toBe(ref);
    expect(readOutbox(U)).toHaveLength(1);
    expect(readCache(U).workouts).toHaveLength(1);
  });

  it("undo while pending discards the outbox entry and the cached stub, and never calls the server", async () => {
    mocks.completeWorkout.mockRejectedValue(new TypeError("Failed to fetch"));
    const ref = await logRestDay(U, DAY, NOW);
    await undoRestDay(U, ref);
    expect(readOutbox(U)).toEqual([]);
    expect(readCache(U).workouts).toEqual([]);
    expect(hasRestDay(U, DAY)).toBe(false);
    expect(mocks.deleteWorkout).not.toHaveBeenCalled();
  });

  it("undo once sent deletes the workout the server answered with", async () => {
    mocks.completeWorkout.mockResolvedValue({ id: "srv-1" });
    mocks.deleteWorkout.mockResolvedValue(undefined);
    const ref = await logRestDay(U, DAY, NOW);
    await undoRestDay(U, ref);
    expect(mocks.deleteWorkout).toHaveBeenCalledWith("srv-1");
    expect(readCache(U).workouts).toEqual([]);
  });

  it("a rest day is not a routine 'last done'", async () => {
    mocks.listWorkouts.mockResolvedValue([
      { ...workoutRow("w2", "2031-03-03", "r1"), rest_day: true },
      workoutRow("w1", "2031-03-01", "r1"),
    ]);
    const cache = await refreshCache(U);
    expect(cache.lastDone).toEqual({ r1: "2031-03-01" });
  });

  it("refresh caches the recent sessions; a failure keeps the cache refreshing", async () => {
    const recent = [{ id: "w1", rest_day: false, performed_on: DAY, sets: [] }];
    mocks.listRecentWorkouts.mockResolvedValue(recent);
    await refreshCache(U);
    expect(mocks.listRecentWorkouts).toHaveBeenCalledWith(10);
    expect(readRecent(U)).toEqual(recent);
    mocks.listRecentWorkouts.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(refreshCache(U)).resolves.toBeDefined();
    expect(readRecent(U)).toEqual(recent);
  });

  it("clearGymStore clears recent and the remembered ids too", async () => {
    mocks.listRecentWorkouts.mockResolvedValue([{ id: "w1", rest_day: false, performed_on: DAY, sets: [] }]);
    mocks.completeWorkout.mockResolvedValue({ id: "srv-1" });
    await refreshCache(U);
    await logRestDay(U, DAY, NOW);
    clearGymStore(U);
    expect(readRecent(U)).toEqual([]);
    expect(window.localStorage.getItem("everything-everywhere.gym.u3.sent")).toBeNull();
  });
});
