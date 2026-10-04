import { describe, expect, it } from "vitest";

import type { RoutineDetail, RoutineLine, SetTarget } from "../api/types";
import {
  addExercise,
  currentExercise,
  logSet,
  nextSetDraft,
  progress,
  removeExercise,
  extendRest,
  removeSet,
  restAfterSet,
  sessionFromLines,
  skipRest,
  startRest,
  startSession,
  supersetMembers,
  toCompleteBody,
  updateSet,
  type ActiveSession,
  type SetDraft,
} from "./session";

/** Deterministic ids: id-1, id-2, … */
function ids() {
  let n = 0;
  return () => `id-${++n}`;
}

const NOW = new Date("2031-03-04T10:00:00Z");
const later = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);

function line(over: Partial<RoutineLine> & Pick<RoutineLine, "id" | "exercise_name" | "kind" | "position">): RoutineLine {
  return {
    exercise_id: `ex-${over.id}`,
    video_url: null,
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
    ...over,
  };
}

const ROUTINE: RoutineDetail = {
  id: "r1",
  name: "Push",
  note: null,
  lines: [
    line({ id: "b", exercise_name: "Plank", kind: "duration", position: 2, target_sets: 2, target_seconds: 45 }),
    line({ id: "a", exercise_name: "Bench", kind: "reps", position: 1, target_sets: 2, target_reps: 8, target_weight: "60.00" }),
    line({ id: "c", exercise_name: "Row", kind: "distance", position: 3, target_distance_m: 2000, rest_seconds: 0 }),
  ],
};

const reps = (n: number, weight: string | null = null): SetDraft => ({
  reps: n,
  weight,
  duration_seconds: null,
  distance_m: null,
});

function started(): ActiveSession {
  return startSession(ROUTINE, NOW, ids());
}

describe("starting", () => {
  it("copies the routine in plan order with its targets", () => {
    const session = started();
    expect(session.routine_id).toBe("r1");
    expect(session.routine_name).toBe("Push");
    expect(session.exercises.map((e) => e.name)).toEqual(["Bench", "Plank", "Row"]);
    expect(session.exercises[0]).toMatchObject({ exercise_id: "ex-a", kind: "reps", target_reps: 8, target_weight: "60.00" });
    expect(session.sets).toEqual([]);
    expect(session.rest_until).toBeNull();
    expect(new Set([session.client_ref, ...session.exercises.map((e) => e.key)]).size).toBe(4);
  });

  it("starts empty with no routine", () => {
    const session = startSession(null, NOW, ids());
    expect(session).toMatchObject({ routine_id: null, routine_name: null, exercises: [], started_at: NOW.toISOString() });
  });

  it("counts the session for the local day it started", () => {
    const evening = new Date(2031, 2, 4, 23, 30); // local time
    expect(startSession(null, evening, ids()).performed_on).toBe("2031-03-04");
  });
});

describe("prefilling the next set", () => {
  it("uses the targets first", () => {
    const session = started();
    const [bench, plank, row] = session.exercises;
    expect(nextSetDraft(session, bench!.key)).toEqual({ reps: 8, weight: "60.00", duration_seconds: null, distance_m: null });
    expect(nextSetDraft(session, plank!.key)).toMatchObject({ reps: null, duration_seconds: 45 });
    expect(nextSetDraft(session, row!.key)).toMatchObject({ distance_m: 2000 });
  });

  it("then the previous set of the same exercise, not another exercise's", () => {
    let session = started();
    const [bench, plank] = session.exercises;
    const newId = ids();
    session = logSet(session, bench!.key, reps(6, "62.50"), NOW, newId);
    expect(nextSetDraft(session, bench!.key)).toMatchObject({ reps: 6, weight: "62.50" });
    expect(nextSetDraft(session, plank!.key)).toMatchObject({ duration_seconds: 45, reps: null });
  });

  it("is empty for an unknown exercise or one with no target", () => {
    const session = addExercise(started(), { exercise_id: null, name: "Curl", kind: "reps" }, ids());
    const curl = session.exercises[3]!;
    expect(nextSetDraft(session, curl.key)).toEqual({ reps: null, weight: null, duration_seconds: null, distance_m: null });
    expect(nextSetDraft(session, "nope")).toEqual({ reps: null, weight: null, duration_seconds: null, distance_m: null });
  });
});

