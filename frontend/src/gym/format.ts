import type { ExerciseKind, RoutineImport, RoutineImportLine, WeightUnit } from "../api/types";
import type { MessageKey } from "../i18n";

/**
 * The workout file format `ee-workout/1` (Epic 42, docs/epic-42-gym-revamp.md §5).
 *
 * Pure and offline: a file shared to the phone, picked from Files or pasted from a chat is
 * parsed here, never on the server. Nothing in the text is evaluated — it is `JSON.parse`d
 * and read field by field. The parser is deliberately forgiving about shape (an LLM wraps
 * JSON in prose, writes "8" for 8, adds keys) and deliberately strict about numbers: a value
 * it cannot read exactly is kept and flagged for the review, never guessed.
 */

export const FORMAT = "ee-workout/1";

/** Most exercises one imported routine may hold (the server's own limit, §4). */
export const MAX_LINES = 60;

/** Fields of a line the review can flag. */
export type LineField =
  | "name"
  | "kind"
  | "sets"
  | "reps"
  | "seconds"
  | "distance_m"
  | "weight"
  | "rest_seconds"
  | "rest_after_seconds"
  | "note"
  | "video_url";

/** One exercise of an imported routine, as the review edits it. Numbers are null when absent. */
export interface DraftLine {
  name: string;
  kind: ExerciseKind;
  /** True when `kind` was not in the file and was inferred from which measure was given. */
  kindInferred: boolean;
  sets: number | null;
  reps: number | null;
  seconds: number | null;
  distance_m: number | null;
  /** In the account's unit, as a number; serialised with two places by `toImportBody`. */
  weight: number | null;
  /** True when the file's weight_unit differed and `weight` was converted. */
  converted: boolean;
  rest_seconds: number | null;
  /** Rest after the exercise's last set, before the next exercise (Epic 43). */
  rest_after_seconds: number | null;
  note: string;
  video_url: string;
  /** Per-field problems, as message keys. Empty when the line can be created as is. */
  errors: Partial<Record<LineField, MessageKey>>;
}

export interface DraftRoutine {
  name: string;
  note: string;
  lines: DraftLine[];
}

export interface ParsedImport {
  routines: DraftRoutine[];
  /** Whole-file notes, e.g. "weights converted from lb". */
  warnings: MessageKey[];
  /** The week plan's day labels ("Push day", "rest", …), or null when the file has none. */
  schedule: string[] | null;
}

/** Why the text could not be read at all. The review never opens for these. */
export class ImportError extends Error {
  constructor(public readonly key: MessageKey) {
    super(key);
    this.name = "ImportError";
  }
}

/** Inclusive bounds of each numeric field — §4's ranges, shown by the review as hints. */
export const FIELD_RANGES = {
  sets: [1, 99],
  reps: [1, 999],
  seconds: [1, 86_400],
  distance_m: [1, 1_000_000],
  weight: [0, 99_999.99],
  rest_seconds: [0, 3_600],
  rest_after_seconds: [0, 3_600],
} as const;

/** Most sets one workout may hold (the server's own limit). */
export const MAX_SETS_PER_WORKOUT = 500;

type NumericField = keyof typeof FIELD_RANGES;

/** Fields that must be whole numbers. Weight may carry a half. */
const WHOLE: ReadonlySet<NumericField> = new Set([
  "sets",
  "reps",
  "seconds",
  "distance_m",
  "rest_seconds",
  "rest_after_seconds",
]);

