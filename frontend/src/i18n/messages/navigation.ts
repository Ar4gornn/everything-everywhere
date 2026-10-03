import type { Entry } from "../catalogue";

/**
 * Epic 52 (AD-65): the drawer, the sidebar and the group names. Builders add their own keys
 * under `nav.drawer.*`, `nav.sidebar.*`, `nav.hint.*` and `layout.nav.*`.
 */
export const navigation = {
  "nav.moreTab": { en: "More", fr: "Plus" },
  "nav.drawer.title": { en: "All places", fr: "Toutes les rubriques" },
  "nav.drawer.customise": { en: "Change what's in the bar", fr: "Modifier la barre" },
  "nav.skip": { en: "Skip to content", fr: "Aller au contenu" },
  "nav.sidebar": { en: "All places", fr: "Toutes les rubriques" },
  "nav.sidebar.account": { en: "Account", fr: "Compte" },
  "nav.drawer.close": { en: "Close", fr: "Fermer" },
  "nav.hint.planLeft_one": { en: "{count} day left", fr: "{count} jour restant" },
  "nav.hint.planLeft_other": { en: "{count} days left", fr: "{count} jours restants" },
  "nav.group.daily": { en: "Daily", fr: "Au quotidien" },
  "nav.group.money": { en: "Money", fr: "Argent" },
  "nav.group.home": { en: "Home & body", fr: "Maison et forme" },
  "nav.group.tools": { en: "Tools", fr: "Outils" },
} satisfies Record<string, Entry>;
