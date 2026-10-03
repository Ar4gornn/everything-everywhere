import type { Entry } from "../catalogue";

/**
 * Epic 44 (AD-60): the quick-add sheet. Its title and the Entries page button are
 * `nav.addEntry`. Field labels the Entries form already has
 * (`field.amount`, `field.category`, `field.date`, `field.note`, `entries.vendor`,
 * `entries.paidFrom`, `entries.amountAria`, `kind.expense`, `kind.income`, the quantity keys and
 * the validation messages) are reused, not duplicated here.
 */
export const quickAdd = {
  "quickAdd.close": { en: "Close", fr: "Fermer" },
  "quickAdd.kind": { en: "Kind", fr: "Type" },
  "quickAdd.repeat": { en: "Again", fr: "À nouveau" },
  "quickAdd.repeatAria": {
    en: "Fill in {category}, {amount} again",
    fr: "Reprendre {category}, {amount}",
  },
  "quickAdd.categories": { en: "Category", fr: "Catégorie" },
  "quickAdd.other": { en: "Other…", fr: "Autre…" },
  "suggest.group": { en: "Suggestions", fr: "Suggestions" },
  "quickAdd.today": { en: "Today", fr: "Aujourd’hui" },
  "quickAdd.yesterday": { en: "Yesterday", fr: "Hier" },
  "quickAdd.pickDate": { en: "Another day", fr: "Autre jour" },
  "quickAdd.paidFromLine": { en: "Paid from {pot}", fr: "Payé depuis {pot}" },
  "quickAdd.more": { en: "More", fr: "Plus" },
  "quickAdd.less": { en: "Less", fr: "Moins" },
  "quickAdd.save": { en: "Save", fr: "Enregistrer" },
  "quickAdd.saveAnother": { en: "Save & add another", fr: "Enregistrer et continuer" },
  "quickAdd.saved": { en: "Entry saved", fr: "Opération enregistrée" },
  "quickAdd.needCategory": {
    en: "Choose a category, or type a new one.",
    fr: "Choisissez une catégorie, ou saisissez-en une nouvelle.",
  },
  "quickAdd.picksFailed": {
    en: "Suggestions could not be loaded. You can still type the entry.",
    fr: "Impossible de charger les suggestions. Vous pouvez quand même saisir l’opération.",
  },
  "quickAdd.undone": { en: "Entry removed", fr: "Opération supprimée" },
} satisfies Record<string, Entry>;
