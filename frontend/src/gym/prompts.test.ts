import { describe, expect, it } from "vitest";

import type { Exercise, RoutineDetail, WorkoutDetail } from "../api/types";
import { translator } from "../i18n";
import {
  buildPrompt,
  buildPromptContext,
  PROFILES,
  type PromptContext,
  type PromptProfile,
} from "./prompts";
import { EMPTY_CACHE, type GymCache } from "./store";

const exercise = (id: string, name: string, kind: Exercise["kind"] = "reps"): Exercise => ({
  id,
  name,
  kind,
  video_url: null,
  note: null,
  created_at: "",
});

const routine = (id: string, name: string, names: string[]): RoutineDetail => ({
  id,
  name,
  note: null,
  lines: names.map((exercise_name, index) => ({
    id: `${id}-${index}`,
    exercise_id: `e-${exercise_name}`,
    exercise_name,
    kind: "reps",
    video_url: null,
    position: index + 1,
    target_sets: 3,
    target_reps: 8,
    target_seconds: null,
    target_distance_m: null,
    target_weight: null,
    rest_seconds: null,
    rest_after_seconds: null,
    note: null,
  })),
});

const set = (name: string, over: Partial<WorkoutDetail["sets"][number]> = {}) => ({
  id: "s",
  exercise_id: `e-${name}`,
  exercise_name: name,
  kind: "reps" as const,
  position: 1,
  reps: 8,
  weight: "60.00",
  duration_seconds: null,
  distance_m: null,
  ...over,
});

const session = (day: string, over: Partial<WorkoutDetail> = {}): WorkoutDetail => ({
  id: day,
  routine_id: null,
  performed_on: day,
  started_at: null,
  ended_at: null,
  rest_day: false,
  note: null,
  sets: [],
  ...over,
});

const EMPTY: PromptContext = { unit: "kg", exercises: [], routines: [], recent: [] };

describe("the six profiles", () => {
  it("are in the spec's order, and only `notes` takes notes", () => {
    expect(PROFILES.map((p) => p.id)).toEqual(["notes", "build", "fresh", "quick", "progress", "home"]);
    expect(PROFILES.filter((p) => p.takesNotes).map((p) => p.id)).toEqual(["notes"]);
  });

  const marker: Record<PromptProfile, string> = {
    notes: "Turn them into a workout",
    build: "Interview me before proposing anything",
    fresh: "a different workout every time",
    quick: "little time and little motivation",
    progress: "I want to progress",
    home: "training at home or travelling",
  };

  it.each(PROFILES.map((p) => p.id))("%s carries its instruction and the shared format", (id) => {
    const text = buildPrompt(id, EMPTY, "en");
    expect(text).toContain(marker[id]);
    expect(text).toContain('"format": "ee-workout/1"');
    expect(text).toContain("rest_after_seconds");
    expect(text).toContain('"schedule"');
    expect(text).toContain("Gym → New workout → Ask an AI");
    expect(text.startsWith("You are helping me build a gym workout")).toBe(true);
  });

  it("has a title and a one-line description for every card, in both languages", () => {
    for (const lang of ["en", "fr"] as const) {
      const t = translator(lang);
      for (const profile of PROFILES) {
        expect(t(profile.title)).not.toBe(profile.title);
        expect(t(profile.description)).not.toBe(profile.description);
      }
    }
  });
});

describe("the confirmation rules", () => {
  it("go one exercise at a time, except for `notes`, which is one pass", () => {
    for (const profile of PROFILES) {
      const text = buildPrompt(profile.id, EMPTY, "en");
      if (profile.id === "notes") {
        expect(text).toContain("Anything to change?");
        expect(text).not.toContain("ONE AT A TIME");
      } else {
        expect(text).toContain("ONE AT A TIME");
        expect(text).not.toContain("Anything to change?");
      }
    }
  });
});

describe("notes", () => {
  it("are written into the notes profile only", () => {
    expect(buildPrompt("notes", EMPTY, "en", "bench 4x8 then rows")).toContain("bench 4x8 then rows");
    for (const profile of PROFILES.filter((p) => p.id !== "notes")) {
      expect(buildPrompt(profile.id, EMPTY, "en", "bench 4x8 then rows")).not.toContain("bench 4x8");
    }
  });
  it("say they come in the next message when empty", () => {
    expect(buildPrompt("notes", EMPTY, "en", "   ")).toContain("(I will paste them in my next message)");
    expect(buildPrompt("notes", EMPTY, "en")).toContain("(I will paste them in my next message)");
  });
  it("are not re-interpolated", () => {
    expect(buildPrompt("notes", EMPTY, "en", "{unit} {notes}")).toContain("{unit} {notes}");
  });
});

