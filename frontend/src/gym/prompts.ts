import type { ExerciseKind, WeightUnit, WorkoutDetail } from "../api/types";
import { type Lang, type MessageKey, translator } from "../i18n";
import type { GymCache } from "./store";

/**
 * Prompts for Claude or ChatGPT, one per kind of person (Epic 43, docs/epic-43-gym-ai-and-rest.md §6).
 *
 * Pure: the page passes the device cache in and gets a string out. The person's context — unit,
 * exercise names, routines, last sessions — is written into the prompt so the AI reuses the
 * names the app already has (an import then matches existing exercises instead of coining
 * near-duplicates) and, for `fresh` and `progress`, can see what was done. The text is handed
 * over by the clipboard only; it never goes in a URL.
 */

export type PromptProfile = "notes" | "build" | "fresh" | "quick" | "progress" | "home";

export interface ProfileSpec {
  id: PromptProfile;
  /** Card title and its one-line description. */
  title: MessageKey;
  description: MessageKey;
  /** A decorative glyph for the card (aria-hidden). */
  glyph: string;
  /** Whether the card offers a notes box whose text is written into the prompt. */
  takesNotes: boolean;
}

const spec = (id: PromptProfile, glyph: string, takesNotes = false): ProfileSpec => ({
  id,
  title: `gymPrompt.${id}.title` as MessageKey,
  description: `gymPrompt.${id}.description` as MessageKey,
  glyph,
  takesNotes,
});

/** In the order the cards are shown. */
export const PROFILES: readonly ProfileSpec[] = [
  spec("notes", "✎", true),
  spec("build", "✦"),
  spec("fresh", "↻"),
  spec("quick", "⏱"),
  spec("progress", "↗"),
  spec("home", "⌂"),
];

export interface PromptContext {
  unit: WeightUnit;
  /** Max 60, most used first. */
  exercises: { name: string; kind: ExerciseKind }[];
  /** Max 10: routine name and its exercise names in order. */
  routines: { name: string; exercises: string[] }[];
  /** Max 10, newest first, one line each, already formatted (rest days included). */
  recent: string[];
}

export const MAX_CONTEXT_EXERCISES = 60;
export const MAX_CONTEXT_ROUTINES = 10;
export const MAX_CONTEXT_RECENT = 10;

/** "62.50" → "62.5", "60.00" → "60": the way a person writes a weight. */
function plainWeight(weight: string): string {
  const value = Number(weight);
  return Number.isFinite(value) ? String(value) : weight;
}

/** The set an exercise was mostly done with: most common measure+weight, heavier on a tie. */
function typicalSet(sets: WorkoutDetail["sets"]): WorkoutDetail["sets"][number] {
  const groups = new Map<string, { set: WorkoutDetail["sets"][number]; count: number }>();
  for (const set of sets) {
    const key = `${set.reps}|${set.duration_seconds}|${set.distance_m}|${set.weight}`;
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { set, count: 1 });
  }
  let best = [...groups.values()][0] as { set: WorkoutDetail["sets"][number]; count: number };
  for (const group of groups.values()) {
    const heavier = Number(group.set.weight ?? 0) > Number(best.set.weight ?? 0);
    if (group.count > best.count || (group.count === best.count && heavier)) best = group;
  }
  return best.set;
}

function sessionLine(
  workout: WorkoutDetail,
  routineName: string | undefined,
  unit: WeightUnit,
  t: ReturnType<typeof translator>,
): string {
  if (workout.rest_day) return t("gymPrompt.context.restDay", { date: workout.performed_on });
  const order: string[] = [];
  const byName = new Map<string, WorkoutDetail["sets"]>();
  for (const set of workout.sets) {
    const list = byName.get(set.exercise_name);
    if (list) list.push(set);
    else {
      byName.set(set.exercise_name, [set]);
      order.push(set.exercise_name);
    }
  }
  const parts = order.map((name) => {
    const sets = byName.get(name) ?? [];
    const set = typicalSet(sets);
    const measure =
      set.reps !== null
        ? `${set.reps}`
        : set.duration_seconds !== null
          ? `${set.duration_seconds} s`
          : set.distance_m !== null
            ? `${set.distance_m} m`
            : "";
    const weight = set.weight !== null ? ` @ ${plainWeight(set.weight)} ${unit}` : "";
    return `${name} ${sets.length}×${measure}${weight}`;
  });
  const label = routineName ?? t("gymPrompt.context.freeSession");
  return `${workout.performed_on} ${label}${parts.length > 0 ? `: ${parts.join(", ")}` : ""}`;
}

