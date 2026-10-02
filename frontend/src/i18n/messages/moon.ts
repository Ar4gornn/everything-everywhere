import type { Entry } from "../catalogue";

/**
 * Epic 47 (AD-63): the moon. Shared keys (phase names, module, settings); the Moon page's own
 * text is added below by its builder under `moon.page.*`.
 */
export const moon = {
  "moon.module": { en: "Moon", fr: "Lune" },
  "moon.phase.new": { en: "New moon", fr: "Nouvelle lune" },
  "moon.phase.waxingCrescent": { en: "Waxing crescent", fr: "Premier croissant" },
  "moon.phase.firstQuarter": { en: "First quarter", fr: "Premier quartier" },
  "moon.phase.waxingGibbous": { en: "Waxing gibbous", fr: "Gibbeuse croissante" },
  "moon.phase.full": { en: "Full moon", fr: "Pleine lune" },
  "moon.phase.waningGibbous": { en: "Waning gibbous", fr: "Gibbeuse décroissante" },
  "moon.phase.lastQuarter": { en: "Last quarter", fr: "Dernier quartier" },
  "moon.phase.waningCrescent": { en: "Waning crescent", fr: "Dernier croissant" },
  "moon.lit": { en: "{percent}% lit", fr: "{percent} % éclairée" },
  "moon.settings.title": { en: "Moon", fr: "Lune" },
  "moon.settings.hemisphere": { en: "Hemisphere", fr: "Hémisphère" },
  "moon.settings.auto": { en: "From my time zone", fr: "D’après mon fuseau horaire" },
  "moon.settings.north": { en: "Northern", fr: "Nord" },
  "moon.settings.south": { en: "Southern", fr: "Sud" },
  "moon.place.title": { en: "Place for moonrise", fr: "Lieu pour le lever de lune" },
  "moon.place.privacy": {
    en: "Stays on this device, rounded to about 10 km. It is never sent to the server.",
    fr: "Reste sur cet appareil, arrondi à environ 10 km. Il n’est jamais envoyé au serveur.",
  },
  "moon.place.locate": { en: "Use my location", fr: "Utiliser ma position" },
  "moon.place.enter": { en: "Enter coordinates", fr: "Saisir des coordonnées" },
  "moon.place.remove": { en: "Remove the place", fr: "Supprimer le lieu" },
  "moon.place.none": {
    en: "No place set: moonrise and moonset are not shown.",
    fr: "Aucun lieu : le lever et le coucher de la lune ne sont pas affichés.",
  },
  "moon.digest.kind": { en: "New and full moon", fr: "Nouvelle et pleine lune" },
} satisfies Record<string, Entry>;
