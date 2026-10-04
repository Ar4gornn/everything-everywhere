import type {
  ExerciseKind,
  RoutineDetail,
  SetInput,
  SetTarget,
  WorkoutComplete,
} from "../api/types";
import { todayIso } from "../months";
import { FIELD_RANGES, MAX_SETS_PER_WORKOUT } from "./format";

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
  /** Rest after the last target set, before the next exercise (Epic 43). */
  rest_after_seconds: number | null;
  note: string | null;
  /** Epic 54: per-set targets; null = every set uses the flat target. Absent in old stored sessions. */
  set_targets: SetTarget[] | null;
  target_rpe: number | null;
  target_rir: number | null;
  tempo: string | null;
  /** Consecutive exercises sharing a non-null group alternate set by set (a superset). */
  superset_group: number | null;
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
  /** Epic 54: a warm-up set (from its target); excluded from volume and records server-side. */
  is_warmup: boolean;
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


/** Seconds of rest when the line names none: a set of reps needs more than a timed one. */
const DEFAULT_REST: Record<ExerciseKind, number> = { reps: 90, duration: 60, distance: 60 };

const EMPTY_DRAFT: SetDraft = { reps: null, weight: null, duration_seconds: null, distance_m: null };

export function startSession(
  routine: RoutineDetail | null,
  now: Date,
  newId: () => string,
): ActiveSession {
  const lines = routine ? [...routine.lines].sort((a, b) => a.position - b.position) : [];
  return {
    client_ref: newId(),
    routine_id: routine?.id ?? null,
    routine_name: routine?.name ?? null,
    // The local day the session began, so a workout that crosses midnight stays on the day
    // it was started (and the same helper the rest of the app uses for "today").
    performed_on: todayIso(now),
    started_at: now.toISOString(),
    note: "",
    exercises: lines.map((line) => ({
      key: newId(),
      exercise_id: line.exercise_id,
      name: line.exercise_name,
      kind: line.kind,
      video_url: line.video_url,
      target_sets: line.target_sets,
      target_reps: line.target_reps,
      target_seconds: line.target_seconds,
      target_distance_m: line.target_distance_m,
      target_weight: line.target_weight,
      rest_seconds: line.rest_seconds,
      rest_after_seconds: line.rest_after_seconds ?? null,
      note: line.note,
      set_targets: line.set_targets ?? null,
      target_rpe: line.target_rpe ?? null,
      target_rir: line.target_rir ?? null,
      tempo: line.tempo ?? null,
      superset_group: line.superset_group ?? null,
    })),
    sets: [],
    rest_until: null,
  };
}

export function addExercise(
  session: ActiveSession,
  exercise: {
    exercise_id: string | null;
    name: string;
    kind: ExerciseKind;
    video_url?: string | null;
  },
  newId: () => string,
): ActiveSession {
  const added: SessionExercise = {
    key: newId(),
    exercise_id: exercise.exercise_id,
    name: exercise.name,
    kind: exercise.kind,
    video_url: exercise.video_url ?? null,
    target_sets: null,
    target_reps: null,
    target_seconds: null,
    target_distance_m: null,
    target_weight: null,
    rest_seconds: null,
    rest_after_seconds: null,
    note: null,
    set_targets: null,
    target_rpe: null,
    target_rir: null,
    tempo: null,
    superset_group: null,
  };
  return { ...session, exercises: [...session.exercises, added] };
}

export function removeExercise(session: ActiveSession, key: string): ActiveSession {
  return {
    ...session,
    exercises: session.exercises.filter((exercise) => exercise.key !== key),
    sets: session.sets.filter((set) => set.exercise !== key),
  };
}

const exerciseOf = (session: ActiveSession, key: string) =>
  session.exercises.find((exercise) => exercise.key === key);

/** Only the measure the kind is counted in is kept; weight rides along for every kind. */
function shaped(kind: ExerciseKind, draft: SetDraft): SetDraft {
  return {
    reps: kind === "reps" ? draft.reps : null,
    weight: draft.weight,
    duration_seconds: kind === "duration" ? draft.duration_seconds : null,
    distance_m: kind === "distance" ? draft.distance_m : null,
  };
}

function hasMeasure(kind: ExerciseKind, draft: SetDraft): boolean {
  const value =
    kind === "reps" ? draft.reps : kind === "duration" ? draft.duration_seconds : draft.distance_m;
  return value !== null && Number.isFinite(value) && value > 0;
}

