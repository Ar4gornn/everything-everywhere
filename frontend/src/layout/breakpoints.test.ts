import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { PHONE_QUERY } from "./useLayout";

/**
 * The phone/desktop split lives in two places: `PHONE_QUERY` (JS) and every `@media` block in
 * the stylesheets. A touch-first device up to 1024px is a phone; anything else follows the
 * width alone (docs/epic-52-navigation.md section 8). A block that kept the bare width test
 * would draw the desktop CSS under the phone's markup on a tablet, so this reads them all.
 */
const SRC = join(__dirname, "..");

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? cssFiles(join(dir, e.name))
      : e.name.endsWith(".css")
        ? [join(dir, e.name)]
        : [],
  );
}

const files = cssFiles(SRC);
const preludes = files.flatMap((f) =>
  [...readFileSync(f, "utf8").replace(/\r\n/g, "\n").matchAll(/^\s*@media ([^{]*) \{$/gm)].map(
    (m) => ({ file: f.slice(SRC.length + 1), prelude: m[1] ?? "" }),
  ),
);

const DESKTOP = "(min-width: 721px) and (not (pointer: coarse)), (min-width: 1025px)";

describe("the breakpoint in the stylesheets", () => {
  it("finds the stylesheets", () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
    expect(preludes.length).toBeGreaterThan(20);
  });

  it("never leaves a bare (max-width: 720px) or (min-width: 721px)", () => {
    const bare = preludes.filter(
      (p) =>
        (p.prelude === "(max-width: 720px)" || p.prelude === "(min-width: 721px)") ||
        (/721px|720px/.test(p.prelude) && !p.prelude.includes("pointer: coarse")),
    );
    expect(bare).toEqual([]);
  });

  it("writes every phone block exactly as PHONE_QUERY does", () => {
    const phone = preludes.filter((p) => p.prelude.includes("max-width: 720px"));
    expect(phone.length).toBeGreaterThan(10);
    for (const p of phone) expect(p.prelude, p.file).toBe(PHONE_QUERY);
  });

  it("writes every desktop block as the exact complement of the phone query", () => {
    const desktop = preludes.filter((p) => p.prelude.includes("min-width: 721px"));
    expect(desktop.length).toBeGreaterThan(3);
    for (const p of desktop) {
      // The icon rail (721-960) only qualifies the first clause; the rest must not be coarse.
      const alone = p.prelude === DESKTOP;
      const rail =
        /^\(min-width: 721px\) and \(max-width: 960px\)( and \(max-height: 640px\))? and \(not \(pointer: coarse\)\)$/.test(
          p.prelude,
        );
      expect(alone || rail, `${p.file}: ${p.prelude}`).toBe(true);
    }
  });

  it("keeps the calendar's two-column split off a touch tablet", () => {
    const split = preludes.filter((p) => p.prelude.includes("min-width: 1000px"));
    expect(split.map((p) => p.prelude)).toEqual([
      "(min-width: 1000px) and (not (pointer: coarse)), (min-width: 1025px)",
    ]);
  });
});