describe("logging sets", () => {
  it("refuses a set without the measure its kind needs", () => {
    const session = started();
    const [bench, plank, row] = session.exercises;
    const empty: SetDraft = { reps: null, weight: "60.00", duration_seconds: null, distance_m: null };
    expect(() => logSet(session, bench!.key, empty, NOW, ids())).toThrow("set_missing_measure");
    // reps on a duration exercise is not its measure
    expect(() => logSet(session, plank!.key, reps(8), NOW, ids())).toThrow("set_missing_measure");
    expect(() => logSet(session, row!.key, reps(8), NOW, ids())).toThrow("set_missing_measure");
    expect(() => logSet(session, bench!.key, reps(0), NOW, ids())).toThrow("set_missing_measure");
    expect(() => logSet(session, "nope", reps(5), NOW, ids())).toThrow();
  });

  it("keeps only the kind's measure and the weight", () => {
    const session = started();
    const plank = session.exercises[1]!;
    const messy: SetDraft = { reps: 9, weight: "5.00", duration_seconds: 40, distance_m: 100 };
    const after = logSet(session, plank.key, messy, NOW, ids());
    expect(after.sets[0]).toMatchObject({ reps: null, weight: "5.00", duration_seconds: 40, distance_m: null, done_at: NOW.toISOString() });
  });

  it("starts the rest: the line's, else 90 s for reps and 60 s otherwise", () => {
    const session = started();
    const [bench, plank, row] = session.exercises;
    expect(logSet(session, bench!.key, reps(8), NOW, ids()).rest_until).toBe(later(90).toISOString());
    expect(
      logSet(session, plank!.key, { reps: null, weight: null, duration_seconds: 45, distance_m: null }, NOW, ids()).rest_until,
    ).toBe(later(60).toISOString());
    // the Row line says 0: no rest at all
    expect(
      logSet(session, row!.key, { reps: null, weight: null, duration_seconds: null, distance_m: 500 }, NOW, ids()).rest_until,
    ).toBeNull();
  });

  it("does not change the session it was given", () => {
    const session = started();
    const frozen = JSON.stringify(session);
    logSet(session, session.exercises[0]!.key, reps(8), NOW, ids());
    expect(JSON.stringify(session)).toBe(frozen);
  });

  it("skips rest", () => {
    const session = started();
    const after = logSet(session, session.exercises[0]!.key, reps(8), NOW, ids());
    expect(skipRest({ ...after, rest_until: later(90).toISOString() }).rest_until).toBeNull();
  });
});

describe("editing", () => {
  function withSet() {
    const session = started();
    const bench = session.exercises[0]!;
    const next = logSet(session, bench.key, reps(8, "60.00"), NOW, ids());
    return { session: next, setKey: next.sets[0]!.key, bench };
  }

  it("updates a set in place, keeping its place and time", () => {
    const { session, setKey } = withSet();
    const after = updateSet(session, setKey, reps(10, "65.00"));
    expect(after.sets[0]).toMatchObject({ key: setKey, reps: 10, weight: "65.00", done_at: NOW.toISOString() });
  });

  it("refuses an update that empties the measure", () => {
    const { session, setKey } = withSet();
    expect(() => updateSet(session, setKey, reps(0))).toThrow("set_missing_measure");
  });

  it("ignores an update of a set that is gone", () => {
    const { session } = withSet();
    expect(updateSet(session, "ghost", reps(5))).toBe(session);
  });

  it("removes a set", () => {
    const { session, setKey } = withSet();
    expect(removeSet(session, setKey).sets).toEqual([]);
  });

  it("removing an exercise removes its sets and no one else's", () => {
    let { session, bench } = withSet();
    const plank = session.exercises[1]!;
    session = logSet(session, plank.key, { reps: null, weight: null, duration_seconds: 30, distance_m: null }, NOW, ids());
    const after = removeExercise(session, bench.key);
    expect(after.exercises.map((e) => e.name)).toEqual(["Plank", "Row"]);
    expect(after.sets).toHaveLength(1);
    expect(after.sets[0]?.exercise).toBe(plank.key);
  });

  it("adds an exercise coined during the session", () => {
    const session = addExercise(started(), { exercise_id: null, name: "Curl", kind: "reps" }, ids());
    expect(session.exercises[3]).toMatchObject({ name: "Curl", exercise_id: null, target_sets: null, video_url: null });
  });
});