const within = (value: number, [low, high]: readonly [number, number]) =>
  Number.isFinite(value) && value >= low && value <= high;

const wholeWithin = (value: number | null, range: readonly [number, number]) =>
  value === null || (Number.isInteger(value) && within(value, range));

/** The server's bounds: whole numbers for the measures, a weight of 0 to 99 999.99. */
function inRange(kind: ExerciseKind, draft: SetDraft): boolean {
  if (kind === "reps" && !wholeWithin(draft.reps, FIELD_RANGES.reps)) return false;
  if (kind === "duration" && !wholeWithin(draft.duration_seconds, FIELD_RANGES.seconds)) return false;
  if (kind === "distance" && !wholeWithin(draft.distance_m, FIELD_RANGES.distance_m)) return false;
  return draft.weight === null || within(Number(draft.weight), FIELD_RANGES.weight);
}

/**
 * The target of the next set of an exercise with per-set targets: `set_targets[n]`, n = sets
 * done, the last one beyond the list. Null when the exercise has none (flat targets apply).
 */
export function targetForNext(session: ActiveSession, exerciseKey: string): SetTarget | null {
  const exercise = exerciseOf(session, exerciseKey);
  const list = exercise?.set_targets;
  if (!list || list.length === 0) return null;
  return list[Math.min(setsOf(session, exerciseKey), list.length - 1)] ?? null;
}

/** Prefill: the set's own target when the exercise has per-set targets, else the previous set, else the flat targets. */
export function nextSetDraft(session: ActiveSession, exerciseKey: string): SetDraft {
  const exercise = exerciseOf(session, exerciseKey);
  if (!exercise) return { ...EMPTY_DRAFT };
  const planned = targetForNext(session, exerciseKey);
  if (planned) {
    return shaped(exercise.kind, {
      reps: planned.reps,
      weight: planned.weight,
      duration_seconds: planned.seconds,
      distance_m: planned.distance_m,
    });
  }
  const previous = [...session.sets].reverse().find((set) => set.exercise === exerciseKey);
  if (previous) {
    return shaped(exercise.kind, {
      reps: previous.reps,
      weight: previous.weight,
      duration_seconds: previous.duration_seconds,
      distance_m: previous.distance_m,
    });
  }
  return shaped(exercise.kind, {
    reps: exercise.target_reps,
    weight: exercise.target_weight,
    duration_seconds: exercise.target_seconds,
    distance_m: exercise.target_distance_m,
  });
}

/** Throws when the draft lacks the measure the kind requires. Starts the rest timer. */
export function logSet(
  session: ActiveSession,
  exerciseKey: string,
  draft: SetDraft,
  now: Date,
  newId: () => string,
): ActiveSession {
  const exercise = exerciseOf(session, exerciseKey);
  if (!exercise) throw new Error("unknown_exercise");
  if (!hasMeasure(exercise.kind, draft)) throw new Error("set_missing_measure");
  if (!inRange(exercise.kind, draft)) throw new Error("set_out_of_range");
  if (session.sets.length >= MAX_SETS_PER_WORKOUT) throw new Error("too_many_sets");
  const { seconds: rest } = restAfterSet(session, exerciseKey);
  const is_warmup = targetForNext(session, exerciseKey)?.warmup === true;
  return {
    ...session,
    sets: [
      ...session.sets,
      {
        key: newId(),
        exercise: exerciseKey,
        ...shaped(exercise.kind, draft),
        done_at: now.toISOString(),
        is_warmup,
      },
    ],
    rest_until: rest > 0 ? new Date(now.getTime() + rest * 1000).toISOString() : null,
  };
}

export function updateSet(session: ActiveSession, setKey: string, draft: SetDraft): ActiveSession {
  const target = session.sets.find((set) => set.key === setKey);
  const exercise = target ? exerciseOf(session, target.exercise) : undefined;
  if (!target || !exercise) return session;
  if (!hasMeasure(exercise.kind, draft)) throw new Error("set_missing_measure");
  if (!inRange(exercise.kind, draft)) throw new Error("set_out_of_range");
  return {
    ...session,
    sets: session.sets.map((set) =>
      set.key === setKey ? { ...set, ...shaped(exercise.kind, draft) } : set,
    ),
  };
}

export function removeSet(session: ActiveSession, setKey: string): ActiveSession {
  return { ...session, sets: session.sets.filter((set) => set.key !== setKey) };
}

