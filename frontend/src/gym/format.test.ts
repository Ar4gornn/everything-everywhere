import { describe, expect, it } from "vitest";

import {
  convertWeight,
  type DraftLine,
  extractJson,
  ImportError,
  parseWorkoutFile,
  toImportBody,
  validateLine,
} from "./format";

/**
 * The workout file parser (Epic 42, §5). Table-driven: each row is a way a file arrives
 * (clean, fenced, wrapped in prose, hand-edited) and what the review must then see.
 */

const file = (exercises: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ format: "ee-workout/1", weight_unit: "kg", routines: [{ name: "Push", exercises }], ...extra });

const firstLine = (text: string, unit: "kg" | "lb" = "kg"): DraftLine => {
  const line = parseWorkoutFile(text, unit).routines[0]?.lines[0];
  if (!line) throw new Error("no line");
  return line;
};

describe("finding the JSON", () => {
  const body = { routines: [{ name: "A", exercises: [{ name: "Squat" }] }] };
  const json = JSON.stringify(body);
  it.each([
    ["a bare object", json],
    ["surrounded by whitespace", `\n\n  ${json}  \n`],
    ["a ```json fence", `Here you go:\n\n\`\`\`json\n${json}\n\`\`\`\n\nEnjoy!`],
    ["a bare ``` fence", `\`\`\`\n${json}\n\`\`\``],
    ["a fence with CRLF line ends", `\`\`\`json\r\n${json}\r\n\`\`\``],
    ["prose before and after", `Sure! ${json} Let me know if you want changes.`],
    ["a first fence that is not JSON", `\`\`\`text\nnot json\n\`\`\`\n\`\`\`json\n${json}\n\`\`\``],
  ])("reads %s", (_name, text) => {
    expect(extractJson(text)).toEqual(body);
  });

  it.each([
    ["empty", ""],
    ["prose only", "Squat 4x8 then bench 4x8."],
    ["broken JSON", '{"routines": [ {"name": '],
    ["an array", "[1, 2, 3]"],
    ["a number", "42"],
  ])("refuses %s", (_name, text) => {
    expect(() => extractJson(text)).toThrow(ImportError);
  });
});

