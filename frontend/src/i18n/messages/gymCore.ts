import type { Entry } from "../catalogue";

/**
 * Epic 42 core: the dashboard card, the offline store, import parsing errors, sign-out
 * warning. The gym page's own strings are in `gym.ts`.
 */
export const gymCore = {
  "gymCore.cardTitle": { en: "Gym", fr: "Sport" },
} satisfies Record<string, Entry>;