export function skipRest(session: ActiveSession): ActiveSession {
  return { ...session, rest_until: null };
}

const setsOf = (session: ActiveSession, key: string) =>
  session.sets.filter((set) => set.exercise === key).length;

/** An exercise with a target is done at that many sets; one without, at its first. */
const isDone = (session: ActiveSession, exercise: SessionExercise) =>
  setsOf(session, exercise.key) >= (exercise.target_sets ?? 1);

/**
 * The exercises that alternate with `key`: the run of consecutive exercises sharing its
 * non-null `superset_group`, in plan order. A lone exercise is its own single member.
 */
export function supersetMembers(session: ActiveSession, key: string): SessionExercise[] {
  const index = session.exercises.findIndex((exercise) => exercise.key === key);
  const exercise = session.exercises[index];
  if (!exercise) return [];
  const group = exercise.superset_group;
  if (group === null || group === undefined) return [exercise];
  let from = index;
  let to = index;
  while (session.exercises[from - 1]?.superset_group === group) from -= 1;
  while (session.exercises[to + 1]?.superset_group === group) to += 1;
  return session.exercises.slice(from, to + 1);
}

/** The first exercise whose target sets are not all done, else the last one touched. */
export function currentExercise(session: ActiveSession): string | null {
  const open = session.exercises.find((exercise) => !isDone(session, exercise));
  if (open) {
    // A superset alternates: the member with sets left and the fewest done (earliest on a tie),
    // so A, B, A, B and an uneven A, B, A come out right without remembering who went last.
    const members = supersetMembers(session, open.key).filter(
      (member) => !isDone(session, member),
    );
    let pick = open;
    for (const member of members) {
      if (setsOf(session, member.key) < setsOf(session, pick.key)) pick = member;
    }
    return pick.key;
  }
  const lastSet = session.sets[session.sets.length - 1];
  if (lastSet && exerciseOf(session, lastSet.exercise)) return lastSet.exercise;
  return session.exercises[session.exercises.length - 1]?.key ?? null;
}

export interface Progress {
  exercisesDone: number;
  exercisesTotal: number;
  setsDone: number;
  /** Sum of target_sets where set; exercises without a target count their done sets. */
  setsPlanned: number;
}

export function progress(session: ActiveSession): Progress {
  let exercisesDone = 0;
  let setsPlanned = 0;
  for (const exercise of session.exercises) {
    if (isDone(session, exercise)) exercisesDone += 1;
    setsPlanned += exercise.target_sets ?? setsOf(session, exercise.key);
  }
  return {
    exercisesDone,
    exercisesTotal: session.exercises.length,
    setsDone: session.sets.length,
    setsPlanned,
  };
}

/** The body for the complete-workout call. Sets in the order they were done. */
export function toCompleteBody(session: ActiveSession, now: Date): WorkoutComplete {
  const sets: SetInput[] = [];
  for (const done of session.sets) {
    const exercise = exerciseOf(session, done.exercise);
    // A set whose exercise was removed cannot happen through `removeExercise`; skipping it
    // here keeps a hand-damaged stored session from failing the whole Finish.
    if (!exercise) continue;
    const out: SetInput =
      exercise.exercise_id !== null
        ? { exercise_id: exercise.exercise_id }
        : { exercise_name: exercise.name, kind: exercise.kind };
    if (done.reps !== null) out.reps = done.reps;
    if (done.weight !== null) out.weight = done.weight;
    if (done.duration_seconds !== null) out.duration_seconds = done.duration_seconds;
    if (done.distance_m !== null) out.distance_m = done.distance_m;
    if (done.is_warmup === true) out.is_warmup = true;
    sets.push(out);
  }
  const started = new Date(session.started_at);
  // A clock that went backwards must not make the server refuse the whole session
  // (ended_at ≥ started_at is a CHECK).
  const ended = now.getTime() < started.getTime() ? started : now;
  const body: WorkoutComplete = {
    client_ref: session.client_ref,
    performed_on: session.performed_on,
    started_at: session.started_at,
    ended_at: ended.toISOString(),
    sets,
  };
  if (session.routine_id !== null) body.routine_id = session.routine_id;
  if (session.note.trim() !== "") body.note = session.note.trim();
  return body;
}

// ------------------------------------------------------------------ Epic 43 (AD-59)