/**
 * Read the device cache and the recent sessions into the context block's facts. `lang` only
 * words the two labels inside the session lines ("free session", "rest day").
 */
export function buildPromptContext(
  cache: GymCache,
  recent: WorkoutDetail[],
  unit: WeightUnit,
  lang: Lang = "en",
): PromptContext {
  const t = translator(lang);
  const uses = new Map<string, number>();
  const bump = (id: string) => uses.set(id, (uses.get(id) ?? 0) + 1);
  for (const workout of recent) for (const set of workout.sets) bump(set.exercise_id);
  for (const routine of cache.routines) for (const line of routine.lines) bump(line.exercise_id);
  const lastSeen = (id: string) => cache.lastTime[id]?.performed_on ?? "";

  const exercises = cache.exercises
    .filter((exercise) => exercise.name.trim() !== "")
    .sort(
      (a, b) =>
        (uses.get(b.id) ?? 0) - (uses.get(a.id) ?? 0) ||
        lastSeen(b.id).localeCompare(lastSeen(a.id)) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, MAX_CONTEXT_EXERCISES)
    .map((exercise) => ({ name: exercise.name, kind: exercise.kind }));

  const routines = cache.routines.slice(0, MAX_CONTEXT_ROUTINES).map((routine) => ({
    name: routine.name,
    exercises: [...routine.lines]
      .sort((a, b) => a.position - b.position)
      .map((line) => line.exercise_name),
  }));

  const names = new Map(cache.routines.map((routine) => [routine.id, routine.name]));
  const lines = recent
    .slice(0, MAX_CONTEXT_RECENT)
    .map((workout) =>
      sessionLine(workout, workout.routine_id ? names.get(workout.routine_id) : undefined, unit, t),
    );

  return { unit, exercises, routines, recent: lines };
}

/** The "About me" block, with every empty part left out. Empty string when nothing is known. */
function contextBlock(context: PromptContext, t: ReturnType<typeof translator>): string {
  const lines: string[] = [t("gymPrompt.context.header"), t("gymPrompt.context.unit", { unit: context.unit })];
  if (context.exercises.length > 0) {
    const list = context.exercises
      .map((exercise) => `${exercise.name} (${t(`gymPrompt.context.kind.${exercise.kind}`)})`)
      .join(", ");
    lines.push(t("gymPrompt.context.exercises", { list }));
  }
  if (context.routines.length > 0) {
    const list = context.routines
      .map((routine) =>
        routine.exercises.length > 0 ? `${routine.name}: ${routine.exercises.join(", ")}` : routine.name,
      )
      .join("; ");
    lines.push(t("gymPrompt.context.routines", { list }));
  }
  if (context.recent.length > 0) {
    lines.push(t("gymPrompt.context.recent"));
    for (const line of context.recent) lines.push(`  ${line}`);
  }
  return lines.join("\n");
}

/** The whole prompt for one profile, in `lang`. `notes` is used by the `notes` profile only. */
export function buildPrompt(
  profile: PromptProfile,
  context: PromptContext,
  lang: Lang,
  notes?: string,
): string {
  const t = translator(lang);
  const instructions =
    profile === "notes"
      ? t("gymPrompt.notes.instructions", {
          notes: notes?.trim() ? notes.trim() : t("gymPrompt.notes.pending"),
        })
      : t(`gymPrompt.${profile}.instructions` as MessageKey);
  return [
    t("gymPrompt.role"),
    instructions,
    contextBlock(context, t),
    t(profile === "notes" ? "gymPrompt.confirmOnce" : "gymPrompt.confirm"),
    t("gymPrompt.format", { unit: context.unit }),
  ]
    .filter((part) => part.trim() !== "")
    .join("\n\n");
}
