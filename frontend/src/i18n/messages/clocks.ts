import type { Entry } from "../catalogue";

/**
 * Epic 48 (AD-64): the clocks. Shared keys only (module, card, view, shading words);
 * the page's own text is in `clocksPage.ts`, Settings and the calendar's in
 * `clocksSettings.ts`.
 */
export const clocks = {
  "clocks.module": { en: "Clocks", fr: "Horloges" },
  "clocks.card": { en: "Clocks", fr: "Horloges" },
  "view.clocks": { en: "Clocks", fr: "Horloges" },
  "clocks.you": { en: "You", fr: "Vous" },
  "clocks.shade.night": { en: "Night", fr: "Nuit" },
  "clocks.shade.work": { en: "Working", fr: "Au travail" },
  "clocks.shade.free": { en: "Free time", fr: "Temps libre" },
  "clocks.sameTime": { en: "Same time", fr: "Même heure" },
  "clocks.tomorrow": { en: "tomorrow", fr: "demain" },
  "clocks.yesterday": { en: "yesterday", fr: "hier" },
} satisfies Record<string, Entry>;
