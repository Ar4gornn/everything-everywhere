import type { Entry } from "../catalogue";

/**
 * Streaks (Epic 41). A streak counts **days**, and the unit is its own plural pair so the
 * big number and the collapsed summary read the same. French takes the singular at 0 as
 * well as 1, which `pluralForm` already knows.
 *
 * The dots are read aloud one by one, so each carries its day and its state in words:
 * colour is never the only thing telling them apart.
 */
export const streaks = {
  "streaks.title": { en: "Streak", fr: "Série" },
  "streaks.days_one": { en: "{count} day", fr: "{count} jour" },
  "streaks.days_other": { en: "{count} days", fr: "{count} jours" },
  "streaks.dayUnit_one": { en: "day in a row", fr: "jour de suite" },
  "streaks.dayUnit_other": { en: "days in a row", fr: "jours de suite" },
  "streaks.best": { en: "Best: {count}", fr: "Record : {count}" },
  "streaks.checkIn": { en: "Check in", fr: "Valider aujourd’hui" },
  "streaks.checkedIn": { en: "Checked in ✓", fr: "Journée validée ✓" },
  // A tab's own Check in sits in a page header, so it is the short form.
  "streaks.tabCheckIn": { en: "Check in", fr: "Valider" },
  "streaks.tabCheckedIn": { en: "Checked in ✓", fr: "Validé ✓" },
  "streaks.tabs": { en: "Streaks by tab", fr: "Séries par onglet" },
  "streaks.rowActiveToday": { en: "active today", fr: "actif aujourd’hui" },
  "streaks.settingsTitle": { en: "Streaks", fr: "Séries" },
  "streaks.settingsHint": {
    en: "Choose which tabs show their own streak and a Check in button. Every tab keeps counting whether or not it is shown.",
    fr: "Choisissez les onglets qui affichent leur propre série et un bouton Valider. Chaque onglet continue de compter, affiché ou non.",
  },
  "streaks.show": { en: "Show the {name} streak", fr: "Afficher la série {name}" },
  "streaks.couldNotSave": {
    en: "Could not save that change.",
    fr: "Impossible d’enregistrer ce changement.",
  },
  "streaks.recent": { en: "The last four weeks", fr: "Les quatre dernières semaines" },
  "streaks.dot.active": { en: "{day}: active", fr: "{day} : jour actif" },
  "streaks.dot.missed": { en: "{day}: missed", fr: "{day} : manqué" },
  "streaks.dot.pending": { en: "{day}: today, not yet", fr: "{day} : aujourd’hui, pas encore" },
  "streaks.dot.before": { en: "{day}: before you started", fr: "{day} : avant le début" },
  "streaks.couldNotLoad": {
    en: "Could not load your streak.",
    fr: "Impossible de charger votre série.",
  },
  "streaks.couldNotCheckIn": {
    en: "Could not check in.",
    fr: "Impossible de valider la journée.",
  },
  "error.streak_unknown": {
    en: "That streak does not exist.",
    fr: "Cette série n’existe pas.",
  },
} satisfies Record<string, Entry>;
