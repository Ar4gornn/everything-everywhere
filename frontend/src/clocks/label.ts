/**
 * Epic 48 (AD-64): the client's half of the server's `clean_clock_label`. The server
 * refuses Unicode categories Cc, Cs, Zl, Zp and the bidi overrides/isolates U+202A-U+202E,
 * U+2066-U+2069 (a zero-width joiner stays: emoji need it); this refuses the same, earlier,
 * with a reason the person can read.
 */
// Built from escapes in a string, so no invisible direction character sits in this source.
// biome-ignore lint/complexity/useRegexLiterals: the autofix writes the direction characters into the source itself
const REFUSED = new RegExp("[\\p{Cc}\\p{Cs}\\p{Zl}\\p{Zp}\\u202A-\\u202E\\u2066-\\u2069]", "u");

export const LABEL_MAX = 32;

/** True when the (trimmed) label holds a character the server would refuse. */
export function labelRefused(raw: string): boolean {
  return REFUSED.test(raw.trim());
}
