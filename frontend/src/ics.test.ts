/** Epic 39: the .ics file "Add to calendar" hands over. Same rules as the server's feed. */
import { describe, expect, it } from "vitest";

import { dueEvent, escapeText, foldLine, icsFileName, icsFor } from "./ics";

const NOW = new Date(Date.UTC(2026, 8, 28, 12, 0, 0));

describe("ics", () => {
  it("escapes backslash first, then the separators and newlines", () => {
    expect(escapeText("a\\b;c,d\ne")).toBe("a\\\\b\\;c\\,d\\ne");
  });

  it("folds at 75 octets without splitting a character", () => {
    const line = `SUMMARY:${"é".repeat(60)}`;
    const parts = foldLine(line).split("\r\n");
    const encoder = new TextEncoder();
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(encoder.encode(part).length).toBeLessThanOrEqual(75);
    for (const part of parts.slice(1)) expect(part.startsWith(" ")).toBe(true);
    expect(parts.map((part, i) => (i ? part.slice(1) : part)).join("")).toBe(line);
  });

  it("writes one all-day event that ends the next day, across a month and a DST change", () => {
    const body = icsFor({ uid: "x@y", day: "2026-10-31", summary: "Rent" }, NOW);
    expect(body.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(body.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(body).toContain("DTSTART;VALUE=DATE:20261031\r\n");
    expect(body).toContain("DTEND;VALUE=DATE:20261101\r\n");
    expect(body).toContain("DTSTAMP:20260928T120000Z\r\n");
    expect(body).not.toContain("DESCRIPTION");
  });

  it("gives a bill the feed's UID, so the two are the same event", () => {
    const event = dueEvent("t-1", "2026-10-05", "Rent", "$1,200.00", "flat");
    expect(event.uid).toBe("due-t-1-20261005@everything-everywhere.app");
    const body = icsFor(event, NOW);
    expect(body).toContain("SUMMARY:Rent · $1\\,200.00");
    expect(body).toContain("DESCRIPTION:flat");
  });

  it("names the file after the summary, in characters any phone keeps", () => {
    expect(icsFileName({ uid: "u", day: "2026-10-05", summary: "Électricité · 45€" })).toBe(
      "Electricite-45-2026-10-05.ics",
    );
    expect(icsFileName({ uid: "u", day: "2026-10-05", summary: "€€" })).toBe(
      "event-2026-10-05.ics",
    );
  });
});
