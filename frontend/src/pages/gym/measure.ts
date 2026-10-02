import type {
  ExerciseKind,
  HistoryPoint,
  RoutineDetail,
  WeightUnit,
  Workout,
} from "../../api/types";
import type { Translate } from "../../i18n";
import type { ActiveSession } from "../../gym/session";

/**
 * Small pure helpers the gym views share (Epic 42): how a target or a set is written, how a
 * time or a distance is shown, how a typed number is read. No React, no storage.
 */

/** The targets a routine line and a session exercise both carry. */
export interface Targets {
  kind: ExerciseKind;
  target_sets: number | null;
  target_reps: number | null;
  target_seconds: number | null;
  target_distance_m: number | null;
  target_weight: string | null;
  rest_seconds: number | null;
}

/** The measures of one set. */
export interface Measures {
  kind: ExerciseKind;
  reps: number | null;
  weight: string | null;
  duration_seconds: number | null;
  distance_m: number | null;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** A clock reading: 75 -> "1:15", 3725 -> "1:02:05". Used by every timer. */
export function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** A length of time in a target or a set: 45 -> "45 s", 90 -> "1:30". */
export function formatSeconds(seconds: number): string {
  return seconds < 60 ? `${seconds} s` : clock(seconds);
}

function number(lang: string, value: number, digits = 2): string {
  return new Intl.NumberFormat(lang, { maximumFractionDigits: digits }).format(value);
}

/** 800 -> "800 m", 2000 -> "2 km", 1500 -> "1.5 km" (a comma in French). */
export function formatDistance(metres: number, lang: string): string {
  return metres < 1000 ? `${metres} m` : `${number(lang, metres / 1000)} km`;
}

/** "60.00" -> "60 kg", "62.50" -> "62.5 kg". */
export function formatWeight(weight: string, unit: WeightUnit, lang: string): string {
  return `${number(lang, Number(weight))} ${unit}`;
}

/** "4 × 8 · 60 kg", "3 × 45 s", "1 × 2 km", "4 sets", or "" for a line with no target. */
export function formatTarget(line: Targets, unit: WeightUnit, t: Translate): string {
  const measure =
    line.kind === "duration"
      ? line.target_seconds === null
        ? null
        : formatSeconds(line.target_seconds)
      : line.kind === "distance"
        ? line.target_distance_m === null
          ? null
          : formatDistance(line.target_distance_m, t.lang)
        : line.target_reps === null
          ? null
          : String(line.target_reps);
  let text = "";
  if (line.target_sets !== null && measure !== null) text = `${line.target_sets} × ${measure}`;
  else if (measure !== null) text = measure;
  else if (line.target_sets !== null) text = t.n("gym.setsCount", line.target_sets);
  if (line.target_weight !== null) {
    const w = formatWeight(line.target_weight, unit, t.lang);
    text = text ? `${text} · ${w}` : w;
  }
  return text;
}

/** One set: "8 × 60 kg", "8 reps", "45 s", "2 km · 10 kg". */
export function formatSet(set: Measures, unit: WeightUnit, t: Translate): string {
  let measure: string;
  if (set.kind === "duration") measure = formatSeconds(set.duration_seconds ?? 0);
  else if (set.kind === "distance") measure = formatDistance(set.distance_m ?? 0, t.lang);
  else measure = t.n("gym.repsCount", set.reps ?? 0);
  if (set.weight === null) return measure;
  const w = formatWeight(set.weight, unit, t.lang);
  return set.kind === "reps" ? `${set.reps ?? 0} × ${w}` : `${measure} · ${w}`;
}

/** The rest after a set when the line names none (the session model applies the same). */
export function defaultRest(kind: ExerciseKind): number {
  return kind === "reps" ? 90 : 60;
}

/** Rough minutes for a routine: working time of every target plus the rests between sets. */
export function estimateMinutes(routine: RoutineDetail): number {
  let seconds = 0;
  for (const line of routine.lines) {
    const sets = line.target_sets ?? 1;
    // A rep takes about three seconds; a distance without a pace is guessed at 4 min/km.
    const work =
      line.kind === "duration"
        ? (line.target_seconds ?? 30)
        : line.kind === "distance"
          ? ((line.target_distance_m ?? 500) / 1000) * 240
          : (line.target_reps ?? 10) * 3;
    seconds += sets * work + sets * (line.rest_seconds ?? defaultRest(line.kind));
  }
  return Math.max(1, Math.round(seconds / 60));
}

/** Time between two ISO stamps in whole minutes, or null when either is missing. */
export function minutesBetween(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const ms = Date.parse(end) - Date.parse(start);
  return Number.isFinite(ms) && ms >= 0 ? Math.max(1, Math.round(ms / 60000)) : null;
}

// ---- typed numbers

/**
 * Read what was typed into a number field. A decimal comma is a decimal point; empty is
 * null. Returns NaN for anything else, so a caller can tell "blank" from "garbage".
 */
export function parseNumber(text: string): number | null {
  const trimmed = text.trim().replace(",", ".");
  if (trimmed === "") return null;
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === ".") return Number.NaN;
  return Number(trimmed);
}