describe("the shapes of a file", () => {
  it("reads the documented object", () => {
    const parsed = parseWorkoutFile(
      file([
        { name: "Bench press", kind: "reps", sets: 4, reps: 8, weight: 60, rest_seconds: 90 },
        { name: "Plank", kind: "duration", sets: 3, seconds: 45, rest_seconds: 60 },
        { name: "Rowing", kind: "distance", sets: 1, distance_m: 2000, note: "Easy pace" },
      ]),
      "kg",
    );
    expect(parsed.warnings).toEqual([]);
    const [bench, plank, row] = parsed.routines[0]?.lines ?? [];
    expect(bench).toMatchObject({ name: "Bench press", kind: "reps", sets: 4, reps: 8, weight: 60, rest_seconds: 90 });
    expect(plank).toMatchObject({ kind: "duration", seconds: 45 });
    expect(row).toMatchObject({ kind: "distance", distance_m: 2000, note: "Easy pace" });
    expect([bench, plank, row].every((line) => Object.keys(line?.errors ?? {}).length === 0)).toBe(true);
  });

  it("reads a single routine at the top level", () => {
    const parsed = parseWorkoutFile(
      JSON.stringify({ name: "Legs", exercises: [{ name: "Squat", sets: 5, reps: 5 }] }),
      "kg",
    );
    expect(parsed.routines).toHaveLength(1);
    expect(parsed.routines[0]?.name).toBe("Legs");
  });

  it("does not need the format field", () => {
    const text = JSON.stringify({ routines: [{ name: "X", exercises: [{ name: "Squat" }] }] });
    expect(parseWorkoutFile(text, "kg").routines).toHaveLength(1);
  });

  it("reads several routines", () => {
    const text = JSON.stringify({
      routines: [
        { name: "A", exercises: [{ name: "Squat" }] },
        { name: "B", exercises: [{ name: "Deadlift" }] },
      ],
    });
    expect(parseWorkoutFile(text, "kg").routines.map((routine) => routine.name)).toEqual(["A", "B"]);
  });

  it("ignores keys it does not know, at every level", () => {
    const text = JSON.stringify({
      format: "ee-workout/1",
      author: "gpt",
      routines: [{ name: "A", tags: ["x"], exercises: [{ name: "Squat", tempo: "3-1-1", rpe: 8 }] }],
    });
    const line = firstLine(text);
    expect(line.name).toBe("Squat");
    expect(line.errors).toEqual({});
  });

  it.each([
    ["no routines or exercises", { format: "ee-workout/1", hello: 1 }],
    ["routines that is not a list", { routines: "none" }],
  ])("refuses %s as unreadable", (_name, value) => {
    expect(() => parseWorkoutFile(JSON.stringify(value), "kg")).toThrow(
      expect.objectContaining({ key: "gymCore.import.unreadable" }),
    );
  });

  it("refuses a file with no exercises at all", () => {
    expect(() => parseWorkoutFile(JSON.stringify({ routines: [{ name: "A", exercises: [] }] }), "kg")).toThrow(
      expect.objectContaining({ key: "gymCore.import.noExercises" }),
    );
  });

  it("refuses more than 60 exercises in a routine, and accepts exactly 60", () => {
    const many = (n: number) => file(Array.from({ length: n }, (_, i) => ({ name: `E${i}` })));
    expect(parseWorkoutFile(many(60), "kg").routines[0]?.lines).toHaveLength(60);
    expect(() => parseWorkoutFile(many(61), "kg")).toThrow(
      expect.objectContaining({ key: "gymCore.import.tooMany" }),
    );
  });

  it("drops an empty routine and non-exercise entries, saying so", () => {
    const text = JSON.stringify({
      routines: [
        { name: "Empty", exercises: [] },
        { name: "Real", exercises: [{ name: "Squat" }, "stretch", 7] },
      ],
    });
    const parsed = parseWorkoutFile(text, "kg");
    expect(parsed.routines.map((routine) => routine.name)).toEqual(["Real"]);
    expect(parsed.routines[0]?.lines).toHaveLength(1);
    expect(parsed.warnings).toEqual(["gymCore.warn.emptyRoutine", "gymCore.warn.skipped"]);
  });
});

describe("kinds", () => {
  it.each([
    ["seconds present", { name: "Plank", seconds: 30 }, "duration"],
    ["distance_m present", { name: "Run", distance_m: 5000 }, "distance"],
    ["neither", { name: "Squat", reps: 5 }, "reps"],
    ["both: seconds wins", { name: "X", seconds: 30, distance_m: 100 }, "duration"],
    ["an explicit kind beats the measures", { name: "X", kind: "reps", seconds: 30 }, "reps"],
    ["a kind in capitals", { name: "X", kind: "Distance" }, "distance"],
  ])("%s", (_name, line, kind) => {
    expect(firstLine(file([line])).kind).toBe(kind);
  });

  it("marks an inferred kind", () => {
    expect(firstLine(file([{ name: "Plank", seconds: 30 }])).kindInferred).toBe(true);
    expect(firstLine(file([{ name: "Plank", kind: "duration", seconds: 30 }])).kindInferred).toBe(false);
  });

  it("flags a kind it does not know and falls back to inferring", () => {
    const line = firstLine(file([{ name: "X", kind: "strength", reps: 5 }]));
    expect(line.kind).toBe("reps");
    expect(line.errors.kind).toBe("gymCore.field.kind");
  });
});