describe("where the person is", () => {
  it("points at the first exercise with sets left, then the last one touched", () => {
    let session = started();
    const [bench, plank, row] = session.exercises;
    const newId = ids();
    expect(currentExercise(session)).toBe(bench!.key);
    session = logSet(session, bench!.key, reps(8), NOW, newId);
    expect(currentExercise(session)).toBe(bench!.key); // 1 of 2
    session = logSet(session, bench!.key, reps(8), NOW, newId);
    expect(currentExercise(session)).toBe(plank!.key);
    const timed: SetDraft = { reps: null, weight: null, duration_seconds: 45, distance_m: null };
    session = logSet(session, plank!.key, timed, NOW, newId);
    session = logSet(session, plank!.key, timed, NOW, newId);
    // Row has no target: one set finishes it
    expect(currentExercise(session)).toBe(row!.key);
    session = logSet(session, row!.key, { reps: null, weight: null, duration_seconds: null, distance_m: 2000 }, NOW, newId);
    expect(currentExercise(session)).toBe(row!.key); // all done: the last touched
  });

  it("is null with no exercises", () => {
    expect(currentExercise(startSession(null, NOW, ids()))).toBeNull();
  });

  it("counts progress, with untargeted exercises counting what they have done", () => {
    let session = started();
    const [bench, , row] = session.exercises;
    expect(progress(session)).toEqual({ exercisesDone: 0, exercisesTotal: 3, setsDone: 0, setsPlanned: 4 });
    const newId = ids();
    session = logSet(session, bench!.key, reps(8), NOW, newId);
    session = logSet(session, bench!.key, reps(8), NOW, newId);
    session = logSet(session, row!.key, { reps: null, weight: null, duration_seconds: null, distance_m: 2000 }, NOW, newId);
    session = logSet(session, row!.key, { reps: null, weight: null, duration_seconds: null, distance_m: 2000 }, NOW, newId);
    expect(progress(session)).toEqual({ exercisesDone: 2, exercisesTotal: 3, setsDone: 4, setsPlanned: 2 + 2 + 2 });
  });
});

describe("finishing", () => {
  it("builds the body: ids for known exercises, name and kind for coined ones, in order", () => {
    let session = started();
    const newId = ids();
    session = addExercise(session, { exercise_id: null, name: "Curl", kind: "reps" }, newId);
    const [bench, plank, , curl] = session.exercises;
    session = logSet(session, bench!.key, reps(8, "60.00"), NOW, newId);
    session = logSet(session, curl!.key, reps(12), NOW, newId);
    session = logSet(session, plank!.key, { reps: null, weight: null, duration_seconds: 45, distance_m: null }, NOW, newId);
    session = { ...session, note: "  felt good " };
    const body = toCompleteBody(session, later(3600));
    expect(body).toEqual({
      client_ref: session.client_ref,
      routine_id: "r1",
      performed_on: session.performed_on,
      started_at: NOW.toISOString(),
      ended_at: later(3600).toISOString(),
      note: "felt good",
      sets: [
        { exercise_id: "ex-a", reps: 8, weight: "60.00" },
        { exercise_name: "Curl", kind: "reps", reps: 12 },
        { exercise_id: "ex-b", duration_seconds: 45 },
      ],
    });
  });

  it("omits a missing routine and an empty note, and may have no sets", () => {
    const body = toCompleteBody(startSession(null, NOW, ids()), later(60));
    expect(body.routine_id).toBeUndefined();
    expect(body.note).toBeUndefined();
    expect(body.sets).toEqual([]);
  });

  it("never ends before it started", () => {
    const body = toCompleteBody(started(), later(-600));
    expect(body.ended_at).toBe(NOW.toISOString());
  });

  it("keeps the same client_ref however often it is built", () => {
    const session = started();
    expect(toCompleteBody(session, later(1)).client_ref).toBe(toCompleteBody(session, later(99)).client_ref);
  });
});

