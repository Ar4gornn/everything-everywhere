import { describe, expect, it } from "vitest";
import { LABEL_MAX, labelProblem, labelRefused } from "./label";

describe("labelRefused", () => {
  it("refuses control characters, line and paragraph separators", () => {
    for (const bad of ["a\u0000b", "a\tb", "a\nb", "a\u0085b", "a\u2028b", "a\u2029b"]) {
      expect(labelRefused(bad)).toBe(true);
    }
  });

  it("refuses bidi overrides, embeddings and isolates", () => {
    for (const code of [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]) {
      expect(labelRefused(`a${String.fromCharCode(code)}b`)).toBe(true);
    }
  });

  it("refuses the bare direction marks LRM, RLM and ALM", () => {
    for (const code of [0x200e, 0x200f, 0x061c]) {
      expect(labelProblem(`a${String.fromCharCode(code)}b`)).toBe("character");
    }
  });

  it("refuses a label with nothing visible in it", () => {
    for (const blank of [
      "​",
      "‍‍",
      "ㅤ",
      "⠀⠀",
      "ᅟᅠ",
      "ﾠ",
      "﻿⁠",
      "   ",
    ]) {
      expect(labelProblem(blank), JSON.stringify(blank)).toBe("invisible");
    }
    expect(labelProblem("ㅤx")).toBeNull();
    expect(labelProblem("")).toBeNull();
  });

  it("allows ordinary names, accents, emoji and the zero-width joiner", () => {
    for (const ok of ["Mum", "Café Zürich", "\u{1F468}\u200d\u{1F469} home", "東京", "A B"]) {
      expect(labelRefused(ok)).toBe(false);
    }
  });

  it("judges the trimmed label, as the server does", () => {
    expect(labelRefused("  Mum \t")).toBe(false);
  });

  it("shares the server's 32 character limit", () => {
    expect(LABEL_MAX).toBe(32);
  });
});
