import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiError, api } from "../api/client";
import type {
  Exercise,
  HistoryPoint,
  RoutineDetail,
  Workout,
  WorkoutComplete,
} from "../api/types";
import { useOptionalAuth } from "../auth/AuthContext";
import { PREFIX } from "../storage";
import { type ActiveSession, toCompleteBody } from "./session";

/**
 * The gym on the device (Epic 42, AD-58).
 *
 * Keys: `everything-everywhere.gym.<userId>.{cache,active,outbox}` in localStorage, every
 * read and write in try/catch (storage can be full, blocked, or absent in a private window —
 * the page then works online-only and says nothing alarming).
 *
 * - **cache**: what the gym page and the dashboard card read first, refreshed from the server
 *   whenever it answers. Holds routines with lines, exercises, the last 20 workouts, and the
 *   last-time figure per exercise.
 * - **active**: the session being recorded, written on every change.
 * - **outbox**: finished sessions not yet accepted by the server. A network failure keeps an
 *   entry pending; a 4xx marks it refused (kept, shown, not retried); a success removes it.
 *
 * All three are removed by `clearGymStore` on explicit sign-out (AD-48's rule); an expired
 * session keeps them.
 *
 * Subscribers (`subscribe`) hear every change so the dashboard card and the page stay in step
 * across components and tabs (`storage` event).
 */

export interface GymCache {
  routines: RoutineDetail[];
  exercises: Exercise[];
  workouts: Workout[];
  /** exercise_id → the most recent session's point for it. */
  lastTime: Record<string, HistoryPoint>;
  /** routine_id → ISO date it was last done, for ordering the quick-start buttons. */
  lastDone: Record<string, string>;
  /** ISO time of the last successful refresh, null if never. */
  refreshedAt: string | null;
}

export interface OutboxEntry {
  body: WorkoutComplete;
  /** Display name for the pending list. */
  routine_name: string | null;
  queuedAt: string;
  /** Server error code when it refused the session; null while merely waiting. */
  refused: string | null;
}

export const EMPTY_CACHE: GymCache = {
  routines: [],
  exercises: [],
  workouts: [],
  lastTime: {},
  lastDone: {},
  refreshedAt: null,
};

const base = (userId: string) => `${PREFIX}gym.${userId}.`;
const CACHE = "cache";
const ACTIVE = "active";
const OUTBOX = "outbox";

function readJson(userId: string, part: string): unknown {
  try {
    const raw = window.localStorage.getItem(base(userId) + part);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    // Blocked storage or a value this version cannot read: as if nothing were stored.
    return null;
  }
}

