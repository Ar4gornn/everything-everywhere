import type { Entry } from "../catalogue";

/**
 * Epic 42 core: the dashboard card, the offline store, import parsing errors, sign-out
 * warning. The gym page's own strings are in `gym.ts`.
 */
export const gymCore = {
  "gymCore.cardTitle": { en: "Gym", fr: "Sport" },

  // The dashboard card (§8). `cardName` is its name in the layout editor, where "Gym" would
  // be ambiguous beside the Gym tab.
  "gymCore.cardName": { en: "Gym session", fr: "Séance de sport" },
  "gymCore.card.start": { en: "Start session", fr: "Démarrer une séance" },
  "gymCore.card.resume": { en: "Resume", fr: "Reprendre" },
  "gymCore.card.inProgress": {
    en: "Session in progress · {minutes} min",
    fr: "Séance en cours · {minutes} min",
  },
  "gymCore.card.startRoutine": { en: "Start {name}", fr: "Démarrer {name}" },
  "gymCore.card.empty": {
    en: "No routines yet. Start an empty session, or import a program from Gym.",
    fr: "Aucune routine pour l’instant. Démarrez une séance vide, ou importez un programme depuis Sport.",
  },
  "gymCore.card.waiting_one": {
    en: "{count} session waiting to sync",
    fr: "{count} séance en attente de synchronisation",
  },
  "gymCore.card.waiting_other": {
    en: "{count} sessions waiting to sync",
    fr: "{count} séances en attente de synchronisation",
  },
  "gymCore.card.refused_one": {
    en: "{count} session was not accepted by the server",
    fr: "{count} séance n’a pas été acceptée par le serveur",
  },
  "gymCore.card.refused_other": {
    en: "{count} sessions were not accepted by the server",
    fr: "{count} séances n’ont pas été acceptées par le serveur",
  },

  // Reading a workout file (format.ts): why nothing could be read at all.
  "gymCore.import.unreadable": {
    en: "No workout found in that text. Paste the JSON block from the chat, or choose the file.",
    fr: "Aucune séance trouvée dans ce texte. Collez le bloc JSON de la discussion, ou choisissez le fichier.",
  },
  "gymCore.import.noExercises": {
    en: "The file has no exercises in it.",
    fr: "Le fichier ne contient aucun exercice.",
  },
  "gymCore.import.tooMany": {
    en: "A routine can hold 60 exercises at most. Split the file in two.",
    fr: "Une routine peut contenir 60 exercices au plus. Scindez le fichier en deux.",
  },

  // Field problems, shown beside the field in the review.
  "gymCore.field.required": { en: "This is required.", fr: "Ce champ est obligatoire." },
  "gymCore.field.number": {
    en: "That is not a number.",
    fr: "Ce n’est pas un nombre.",
  },
  "gymCore.field.whole": {
    en: "Use a whole number.",
    fr: "Utilisez un nombre entier.",
  },
  "gymCore.field.range": {
    en: "That value is outside the allowed range.",
    fr: "Cette valeur est hors des limites autorisées.",
  },
  "gymCore.field.tooLong": { en: "That is too long.", fr: "C’est trop long." },
  "gymCore.field.url": {
    en: "Use a full https link, or leave it empty.",
    fr: "Utilisez un lien https complet, ou laissez vide.",
  },
  "gymCore.field.kind": {
    en: "The kind must be reps, duration or distance.",
    fr: "Le type doit être répétitions, durée ou distance.",
  },

  // Whole-file notes.
  "gymCore.warn.fromLb": {
    en: "The file counts weights in lb. They were converted to kg and rounded to 0.5.",
    fr: "Le fichier compte les poids en lb. Ils ont été convertis en kg et arrondis à 0,5.",
  },
  "gymCore.warn.fromKg": {
    en: "The file counts weights in kg. They were converted to lb and rounded to 0.5.",
    fr: "Le fichier compte les poids en kg. Ils ont été convertis en lb et arrondis à 0,5.",
  },
  "gymCore.warn.unitUnknown": {
    en: "The weight unit in the file is not kg or lb. Weights are read in your unit.",
    fr: "L’unité de poids du fichier n’est ni kg ni lb. Les poids sont lus dans votre unité.",
  },
  "gymCore.warn.emptyRoutine": {
    en: "A routine with no exercises was left out.",
    fr: "Une routine sans exercice a été ignorée.",
  },
  "gymCore.warn.skipped": {
    en: "Some entries that were not exercises were skipped.",
    fr: "Certaines entrées qui n’étaient pas des exercices ont été ignorées.",
  },

  // Signing out with gym data that never reached the server.
  "gymCore.signOut.unsent": {
    en: "A gym session is in progress or still waiting to sync on this device. Signing out deletes it. Sign out anyway?",
    fr: "Une séance de sport est en cours ou attend encore d’être synchronisée sur cet appareil. Se déconnecter la supprime. Se déconnecter quand même ?",
  },
} satisfies Record<string, Entry>;
