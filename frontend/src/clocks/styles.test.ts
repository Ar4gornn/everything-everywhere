import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** jsdom has no layout, so the clock rows' CSS contract is pinned on the stylesheet text. */
const css = readFileSync(join(__dirname, "..", "styles.css"), "utf8").replace(/\r\n/g, "\n");
const block = css.slice(css.indexOf("Epic 48 (AD-64): Clocks page"));

function rule(selector: string): string {
  const start = block.indexOf(`${selector} {`);
  expect(start, `no rule for ${selector}`).toBeGreaterThan(-1);
  return block.slice(start, block.indexOf("}", start));
}

describe("the clocks stylesheet", () => {
  it("lays every row out as name | time | meta so the times line up", () => {
    expect(rule(".clocks-row,\n.clocks-line")).toContain(
      "grid-template-columns: minmax(0, 1fr) auto auto;",
    );
    expect(rule(".clocks-row .clocks-time,\n.clocks-line .clocks-time")).toContain("tabular-nums");
  });

  it("gives work, free and night three different fills", () => {
    const work = rule('.clocks-row .clocks-shade[data-shade="work"],\n.clocks-line .clocks-shade[data-shade="work"]');
    const free = rule('.clocks-row .clocks-shade[data-shade="free"],\n.clocks-line .clocks-shade[data-shade="free"]');
    const night = rule('.clocks-row .clocks-shade[data-shade="night"],\n.clocks-line .clocks-shade[data-shade="night"]');
    expect(work).toContain("background: var(--accent-soft)");
    expect(free).toContain("background: transparent");
    expect(night).toContain("background: var(--secondary)");
    // Text on the dark fill is the checked text token for it.
    expect(night).toContain("color: var(--on-secondary)");
  });

  it("lets the name wrap anywhere and shrink, so a 32-character name never overflows", () => {
    const name = rule(".clocks-row .clocks-name,\n.clocks-line .clocks-name");
    expect(name).toContain("min-width: 0");
    expect(name).toContain("overflow-wrap: anywhere");
  });
});