describe("the context block", () => {
  it("is just the unit when nothing is known, and omits the empty parts", () => {
    const text = buildPrompt("build", EMPTY, "en");
    expect(text).toContain("About me (from my app):\n- I count weight in kg.");
    expect(text).not.toContain("Exercises I already have");
    expect(text).not.toContain("My routines");
    expect(text).not.toContain("My last sessions");
    expect(text).not.toMatch(/undefined|null|NaN/);
  });

  it("lists exercises, routines and sessions the way the spec shows", () => {
    const cache: GymCache = {
      ...EMPTY_CACHE,
      exercises: [exercise("e-Bench", "Bench"), exercise("e-Plank", "Plank", "duration")],
      routines: [routine("r1", "Push", ["Bench", "Row"])],
    };
    const recent = [
      session("2031-03-04", {
        routine_id: "r1",
        sets: [set("Bench"), set("Bench"), set("Bench", { weight: "62.50" }), set("Plank", { reps: null, duration_seconds: 45, weight: null })],
      }),
      session("2031-03-03", { rest_day: true }),
      session("2031-03-01", { sets: [set("Row", { reps: null, distance_m: 2000, weight: null })] }),
    ];
    const context = buildPromptContext(cache, recent, "kg");
    expect(context.recent).toEqual([
      "2031-03-04 Push: Bench 3×8 @ 60 kg, Plank 1×45 s",
      "2031-03-03 rest day",
      "2031-03-01 free session: Row 1×2000 m",
    ]);
    const text = buildPrompt("fresh", context, "en");
    expect(text).toContain("Exercises I already have (reuse these exact names when they fit): Bench (reps), Plank (duration)");
    expect(text).toContain("My routines: Push: Bench, Row");
    expect(text).toContain("My last sessions, newest first:\n  2031-03-04 Push: Bench 3×8 @ 60 kg, Plank 1×45 s");
  });

  it("writes weights in lb when the account counts in lb", () => {
    const context = buildPromptContext(EMPTY_CACHE, [session("2031-03-04", { sets: [set("Bench", { weight: "135.00" })] })], "lb");
    expect(context.recent[0]).toBe("2031-03-04 free session: Bench 1×8 @ 135 lb");
  });

  it("puts the most used exercises first", () => {
    const cache: GymCache = {
      ...EMPTY_CACHE,
      exercises: [exercise("e-Alpha", "Alpha"), exercise("e-Beta", "Beta"), exercise("e-Gamma", "Gamma")],
    };
    const recent = [session("2031-03-04", { sets: [set("Gamma"), set("Gamma"), set("Beta")] })];
    expect(buildPromptContext(cache, recent, "kg").exercises.map((e) => e.name)).toEqual(["Gamma", "Beta", "Alpha"]);
  });

  it("caps exercises at 60, routines at 10 and sessions at 10", () => {
    const cache: GymCache = {
      ...EMPTY_CACHE,
      exercises: Array.from({ length: 75 }, (_, i) => exercise(`e${i}`, `Ex ${String(i).padStart(2, "0")}`)),
      routines: Array.from({ length: 14 }, (_, i) => routine(`r${i}`, `Routine ${i}`, ["Bench"])),
    };
    const recent = Array.from({ length: 15 }, (_, i) => session(`2031-03-${String(i + 1).padStart(2, "0")}`));
    const context = buildPromptContext(cache, recent, "kg");
    expect(context.exercises).toHaveLength(60);
    expect(context.routines).toHaveLength(10);
    expect(context.recent).toHaveLength(10);
  });

  it("never prints undefined or null, even for a set with no measure", () => {
    const odd = session("2031-03-04", { sets: [set("Odd", { reps: null, weight: null })] });
    const context = buildPromptContext(EMPTY_CACHE, [odd], "kg");
    for (const profile of PROFILES) {
      for (const lang of ["en", "fr"] as const) {
        expect(buildPrompt(profile.id, context, lang)).not.toMatch(/undefined|null\b|NaN/);
      }
    }
  });
});

describe("French", () => {
  it("is French, and keeps the JSON keys and enum values English", () => {
    const context = buildPromptContext(EMPTY_CACHE, [session("2031-03-03", { rest_day: true })], "kg", "fr");
    expect(context.recent[0]).toBe("2031-03-03 jour de repos");
    for (const profile of PROFILES) {
      const text = buildPrompt(profile.id, context, "fr");
      expect(text).toContain("Je compte les charges en kg");
      expect(text).not.toContain("You are helping me");
      for (const key of ['"format": "ee-workout/1"', '"rest_after_seconds"', '"schedule"', '"kind": "duration"', '"distance_m"', '"rest_seconds"']) {
        expect(text).toContain(key);
      }
      expect(text).not.toContain('"répétitions"');
    }
    expect(buildPrompt("notes", EMPTY, "fr", "mes notes")).toContain("mes notes");
  });
});

describe("the person's unit in the format", () => {
  it.each(["en", "fr"] as const)("%s: an lb context says lb in the example and never kg", (lang) => {
    const context = { ...EMPTY, unit: "lb" as const };
    for (const profile of PROFILES) {
      const text = buildPrompt(profile.id, context, lang);
      expect(text).toContain('"weight_unit": "lb"');
      expect(text).toContain('"weight_unit" ');
      expect(text).not.toContain('"kg"');
      expect(text).not.toContain("{unit}");
    }
    expect(buildPrompt("quick", EMPTY, lang)).toContain('"weight_unit": "kg"');
  });
});
