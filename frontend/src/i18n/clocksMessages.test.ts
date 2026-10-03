import { describe, expect, it } from "vitest";
import { clocks } from "./messages/clocks";
import { clocksPage } from "./messages/clocksPage";
import { clocksSettings } from "./messages/clocksSettings";

const all = Object.entries({ ...clocks, ...clocksPage, ...clocksSettings });

describe("the Clocks messages", () => {
  it("write French with the curly apostrophe, like the rest of the app", () => {
    const straight = all.filter(([, entry]) => entry.fr.includes("'")).map(([key]) => key);
    expect(straight).toEqual([]);
  });

  it("name the own-hours action after the place, in both languages", () => {
    expect(clocksPage["clocks.page.ownHours"].fr).toBe("Horaires de ce lieu");
    expect(clocksSettings["clocks.settings.workStart"]).toEqual({
      en: "Working hours start",
      fr: "Heures de travail, début",
    });
  });
});
