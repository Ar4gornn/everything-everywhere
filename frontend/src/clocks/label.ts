/**
 * Epic 48 (AD-64): the client's half of the server's `clean_clock_label`. The server
 * refuses Unicode categories Cc, Cs, Zl, Zp, the bidi overrides/isolates U+202A-U+202E,
 * U+2066-U+2069 and the bare direction marks U+200E, U+200F, U+061C (a zero-width joiner
 * stays: emoji need it), and a label with nothing visible in it: only spaces, format (Cf)
 * characters and the blank fillers U+115F, U+1160, U+3164, U+FFA0, U+2800. This refuses the
 * same, earlier, with a reason the person can read.
 */
// Built from escapes in a string, so no invisible direction character sits in this source.
// biome-ignore lint/complexity/useRegexLiterals: the autofix writes the direction characters into the source itself
const REFUSED = new RegExp(
  "[\\p{Cc}\\p{Cs}\\p{Zl}\\p{Zp}\\u202A-\\u202E\\u2066-\\u2069\\u200E\\u200F\\u061C]",
  "u",
);
// biome-ignore lint/complexity/useRegexLiterals: same reason, the fillers are invisible
const VISIBLE = new RegExp("[^\\s\\p{Cf}\\u115F\\u1160\\u3164\\uFFA0\\u2800]", "u");

export const LABEL_MAX = 32;

/** Why the server would refuse this label: a forbidden character, nothing visible, or null
 *  when it is fine. An empty label is not a refusal (the save button is just disabled). */
export function labelProblem(raw: string): "character" | "invisible" | null {
  const label = raw.trim();
  if (REFUSED.test(label)) return "character";
  if (raw !== "" && !VISIBLE.test(label)) return "invisible";
  return null;
}

/** True when the (trimmed) label holds a character the server would refuse, or nothing
 *  visible at all. */
export function labelRefused(raw: string): boolean {
  return labelProblem(raw) !== null;
}