describe("numbers", () => {
  it.each([
    ["a number", 8, 8],
    ["a string", "8", 8],
    ["a padded string", " 8 ", 8],
    ["a decimal comma", "62,5", 62.5],
    ["a decimal point string", "62.5", 62.5],
  ])("reads weight as %s", (_name, raw, expected) => {
    const line = firstLine(file([{ name: "Bench", weight: raw }]));
    expect(line.weight).toBe(expected);
    expect(line.errors.weight).toBeUndefined();
  });

  it("keeps a missing number as null, not zero", () => {
    const line = firstLine(file([{ name: "Squat" }]));
    expect([line.sets, line.reps, line.seconds, line.distance_m, line.weight, line.rest_seconds]).toEqual([
      null, null, null, null, null, null,
    ]);
  });

  it.each([
    ["words", "heavy"],
    ["a unit suffix", "8 reps"],
    ["Infinity", "Infinity"],
    ["an exponent", "1e3"],
    ["an object", {}],
  ])("flags %s as not a number and leaves the field empty", (_name, raw) => {
    const line = firstLine(file([{ name: "Squat", reps: raw }]));
    expect(line.reps).toBeNull();
    expect(line.errors.reps).toBe("gymCore.field.number");
  });

  it.each([
    ["sets", "sets", 0, "gymCore.field.range"],
    ["sets", "sets", 100, "gymCore.field.range"],
    ["reps", "reps", 1000, "gymCore.field.range"],
    ["reps", "reps", -3, "gymCore.field.range"],
    ["seconds", "seconds", 86401, "gymCore.field.range"],
    ["distance_m", "distance_m", 1_000_001, "gymCore.field.range"],
    ["weight", "weight", -5, "gymCore.field.range"],
    ["rest_seconds", "rest_seconds", 3601, "gymCore.field.range"],
    ["reps", "reps", 7.5, "gymCore.field.whole"],
  ])("keeps %s=%s but flags it", (key, _k, value, problem) => {
    const line = firstLine(file([{ name: "X", [key]: value }]));
    const field = key as keyof DraftLine["errors"];
    expect(line.errors[field]).toBe(problem);
  });

  it.each([
    ["sets", 1],
    ["sets", 99],
    ["reps", 999],
    ["seconds", 86400],
    ["distance_m", 1_000_000],
    ["weight", 0],
    ["rest_seconds", 0],
    ["rest_seconds", 3600],
  ])("accepts %s=%s", (key, value) => {
    expect(firstLine(file([{ name: "X", [key]: value }])).errors).toEqual({});
  });

  it("allows a half-kilo weight but not half a rep", () => {
    expect(firstLine(file([{ name: "X", weight: 62.5 }])).errors).toEqual({});
  });
});

describe("text fields", () => {
  it("requires a name, and bounds it, the note and the link", () => {
    const line = firstLine(
      file([{ name: "  ", note: "x".repeat(201), video_url: "http://example.com/a" }]),
    );
    expect(line.errors).toMatchObject({
      name: "gymCore.field.required",
      note: "gymCore.field.tooLong",
      video_url: "gymCore.field.url",
    });
    expect(firstLine(file([{ name: "n".repeat(81) }])).errors.name).toBe("gymCore.field.tooLong");
  });

  it.each([
    ["an https link", "https://example.com/squat", undefined],
    ["an empty link", "", undefined],
    ["a javascript: link", "javascript:alert(1)", "gymCore.field.url"],
    ["text that is not a URL", "squat video", "gymCore.field.url"],
    ["a plain http link", "http://example.com", "gymCore.field.url"],
  ])("video_url: %s", (_name, url, problem) => {
    expect(firstLine(file([{ name: "Squat", video_url: url }])).errors.video_url).toBe(problem);
  });

  it("trims and keeps the routine name and note", () => {
    const text = JSON.stringify({ routines: [{ name: "  Push  ", note: " heavy ", exercises: [{ name: "X" }] }] });
    expect(parseWorkoutFile(text, "kg").routines[0]).toMatchObject({ name: "Push", note: "heavy" });
  });
});