const NAME_MAX = 80;
const LINE_NOTE_MAX = 200;
const ROUTINE_NOTE_MAX = 500;
const KG_PER_LB = 1 / 2.20462;
const LB_PER_KG = 2.20462;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Find the JSON in `text`: a ```json fence first, else the first `{` to its matching `}`.
 * Throws `ImportError` when there is none.
 *
 * The whole text is tried first, so a clean file never goes through the fence search.
 */
export function extractJson(text: string): unknown {
  const whole = tryParse(text.trim());
  if (isRecord(whole)) return whole;

  const fence = /```(?:json|JSON)?[^\S\r\n]*\r?\n?([\s\S]*?)```/g;
  for (let match = fence.exec(text); match !== null; match = fence.exec(text)) {
    const inside = tryParse((match[1] ?? "").trim());
    if (isRecord(inside)) return inside;
  }

  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) {
    const slice = tryParse(text.slice(first, last + 1));
    if (isRecord(slice)) return slice;
  }
  throw new ImportError("gymCore.import.unreadable");
}

/** kg ↔ lb, rounded to the nearest 0.5. */
export function convertWeight(value: number, from: WeightUnit, to: WeightUnit): number {
  if (from === to) return value;
  const converted = from === "kg" ? value * LB_PER_KG : value * KG_PER_LB;
  return Math.round(converted * 2) / 2;
}

/** What a numeric field of the file held. `null` value with an error: unreadable. */
interface Read {
  value: number | null;
  error?: MessageKey;
}

function readNumber(raw: unknown): Read {
  if (raw === undefined || raw === null) return { value: null };
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? { value: raw } : { value: null, error: "gymCore.field.number" };
  }
  if (typeof raw === "string") {
    const text = raw.trim().replace(/\s/g, "");
    if (text === "") return { value: null };
    // Decimal comma (French keyboards, French chat answers). A comma then exactly three digits
    // ("1,000", "1,250") is a thousands separator in English and a decimal in French: it is not
    // guessed at, the field is flagged and left empty so the person types it again.
    if (/^[+-]?\d{1,3},\d{3}$/.test(text)) {
      return { value: null, error: "gymCore.field.ambiguous" };
    }
    if (!/^[+-]?(\d+([.,]\d*)?|[.,]\d+)$/.test(text)) {
      return { value: null, error: "gymCore.field.number" };
    }
    const value = Number(text.replace(",", "."));
    return Number.isFinite(value) ? { value } : { value: null, error: "gymCore.field.number" };
  }
  return { value: null, error: "gymCore.field.number" };
}

/** The problem with a number already read, if any. Absent (null) is never a problem here. */
function rangeError(field: NumericField, value: number | null): MessageKey | undefined {
  if (value === null) return undefined;
  if (!Number.isFinite(value)) return "gymCore.field.number";
  if (WHOLE.has(field) && !Number.isInteger(value)) return "gymCore.field.whole";
  const [low, high] = FIELD_RANGES[field];
  return value < low || value > high ? "gymCore.field.range" : undefined;
}

function readText(raw: unknown): string {
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return "";
}

/** https only, and a real URL. Empty is fine: the link is optional. */
function urlError(value: string): MessageKey | undefined {
  if (value === "") return undefined;
  try {
    return new URL(value).protocol === "https:" ? undefined : "gymCore.field.url";
  } catch {
    return "gymCore.field.url";
  }
}

const KIND_WORDS: Record<string, ExerciseKind> = {
  reps: "reps",
  rep: "reps",
  duration: "duration",
  time: "duration",
  distance: "distance",
};

type Errors = DraftLine["errors"];

/** Checks that depend only on a line's current values — shared by parse and the review. */
function checkLine(line: DraftLine): Errors {
  const errors: Errors = {};
  if (line.name.trim() === "") errors.name = "gymCore.field.required";
  else if (line.name.trim().length > NAME_MAX) errors.name = "gymCore.field.tooLong";
  const numeric: [NumericField, number | null, LineField][] = [
    ["sets", line.sets, "sets"],
    ["reps", line.reps, "reps"],
    ["seconds", line.seconds, "seconds"],
    ["distance_m", line.distance_m, "distance_m"],
    ["weight", line.weight, "weight"],
    ["rest_seconds", line.rest_seconds, "rest_seconds"],
    ["rest_after_seconds", line.rest_after_seconds, "rest_after_seconds"],
  ];
  for (const [field, value, slot] of numeric) {
    const problem = rangeError(field, value);
    if (problem) errors[slot] = problem;
  }
  if (line.note.length > LINE_NOTE_MAX) errors.note = "gymCore.field.tooLong";
  const link = urlError(line.video_url.trim());
  if (link) errors.video_url = link;
  return errors;
}

/** Re-check one line after the review edited it. Returns the same line with fresh `errors`. */
export function validateLine(line: DraftLine): DraftLine {
  const errors = checkLine(line);
  // A value the parser could not read is `null` — and a null is not a problem by itself, so
  // re-checking would otherwise clear the very flag that says a number went missing. It stays
  // until the field is given a value.
  for (const field of ["sets", "reps", "seconds", "distance_m", "weight", "rest_seconds", "rest_after_seconds"] as const) {
    const kept = line.errors[field];
    if ((kept === "gymCore.field.number" || kept === "gymCore.field.ambiguous") && line[field] === null) {
      errors[field] = kept;
    }
  }
  if (line.errors.kind !== undefined && line.kindInferred) errors.kind = line.errors.kind;
  return { ...line, errors };
}

/**
 * True when the line holds a measure its kind does not count (kind reps + seconds): the
 * request body leaves it out, so the review says so rather than dropping it silently.
 */
export function hasDroppedMeasure(line: DraftLine): boolean {
  if (line.kind !== "reps" && line.reps !== null) return true;
  if (line.kind !== "duration" && line.seconds !== null) return true;
  if (line.kind !== "distance" && line.distance_m !== null) return true;
  return false;
}

/** Routine-level problems the lines do not carry: a name is required, notes are bounded. */
export function validateRoutine(routine: DraftRoutine): {
  name?: MessageKey;
  note?: MessageKey;
} {
  const problems: { name?: MessageKey; note?: MessageKey } = {};
  const name = routine.name.trim();
  if (name === "") problems.name = "gymCore.field.required";
  else if (name.length > NAME_MAX) problems.name = "gymCore.field.tooLong";
  if (routine.note.trim().length > ROUTINE_NOTE_MAX) problems.note = "gymCore.field.tooLong";
  return problems;
}

function unitOf(raw: unknown): WeightUnit | "unknown" | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") return "unknown";
  const word = raw.trim().toLowerCase();
  if (["kg", "kgs", "kilogram", "kilograms", "kilo", "kilos"].includes(word)) return "kg";
  if (["lb", "lbs", "pound", "pounds"].includes(word)) return "lb";
  return "unknown";
}

function readLine(
  raw: Record<string, unknown>,
  fileUnit: WeightUnit,
  accountUnit: WeightUnit,
): DraftLine {
  const parseErrors: Errors = {};
  const num = (field: NumericField, key: string): number | null => {
    const read = readNumber(raw[key]);
    if (read.error) parseErrors[field] = read.error;
    return read.value;
  };
  const sets = num("sets", "sets");
  const reps = num("reps", "reps");
  const seconds = num("seconds", "seconds");
  const distance = num("distance_m", "distance_m");
  const rest = num("rest_seconds", "rest_seconds");
  const restAfter = num("rest_after_seconds", "rest_after_seconds");
  let weight = num("weight", "weight");

  const hasValue = (key: string) => {
    const value = raw[key];
    return value !== undefined && value !== null && !(typeof value === "string" && value.trim() === "");
  };
  const rawKind = typeof raw["kind"] === "string" ? raw["kind"].trim().toLowerCase() : "";
  let kind: ExerciseKind;
  let kindInferred = false;
  if (rawKind in KIND_WORDS) {
    kind = KIND_WORDS[rawKind] as ExerciseKind;
  } else {
    kindInferred = true;
    kind = hasValue("seconds") ? "duration" : hasValue("distance_m") ? "distance" : "reps";
    if (hasValue("kind")) parseErrors.kind = "gymCore.field.kind";
  }

  let converted = false;
  if (weight !== null && weight >= 0 && fileUnit !== accountUnit) {
    weight = convertWeight(weight, fileUnit, accountUnit);
    converted = true;
  }

  const line: DraftLine = {
    name: readText(raw["name"] ?? raw["exercise_name"]),
    kind,
    kindInferred,
    sets,
    reps,
    seconds,
    distance_m: distance,
    weight,
    converted,
    rest_seconds: rest,
    rest_after_seconds: restAfter,
    note: readText(raw["note"]),
    video_url: readText(raw["video_url"]),
    errors: {},
  };
  line.errors = { ...checkLine(line), ...parseErrors };
  return line;
}

/** Most day labels a schedule may hold. */
export const MAX_SCHEDULE = 14;

/** An array of at most 14 strings, each trimmed and at most 80 long; anything else is ignored. */
function readSchedule(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_SCHEDULE) return null;
  const days: string[] = [];
  for (const day of raw) {
    if (typeof day !== "string") return null;
    const label = day.trim();
    if (label.length > NAME_MAX) return null;
    days.push(label);
  }
  return days;
}

/**
 * Read `text` into draft routines in the account's `unit`. Throws `ImportError` when the text
 * holds no readable workout; returns field-level problems inside the drafts otherwise.
 */
export function parseWorkoutFile(text: string, unit: WeightUnit): ParsedImport {
  const root = extractJson(text);
  if (!isRecord(root)) throw new ImportError("gymCore.import.unreadable");

  let rawRoutines: unknown[];
  if (Array.isArray(root["routines"])) rawRoutines = root["routines"];
  else if (Array.isArray(root["exercises"])) rawRoutines = [root];
  else throw new ImportError("gymCore.import.unreadable");

  const warnings: MessageKey[] = [];
  const declared = unitOf(root["weight_unit"]);
  let fileUnit: WeightUnit = unit;
  if (declared === "unknown") warnings.push("gymCore.warn.unitUnknown");
  else if (declared !== null) fileUnit = declared;

  const routines: DraftRoutine[] = [];
  let skipped = false;
  let emptyRoutine = false;
  let anyConverted = false;
  for (const entry of rawRoutines) {
    if (!isRecord(entry) || !Array.isArray(entry["exercises"])) {
      skipped = true;
      continue;
    }
    const rawLines = entry["exercises"];
    if (rawLines.length > MAX_LINES) throw new ImportError("gymCore.import.tooMany");
    const lines: DraftLine[] = [];
    for (const rawLine of rawLines) {
      if (!isRecord(rawLine)) {
        skipped = true;
        continue;
      }
      const line = readLine(rawLine, fileUnit, unit);
      anyConverted ||= line.converted;
      lines.push(line);
    }
    if (lines.length === 0) {
      emptyRoutine = true;
      continue;
    }
    routines.push({ name: readText(entry["name"]), note: readText(entry["note"]), lines });
  }
  if (routines.length === 0) throw new ImportError("gymCore.import.noExercises");

  if (anyConverted) {
    warnings.push(fileUnit === "lb" ? "gymCore.warn.fromLb" : "gymCore.warn.fromKg");
  }
  if (routines.some((routine) => routine.lines.some(hasDroppedMeasure))) {
    warnings.push("gymCore.warn.droppedMeasure");
  }
  if (emptyRoutine) warnings.push("gymCore.warn.emptyRoutine");
  if (skipped) warnings.push("gymCore.warn.skipped");
  return { routines, warnings, schedule: readSchedule(root["schedule"]) };
}

/** The request body for the import-routine call. Only call on a routine whose lines have no errors. */
export function toImportBody(routine: DraftRoutine): RoutineImport {
  const lines: RoutineImportLine[] = routine.lines.map((line) => {
    const out: RoutineImportLine = { exercise_name: line.name.trim(), kind: line.kind };
    const link = line.video_url.trim();
    if (link !== "") out.video_url = link;
    if (line.sets !== null) out.target_sets = line.sets;
    // Only the measure the kind is counted in: a plank's "reps" would be a second answer to
    // a question the kind has already settled.
    if (line.kind === "reps" && line.reps !== null) out.target_reps = line.reps;
    if (line.kind === "duration" && line.seconds !== null) out.target_seconds = line.seconds;
    if (line.kind === "distance" && line.distance_m !== null) out.target_distance_m = line.distance_m;
    if (line.weight !== null) out.target_weight = line.weight.toFixed(2);
    if (line.rest_seconds !== null) out.rest_seconds = line.rest_seconds;
    if (line.rest_after_seconds !== null) out.rest_after_seconds = line.rest_after_seconds;
    if (line.note.trim() !== "") out.note = line.note.trim();
    return out;
  });
  const body: RoutineImport = { name: routine.name.trim(), lines };
  if (routine.note.trim() !== "") body.note = routine.note.trim();
  return body;
}
