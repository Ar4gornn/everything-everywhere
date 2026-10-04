import { describe, expect, it } from "vitest";

import {
  convertWeight,
  FORMAT,
  type DraftLine,
  extractJson,
  hasDroppedMeasure,
  ImportError,
  parseWorkoutFile,
  toImportBody,
  validateLine,
  validateLines,
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
      routines: [{ name: "A", tags: ["x"], exercises: [{ name: "Squat", cadence: "3-1-1", effort: 8 }] }],
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

describe("an ambiguous thousands comma", () => {
  it.each(["1,000", "1,250", "12,500"])("flags %s and leaves the value empty", (text) => {
    const line = firstLine(file([{ name: "Squat", reps: text }]));
    expect(line.reps).toBeNull();
    expect(line.errors.reps).toBe("gymCore.field.ambiguous");
    // the review's re-check keeps the flag until the field is given a value
    expect(validateLine(line).errors.reps).toBe("gymCore.field.ambiguous");
  });
  it.each([["62,5", 62.5], ["2,25", 2.25], ["1,5", 1.5]])("still reads %s", (text, value) => {
    const line = firstLine(file([{ name: "Squat", weight: text }]));
    expect(line.weight).toBe(value);
    expect(line.errors.weight).toBeUndefined();
  });
});

describe("a measure the kind does not use", () => {
  it("is warned about, whole-file and on the line", () => {
    const text = file([{ name: "Plank", kind: "reps", reps: 10, seconds: 30 }]);
    expect(parseWorkoutFile(text, "kg").warnings).toContain("gymCore.warn.droppedMeasure");
    expect(hasDroppedMeasure(firstLine(text))).toBe(true);
    // not a blocking error
    expect(Object.keys(firstLine(text).errors)).toEqual([]);
  });
  it("is silent when every measure belongs to the kind", () => {
    const text = file([{ name: "Squat", kind: "reps", reps: 10, weight: 20 }]);
    expect(parseWorkoutFile(text, "kg").warnings).not.toContain("gymCore.warn.droppedMeasure");
    expect(hasDroppedMeasure(firstLine(text))).toBe(false);
  });
});

describe("rest_after_seconds (Epic 43)", () => {
  it("is read, range-checked like rest_seconds, and sent", () => {
    const line = firstLine(file([{ name: "Squat", reps: 5, rest_seconds: 60, rest_after_seconds: "120" }]));
    expect(line.rest_after_seconds).toBe(120);
    expect(line.errors.rest_after_seconds).toBeUndefined();
    const parsed = parseWorkoutFile(file([{ name: "Squat", reps: 5, rest_after_seconds: 120 }]), "kg");
    const body = toImportBody(parsed.routines[0] as NonNullable<(typeof parsed.routines)[0]>);
    expect(body.lines[0]?.rest_after_seconds).toBe(120);
  });
  it("is absent, not zero, when the file has none", () => {
    const parsed = parseWorkoutFile(file([{ name: "Squat", reps: 5 }]), "kg");
    expect(parsed.routines[0]?.lines[0]?.rest_after_seconds).toBeNull();
    const body = toImportBody(parsed.routines[0] as NonNullable<(typeof parsed.routines)[0]>);
    expect(body.lines[0]).not.toHaveProperty("rest_after_seconds");
  });
  it("flags 3601, a fraction and a word, and the re-check keeps the unreadable flag", () => {
    expect(firstLine(file([{ name: "A", reps: 5, rest_after_seconds: 3601 }])).errors.rest_after_seconds).toBe("gymCore.field.range");
    expect(firstLine(file([{ name: "A", reps: 5, rest_after_seconds: 2.5 }])).errors.rest_after_seconds).toBe("gymCore.field.whole");
    const word = firstLine(file([{ name: "A", reps: 5, rest_after_seconds: "soon" }]));
    expect(word.errors.rest_after_seconds).toBe("gymCore.field.number");
    expect(validateLine(word).errors.rest_after_seconds).toBe("gymCore.field.number");
    expect(firstLine(file([{ name: "A", reps: 5, rest_after_seconds: 3600 }])).errors.rest_after_seconds).toBeUndefined();
  });
});

describe("schedule (Epic 43)", () => {
  const week = ["Push day", "rest", "Pull day", "rest", "Legs", "rest", "rest"];
  const read = (schedule: unknown) =>
    parseWorkoutFile(file([{ name: "Squat", reps: 5 }], { schedule }), "kg").schedule;
  it("is kept as written, trimmed", () => {
    expect(read(week)).toEqual(week);
    expect(read([" Push ", "rest"])).toEqual(["Push", "rest"]);
  });
  it("is null when absent", () => {
    expect(parseWorkoutFile(file([{ name: "Squat", reps: 5 }]), "kg").schedule).toBeNull();
  });
  it.each([
    ["a string", "Push, rest"],
    ["an object", { mon: "Push" }],
    ["too long (15 days)", Array.from({ length: 15 }, () => "rest")],
    ["a non-string entry", ["Push", 3]],
    ["a label over 80 characters", ["x".repeat(81)]],
    ["empty", []],
  ])("ignores %s without an error", (_name, value) => {
    expect(read(value)).toBeNull();
  });
  it("accepts 14 days and an 80-character label", () => {
    expect(read(Array.from({ length: 14 }, () => "rest"))).toHaveLength(14);
    expect(read(["x".repeat(80)])?.[0]).toHaveLength(80);
  });
});

const v2 = (exercises: unknown[], extra: Record<string, unknown> = {}) =>
  file(exercises, { format: "ee-workout/2", ...extra });
const bodyOf = (text: string, unit: "kg" | "lb" = "kg") => {
  const routine = parseWorkoutFile(text, unit).routines[0];
  return toImportBody(routine as NonNullable<typeof routine>);
};

describe("ee-workout/2: the format and its older sibling", () => {
  it("writes v2 and still reads v1 and files with no format", () => {
    expect(FORMAT).toBe("ee-workout/2");
    for (const format of ["ee-workout/1", "ee-workout/2", undefined]) {
      const text = JSON.stringify({ format, routines: [{ name: "A", exercises: [{ name: "Squat", sets: 3, reps: 5 }] }] });
      expect(firstLine(text)).toMatchObject({ sets: 3, reps: 5, setTargets: null, rpe: null, rir: null, tempo: "", superset: "" });
    }
  });

  it("reads the documented v2 object without a single flag", () => {
    const parsed = parseWorkoutFile(
      v2([
        {
          name: "Bench press", kind: "reps", video_url: "https://www.youtube.com/watch?v=VIDEO_ID",
          rpe: 8, tempo: "3-1-1-0", rest_seconds: 90, rest_after_seconds: 120,
          sets: [{ reps: 12, weight: 40, warmup: true }, { reps: 8, weight: 60 }, { reps: 8, weight: 60 }],
        },
        { name: "Pull-up", kind: "reps", superset: "A", sets: 3, reps: 8, rir: 2 },
        { name: "Dips", kind: "reps", superset: "A", sets: 3, reps: 10 },
      ]),
      "kg",
    );
    expect(parsed.warnings).toEqual([]);
    const [bench, pull, dips] = parsed.routines[0]?.lines ?? [];
    expect(bench).toMatchObject({ sets: 3, rpe: 8, rir: null, tempo: "3-1-1-0" });
    expect(bench?.setTargets?.map((s) => [s.reps, s.weight, s.warmup])).toEqual([
      [12, 40, true],
      [8, 60, false],
      [8, 60, false],
    ]);
    expect(pull).toMatchObject({ superset: "A", rir: 2, setTargets: null });
    expect(dips?.superset).toBe("A");
    expect([bench, pull, dips].every((line) => Object.keys(line?.errors ?? {}).length === 0)).toBe(true);
  });
});

describe("per-set targets", () => {
  it("reads numbers as text and a decimal comma, like the flat fields", () => {
    const line = firstLine(v2([{ name: "Bench", sets: [{ reps: "8", weight: "62,5" }] }]));
    expect(line.setTargets?.[0]).toMatchObject({ reps: 8, weight: 62.5, warmup: false, errors: {} });
  });

  it("keeps a bad number in its set, flags the set and the line, and holds it until fixed", () => {
    const line = firstLine(
      v2([{ name: "Bench", sets: [{ reps: 8 }, { reps: 1000 }, { reps: "lots" }, { reps: 5, weight: -2 }] }]),
    );
    const sets = line.setTargets ?? [];
    expect(sets.map((s) => s.errors)).toEqual([
      {},
      { reps: "gymCore.field.range" },
      { reps: "gymCore.field.number" },
      { weight: "gymCore.field.range" },
    ]);
    expect(sets[2]?.reps).toBeNull();
    expect(line.errors.set_targets).toBe("gymFormat.setsInvalid");

    // re-check: the unreadable flag stays on an empty field, the rest recomputes
    const again = validateLine(line);
    expect(again.setTargets?.[2]?.errors.reps).toBe("gymCore.field.number");
    expect(again.errors.set_targets).toBe("gymFormat.setsInvalid");

    const fixed = validateLine({
      ...line,
      setTargets: sets.map((s, i) => ({ ...s, reps: i === 1 ? 8 : i === 2 ? 8 : s.reps, weight: s.weight === -2 ? 20 : s.weight })),
    });
    expect(fixed.setTargets?.every((s) => Object.keys(s.errors).length === 0)).toBe(true);
    expect(fixed.errors.set_targets).toBeUndefined();
  });

  it("takes the set count from the list, and flags more than 99", () => {
    const many = (n: number) => firstLine(v2([{ name: "X", sets: Array.from({ length: n }, () => ({ reps: 5 })) }]));
    expect(many(99).sets).toBe(99);
    expect(many(99).errors.sets).toBeUndefined();
    expect(many(100).errors.sets).toBe("gymCore.field.range");
  });

  it("treats an empty list as no sets, and skips entries that are not objects, saying so", () => {
    expect(firstLine(v2([{ name: "X", sets: [] }]))).toMatchObject({ sets: null, setTargets: null });
    const parsed = parseWorkoutFile(v2([{ name: "X", sets: [{ reps: 5 }, "oops", 7] }]), "kg");
    expect(parsed.routines[0]?.lines[0]?.setTargets).toHaveLength(1);
    expect(parsed.warnings).toContain("gymCore.warn.skipped");
  });

  it("converts per-set weights by weight_unit, flags the line, and warns", () => {
    const parsed = parseWorkoutFile(v2([{ name: "Bench", sets: [{ reps: 8, weight: 135 }, { reps: 8 }] }], { weight_unit: "lb" }), "kg");
    const line = parsed.routines[0]?.lines[0];
    expect(line?.setTargets?.map((s) => s.weight)).toEqual([61, null]);
    expect(line?.converted).toBe(true);
    expect(parsed.warnings).toEqual(["gymCore.warn.fromLb"]);
  });

  it("infers the kind from the sets when the line does not say", () => {
    expect(firstLine(v2([{ name: "Plank", sets: [{ seconds: 30 }] }])).kind).toBe("duration");
    expect(firstLine(v2([{ name: "Run", sets: [{ distance_m: 500 }] }])).kind).toBe("distance");
  });

  it("counts a stray measure inside a set as dropped", () => {
    const text = v2([{ name: "Squat", kind: "reps", sets: [{ reps: 5, seconds: 30 }] }]);
    expect(hasDroppedMeasure(firstLine(text))).toBe(true);
    expect(parseWorkoutFile(text, "kg").warnings).toContain("gymCore.warn.droppedMeasure");
  });

  it("ships set_targets with two-place weights, the kind's measure only, and coherent flat targets", () => {
    const body = bodyOf(
      v2([
        { name: "Bench", kind: "reps", sets: [{ reps: 12, weight: 40, warmup: true }, { reps: 8, weight: 62.5 }, { reps: 6, weight: 65, seconds: 9 }] },
        { name: "Plank", kind: "duration", sets: [{ seconds: 30, reps: 4 }, { seconds: 45 }] },
      ]),
    );
    expect(body.lines[0]).toEqual({
      exercise_name: "Bench",
      kind: "reps",
      target_sets: 3,
      target_reps: 8, // the first working set, not the warm-up
      target_weight: "62.50",
      set_targets: [
        { reps: 12, seconds: null, distance_m: null, weight: "40.00", warmup: true },
        { reps: 8, seconds: null, distance_m: null, weight: "62.50", warmup: false },
        { reps: 6, seconds: null, distance_m: null, weight: "65.00", warmup: false },
      ],
    });
    expect(body.lines[1]).toMatchObject({
      target_sets: 2,
      target_seconds: 30,
      set_targets: [
        { reps: null, seconds: 30, distance_m: null, weight: null, warmup: false },
        { reps: null, seconds: 45, distance_m: null, weight: null, warmup: false },
      ],
    });
    expect(body.lines[1]).not.toHaveProperty("target_reps");
  });

  it("falls back to the first set when every set is a warm-up, and ignores a flat target_sets", () => {
    const body = bodyOf(v2([{ name: "Bench", sets: [{ reps: 10, weight: 20, warmup: true }, { reps: 8, weight: 30, warmup: true }] }]));
    expect(body.lines[0]).toMatchObject({ target_sets: 2, target_reps: 10, target_weight: "20.00" });
  });

  it("sends no set_targets for a uniform line", () => {
    const body = bodyOf(v2([{ name: "Squat", sets: 3, reps: 5, weight: 100 }]));
    expect(body.lines[0]).toEqual({ exercise_name: "Squat", kind: "reps", target_sets: 3, target_reps: 5, target_weight: "100.00" });
  });
});

describe("effort and tempo", () => {
  it.each([
    [{ rpe: 8 }, undefined],
    [{ rpe: 7.5 }, undefined],
    [{ rpe: "8,5" }, undefined],
    [{ rpe: 10 }, undefined],
    [{ rpe: 1 }, undefined],
    [{ rpe: 0.5 }, "gymCore.field.range"],
    [{ rpe: 11 }, "gymCore.field.range"],
    [{ rpe: 7.3 }, "gymFormat.rpeStep"],
    [{ rpe: "hard" }, "gymCore.field.number"],
  ])("rpe %j: %s", (extra, problem) => {
    expect(firstLine(v2([{ name: "X", reps: 5, ...extra }])).errors.rpe).toBe(problem);
  });

  it.each([
    [{ rir: 0 }, undefined],
    [{ rir: 10 }, undefined],
    [{ rir: 11 }, "gymCore.field.range"],
    [{ rir: -1 }, "gymCore.field.range"],
    [{ rir: 1.5 }, "gymCore.field.whole"],
  ])("rir %j: %s", (extra, problem) => {
    expect(firstLine(v2([{ name: "X", reps: 5, ...extra }])).errors.rir).toBe(problem);
  });

  it("flags rpe and rir together on both, keeps both values, and refuses to send them", () => {
    const line = firstLine(v2([{ name: "X", reps: 5, rpe: 8, rir: 2 }]));
    expect([line.rpe, line.rir]).toEqual([8, 2]);
    expect(line.errors).toMatchObject({ rpe: "gymFormat.effortBoth", rir: "gymFormat.effortBoth" });
    expect(validateLine({ ...line, rir: null }).errors.rpe).toBeUndefined();
  });

  it("keeps an unreadable rpe flagged until it has a value", () => {
    const line = firstLine(v2([{ name: "X", reps: 5, rpe: "hard" }]));
    expect(validateLine(line).errors.rpe).toBe("gymCore.field.number");
    expect(validateLine({ ...line, rpe: 8 }).errors.rpe).toBeUndefined();
  });

  it.each([
    ["3-1-1-0", undefined],
    ["X-0-X-0", undefined],
    ["3-1-x-0", undefined],
    [" 2-0-2-0 ", undefined],
    ["", undefined],
    ["3-1-1", "gymFormat.tempo"],
    ["3-1-1-0-1", "gymFormat.tempo"],
    ["slow", "gymFormat.tempo"],
    ["10-1-1-0", "gymFormat.tempo"],
  ])("tempo %j: %s", (tempo, problem) => {
    expect(firstLine(v2([{ name: "X", reps: 5, tempo }])).errors.tempo).toBe(problem);
  });

  it("sends rpe or rir, and the tempo upper-cased", () => {
    const body = bodyOf(v2([{ name: "A", reps: 5, rpe: 7.5, tempo: " 3-1-x-0 " }, { name: "B", reps: 5, rir: 0 }, { name: "C", reps: 5 }]));
    expect(body.lines[0]).toMatchObject({ target_rpe: 7.5, tempo: "3-1-X-0" });
    expect(body.lines[0]).not.toHaveProperty("target_rir");
    expect(body.lines[1]).toMatchObject({ target_rir: 0 });
    expect(body.lines[2]).not.toHaveProperty("target_rpe");
    expect(body.lines[2]).not.toHaveProperty("tempo");
  });
});

describe("supersets", () => {
  const ex = (name: string, superset?: string) => ({ name, reps: 5, ...(superset === undefined ? {} : { superset }) });

  it("numbers labels 1, 2 in order of first appearance and drops a group of one", () => {
    const body = bodyOf(v2([ex("A1", "x"), ex("A2", "x"), ex("Solo"), ex("B1", "Y"), ex("B2", "y"), ex("B3", "Y"), ex("Lonely", "Z")]));
    expect(body.lines.map((l) => l.superset_group)).toEqual([1, 1, undefined, 2, 2, 2, undefined]);
    expect(JSON.stringify(body)).not.toContain("null");
  });

  it("warns about a label only one exercise carries", () => {
    expect(parseWorkoutFile(v2([ex("A", "A"), ex("B")]), "kg").warnings).toContain("gymFormat.warn.lonelySuperset");
    expect(parseWorkoutFile(v2([ex("A", "A"), ex("B", "A")]), "kg").warnings).not.toContain("gymFormat.warn.lonelySuperset");
  });

  it("flags a label longer than 8 characters, and accepts exactly 8", () => {
    expect(firstLine(v2([ex("A", "123456789")])).errors.superset).toBe("gymFormat.supersetLong");
    expect(firstLine(v2([ex("A", "12345678")])).errors.superset).toBeUndefined();
  });

  it("flags a label that comes back after a break, on the later run only", () => {
    const lines = parseWorkoutFile(v2([ex("A1", "A"), ex("A2", "A"), ex("Mid"), ex("A3", "A"), ex("A4", "a")]), "kg").routines[0]?.lines ?? [];
    expect(lines.map((l) => l.errors.superset)).toEqual([
      undefined,
      undefined,
      undefined,
      "gymFormat.supersetSplit",
      "gymFormat.supersetSplit",
    ]);
  });

  it("leaves two different consecutive groups alone", () => {
    const lines = parseWorkoutFile(v2([ex("A1", "A"), ex("A2", "A"), ex("B1", "B"), ex("B2", "B")]), "kg").routines[0]?.lines ?? [];
    expect(lines.every((l) => l.errors.superset === undefined)).toBe(true);
  });

  it("validateLines re-checks a whole routine, including the split flag", () => {
    const lines = parseWorkoutFile(v2([ex("A1", "A"), ex("Mid"), ex("A2", "A")]), "kg").routines[0]?.lines ?? [];
    const checked = validateLines(lines.map((l) => ({ ...l, errors: {} })));
    expect(checked.map((l) => l.errors.superset)).toEqual([undefined, undefined, "gymFormat.supersetSplit"]);
    // fixing the middle exercise's neighbour order clears it
    const [first, mid, last] = lines;
    const regrouped = validateLines([first, last, mid].map((l) => ({ ...(l as DraftLine), errors: {} })));
    expect(regrouped.every((l) => l.errors.superset === undefined)).toBe(true);
  });
});
