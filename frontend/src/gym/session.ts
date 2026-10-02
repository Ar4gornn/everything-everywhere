import type { ExerciseKind, RoutineDetail, WorkoutComplete } from "../api/types";

/**
 * The live session, as a pure model (Epic 42, AD-58).
 *
 * Every function returns a new `ActiveSession`; none touches storage, the clock or the
 * network — the store persists, the page supplies `now`. That is what makes the session
 * testable without a DOM and safe to rebuild after the app is killed mid-set.
 */

/** One exercise of the session, in plan order. Targets copied from the routine at start. */
export interface SessionExercise {
  /** Local id, stable for the session (crypto.randomUUID). */
  key: string;
  /** Null for an exercise coined during the session; then `name` creates it on Finish. */
  exercise_id: string | null;
  name: string;
  kind: ExerciseKind;
  video_url: string | null;
  target_sets: number | null;
  target_reps: number | null;
  target_seconds: number | null;
  target_distance_m: number | null;
  /** Two-place decimal string, in the account's unit, or null. */
  target_weight: string | null;
  rest_seconds: number | null;
  note: string | null;
}

/** One set done. Exactly the measures its kind needs are set; weight is optional. */
export interface SessionSet {
  key: string;
  /** `SessionExercise.key` it belongs to. */
  exercise: string;
  reps: number | null;
  /** Two-place decimal string, or null for bodyweight. */
  weight: string | null;
  duration_seconds: number | null;
  distance_m: number | null;
  /** ISO time it was logged. */
  done_at: string;
}

export interface ActiveSession {
  /** Becomes the workout's client_ref: a replay of Finish never writes twice. */
  client_ref: string;
  routine_id: string | null;
  routine_name: string | null;
  /** ISO date the session counts for (the start day, local). */
  performed_on: string;
  started_at: string;
  note: string;
  exercises: SessionExercise[];
  sets: SessionSet[];
  /** ISO time the current rest ends, or null when not resting. */
  rest_until: string | null;
}

/** What a set needs, prefilled for the next set of `exercise`. */
export interface SetDraft {
  reps: number | null;
  weight: string | null;
  duration_seconds: number | null;
  distance_m: number | null;
}

export function startSession(
  routine: RoutineDetail | null,
  now: Date,
  newId: () => string,
): ActiveSession {
  void routine;
  void now;
  void newId;
  throw new Error("TODO(F1): startSession");
}

export function addExercise(
  session: ActiveSession,
  exercise: { exercise_id: string | null; name: string; kind: ExerciseKind; video_url?: string | null },
  newId: () => string,
): ActiveSession {
  void session;
  void exercise;
  void newId;
  throw new Error("TODO(F1): addExercise");
}

export function removeExercise(session: ActiveSession, key: string): ActiveSession {
  void session;
  void key;
  throw new Error("TODO(F1): removeExercise");
}

/** Prefill: the previous set of this exercise in the session, else its targets. */
export function nextSetDraft(session: ActiveSession, exerciseKey: string): SetDraft {
  void session;
  void exerciseKey;
  throw new Error("TODO(F1): nextSetDraft");
}

/** Throws when the draft lacks the measure the kind requires. Starts the rest timer. */
export function logSet(
  session: ActiveSession,
  exerciseKey: string,
  draft: SetDraft,
  now: Date,
  newId: () => string,
): ActiveSession {
  void session;
  void exerciseKey;
  void draft;
  void now;
  void newId;
  throw new Error("TODO(F1): logSet");
}

export function updateSet(session: ActiveSession, setKey: string, draft: SetDraft): ActiveSession {
  void session;
  void setKey;
  void draft;
  throw new Error("TODO(F1): updateSet");
}

export function removeSet(session: ActiveSession, setKey: string): ActiveSession {
  void session;
  void setKey;
  throw new Error("TODO(F1): removeSet");
}

export function skipRest(session: ActiveSession): ActiveSession {
  void session;
  throw new Error("TODO(F1): skipRest");
}

/** The first exercise whose target sets are not all done, else the last one touched. */
export function currentExercise(session: ActiveSession): string | null {
  void session;
  throw new Error("TODO(F1): currentExercise");
}

export interface Progress {
  exercisesDone: number;
  exercisesTotal: number;
  setsDone: number;
  /** Sum of target_sets where set; exercises without a target count their done sets. */
  setsPlanned: number;
}

export function progress(session: ActiveSession): Progress {
  void session;
  throw new Error("TODO(F1): progress");
}

/** The body for `api.completeWorkout`. Sets in the order they were done. */
export function toCompleteBody(session: ActiveSession, now: Date): WorkoutComplete {
  void session;
  void now;
  throw new Error("TODO(F1): toCompleteBody");
}
