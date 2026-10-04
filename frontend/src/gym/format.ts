import type {
  ExerciseKind,
  RoutineImport,
  RoutineImportLine,
  SetTarget,
  WeightUnit,
} from "../api/types";
import type { MessageKey } from "../i18n";

/**
 * The workout file format `ee-workout/2` (Epic 54, docs/epic-54-gym-format-v2.md §2; v1 from
 * Epic 42 is a subset and is still read).
 *
 * Pure and offline: a file shared to the phone, picked from Files or pasted from a chat is
 * parsed here, never on the server. Nothing in the text is evaluated — it is `JSON.parse`d
 * and read field by field. The parser is deliberately forgiving about shape (an LLM wraps
 * JSON in prose, writes "8" for 8, adds keys) and deliberately strict about numbers: a value
 * it cannot read exactly is kept and flagged for the review, never guessed.
 */

export const FORMAT = "ee-workout/2";

/** The format of files written before Epic 54. Read by the same parser. */
export const LEGACY_FORMAT = "ee-workout/1";

/** Most exercises one imported routine may hold (the server's own limit, §4). */
export const MAX_LINES = 60;

/** Longest superset label the file may carry. */
export const SUPERSET_LABEL_MAX = 8;

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
  | "video_url"
  | "set_targets"
  | "rpe"
  | "rir"
  | "tempo"
  | "superset";

/** The fields of one set that can be flagged. */
export type SetField = "reps" | "seconds" | "distance_m" | "weight";

/** One set of a per-set exercise (`sets` as an array in the file). Numbers are null when absent. */
export interface DraftSet {
  reps: number | null;
  seconds: number | null;
  distance_m: number | null;
  /** In the account's unit, as a number; serialised with two places by `toImportBody`. */
  weight: number | null;
  warmup: boolean;
  errors: Partial<Record<SetField, MessageKey>>;
}

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
  /** True when the file's weight_unit differed and `weight` (or a set's weight) was converted. */
  converted: boolean;
  rest_seconds: number | null;
  /** Rest after the exercise's last set, before the next exercise (Epic 43). */
  rest_after_seconds: number | null;
  note: string;
  video_url: string;
  /** Per-set targets (Epic 54). Null = uniform sets: the flat fields apply. */
  setTargets: DraftSet[] | null;
  /** Effort: RPE 1-10 in halves, or RIR 0-10. Not both. */
  rpe: number | null;
  rir: number | null;
  /** "3-1-1-0"; "" = none. Upper-cased when sent. */
  tempo: string;
  /** The file's superset label; "" = none. */
  superset: string;
  /**
   * Per-field problems, as message keys. Empty when the line can be created as is. A problem in
   * any set also sets `set_targets`, so "no keys" still means "nothing blocks Confirm".
   */
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
  rpe: [1, 10],
  rir: [0, 10],
} as const;

/** Most sets one workout may hold (the server's own limit). */
export const MAX_SETS_PER_WORKOUT = 500;

type NumericField = keyof typeof FIELD_RANGES;

/** Fields that must be whole numbers. Weight may carry a half; RPE is checked in halves. */
const WHOLE: ReadonlySet<NumericField> = new Set([
  "sets",
  "reps",
  "seconds",
  "distance_m",
  "rest_seconds",
  "rest_after_seconds",
  "rir",
]);

const NAME_MAX = 80;
const LINE_NOTE_MAX = 200;
const ROUTINE_NOTE_MAX = 500;
const KG_PER_LB = 1 / 2.20462;
const LB_PER_KG = 2.20462;
const TEMPO = /^[0-9X]-[0-9X]-[0-9X]-[0-9X]$/;

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
type SetErrors = DraftSet["errors"];

const SET_FIELDS = ["reps", "seconds", "distance_m", "weight"] as const;

/** A set with nothing in it yet — what the editor adds with "Add set". */
export function blankSet(): DraftSet {
  return { reps: null, seconds: null, distance_m: null, weight: null, warmup: false, errors: {} };
}

/** Checks that depend only on a set's current values. */
function checkSet(set: DraftSet): SetErrors {
  const errors: SetErrors = {};
  for (const field of SET_FIELDS) {
    const problem = rangeError(field, set[field]);
    if (problem) errors[field] = problem;
  }
  return errors;
}

/**
 * Re-check one set after the review edited it. Like a line, a number the parser could not
 * read stays flagged until the field is given a value.
 */
export function validateSet(set: DraftSet): DraftSet {
  const errors = checkSet(set);
  for (const field of SET_FIELDS) {
    const kept = set.errors[field];
    if ((kept === "gymCore.field.number" || kept === "gymCore.field.ambiguous") && set[field] === null) {
      errors[field] = kept;
    }
  }
  return { ...set, errors };
}

