import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phone layout rules that a component test cannot see, because jsdom does no layout. Each
 * one was found by measuring the running app at 375px; these keep them from coming back.
 */
const css = readFileSync(join(__dirname, "styles.css"), "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Every `selector { body }` pair, flattened out of any @media block. */
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selectors: (m[1] ?? "").split(",").map((s) => s.trim()),
  body: m[2] ?? "",
}));

describe("phone layout CSS", () => {
  it("sizes only the sketch's swatch buttons, not the chart legends' keys", () => {
    // A bare `.swatch { width: 32px }` turned every 9px legend key into a 32px circle.
    const sized = rules.filter((r) => /(^|;)\s*width:\s*32px/.test(r.body));
    const bare = sized.flatMap((r) => r.selectors).filter((s) => /^\.swatch\b/.test(s));
    expect(bare).toEqual([]);
  });

  it("leaves room below the page for the floating buttons", () => {
    const pad = (selector: string) =>
      rules.find((r) => r.selectors.includes(selector))?.body.match(/padding-bottom:\s*([^;]+)/)?.[1];
    // The entry button's top is 72 + 52 above the bottom; the note button sits 12 + 48 higher.
    expect(pad(".shell:has(> .fab)")).toContain("72px + 52px");
    expect(pad(".shell:has(> .fab-note)")).toContain("48px");
  });

  it("gives a collapsible card heading a 44px target", () => {
    const toggle = rules.find((r) => r.selectors.includes(".card-toggle"))?.body ?? "";
    const pad = Number(toggle.match(/padding:\s*(\d+)px 0/)?.[1] ?? 0);
    expect(14 + 2 * pad).toBeGreaterThanOrEqual(44);
  });
});
