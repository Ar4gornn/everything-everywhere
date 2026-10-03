import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * jsdom has no layout, so the navigation's CSS contract is pinned on the stylesheet text
 * (the pattern of `clocks/styles.test.ts`); the measurements themselves were taken in a real
 * browser at 768, 1024, 1280 and 1600 wide (Epic 52 round 1).
 */
const read = (name: string) =>
  readFileSync(join(__dirname, name), "utf8").replace(/\r\n/g, "\n");
const sidebar = read("sidebar.css");
const drawer = read("drawer.css");

/** The declarations of the first rule whose selector list is exactly `selector`. */
function rule(css: string, selector: string, from = 0): string {
  const start = css.indexOf(`${selector} {`, from);
  expect(start, `no rule for ${selector}`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
}

const desktop = sidebar.indexOf("@media (min-width: 721px) {");
const rail = sidebar.indexOf("@media (min-width: 721px) and (max-width: 960px) {");

describe("the sidebar stylesheet", () => {
  it("keeps the page's old measure beside the column: a selector that outranks plain .shell", () => {
    const shell = rule(sidebar, "  .shell:has(> .sidebar)", desktop);
    expect(shell).toContain("display: grid;");
    expect(shell).toContain("max-width: calc(1080px + var(--sidebar-w) + var(--sidebar-gap));");
    // styles.css's `.shell { max-width: 1080px }` comes later in the bundle: only a more
    // specific selector can win, so the rule must not be the bare `.shell`.
    expect(sidebar).not.toMatch(/^ {2}\.shell \{/m);
  });

  it("is exactly the viewport tall and takes back the shell's padding, so no page scrolls for it", () => {
    const side = rule(sidebar, "  .sidebar", desktop);
    expect(side).toContain("position: sticky;");
    expect(side).toContain("top: 0;");
    expect(side).toContain("height: 100dvh;");
    expect(side).toContain("box-sizing: border-box;");
    expect(side).toContain("margin-top: calc(-1 * max(24px, env(safe-area-inset-top)));");
    expect(side).toContain("margin-bottom: calc(-1 * max(64px, env(safe-area-inset-bottom)));");
  });

  it("scrolls the groups inside, and only the groups, so the foot is always visible", () => {
    expect(rule(sidebar, "  .sidebar .sidebar-groups", desktop)).toContain("overflow-y: auto;");
    const foot = rule(sidebar, "  .sidebar .sidebar-foot", desktop);
    expect(foot).toContain("flex: none;");
  });

  it("keeps a place's name its width and lets the hint shrink with an ellipsis", () => {
    const link = rule(sidebar, "  .sidebar .sidebar-link", desktop);
    expect(link).toContain("grid-template-columns: 24px max-content minmax(0, 1fr);");
    expect(rule(sidebar, "  .sidebar .sidebar-hint", desktop)).toContain("min-width: 0;");
    const text = rule(sidebar, "  .sidebar .sidebar-hint .nav-hint-text", desktop);
    for (const line of [
      "min-width: 0;",
      "overflow: hidden;",
      "text-overflow: ellipsis;",
      "white-space: nowrap;",
    ])
      expect(text).toContain(line);
  });

  it("shows the rail's tooltip on hover and keyboard focus, and not in the full sidebar", () => {
    expect(rule(sidebar, "  .sidebar [data-tip]::after", desktop)).toContain("display: none;");
    const shown = rule(sidebar, "  .sidebar [data-tip]::after", rail);
    expect(shown).toContain("display: block;");
    expect(shown).toContain("left: calc(100% + var(--space-2));");
    expect(sidebar.indexOf("  .sidebar [data-tip]:focus-visible::after", rail)).toBeGreaterThan(-1);
    expect(sidebar.indexOf("  .sidebar [data-tip]:hover::after", rail)).toBeGreaterThan(-1);
    // A scroll box would clip the tooltips beside the rail.
    expect(rule(sidebar, "  .sidebar .sidebar-groups", rail)).toContain("overflow: visible;");
  });
});

describe("the drawer stylesheet", () => {
  it("cuts a tile's hint to two lines", () => {
    const text = rule(drawer, ".nav-drawer .nav-tile .nav-tile-hint .nav-hint-text");
    expect(text).toContain("-webkit-line-clamp: 2;");
    expect(text).toContain("overflow: hidden;");
    expect(text).toContain("overflow-wrap: anywhere;");
  });
});