/** True when any set of the line carries a problem. */
export function hasSetErrors(line: DraftLine): boolean {
  return (line.setTargets ?? []).some((set) => Object.keys(set.errors).length > 0);
}

/** A tempo as it is sent: trimmed and upper-cased. */
export function normalTempo(tempo: string): string {
  return tempo.trim().toUpperCase();
}

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
    ["rpe", line.rpe, "rpe"],
    ["rir", line.rir, "rir"],
  ];
  for (const [field, value, slot] of numeric) {
    const problem = rangeError(field, value);
    if (problem) errors[slot] = problem;
  }
  if (line.rpe !== null && !errors.rpe && !Number.isInteger(line.rpe * 2)) {
    errors.rpe = "gymFormat.rpeStep";
  }
  if (line.rpe !== null && line.rir !== null) {
    errors.rpe = "gymFormat.effortBoth";
    errors.rir = "gymFormat.effortBoth";
  }
  const tempo = normalTempo(line.tempo);
  if (tempo !== "" && !TEMPO.test(tempo)) errors.tempo = "gymFormat.tempo";
  if (line.superset.trim().length > SUPERSET_LABEL_MAX) errors.superset = "gymFormat.supersetLong";
  if (line.note.length > LINE_NOTE_MAX) errors.note = "gymCore.field.tooLong";
  const link = urlError(line.video_url.trim());
  if (link) errors.video_url = link;
  return errors;
}

/**
 * Re-check one line after the review edited it. Returns the same line with fresh `errors`,
 * its sets re-checked too. A superset label reused after a break needs the neighbours: use
 * `validateLines` for that.
 */
export function validateLine(line: DraftLine): DraftLine {
  const setTargets = line.setTargets ? line.setTargets.map(validateSet) : null;
  const errors = checkLine(line);
  // A value the parser could not read is `null` — and a null is not a problem by itself, so
  // re-checking would otherwise clear the very flag that says a number went missing. It stays
  // until the field is given a value.
  for (const field of ["sets", "reps", "seconds", "distance_m", "weight", "rest_seconds", "rest_after_seconds", "rpe", "rir"] as const) {
    const kept = line.errors[field];
    if ((kept === "gymCore.field.number" || kept === "gymCore.field.ambiguous") && line[field] === null) {
      errors[field] = kept;
    }
  }
  if (line.errors.kind !== undefined && line.kindInferred) errors.kind = line.errors.kind;
  if (setTargets?.some((set) => Object.keys(set.errors).length > 0)) {
    errors.set_targets = "gymFormat.setsInvalid";
  }
  return { ...line, setTargets, errors };
}

const supersetKey = (line: DraftLine) => line.superset.trim().toUpperCase();

/**
 * Re-check every line of a routine, and flag a superset label that comes back after another
 * exercise came between (the later run is flagged; the first is left alone).
 */
export function validateLines(lines: DraftLine[]): DraftLine[] {
  const closed = new Set<string>();
  let previous = "";
  return lines.map((raw) => {
    let line = validateLine(raw);
    const key = supersetKey(line);
    if (key !== previous && previous !== "") closed.add(previous);
    previous = key;
    if (key !== "" && closed.has(key) && !line.errors.superset) {
      line = { ...line, errors: { ...line.errors, superset: "gymFormat.supersetSplit" } };
    }
    return line;
  });
}

/**
 * True when the line holds a measure its kind does not count (kind reps + seconds): the
 * request body leaves it out, so the review says so rather than dropping it silently.
 * Per-set measures count too.
 */