/** Start a rest of `seconds` now, whatever the person is doing — the standalone rest timer. */
export function startRest(session: ActiveSession, seconds: number, now: Date): ActiveSession {
  if (!Number.isFinite(seconds) || seconds <= 0) return { ...session, rest_until: null };
  const capped = Math.min(Math.floor(seconds), FIELD_RANGES.rest_seconds[1]);
  return { ...session, rest_until: new Date(now.getTime() + capped * 1000).toISOString() };
}

/** Add `seconds` to a running rest (the "+15 s" button). No rest running → unchanged. */
export function extendRest(session: ActiveSession, seconds: number, now: Date): ActiveSession {
  if (session.rest_until === null) return session;
  const end = new Date(session.rest_until).getTime();
  // A rest that already ran out is not "running": extending it counts from now.
  if (!Number.isFinite(end) || end <= now.getTime()) return session;
  return { ...session, rest_until: new Date(end + seconds * 1000).toISOString() };
}

/**
 * The rest `logSet` will start for the next set of this exercise: `rest_after_seconds` when
 * that set completes the exercise's target sets and there is a next exercise, else the per-set
 * rest, else the kind's default. Exposed so the page can label it ("Rest before {next}").
 */
export function restAfterSet(
  session: ActiveSession,
  exerciseKey: string,
): { seconds: number; beforeNext: string | null } {
  const index = session.exercises.findIndex((exercise) => exercise.key === exerciseKey);
  const exercise = session.exercises[index];
  if (!exercise) return { seconds: 0, beforeNext: null };
  const perSet = exercise.rest_seconds ?? DEFAULT_REST[exercise.kind];
  const members = supersetMembers(session, exerciseKey);
  if (members.length > 1) {
    const limit = (member: SessionExercise) => member.target_sets ?? 1;
    const round = setsOf(session, exerciseKey);
    // Someone in the group still owes a set of this round: no rest between members.
    const owes = members.some(
      (member) =>
        member.key !== exerciseKey &&
        limit(member) > round &&
        setsOf(session, member.key) <= round,
    );
    if (owes) return { seconds: 0, beforeNext: null };
    const groupDone = members.every((member) =>
      member.key === exerciseKey
        ? round + 1 >= limit(member)
        : setsOf(session, member.key) >= limit(member),
    );
    const last = members[members.length - 1] as SessionExercise;
    if (groupDone && last.rest_after_seconds != null) {
      const lastIndex = session.exercises.findIndex((other) => other.key === last.key);
      const next = session.exercises.slice(lastIndex + 1).find((other) => !isDone(session, other));
      if (next) return { seconds: last.rest_after_seconds, beforeNext: next.name };
    }
    return { seconds: perSet, beforeNext: null };
  }
  const completes =
    exercise.target_sets !== null && setsOf(session, exerciseKey) + 1 >= exercise.target_sets;
  if (completes && exercise.rest_after_seconds != null) {
    const next = session.exercises.slice(index + 1).find((other) => !isDone(session, other));
    if (next) return { seconds: exercise.rest_after_seconds, beforeNext: next.name };
  }
  return { seconds: perSet, beforeNext: null };
}

/** A line of the quick builder (Epic 43 §7.2), before it is a routine or a session. */
export interface BuilderLine {
  exercise_id: string | null;
  name: string;
  kind: import("../api/types").ExerciseKind;
  sets: number;
  reps: number | null;
  seconds: number | null;
  distance_m: number | null;
  /** Two-place decimal string, or null. */
  weight: string | null;
}

/** Start a session straight from builder lines — offline, or when not saved as a routine. */
export function sessionFromLines(
  name: string,
  lines: BuilderLine[],
  now: Date,
  newId: () => string,
): ActiveSession {
  return {
    client_ref: newId(),
    routine_id: null,
    routine_name: name.trim() === "" ? null : name.trim(),
    performed_on: todayIso(now),
    started_at: now.toISOString(),
    note: "",
    exercises: lines.map((line) => ({
      key: newId(),
      exercise_id: line.exercise_id,
      name: line.name,
      kind: line.kind,
      video_url: null,
      target_sets: line.sets,
      target_reps: line.kind === "reps" ? line.reps : null,
      target_seconds: line.kind === "duration" ? line.seconds : null,
      target_distance_m: line.kind === "distance" ? line.distance_m : null,
      target_weight: line.weight,
      rest_seconds: null,
      rest_after_seconds: null,
      note: null,
      set_targets: null,
      target_rpe: null,
      target_rir: null,
      tempo: null,
      superset_group: null,
    })),
    sets: [],
    rest_until: null,
  };
}
