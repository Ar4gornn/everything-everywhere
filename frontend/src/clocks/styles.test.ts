import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { clocksPage } from "../i18n/messages/clocksPage";

/** jsdom has no layout, so the clock rows' CSS contract is pinned on the stylesheet text. */
const css = readFileSync(join(__dirname, "..", "styles.css"), "utf8").replace(/\r\n/g, "\n");
const block = css.slice(css.indexOf("Epic 48 (AD-64): Clocks page"));

function rule(selector: string): string {
  const start = block.indexOf(`${selector} {`);
  expect(start, `no rule for ${selector}`).toBeGreaterThan(-1);
  return block.slice(start, block.indexOf("}", start));
}

describe("the clocks stylesheet", () => {
  it("makes the time one track shared by every row: the list is the grid, each row a subgrid", () => {
    const list = rule(".clocks-list,\n.clocks-lines");
    expect(list).toContain("display: grid;");
    expect(list).toContain("grid-template-columns: minmax(0, 1fr) max-content max-content;");
    const row = rule(".clocks-row,\n.clocks-line");
    expect(row).toContain("grid-template-columns: subgrid;");
    expect(row).toContain("grid-column: 1 / -1;");
    // A row must not define its own tracks, or its time column is its own again.
    expect(row).not.toMatch(/grid-template-columns: (?!subgrid)/);
    expect(rule(".clocks-row .clocks-time,\n.clocks-line .clocks-time")).toContain("tabular-nums");
    // The editor and the error span every track.
    expect(
      rule(".clocks-row > .error,\n.clocks-row > .clocks-panel,\n.clocks-row > .clocks-home-hint"),
    ).toContain(
      "grid-column: 1 / -1;",
    );
  });

  it("never breaks the Custom hours tag inside a word (round 4)", () => {
    const tag = rule(".clocks-row .clocks-tag,\n.clocks-line .clocks-tag");
    expect(tag).toContain("overflow-wrap: normal;");
    // Wrapping between words only works if every word fits the name column (62px at 320,
    // 12px Lato: about nine letters).
    for (const text of Object.values(clocksPage["clocks.page.ownHoursTag"])) {
      for (const word of text.split(" ")) expect(word.length, word).toBeLessThanOrEqual(9);
    }
  });

  it("keeps the slider under the top edge on a phone, and focus clear of it", () => {
    const phone = block.slice(block.indexOf("@media (max-width: 720px)"));
    const card = phone.slice(phone.indexOf(".clocks-page .clocks-slider-card {"));
    expect(card.slice(0, card.indexOf("}"))).toContain("position: sticky;");
    expect(phone).toContain("scroll-margin-top:");
  });

  it("caps the page at a readable width on a wide screen", () => {
    expect(rule(".clocks-page")).toContain("max-width: 640px;");
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

  it("caps the dashboard card's list as wide as the page, so a time stays near its name", () => {
    expect(rule(".clocks-list,\n.clocks-lines")).toContain("max-width: 640px;");
  });

  it("on a phone puts the Edit toggle at the end of the row, in a track of its own", () => {
    const phone = block.slice(block.indexOf("@media (max-width: 720px)"));
    const tracks = phone.slice(phone.indexOf("  .clocks-list {"));
    expect(tracks.slice(0, tracks.indexOf("}"))).toContain(
      "grid-template-columns: minmax(0, 1fr) max-content 44px;",
    );
    const edit = phone.slice(phone.indexOf("  .clocks-page .clocks-edit {"));
    const editRule = edit.slice(0, edit.indexOf("}"));
    expect(editRule).toContain("position: absolute;");
    expect(editRule).toContain("right: 0;");
    expect(phone).toMatch(/\.clocks-row \{\s*position: relative;/);
  });

  it("on a phone puts the meta on its own line under the name, so the name column is stable (round 5)", () => {
    const phone = block.slice(block.indexOf("@media (max-width: 720px)"));
    const at = (selector: string) => {
      const start = phone.indexOf(`  ${selector} {`);
      expect(start, `no phone rule for ${selector}`).toBeGreaterThan(-1);
      return phone.slice(start, phone.indexOf("}", start));
    };
    const meta = at(".clocks-row .clocks-meta,\n  .clocks-line .clocks-meta");
    expect(meta).toContain("grid-column: 1 / 3;");
    expect(meta).toContain("justify-self: start;");
    expect(meta).toContain("justify-content: flex-start;");
    expect(meta).toContain("max-width: none;");
    const name = at(".clocks-row .clocks-name,\n  .clocks-line .clocks-name");
    expect(name).toContain("grid-row: auto;");
    expect(name).toContain("overflow-wrap: break-word;");
    expect(name).not.toContain("span 2");
    expect(at(".clocks-row .clocks-label,\n  .clocks-line .clocks-label")).toContain(
      "overflow-wrap: break-word;",
    );
    expect(at(".clocks-row .clocks-time,\n  .clocks-line .clocks-time")).toContain("grid-column: 2;");
    expect(rule(".clocks-row .clocks-meta,\n.clocks-line .clocks-meta")).toContain(
      "flex-wrap: wrap;",
    );
  });

  it("gives the Undo line a row of its own in the list grid", () => {
    expect(rule(".clocks-page .clocks-undo-row")).toContain("grid-column: 1 / -1;");
  });

  it("keeps the sticky slider opaque and square, with room kept for a two-line readout", () => {
    const phone = block.slice(block.indexOf("@media (max-width: 720px)"));
    const card = phone.slice(phone.indexOf(".clocks-page .clocks-slider-card {"));
    const cardRule = card.slice(0, card.indexOf("}"));
    expect(cardRule).toContain("background: var(--surface);");
    expect(cardRule).toContain("border-radius: 0;");
    const readout = phone.slice(phone.indexOf("  .clocks-page .clocks-readout {"));
    expect(readout.slice(0, readout.indexOf("}"))).toContain("min-height: 2lh;");
  });

  it("lets the name wrap anywhere and shrink, so a 32-character name never overflows", () => {
    const name = rule(".clocks-row .clocks-name,\n.clocks-line .clocks-name");
    expect(name).toContain("min-width: 0");
    expect(name).toContain("overflow-wrap: anywhere");
  });
});