describe("the server's caps, held on the phone", () => {
  const start = () => startSession(ROUTINE, NOW, ids());
  const bench = (s: ActiveSession) => s.exercises.find((e) => e.kind === "reps")!.key;
  const plank = (s: ActiveSession) => s.exercises.find((e) => e.kind === "duration")!.key;
  const draft = (over: Partial<SetDraft>): SetDraft => ({ reps: null, weight: null, duration_seconds: null, distance_m: null, ...over });

  it.each([
    ["reps over 999", { reps: 1000 }],
    ["reps that are not whole", { reps: 2.5 }],
    ["a weight over 99999.99", { reps: 5, weight: "100000.00" }],
    ["a negative weight", { reps: 5, weight: "-1.00" }],
  ])("logSet refuses %s", (_name, over) => {
    const s = start();
    expect(() => logSet(s, bench(s), draft(over), NOW, ids())).toThrow("set_out_of_range");
  });

  it("refuses seconds over 86400 and accepts the bounds", () => {
    const s = start();
    expect(() => logSet(s, plank(s), draft({ duration_seconds: 86_401 }), NOW, ids())).toThrow("set_out_of_range");
    expect(logSet(s, plank(s), draft({ duration_seconds: 86_400 }), NOW, ids()).sets).toHaveLength(1);
    expect(logSet(s, bench(s), draft({ reps: 999, weight: "99999.99" }), NOW, ids()).sets).toHaveLength(1);
  });

  it("updateSet refuses an out-of-range edit", () => {
    const s = logSet(start(), bench(start()), draft({ reps: 5 }), NOW, ids());
    const key = s.sets[0]!.key;
    expect(() => updateSet(s, key, draft({ reps: 1000 }))).toThrow("set_out_of_range");
  });

  it("refuses a 501st set", () => {
    let s = start();
    const key = bench(s);
    for (let i = 0; i < 500; i += 1) s = logSet(s, key, draft({ reps: 5 }), NOW, ids());
    expect(s.sets).toHaveLength(500);
    expect(() => logSet(s, key, draft({ reps: 5 }), NOW, ids())).toThrow("too_many_sets");
  });
});

describe("rest between exercises and the standalone timer (Epic 43)", () => {
  const withRest = (): ActiveSession => {
    const session = started();
    // Bench: 2 sets, default rest 90, 150 after the exercise. Plank next.
    return {
      ...session,
      exercises: session.exercises.map((e) => (e.name === "Bench" ? { ...e, rest_after_seconds: 150 } : e)),
    };
  };
  const bench = (s: ActiveSession) => s.exercises[0]!.key;
  const restSeconds = (s: ActiveSession, from: Date) =>
    (new Date(s.rest_until as string).getTime() - from.getTime()) / 1000;

  it("copies rest_after_seconds from the routine line", () => {
    const routine: RoutineDetail = {
      ...ROUTINE,
      lines: [line({ id: "a", exercise_name: "Bench", kind: "reps", position: 1, rest_after_seconds: 120 })],
    };
    expect(startSession(routine, NOW, ids()).exercises[0]?.rest_after_seconds).toBe(120);
  });

  it("uses the per-set rest until the last target set, then rest_after_seconds", () => {
    let session = withRest();
    expect(restAfterSet(session, bench(session))).toEqual({ seconds: 90, beforeNext: null });
    session = logSet(session, bench(session), reps(8), NOW, ids());
    expect(restSeconds(session, NOW)).toBe(90);
    expect(restAfterSet(session, bench(session))).toEqual({ seconds: 150, beforeNext: "Plank" });
    session = logSet(session, bench(session), reps(8), later(100), ids());
    expect(restSeconds(session, later(100))).toBe(150);
  });

  it("falls back to the per-set rest when there is no next exercise or no after-rest", () => {
    const session = withRest();
    const alone = { ...session, exercises: session.exercises.slice(0, 1), sets: [] };
    const lastSet = logSet(alone, bench(alone), reps(8), NOW, ids());
    expect(restAfterSet(lastSet, bench(lastSet))).toEqual({ seconds: 90, beforeNext: null });
    const plank = session.exercises[1]!;
    expect(restAfterSet(session, plank.key)).toEqual({ seconds: 60, beforeNext: null });
  });

  it("a session saved before rest_after_seconds existed rests like one with none", () => {
    const session = withRest();
    const old = {
      ...session,
      exercises: session.exercises.map((e) => {
        const { rest_after_seconds: _gone, ...rest } = e;
        return rest as typeof e;
      }),
    };
    expect(restAfterSet(old, bench(old))).toEqual({ seconds: 90, beforeNext: null });
    const lastSet = logSet(logSet(old, bench(old), reps(8), NOW, ids()), bench(old), reps(8), NOW, ids());
    expect(restSeconds(lastSet, NOW)).toBe(90);
  });

  it("a zero rest_after_seconds ends the rest", () => {
    let session = withRest();
    session = { ...session, exercises: session.exercises.map((e, i) => (i === 0 ? { ...e, rest_after_seconds: 0 } : e)) };
    session = logSet(session, bench(session), reps(8), NOW, ids());
    session = logSet(session, bench(session), reps(8), NOW, ids());
    expect(session.rest_until).toBeNull();
  });

  it("startRest sets the end from now and replaces any running rest", () => {
    const resting = startRest(started(), 60, NOW);
    expect(resting.rest_until).toBe(later(60).toISOString());
    expect(startRest(resting, 30, later(10)).rest_until).toBe(later(40).toISOString());
    expect(startRest(resting, 0, NOW).rest_until).toBeNull();
  });

  it("extendRest adds to a running rest, and leaves none or an ended one alone", () => {
    const resting = startRest(started(), 60, NOW);
    expect(extendRest(resting, 15, later(10)).rest_until).toBe(later(75).toISOString());
    const none = started();
    expect(extendRest(none, 15, NOW)).toBe(none);
    expect(extendRest(resting, 15, later(61))).toBe(resting);
  });

  it("sessionFromLines builds a routine-less session with the lines' targets", () => {
    const session = sessionFromLines(
      " Quick ",
      [
        { exercise_id: "e1", name: "Squat", kind: "reps", sets: 3, reps: 10, seconds: null, distance_m: null, weight: "40.00" },
        { exercise_id: null, name: "Plank", kind: "duration", sets: 3, reps: 10, seconds: 30, distance_m: null, weight: null },
      ],
      NOW,
      ids(),
    );
    expect(session.routine_id).toBeNull();
    expect(session.routine_name).toBe("Quick");
    expect(session.performed_on).toBe("2031-03-04");
    expect(session.started_at).toBe(NOW.toISOString());
    expect(session.exercises[0]).toMatchObject({ exercise_id: "e1", target_sets: 3, target_reps: 10, target_weight: "40.00" });
    expect(session.exercises[1]).toMatchObject({ exercise_id: null, target_reps: null, target_seconds: 30 });
    expect(session.sets).toEqual([]);
    expect(session.rest_until).toBeNull();
    expect(toCompleteBody(session, later(5)).routine_id).toBeUndefined();
  });
});

