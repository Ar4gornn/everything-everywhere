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
  // --- Wiring (Builder C): the links into the Moon page and the Settings row.
  "moon.open": { en: "Open the Moon page", fr: "Ouvrir la page Lune" },
  "moon.settings.placeNow": { en: "Place: {place}", fr: "Lieu : {place}" },
  "moon.settings.placeLink": { en: "Set it on the Moon page", fr: "À régler sur la page Lune" },
  // --- The Moon page (Builder B). Text only; no sentence ranks or judges a difference.
  "moon.page.loading": { en: "Loading the moon…", fr: "Chargement de la lune…" },
  "moon.page.today": { en: "Today", fr: "Aujourd’hui" },
  "moon.page.age_one": { en: "Age: {days} day", fr: "Âge : {days} jour" },
  "moon.page.age_other": { en: "Age: {days} days", fr: "Âge : {days} jours" },
  "moon.page.nextNew": { en: "Next new moon", fr: "Prochaine nouvelle lune" },
  "moon.page.nextFull": { en: "Next full moon", fr: "Prochaine pleine lune" },
  "moon.page.rise": { en: "Moonrise", fr: "Lever de la lune" },
  "moon.page.set": { en: "Moonset", fr: "Coucher de la lune" },
  "moon.page.noRise": { en: "none today", fr: "aucun aujourd’hui" },
  "moon.page.quarters": { en: "This month’s quarters", fr: "Les quartiers du mois" },
  "moon.page.overlay": { en: "Your days against the moon", fr: "Vos jours face à la lune" },
  "moon.page.overlayNote": {
    en: "Counts and averages per phase, side by side. Nothing is compared or ranked.",
    fr: "Totaux et moyennes par phase, côte à côte. Rien n’est comparé ni classé.",
  },
  "moon.page.window": { en: "Window", fr: "Période" },
  "moon.page.windowOption": { en: "Last {n} cycles", fr: "{n} derniers cycles" },
  "moon.page.covered": { en: "{cycles} cycles · {days} days", fr: "{cycles} cycles · {days} jours" },
  "moon.page.colPhase": { en: "Phase", fr: "Phase" },
  "moon.page.colDays": { en: "Days", fr: "Jours" },
  "moon.page.spending": { en: "Spending", fr: "Dépenses" },
  "moon.page.figureMood": { en: "Mean mood", fr: "Humeur moyenne" },
  "moon.page.figureHabits": { en: "Check-ins per day", fr: "Validations par jour" },
  "moon.page.figureSpending": { en: "Spent per day", fr: "Dépensé par jour" },
  "moon.page.figureGym": { en: "Sessions per day", fr: "Séances par jour" },
  "moon.page.chart": {
    en: "{module} by day, with the moon phases behind",
    fr: "{module} par jour, avec les phases de la lune en fond",
  },
  "moon.page.placeIs": { en: "Place: {place}", fr: "Lieu : {place}" },
  "moon.page.locating": { en: "Locating…", fr: "Localisation…" },
  "moon.page.lat": { en: "Latitude", fr: "Latitude" },
  "moon.page.lon": { en: "Longitude", fr: "Longitude" },
  "moon.page.label": { en: "Name (optional)", fr: "Nom (facultatif)" },
  "moon.page.save": { en: "Save the place", fr: "Enregistrer le lieu" },
  "moon.page.invalid": {
    en: "Latitude must be between -90 and 90, and longitude between -180 and 180.",
    fr: "La latitude doit être entre -90 et 90, et la longitude entre -180 et 180.",
  },
  "moon.page.denied": {
    en: "Location was refused. You can enter coordinates instead.",
    fr: "La localisation a été refusée. Vous pouvez saisir des coordonnées à la place.",
  },
  "moon.page.unavailable": {
    en: "Location is not available on this device. You can enter coordinates instead.",
    fr: "La localisation n’est pas disponible sur cet appareil. Vous pouvez saisir des coordonnées.",
  },
  "moon.page.timeout": {
    en: "Location took too long. Try again, or enter coordinates.",
    fr: "La localisation a pris trop de temps. Réessayez ou saisissez des coordonnées.",
  },
  "moon.page.couldNotLoad": {
    en: "Could not load your days for the moon overlay.",
    fr: "Impossible de charger vos jours pour la superposition lunaire.",
  },
} satisfies Record<string, Entry>;
