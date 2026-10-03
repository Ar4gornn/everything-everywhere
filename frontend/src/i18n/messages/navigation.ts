import type { Entry } from "../catalogue";

/**
 * Epic 52 (AD-65): the drawer, the sidebar and the group names. Builders add their own keys
 * under `nav.drawer.*`, `nav.sidebar.*`, `nav.hint.*` and `layout.nav.*`.
 */
export const navigation = {
  "nav.moreTab": { en: "More", fr: "Plus" },
  "nav.drawer.title": { en: "Everything", fr: "Tout" },
  "nav.sidebar": { en: "All places", fr: "Toutes les rubriques" },
  "nav.drawer.close": { en: "Close", fr: "Fermer" },
  "nav.group.daily": { en: "Daily", fr: "Au quotidien" },
  "nav.group.money": { en: "Money", fr: "Argent" },
  "nav.group.home": { en: "Home & body", fr: "Maison et forme" },
  "nav.group.tools": { en: "Tools", fr: "Outils" },
} satisfies Record<string, Entry>;