/**
 * Keep only what a number field can hold, as it is typed — a controlled numeric input
 * cannot hold a partial decimal, so these are text inputs and this is their filter.
 */
export function sanitise(text: string, decimal: boolean, max?: number): string {
  let out: string;
  if (!decimal) {
    out = text.replace(/\D/g, "").slice(0, 7);
  } else {
    const cleaned = text.replace(/[^\d.,]/g, "");
    const match = /^(\d{0,6})([.,]?)(\d{0,2})/.exec(cleaned);
    out = match ? `${match[1]}${match[2]}${match[3]}` : "";
  }
  // Past the server's own bound the value is held at the bound, not left to fail at Finish.
  if (max !== undefined) {
    const value = parseNumber(out);
    if (value !== null && !Number.isNaN(value) && value > max) return String(max);
  }
  return out;
}

/** A number as the two-place string the API wants. */
export function toWeight(value: number): string {
  return value.toFixed(2);
}

/** The text a number field shows for a value. */
export function toText(value: number | null): string {
  return value === null ? "" : String(value);
}

/** ±step for a weight in the account's unit: 2.5 kg, 5 lb. */
export function weightStep(unit: WeightUnit): number {
  return unit === "lb" ? 5 : 2.5;
}

/** The ± step of the measure a kind counts in. */
export function measureStep(kind: ExerciseKind): number {
  return kind === "duration" ? 5 : kind === "distance" ? 100 : 1;
}

// ---- the end-of-session summary

export interface SessionSummary {
  seconds: number;
  sets: number;
  /** Sum of reps × weight, in the account's unit. */
  volume: number;
  /** Names of exercises up on last time. */
  bests: string[];
}

function peak(values: number[]): number | null {
  return values.length ? Math.max(...values) : null;
}

/** Duration, sets, volume and which exercises beat last time's figure (from the cache). */
export function summarise(
  session: ActiveSession,
  lastTime: Record<string, HistoryPoint>,
  now: Date,
): SessionSummary {
  let volume = 0;
  const bests: string[] = [];
  for (const exercise of session.exercises) {
    const sets = session.sets.filter((s) => s.exercise === exercise.key);
    for (const set of sets) {
      if (set.reps !== null && set.weight !== null) volume += set.reps * Number(set.weight);
    }
    const last = exercise.exercise_id ? lastTime[exercise.exercise_id] : undefined;
    if (!last || sets.length === 0) continue;
    let better = false;
    if (exercise.kind === "duration") {
      const best = peak(sets.map((s) => s.duration_seconds ?? 0));
      better = best !== null && last.best_seconds !== null && best > last.best_seconds;
    } else if (exercise.kind === "distance") {
      const best = peak(sets.map((s) => s.distance_m ?? 0));
      better = best !== null && last.best_distance_m !== null && best > last.best_distance_m;
    } else {
      const top = peak(sets.filter((s) => s.weight !== null).map((s) => Number(s.weight)));
      if (top !== null && last.top_weight !== null) better = top > Number(last.top_weight);
      else if (top === null && last.top_weight === null) {
        better = sets.reduce((sum, s) => sum + (s.reps ?? 0), 0) > last.reps;
      }
    }
    if (better) bests.push(exercise.name);
  }
  return {
    seconds: Math.max(0, Math.round((now.getTime() - Date.parse(session.started_at)) / 1000)),
    sets: session.sets.length,
    volume,
    bests,
  };
}

/** Most recently done first. */
export function byLastDone(routines: RoutineDetail[], lastDone: Record<string, string>) {
  return [...routines].sort((a, b) => (lastDone[b.id] ?? "").localeCompare(lastDone[a.id] ?? ""));
}

/** The date a workout list row shows its duration under. */
export function workoutMinutes(workout: Workout): number | null {
  return minutesBetween(workout.started_at, workout.ended_at);
}