export function hasDroppedMeasure(line: DraftLine): boolean {
  const stray = (m: { reps: number | null; seconds: number | null; distance_m: number | null }) =>
    (line.kind !== "reps" && m.reps !== null) ||
    (line.kind !== "duration" && m.seconds !== null) ||
    (line.kind !== "distance" && m.distance_m !== null);
  return stray(line) || (line.setTargets ?? []).some(stray);
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

const hasValue = (raw: Record<string, unknown>, key: string) => {
  const value = raw[key];
  return value !== undefined && value !== null && !(typeof value === "string" && value.trim() === "");
};

/** Read a weight and convert it from the file's unit; `converted` says whether it was. */
function readWeight(
  raw: unknown,
  fileUnit: WeightUnit,
  accountUnit: WeightUnit,
): Read & { converted: boolean } {
  const read = readNumber(raw);
  if (read.value !== null && read.value >= 0 && fileUnit !== accountUnit) {
    return { ...read, value: convertWeight(read.value, fileUnit, accountUnit), converted: true };
  }
  return { ...read, converted: false };
}

function readSet(
  raw: Record<string, unknown>,
  fileUnit: WeightUnit,
  accountUnit: WeightUnit,
): { set: DraftSet; converted: boolean } {
  const parseErrors: SetErrors = {};
  const num = (field: "reps" | "seconds" | "distance_m"): number | null => {
    const read = readNumber(raw[field]);
    if (read.error) parseErrors[field] = read.error;
    return read.value;
  };
  const reps = num("reps");
  const seconds = num("seconds");
  const distance = num("distance_m");
  const weight = readWeight(raw["weight"], fileUnit, accountUnit);
  if (weight.error) parseErrors.weight = weight.error;
  const warmup = raw["warmup"] === true || raw["warmup"] === "true";
  const set: DraftSet = {
    reps,
    seconds,
    distance_m: distance,
    weight: weight.value,
    warmup,
    errors: {},
  };
  set.errors = { ...checkSet(set), ...parseErrors };
  return { set, converted: weight.converted };
}

function readLine(
  raw: Record<string, unknown>,
  fileUnit: WeightUnit,
  accountUnit: WeightUnit,
): { line: DraftLine; skippedSet: boolean } {
  const parseErrors: Errors = {};
  const num = (field: NumericField, key: string): number | null => {
    const read = readNumber(raw[key]);
    if (read.error) parseErrors[field] = read.error;
    return read.value;
  };

  // `sets` is a number (uniform sets) or a list of per-set objects (Epic 54).
  let sets: number | null = null;
  let setTargets: DraftSet[] | null = null;
  let converted = false;
  let skippedSet = false;
  if (Array.isArray(raw["sets"])) {
    const list: DraftSet[] = [];
    for (const entry of raw["sets"]) {
      if (!isRecord(entry)) {
        skippedSet = true;
        continue;
      }
      const read = readSet(entry, fileUnit, accountUnit);
      converted ||= read.converted;
      list.push(read.set);
    }
    if (list.length > 0) {
      setTargets = list;
      sets = list.length;
    }
  } else {
    sets = num("sets", "sets");
  }
  const reps = num("reps", "reps");
  const seconds = num("seconds", "seconds");
  const distance = num("distance_m", "distance_m");
  const rest = num("rest_seconds", "rest_seconds");
  const restAfter = num("rest_after_seconds", "rest_after_seconds");
  const rpe = num("rpe", "rpe");
  const rir = num("rir", "rir");
  const weightRead = readWeight(raw["weight"], fileUnit, accountUnit);
  if (weightRead.error) parseErrors.weight = weightRead.error;
  converted ||= weightRead.converted;

  const rawKind = typeof raw["kind"] === "string" ? raw["kind"].trim().toLowerCase() : "";
  let kind: ExerciseKind;
  let kindInferred = false;
  if (rawKind in KIND_WORDS) {
    kind = KIND_WORDS[rawKind] as ExerciseKind;
  } else {
    kindInferred = true;
    const setsHave = (field: "seconds" | "distance_m") =>
      (setTargets ?? []).some((set) => set[field] !== null);
    kind =
      hasValue(raw, "seconds") || setsHave("seconds")
        ? "duration"
        : hasValue(raw, "distance_m") || setsHave("distance_m")
          ? "distance"
          : "reps";
    if (hasValue(raw, "kind")) parseErrors.kind = "gymCore.field.kind";
  }

  const line: DraftLine = {
    name: readText(raw["name"] ?? raw["exercise_name"]),
    kind,
    kindInferred,
    sets,
    reps,
    seconds,
    distance_m: distance,
    weight: weightRead.value,
    converted,
    rest_seconds: rest,
    rest_after_seconds: restAfter,
    note: readText(raw["note"]),
    video_url: readText(raw["video_url"]),
    setTargets,
    rpe,
    rir,
    tempo: readText(raw["tempo"]),
    superset: readText(raw["superset"]),
    errors: {},
  };
  line.errors = { ...checkLine(line), ...parseErrors };
  if (setTargets?.some((set) => Object.keys(set.errors).length > 0)) {
    line.errors.set_targets = "gymFormat.setsInvalid";
  }
  return { line, skippedSet };
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

/** True when a superset label is used by exactly one exercise of the routine (it will be dropped). */
function hasLonelySuperset(lines: DraftLine[]): boolean {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const key = supersetKey(line);
    if (key !== "") counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.values()].some((count) => count === 1);
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
      const read = readLine(rawLine, fileUnit, unit);
      skipped ||= read.skippedSet;
      anyConverted ||= read.line.converted;
      lines.push(read.line);
    }
    if (lines.length === 0) {
      emptyRoutine = true;
      continue;
    }
    routines.push({
      name: readText(entry["name"]),
      note: readText(entry["note"]),
      lines: validateSupersets(lines),
    });
  }
  if (routines.length === 0) throw new ImportError("gymCore.import.noExercises");

  if (anyConverted) {
    warnings.push(fileUnit === "lb" ? "gymCore.warn.fromLb" : "gymCore.warn.fromKg");
  }
  if (routines.some((routine) => routine.lines.some(hasDroppedMeasure))) {
    warnings.push("gymCore.warn.droppedMeasure");
  }
  if (routines.some((routine) => hasLonelySuperset(routine.lines))) {
    warnings.push("gymFormat.warn.lonelySuperset");
  }
  if (emptyRoutine) warnings.push("gymCore.warn.emptyRoutine");
  if (skipped) warnings.push("gymCore.warn.skipped");
  return { routines, warnings, schedule: readSchedule(root["schedule"]) };
}

