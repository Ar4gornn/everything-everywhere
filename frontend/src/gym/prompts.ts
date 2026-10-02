import type { ExerciseKind, WeightUnit, WorkoutDetail } from "../api/types";
import type { Lang, MessageKey } from "../i18n";
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

/** In the order the cards are shown. */
export const PROFILES: readonly ProfileSpec[] = [];

export interface PromptContext {
  unit: WeightUnit;
  /** Max 60, most used first. */
  exercises: { name: string; kind: ExerciseKind }[];
  /** Max 10: routine name and its exercise names in order. */
  routines: { name: string; exercises: string[] }[];
  /** Max 10, newest first, one line each, already formatted (rest days included). */
  recent: string[];
}

/** Read the device cache and the recent sessions into the context block's facts. */
export function buildPromptContext(
  cache: GymCache,
  recent: WorkoutDetail[],
  unit: WeightUnit,
): PromptContext {
  void cache;
  void recent;
  void unit;
  throw new Error("TODO(F1): buildPromptContext");
}

/** The whole prompt for one profile, in `lang`. `notes` is used by the `notes` profile only. */
export function buildPrompt(
  profile: PromptProfile,
  context: PromptContext,
  lang: Lang,
  notes?: string,
): string {
  void profile;
  void context;
  void lang;
  void notes;
  throw new Error("TODO(F1): buildPrompt");
}
