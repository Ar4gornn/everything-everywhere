import type { Entry } from "../catalogue";

/** Epic 48 (AD-64): Settings → Clocks and the calendar's "also in" zone. */
export const clocksSettings = {
  "clocks.settings.title": { en: "Clocks", fr: "Horloges" },
  "clocks.settings.hours": { en: "Default hours", fr: "Horaires par défaut" },
  "clocks.settings.hoursHint": {
    en: "Used to shade each place as working, night or free. A place can have its own hours.",
    fr: "Servent à indiquer si chaque lieu est au travail, de nuit ou libre. Un lieu peut avoir ses propres horaires.",
  },
  "clocks.settings.work": { en: "Working hours", fr: "Heures de travail" },
  "clocks.settings.night": { en: "Night hours", fr: "Heures de nuit" },
  "clocks.settings.workStart": { en: "Working hours start", fr: "Heures de travail, début" },
  "clocks.settings.workEnd": { en: "Working hours end", fr: "Heures de travail, fin" },
  "clocks.settings.nightStart": { en: "Night hours start", fr: "Heures de nuit, début" },
  "clocks.settings.nightEnd": { en: "Night hours end", fr: "Heures de nuit, fin" },
  "clocks.settings.removedPlace": {
    en: "Not one of your places any more",
    fr: "Ce n’est plus l’un de vos lieux",
  },
  "clocks.settings.sameAsHome": { en: "Same as your own time", fr: "Identique à votre propre heure" },
  "clocks.settings.from": { en: "from", fr: "de" },
  "clocks.settings.to": { en: "to", fr: "à" },
  "clocks.settings.calendarZone": { en: "Calendar: also show times in", fr: "Calendrier : afficher aussi les heures à" },
  "clocks.settings.calendarZoneHint": {
    en: "Choose one of your places. Timed rows on the calendar then show both times.",
    fr: "Choisissez l’un de vos lieux. Les lignes horodatées du calendrier montrent alors les deux heures.",
  },
  "clocks.settings.calendarOff": { en: "Off", fr: "Désactivé" },
  "clocks.settings.noPlaces": {
    en: "Add a place on the Clocks page to pick one here.",
    fr: "Ajoutez un lieu sur la page Horloges pour en choisir un ici.",
  },
  "clocks.settings.link": { en: "Open the Clocks page", fr: "Ouvrir la page Horloges" },
} satisfies Record<string, Entry>;