// ------------------------------------------------------------------ Epic 54.4

const tgt = (over: Partial<SetTarget>): SetTarget => ({
  reps: null,
  seconds: null,
  distance_m: null,
  weight: null,
  warmup: false,
  ...over,
});

function routineOf(lines: RoutineLine[]): RoutineDetail {
  return { id: "r9", name: "V2", note: null, lines };
}

describe("per-set targets", () => {
  const warm = routineOf([
    line({
      id: "a",
      exercise_name: "Squat",
      kind: "reps",
      position: 1,
      target_sets: 3,
      target_rpe: 8,
      tempo: "3-1-1-0",
      set_targets: [
        tgt({ reps: 10, weight: "40.00", warmup: true }),
        tgt({ reps: 5, weight: "100.00" }),
        tgt({ reps: 3, weight: "110.00" }),
      ],
    }),
  ]);

  it("copies the new fields at start and nulls them for an ad-hoc exercise", () => {
    const session = startSession(warm, NOW, ids());
    expect(session.exercises[0]).toMatchObject({ target_rpe: 8, tempo: "3-1-1-0", target_rir: null, superset_group: null });
    expect(session.exercises[0]!.set_targets).toHaveLength(3);
    const added = addExercise(session, { exercise_id: null, name: "X", kind: "reps" }, ids());
    expect(added.exercises[1]).toMatchObject({ set_targets: null, target_rpe: null, target_rir: null, tempo: null, superset_group: null });
  });

  it("prefills set n from set_targets[n], the last one beyond the list", () => {
    let session = startSession(warm, NOW, ids());
    const key = session.exercises[0]!.key;
    expect(nextSetDraft(session, key)).toMatchObject({ reps: 10, weight: "40.00" });
    session = logSet(session, key, reps(10, "40.00"), NOW, ids());
    expect(nextSetDraft(session, key)).toMatchObject({ reps: 5, weight: "100.00" });
    session = logSet(session, key, reps(5, "100.00"), NOW, ids());
    session = logSet(session, key, reps(3, "110.00"), NOW, ids());
    expect(nextSetDraft(session, key)).toMatchObject({ reps: 3, weight: "110.00" });
  });

  it("flags the logged set as a warm-up from its target and sends it only then", () => {
    let session = startSession(warm, NOW, ids());
    const key = session.exercises[0]!.key;
    session = logSet(session, key, reps(10, "40.00"), NOW, ids());
    session = logSet(session, key, reps(5, "100.00"), NOW, ids());
    expect(session.sets.map((s) => s.is_warmup)).toEqual([true, false]);
    const body = toCompleteBody(session, later(60));
    expect(body.sets[0]).toMatchObject({ is_warmup: true });
    expect(body.sets[1]).not.toHaveProperty("is_warmup");
    expect(progress(session).setsDone).toBe(2);
  });
});

