import type { ExerciseKind, RoutineImport, WeightUnit } from "../api/types";
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
}

/** Why the text could not be read at all. The review never opens for these. */
export class ImportError extends Error {
  constructor(public readonly key: MessageKey) {
    super(key);
    this.name = "ImportError";
  }
}

/**
 * Find the JSON in `text`: a ```json fence first, else the first `{` to its matching `}`.
 * Throws `ImportError` when there is none.
 */
export function extractJson(text: string): unknown {
  void text;
  throw new Error("TODO(F1): extractJson");
}

/**
 * Read `text` into draft routines in the account's `unit`. Throws `ImportError` when the text
 * holds no readable workout; returns field-level problems inside the drafts otherwise.
 */
export function parseWorkoutFile(text: string, unit: WeightUnit): ParsedImport {
  void text;
  void unit;
  throw new Error("TODO(F1): parseWorkoutFile");
}

/** Re-check one line after the review edited it. Returns the same line with fresh `errors`. */
export function validateLine(line: DraftLine): DraftLine {
  void line;
  throw new Error("TODO(F1): validateLine");
}

/** The request body for `api.importRoutine`. Only call on a routine whose lines have no errors. */
export function toImportBody(routine: DraftRoutine): RoutineImport {
  void routine;
  throw new Error("TODO(F1): toImportBody");
}

/** kg ↔ lb, rounded to the nearest 0.5. */
export function convertWeight(value: number, from: WeightUnit, to: WeightUnit): number {
  void value;
  void from;
  void to;
  throw new Error("TODO(F1): convertWeight");
}
