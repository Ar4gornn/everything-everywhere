import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiError, api } from "../api/client";
import type {
  Exercise,
  HistoryPoint,
  RoutineDetail,
  Workout,
  WorkoutComplete,
  WorkoutDetail,
} from "../api/types";
import { useOptionalAuth } from "../auth/AuthContext";
import { PREFIX } from "../storage";
import { newId } from "./id";
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

/** Where the import review keeps its draft (`pages/gym/GymImport.tsx`), per user. */
export const IMPORT_DRAFT_PREFIX = "everything-everywhere.gym.import.";

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
const RECENT = "recent";
const SENT = "sent";

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
    const [routines, exercises, workouts, recent] = await Promise.all([
      api.listRoutinesFull(),
      api.listExercises(),
      api.listWorkouts({ limit: 20 }),
      // The AI prompt's context; a failure is a prompt without recent sessions, not an error.
      (async () => {
        try {
          return await api.listRecentWorkouts(10);
        } catch {
          return null;
        }
      })(),
    ]);

    const lastDone: Record<string, string> = { ...previous.lastDone };
    for (const workout of workouts) {
      if (workout.rest_day) continue; // a rest day is not a routine done
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
    if (generationOf(userId) === started) {
      if (recent) writeJson(userId, RECENT, recent);
      writeCache(userId, cache);
    }
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

/** The statuses that mean "this body is wrong", and will be said again for the same body. */
const CONTENT_REFUSALS: ReadonlySet<number> = new Set([400, 409, 422]);

/**
 * A refusal the server will give again for the same body: 400, 409 or 422. Everything else
 * stays pending, like a lost network — 401 (sign back in), 404/405 (a server older than the
 * client, or a proxy), 413, 408, 429, 5xx, and any failure of the token-refresh path, none of
 * which says anything about the workout itself. A session must never be parked as "refused"
 * for a fault that a later deploy or a reconnect fixes.
 */
function isRefusal(caught: unknown): caught is ApiError {
  return (
    caught instanceof ApiError &&
    caught.code !== "refresh_failed" &&
    CONTENT_REFUSALS.has(caught.status)
  );
}

/** How long Finish waits for the server before leaving the session queued and moving on. */
export const FINISH_TIMEOUT_MS = 10_000;

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
    // Bounded: on a dead connection the page says "saved on this phone", it does not hang.
    // The flush itself carries on; whatever it does not finish stays pending in the outbox.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<FlushResult>((resolve) => {
      timer = setTimeout(() => resolve(tally(userId, 0)), FINISH_TIMEOUT_MS);
    });
    try {
      return await Promise.race([flushOutbox(userId), timeout]);
    } finally {
      clearTimeout(timer);
    }
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
        const saved = await api.completeWorkout(next.body);
        if (next.body.rest_day && saved?.id) rememberSent(userId, ref, saved.id);
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

/**
 * Let a refused entry try again: clears the refusal and flushes. A person fixes a deploy or
 * a plan, not the workout, so "refused" must never be a dead end.
 */
export function retryOutboxEntry(userId: string, clientRef: string): Promise<FlushResult> {
  writeOutbox(
    userId,
    readOutbox(userId).map((entry) =>
      entry.body.client_ref === clientRef ? { ...entry, refused: null } : entry,
    ),
  );
  return flushOutbox(userId);
}

/** True when sign-out would lose something: an active session or an outbox entry. */
export function hasUnsentGym(userId: string): boolean {
  return readActive(userId) !== null || readOutbox(userId).length > 0;
}