/**
 * Add the "label came back after a break" flag to freshly parsed lines, keeping every other
 * error (including the parse-only ones `validateLine` would lose).
 */
function validateSupersets(lines: DraftLine[]): DraftLine[] {
  const closed = new Set<string>();
  let previous = "";
  return lines.map((line) => {
    const key = supersetKey(line);
    if (key !== previous && previous !== "") closed.add(previous);
    previous = key;
    if (key !== "" && closed.has(key) && !line.errors.superset) {
      return { ...line, errors: { ...line.errors, superset: "gymFormat.supersetSplit" } };
    }
    return line;
  });
}

const weightText = (weight: number) => weight.toFixed(2);

/** The set targets of a line as the wire carries them: only the measure the kind counts. */
function wireSets(line: DraftLine, sets: DraftSet[]): SetTarget[] {
  return sets.map((set) => ({
    reps: line.kind === "reps" ? set.reps : null,
    seconds: line.kind === "duration" ? set.seconds : null,
    distance_m: line.kind === "distance" ? set.distance_m : null,
    weight: set.weight !== null ? weightText(set.weight) : null,
    warmup: set.warmup,
  }));
}

/** The request body for the import-routine call. Only call on a routine whose lines have no errors. */
export function toImportBody(routine: DraftRoutine): RoutineImport {
  // Superset labels -> 1, 2, … by first appearance; a label used by one exercise is dropped.
  const counts = new Map<string, number>();
  for (const line of routine.lines) {
    const key = supersetKey(line);
    if (key !== "") counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const groups = new Map<string, number>();
  for (const line of routine.lines) {
    const key = supersetKey(line);
    if (key !== "" && (counts.get(key) ?? 0) > 1 && !groups.has(key)) groups.set(key, groups.size + 1);
  }

  const lines: RoutineImportLine[] = routine.lines.map((line) => {
    const out: RoutineImportLine = { exercise_name: line.name.trim(), kind: line.kind };
    const link = line.video_url.trim();
    if (link !== "") out.video_url = link;

    const perSet = line.setTargets !== null && line.setTargets.length > 0 ? line.setTargets : null;
    // With per-set targets the flat fields follow the first working set (the server does the
    // same on every write); the body is kept coherent so nothing depends on that.
    const flat: Pick<DraftSet, "reps" | "seconds" | "distance_m" | "weight"> = perSet
      ? (perSet.find((set) => !set.warmup) ?? (perSet[0] as DraftSet))
      : line;
    if (perSet) {
      out.set_targets = wireSets(line, perSet);
      out.target_sets = perSet.length;
    } else if (line.sets !== null) {
      out.target_sets = line.sets;
    }
    // Only the measure the kind is counted in: a plank's "reps" would be a second answer to
    // a question the kind has already settled.
    if (line.kind === "reps" && flat.reps !== null) out.target_reps = flat.reps;
    if (line.kind === "duration" && flat.seconds !== null) out.target_seconds = flat.seconds;
    if (line.kind === "distance" && flat.distance_m !== null) out.target_distance_m = flat.distance_m;
    if (flat.weight !== null) out.target_weight = weightText(flat.weight);
    if (line.rest_seconds !== null) out.rest_seconds = line.rest_seconds;
    if (line.rest_after_seconds !== null) out.rest_after_seconds = line.rest_after_seconds;
    if (line.rpe !== null) out.target_rpe = line.rpe;
    if (line.rir !== null) out.target_rir = line.rir;
    const tempo = normalTempo(line.tempo);
    if (tempo !== "") out.tempo = tempo;
    const group = groups.get(supersetKey(line));
    if (group !== undefined) out.superset_group = group;
    if (line.note.trim() !== "") out.note = line.note.trim();
    return out;
  });
  const body: RoutineImport = { name: routine.name.trim(), lines };
  if (routine.note.trim() !== "") body.note = routine.note.trim();
  return body;
}