describe("units", () => {
  it("converts lb to kg, rounds to 0.5, and says so", () => {
    const parsed = parseWorkoutFile(file([{ name: "Bench", weight: 135 }], { weight_unit: "lb" }), "kg");
    const line = parsed.routines[0]?.lines[0];
    expect(line?.weight).toBe(61); // 135 lb = 61.23 kg, to the nearest half
    expect(line?.converted).toBe(true);
    expect(parsed.warnings).toEqual(["gymCore.warn.fromLb"]);
  });

  it("converts kg to lb for an account in pounds", () => {
    const parsed = parseWorkoutFile(file([{ name: "Bench", weight: 60 }]), "lb");
    expect(parsed.routines[0]?.lines[0]?.weight).toBe(132.5);
    expect(parsed.warnings).toEqual(["gymCore.warn.fromKg"]);
  });

  it("leaves weights alone when the units agree, or the file names none", () => {
    expect(firstLine(file([{ name: "B", weight: 60 }])).converted).toBe(false);
    const noUnit = JSON.stringify({ routines: [{ name: "A", exercises: [{ name: "B", weight: 60 }] }] });
    expect(firstLine(noUnit, "lb").weight).toBe(60);
  });

  it.each(["LBS", "pounds", "lb"])("recognises %s as pounds", (word) => {
    expect(firstLine(file([{ name: "B", weight: 100 }], { weight_unit: word })).converted).toBe(true);
  });

  it("warns about a unit it does not know and reads weights as the account's", () => {
    const parsed = parseWorkoutFile(file([{ name: "B", weight: 60 }], { weight_unit: "stone" }), "kg");
    expect(parsed.warnings).toEqual(["gymCore.warn.unitUnknown"]);
    expect(parsed.routines[0]?.lines[0]?.weight).toBe(60);
  });

  it("does not convert a weight it flagged as out of range", () => {
    const line = firstLine(file([{ name: "B", weight: -10 }], { weight_unit: "lb" }));
    expect(line.weight).toBe(-10);
    expect(line.converted).toBe(false);
  });

  it("rounds conversions to the nearest half and passes equal units through", () => {
    expect(convertWeight(100, "lb", "kg")).toBe(45.5);
    expect(convertWeight(100, "kg", "lb")).toBe(220.5);
    expect(convertWeight(61.37, "kg", "kg")).toBe(61.37);
  });
});

describe("re-checking after an edit", () => {
  it("clears a fixed problem and raises a new one", () => {
    const line = firstLine(file([{ name: "X", reps: 5000 }]));
    expect(line.errors.reps).toBeDefined();
    const fixed = validateLine({ ...line, reps: 8, sets: 0 });
    expect(fixed.errors.reps).toBeUndefined();
    expect(fixed.errors.sets).toBe("gymCore.field.range");
  });

  it("keeps 'not a number' until the field has a value", () => {
    const line = firstLine(file([{ name: "X", reps: "lots" }]));
    expect(validateLine({ ...line, name: "Y" }).errors.reps).toBe("gymCore.field.number");
    expect(validateLine({ ...line, reps: 8 }).errors.reps).toBeUndefined();
  });
});

describe("the request body", () => {
  it("writes weight with two places, only what the kind counts, and no nulls", () => {
    const parsed = parseWorkoutFile(
      file([
        { name: "Bench", kind: "reps", sets: 4, reps: 8, weight: 60, rest_seconds: 90, seconds: 30 },
        { name: "Plank", kind: "duration", sets: 3, seconds: 45, reps: 9 },
        { name: "Row", kind: "distance", distance_m: 2000, video_url: "https://example.com/r", note: "Easy" },
      ]),
      "kg",
    );
    const body = toImportBody(parsed.routines[0] as NonNullable<(typeof parsed.routines)[0]>);
    expect(body).toEqual({
      name: "Push",
      lines: [
        { exercise_name: "Bench", kind: "reps", target_sets: 4, target_reps: 8, target_weight: "60.00", rest_seconds: 90 },
        { exercise_name: "Plank", kind: "duration", target_sets: 3, target_seconds: 45 },
        { exercise_name: "Row", kind: "distance", target_distance_m: 2000, video_url: "https://example.com/r", note: "Easy" },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("null");
  });

  it("keeps a rest of zero and a weight of zero", () => {
    const parsed = parseWorkoutFile(file([{ name: "Pushup", reps: 10, weight: 0, rest_seconds: 0 }]), "kg");
    const line = toImportBody(parsed.routines[0] as NonNullable<(typeof parsed.routines)[0]>).lines[0];
    expect(line).toMatchObject({ target_weight: "0.00", rest_seconds: 0 });
  });

  it("includes the routine note only when there is one", () => {
    const text = JSON.stringify({ routines: [{ name: "A", note: "Hard", exercises: [{ name: "X" }] }] });
    const routine = parseWorkoutFile(text, "kg").routines[0];
    expect(toImportBody(routine as NonNullable<typeof routine>).note).toBe("Hard");
  });
});
