import type {
  Exercise,
  HistoryPoint,
  RoutineDetail,
  Workout,
  WorkoutComplete,
} from "../api/types";
import type { ActiveSession } from "./session";

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

export function readCache(userId: string): GymCache {
  void userId;
  throw new Error("TODO(F1): readCache");
}

export function writeCache(userId: string, cache: GymCache): void {
  void userId;
  void cache;
  throw new Error("TODO(F1): writeCache");
}

/** Fetch routines (full), exercises and recent workouts; merge into the cache. Throws offline. */
export async function refreshCache(userId: string): Promise<GymCache> {
  void userId;
  throw new Error("TODO(F1): refreshCache");
}

export function readActive(userId: string): ActiveSession | null {
  void userId;
  throw new Error("TODO(F1): readActive");
}

/** Null removes it. */
export function writeActive(userId: string, session: ActiveSession | null): void {
  void userId;
  void session;
  throw new Error("TODO(F1): writeActive");
}

export function readOutbox(userId: string): OutboxEntry[] {
  void userId;
  throw new Error("TODO(F1): readOutbox");
}

/** Move the active session to the outbox and clear it; then try to flush. */
export async function finishActive(userId: string, now: Date): Promise<FlushResult> {
  void userId;
  void now;
  throw new Error("TODO(F1): finishActive");
}

export interface FlushResult {
  sent: number;
  pending: number;
  refused: number;
}

/**
 * Send every pending entry, one at a time, oldest first. Single-flight per user: a second call
 * while one runs returns the running promise. Called on `online`, on app start, on gym open.
 */
export async function flushOutbox(userId: string): Promise<FlushResult> {
  void userId;
  throw new Error("TODO(F1): flushOutbox");
}

/** Drop a refused entry the person has seen. */
export function discardOutboxEntry(userId: string, clientRef: string): void {
  void userId;
  void clientRef;
  throw new Error("TODO(F1): discardOutboxEntry");
}

/** True when sign-out would lose something: an active session or an outbox entry. */
export function hasUnsentGym(userId: string): boolean {
  void userId;
  throw new Error("TODO(F1): hasUnsentGym");
}

/** Remove cache, active session and outbox for this user (explicit sign-out). */
export function clearGymStore(userId: string): void {
  void userId;
  throw new Error("TODO(F1): clearGymStore");
}

export function subscribe(listener: () => void): () => void {
  void listener;
  throw new Error("TODO(F1): subscribe");
}

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
  throw new Error("TODO(F1): useGymData");
}
