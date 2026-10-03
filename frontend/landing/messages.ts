import type { Entry } from "../src/i18n/catalogue.ts";

// Placeholder copy only (Story 53.1). Story 53.4 writes the real copy.
export const landing = {
  "meta.title": { en: "Everything Everywhere", fr: "Everything Everywhere" },
  "meta.description": {
    en: "Placeholder description for the Everything Everywhere landing page.",
    fr: "Description provisoire de la page d'accueil d'Everything Everywhere.",
  },
  "hero.title": { en: "Everything Everywhere", fr: "Everything Everywhere" },
  "privacy.title": { en: "Privacy", fr: "Confidentialité" },
} satisfies Record<string, Entry>;

export type LandingKey = keyof typeof landing;