/** Remove cache, active session and outbox for this user (explicit sign-out). */
export function clearGymStore(userId: string): void {
  generation.set(userId, generationOf(userId) + 1);
  for (const part of [CACHE, ACTIVE, OUTBOX, RECENT, SENT]) writeJson(userId, part, null);
  // The import review's draft is a person's file content: it does not outlive the sign-out.
  for (const area of ["sessionStorage", "localStorage"] as const) {
    try {
      window[area].removeItem(`${IMPORT_DRAFT_PREFIX}${userId}`);
    } catch {
      /* no storage */
    }
  }
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

// ------------------------------------------------------------------ Epic 43 (AD-59)

/**
 * The newest sessions with their sets, for the AI prompt's context. Cached beside the gym cache
 * under `gym.<userId>.recent`, refreshed by `refreshCache` (one `api.listRecentWorkouts(10)`),
 * cleared by `clearGymStore`.
 */
export function readRecent(userId: string): WorkoutDetail[] {
  const raw = readJson(userId, RECENT);
  return Array.isArray(raw) ? raw.filter((entry): entry is WorkoutDetail => isRecord(entry)) : [];
}

/** True when the cache already holds a rest day on `date` (ISO). */
export function hasRestDay(userId: string, date: string): boolean {
  return (
    readCache(userId).workouts.some((workout) => workout.rest_day && workout.performed_on === date) ||
    readOutbox(userId).some((entry) => entry.body.rest_day === true && entry.body.performed_on === date)
  );
}

/** client_ref → the workout id the server answered, kept so an Undo can delete a sent rest day. */
function readSent(userId: string): Record<string, string> {
  const raw = readJson(userId, SENT);
  return isRecord(raw) ? (raw as Record<string, string>) : {};
}

function rememberSent(userId: string, clientRef: string, workoutId: string): void {
  const sent = readSent(userId);
  // A handful at most: only the newest few matter to an Undo that lasts seconds.
  const kept = Object.entries(sent).slice(-9);
  writeJson(userId, SENT, Object.fromEntries([...kept, [clientRef, workoutId]]));
}

/** The cached workout a rest day stands for until the server's own row replaces it. */
const restWorkoutId = (clientRef: string) => `pending-${clientRef}`;

/**
 * Log a rest day for `date` through the outbox (works offline), add it to the cached workouts
 * at once so the UI updates, then flush. Returns the client_ref, for an Undo that discards it
 * while it is still pending (or deletes the workout once sent).
 */
export async function logRestDay(userId: string, date: string, now: Date): Promise<string> {
  const existing = readOutbox(userId).find(
    (entry) => entry.body.rest_day === true && entry.body.performed_on === date,
  );
  if (existing) return existing.body.client_ref;
  const clientRef = newId();
  const entry: OutboxEntry = {
    body: { client_ref: clientRef, performed_on: date, rest_day: true, sets: [] },
    routine_name: null,
    queuedAt: now.toISOString(),
    refused: null,
  };
  writeOutbox(userId, [...readOutbox(userId), entry]);
  const cache = readCache(userId);
  if (!cache.workouts.some((workout) => workout.rest_day && workout.performed_on === date)) {
    const optimistic: Workout = {
      id: restWorkoutId(clientRef),
      routine_id: null,
      performed_on: date,
      started_at: null,
      ended_at: null,
      rest_day: true,
      note: null,
      created_at: now.toISOString(),
    };
    writeCache(userId, { ...cache, workouts: [optimistic, ...cache.workouts] });
  }
  await flushOutbox(userId);
  return clientRef;
}

/** Undo a rest day logged moments ago: drop it from the outbox, or delete it on the server. */
export async function undoRestDay(userId: string, clientRef: string): Promise<void> {
  const pending = readOutbox(userId).some((entry) => entry.body.client_ref === clientRef);
  const dropOptimistic = (serverId?: string) => {
    const cache = readCache(userId);
    writeCache(userId, {
      ...cache,
      workouts: cache.workouts.filter(
        (workout) => workout.id !== restWorkoutId(clientRef) && workout.id !== serverId,
      ),
    });
  };
  if (pending) {
    discardOutboxEntry(userId, clientRef);
    dropOptimistic();
    return;
  }
  const serverId = readSent(userId)[clientRef];
  if (!serverId) {
    // Sent in another tab or before this version: nothing to delete by id; drop the stub only.
    dropOptimistic();
    return;
  }
  await api.deleteWorkout(serverId);
  dropOptimistic(serverId);
}