/** Returns false when the write did not happen (full or blocked storage). */
function writeJson(userId: string, part: string, value: unknown): boolean {
  try {
    if (value === null) window.localStorage.removeItem(base(userId) + part);
    else window.localStorage.setItem(base(userId) + part, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// --------------------------------------------------------------------- subscribers

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

/** Another tab wrote one of our keys: tell this tab's components. */
function onStorage(event: StorageEvent): void {
  if (event.key === null || event.key.startsWith(`${PREFIX}gym.`)) emit();
}

export function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

// --------------------------------------------------------------------- cache

export function readCache(userId: string): GymCache {
  const raw = readJson(userId, CACHE);
  if (!isRecord(raw)) return EMPTY_CACHE;
  const list = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
  const map = <T>(value: unknown): Record<string, T> =>
    isRecord(value) ? (value as Record<string, T>) : {};
  return {
    routines: list<RoutineDetail>(raw["routines"]),
    exercises: list<Exercise>(raw["exercises"]),
    workouts: list<Workout>(raw["workouts"]),
    lastTime: map<HistoryPoint>(raw["lastTime"]),
    lastDone: map<string>(raw["lastDone"]),
    refreshedAt: typeof raw["refreshedAt"] === "string" ? raw["refreshedAt"] : null,
  };
}

export function writeCache(userId: string, cache: GymCache): void {
  writeJson(userId, CACHE, cache);
  emit();
}

// A sign-out while a refresh is in flight must not let the answer put the data back.
const generation = new Map<string, number>();
const generationOf = (userId: string) => generation.get(userId) ?? 0;

/** Histories asked for at once. The server is small; four is plenty for a handful of lines. */
const HISTORY_PARALLEL = 4;

const refreshing = new Map<string, Promise<GymCache>>();

/** The most recent point of an exercise's history, whatever order the server sent them in. */
function latestPoint(points: HistoryPoint[]): HistoryPoint | undefined {
  return points.reduce<HistoryPoint | undefined>(
    (best, point) => (!best || point.performed_on >= best.performed_on ? point : best),
    undefined,
  );
}

async function fetchLastTimes(
  ids: string[],
  into: Record<string, HistoryPoint>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++] as string;
      try {
        const history = await api.exerciseHistory(id);
        const point = latestPoint(history.points);
        if (point) into[id] = point;
      } catch {
        // A figure that did not arrive is a missing "Last time" line, never an error.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(HISTORY_PARALLEL, ids.length) }, worker));
}

/** Fetch routines (full), exercises and recent workouts; merge into the cache. Throws offline. */
export function refreshCache(userId: string): Promise<GymCache> {
  const running = refreshing.get(userId);
  if (running) return running;
  const started = generationOf(userId);
  const run = (async () => {
    const previous = readCache(userId);
    const [routines, exercises, workouts] = await Promise.all([
      api.listRoutinesFull(),
      api.listExercises(),
      api.listWorkouts({ limit: 20 }),
    ]);

    const lastDone: Record<string, string> = { ...previous.lastDone };
    for (const workout of workouts) {
      const day = workout.routine_id ? lastDone[workout.routine_id] : undefined;
      if (workout.routine_id && (!day || workout.performed_on > day)) {
        lastDone[workout.routine_id] = workout.performed_on;
      }
    }

    // "Last time" is wanted only for exercises a routine can start a session with. If the
    // newest workout is the one already cached nothing new was logged, so only figures that
    // are missing are fetched — opening the dashboard does not re-ask for every history.
    const inRoutines = [
      ...new Set(routines.flatMap((routine) => routine.lines.map((line) => line.exercise_id))),
    ];
    const unchanged =
      previous.refreshedAt !== null && previous.workouts[0]?.id === workouts[0]?.id;
    const lastTime: Record<string, HistoryPoint> = {};
    for (const id of inRoutines) {
      const known = previous.lastTime[id];
      if (known) lastTime[id] = known;
    }
    await fetchLastTimes(
      inRoutines.filter((id) => !unchanged || !(id in lastTime)),
      lastTime,
    );

    const cache: GymCache = {
      routines,
      exercises,
      workouts,
      lastTime,
      lastDone,
      refreshedAt: new Date().toISOString(),
    };
    if (generationOf(userId) === started) writeCache(userId, cache);
    return cache;
  })().finally(() => {
    refreshing.delete(userId);
  });
  refreshing.set(userId, run);
  return run;
}

// --------------------------------------------------------------------- active session

export function readActive(userId: string): ActiveSession | null {
  const raw = readJson(userId, ACTIVE);
  if (
    !isRecord(raw) ||
    typeof raw["client_ref"] !== "string" ||
    !Array.isArray(raw["exercises"]) ||
    !Array.isArray(raw["sets"])
  ) {
    return null;
  }
  return raw as unknown as ActiveSession;
}

/** Null removes it. */
export function writeActive(userId: string, session: ActiveSession | null): void {
  writeJson(userId, ACTIVE, session);
  emit();
}

// --------------------------------------------------------------------- outbox

export function readOutbox(userId: string): OutboxEntry[] {
  const raw = readJson(userId, OUTBOX);
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is OutboxEntry => isRecord(entry) && isRecord(entry["body"]),
  );
}

function writeOutbox(userId: string, entries: OutboxEntry[]): boolean {
  const ok = writeJson(userId, OUTBOX, entries.length === 0 ? null : entries);
  emit();
  return ok;
}

export interface FlushResult {
  sent: number;
  pending: number;
  refused: number;
}

function tally(userId: string, sent: number): FlushResult {
  const entries = readOutbox(userId);
  const refused = entries.filter((entry) => entry.refused !== null).length;
  return { sent, pending: entries.length - refused, refused };
}

/**
 * A 4xx the server will give again for the same body. 401 is the session (the client has
 * already signed the person out; signing back in sends it), 408 and 429 are "later" — those
 * stay pending like a lost network.
 */
function isRefusal(caught: unknown): caught is ApiError {
  return (
    caught instanceof ApiError &&
    caught.status >= 400 &&
    caught.status < 500 &&
    caught.status !== 401 &&
    caught.status !== 408 &&
    caught.status !== 429
  );
}

/** Move the active session to the outbox and clear it; then try to flush. */
export async function finishActive(userId: string, now: Date): Promise<FlushResult> {
  const active = readActive(userId);
  if (!active) return tally(userId, 0);
  const body = toCompleteBody(active, now);
  const entry: OutboxEntry = {
    body,
    routine_name: active.routine_name,
    queuedAt: now.toISOString(),
    refused: null,
  };
  // Outbox first, active second: a crash between the two leaves both, and finishing again
  // replaces the entry under the same client_ref rather than adding a second.
  const others = readOutbox(userId).filter((queued) => queued.body.client_ref !== body.client_ref);
  if (writeOutbox(userId, [...others, entry])) {
    writeActive(userId, null);
    return flushOutbox(userId);
  }
  // Storage refused the write. Keep the session where it is and try the server directly,
  // so a full disk never costs the workout.
  try {
    await api.completeWorkout(body);
    writeActive(userId, null);
    return { sent: 1, pending: 0, refused: 0 };
  } catch {
    return { sent: 0, pending: 1, refused: 0 };
  }
}

const flights = new Map<string, Promise<FlushResult>>();

/**
 * Send every pending entry, one at a time, oldest first. Single-flight per user: a second call
 * while one runs returns the running promise. Called on `online`, on app start, on gym open.
 */
export function flushOutbox(userId: string): Promise<FlushResult> {
  const running = flights.get(userId);
  if (running) return running;
  const run = (async () => {
    let sent = 0;
    for (;;) {
      // Re-read every time: the person may have discarded or queued something meanwhile.
      const next = readOutbox(userId).find((entry) => entry.refused === null);
      if (!next) break;
      const ref = next.body.client_ref;
      try {
        await api.completeWorkout(next.body);
        writeOutbox(
          userId,
          readOutbox(userId).filter((entry) => entry.body.client_ref !== ref),
        );
        sent += 1;
      } catch (caught) {
        if (!isRefusal(caught)) break; // no network, a 5xx, a session to sign back into
        const code = caught.code ?? "error";
        writeOutbox(
          userId,
          readOutbox(userId).map((entry) =>
            entry.body.client_ref === ref ? { ...entry, refused: code } : entry,
          ),
        );
      }
    }
    return tally(userId, sent);
  })().finally(() => {
    flights.delete(userId);
  });
  flights.set(userId, run);
  return run;
}

/** Drop a refused entry the person has seen. */
export function discardOutboxEntry(userId: string, clientRef: string): void {
  const entries = readOutbox(userId);
  const kept = entries.filter((entry) => entry.body.client_ref !== clientRef);
  if (kept.length !== entries.length) writeOutbox(userId, kept);
}

/** True when sign-out would lose something: an active session or an outbox entry. */
export function hasUnsentGym(userId: string): boolean {
  return readActive(userId) !== null || readOutbox(userId).length > 0;
}

/** Remove cache, active session and outbox for this user (explicit sign-out). */
export function clearGymStore(userId: string): void {
  generation.set(userId, generationOf(userId) + 1);
  for (const part of [CACHE, ACTIVE, OUTBOX]) writeJson(userId, part, null);
  emit();
}

// --------------------------------------------------------------------- the hook

export interface GymData {
  cache: GymCache;
  active: ActiveSession | null;
  outbox: OutboxEntry[];
  /** True while a refresh is in flight. */
  refreshing: boolean;
  /** True when the last refresh failed for want of a network (not a 4xx). */
  offline: boolean;
  refresh: () => Promise<void>;
  /** Persist and broadcast a new active session (null discards it). */
  setActive: (session: ActiveSession | null) => void;
}

/**
 * The hook the gym page and the dashboard card read. Cache first, then a refresh when the
 * component mounts and when the browser comes back online; also flushes the outbox then.
 */
export function useGymData(): GymData {
  // Optional: a card drawn outside a provider (a test, a preview) simply has no gym to show.
  const userId = useOptionalAuth()?.user?.id ?? null;
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const unsubscribe = subscribe(() => setVersion((count) => count + 1));
    return () => {
      alive.current = false;
      unsubscribe();
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the signal that storage changed
  const cache = useMemo(() => (userId ? readCache(userId) : EMPTY_CACHE), [userId, version]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: same
  const active = useMemo(() => (userId ? readActive(userId) : null), [userId, version]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: same
  const outbox = useMemo(() => (userId ? readOutbox(userId) : []), [userId, version]);

  const refresh = useCallback(async () => {
    if (!userId) return;
    setBusy(true);
    try {
      await flushOutbox(userId);
      await refreshCache(userId);
      if (alive.current) setOffline(false);
    } catch (caught) {
      // A 4xx is the server answering, which is not "offline"; everything else is.
      if (alive.current) setOffline(!(caught instanceof ApiError && caught.status < 500));
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [userId]);

  useEffect(() => {
    void refresh();
    window.addEventListener("online", refresh);
    return () => window.removeEventListener("online", refresh);
  }, [refresh]);

  const setActive = useCallback(
    (session: ActiveSession | null) => {
      if (userId) writeActive(userId, session);
    },
    [userId],
  );

  return { cache, active, outbox, refreshing: busy, offline, refresh, setActive };
}