describe("supersets", () => {
  const mk = (id: string, pos: number, group: number | null, sets: number, extra: Partial<RoutineLine> = {}) =>
    line({ id, exercise_name: id.toUpperCase(), kind: "reps", position: pos, target_sets: sets, target_reps: 8, superset_group: group, ...extra });

  /** Log one set on the exercise the model currently points at; returns its name. */
  function step(session: ActiveSession): [ActiveSession, string] {
    const key = currentExercise(session)!;
    const name = session.exercises.find((e) => e.key === key)!.name;
    return [logSet(session, key, reps(8), NOW, ids()), name];
  }

  function run(lines: RoutineLine[], n: number) {
    let session = startSession(routineOf(lines), NOW, ids());
    const order: string[] = [];
    const rests: (string | null)[] = [];
    for (let i = 0; i < n; i++) {
      const [next, name] = step(session);
      order.push(name);
      rests.push(next.rest_until);
      session = next;
    }
    return { session, order, rests };
  }

  it("alternates two members and rests only after the round's last member", () => {
    const { order, rests } = run(
      [mk("a", 1, 1, 2, { rest_seconds: 10 }), mk("b", 2, 1, 2, { rest_seconds: 20 }), mk("c", 3, null, 1)],
      4,
    );
    expect(order).toEqual(["A", "B", "A", "B"]);
    expect(rests.map((r) => (r === null ? 0 : (Date.parse(r) - NOW.getTime()) / 1000))).toEqual([0, 20, 0, 20]);
  });

  it("alternates three members and wraps", () => {
    const { order } = run([mk("a", 1, 2, 2), mk("b", 2, 2, 2), mk("c", 3, 2, 2)], 6);
    expect(order).toEqual(["A", "B", "C", "A", "B", "C"]);
  });

  it("copes with uneven set counts: the member with sets left carries on", () => {
    const { order, rests } = run([mk("a", 1, 1, 3, { rest_seconds: 5 }), mk("b", 2, 1, 1, { rest_seconds: 6 })], 4);
    expect(order).toEqual(["A", "B", "A", "A"]);
    const secs = rests.map((r) => (r === null ? 0 : (Date.parse(r) - NOW.getTime()) / 1000));
    // round 0 ends with B (6 s); rounds 1 and 2 have only A left, so A ends them (5 s)
    expect(secs).toEqual([0, 6, 5, 5]);
  });

  it("uses rest_after_seconds of the group's last member once the whole group is done", () => {
    const { session, rests } = run(
      [mk("a", 1, 1, 1, { rest_seconds: 10 }), mk("b", 2, 1, 1, { rest_seconds: 20, rest_after_seconds: 120 }), mk("c", 3, null, 1)],
      2,
    );
    expect(Date.parse(rests[1]!) - NOW.getTime()).toBe(120_000);
    expect(currentExercise(session)).toBe(session.exercises[2]!.key);
  });

  it("treats group membership as consecutive lines only", () => {
    const session = startSession(routineOf([mk("a", 1, 1, 2), mk("b", 2, null, 2), mk("c", 3, 1, 2)]), NOW, ids());
    expect(supersetMembers(session, session.exercises[0]!.key)).toHaveLength(1);
  });
});

describe("an exercise stored before Epic 54", () => {
  it("still works in the model when the new fields are simply absent", () => {
    const session = started();
    const old = {
      ...session,
      exercises: session.exercises.map(({ set_targets, target_rpe, target_rir, tempo, superset_group, ...rest }) => rest),
    } as unknown as ActiveSession;
    expect(nextSetDraft(old, old.exercises[0]!.key)).toMatchObject({ reps: 8 });
    expect(currentExercise(old)).toBe(old.exercises[0]!.key);
  });
});
