import type { Entry } from "../catalogue";

/** Epic 54.3: routine editor and import review, per-set targets, effort, tempo, supersets. */
export const gymPlans = {
  "gymPlans.sets.legend": { en: "Sets", fr: "Séries" },
  "gymPlans.sets.same": { en: "Same every set", fr: "Identiques" },
  "gymPlans.sets.vary": { en: "Vary per set", fr: "Variables" },
  "gymPlans.sets.switch": { en: "Targets for {name}", fr: "Objectifs pour {name}" },
  "gymPlans.sets.setN": { en: "Set {n}", fr: "Série {n}" },
  "gymPlans.sets.list": { en: "Sets of {name}", fr: "Séries de {name}" },
  "gymPlans.sets.reps": { en: "Set {n} reps of {name}", fr: "Répétitions de la série {n} ({name})" },
  "gymPlans.sets.seconds": { en: "Set {n} seconds of {name}", fr: "Secondes de la série {n} ({name})" },
  "gymPlans.sets.metres": { en: "Set {n} metres of {name}", fr: "Mètres de la série {n} ({name})" },
  "gymPlans.sets.weight": { en: "Set {n} weight of {name}", fr: "Poids de la série {n} ({name})" },
  "gymPlans.sets.warmup": { en: "Warm-up", fr: "Échauffement" },
  "gymPlans.sets.warmupOf": {
    en: "Warm-up, set {n} of {name}",
    fr: "Échauffement, série {n} de {name}",
  },
  "gymPlans.sets.add": { en: "Add a set", fr: "Ajouter une série" },
  "gymPlans.sets.addTo": { en: "Add a set to {name}", fr: "Ajouter une série à {name}" },
  "gymPlans.sets.remove": { en: "Remove set {n} of {name}", fr: "Retirer la série {n} de {name}" },
  "gymPlans.sets.max": {
    en: "A line holds at most 99 sets.",
    fr: "Une ligne contient 99 séries au plus.",
  },
  "gymPlans.sets.confirmSame": {
    en: "Going back to the same targets every set keeps only the first working set and drops the rest. Continue?",
    fr: "Revenir à des objectifs identiques ne garde que la première série de travail et abandonne les autres. Continuer ?",
  },
  "gymPlans.effort.label": { en: "Effort", fr: "Effort" },
  "gymPlans.effort.kind": { en: "Effort scale of {name}", fr: "Échelle d’effort de {name}" },
  "gymPlans.effort.none": { en: "No effort target", fr: "Pas d’objectif d’effort" },
  "gymPlans.effort.rpe": { en: "RPE (1 to 10)", fr: "RPE (de 1 à 10)" },
  "gymPlans.effort.rir": { en: "RIR (reps in reserve)", fr: "RIR (répétitions en réserve)" },
  "gymPlans.effort.value": { en: "Effort of {name}", fr: "Effort pour {name}" },
  "gymPlans.effort.rpeRange": {
    en: "RPE is 1 to 10, in steps of 0.5.",
    fr: "Le RPE va de 1 à 10, par pas de 0,5.",
  },
  "gymPlans.effort.rirRange": {
    en: "RIR is a whole number from 0 to 10.",
    fr: "Le RIR est un entier de 0 à 10.",
  },
  "gymPlans.effort.both": {
    en: "Use RPE or RIR, not both. Clear one.",
    fr: "Utilisez le RPE ou le RIR, pas les deux. Videz-en un.",
  },
  "gymPlans.tempo.label": { en: "Tempo", fr: "Tempo" },
  "gymPlans.tempo.of": { en: "Tempo of {name}", fr: "Tempo de {name}" },
  "gymPlans.tempo.hint": {
    en: "Four parts: down, pause, up, pause. Digits or X, like 3-1-1-0.",
    fr: "Quatre temps : descente, pause, montée, pause. Chiffres ou X, comme 3-1-1-0.",
  },
  "gymPlans.tempo.bad": {
    en: "Tempo is four digits or X joined by dashes, like 3-1-1-0.",
    fr: "Le tempo, ce sont quatre chiffres ou X séparés par des tirets, comme 3-1-1-0.",
  },
  "gymPlans.superset.toggle": { en: "Superset with next", fr: "Superset avec la suivante" },
  "gymPlans.superset.of": {
    en: "Superset {name} with the next exercise",
    fr: "Superset de {name} avec l’exercice suivant",
  },
  "gymPlans.superset.last": {
    en: "There is no next exercise to pair with.",
    fr: "Il n’y a pas d’exercice suivant à associer.",
  },
  "gymPlans.superset.leave": { en: "Leave superset", fr: "Quitter le superset" },
  "gymPlans.superset.badge": { en: "Superset {n}", fr: "Superset {n}" },
  "gymPlans.superset.review": {
    en: "Superset with the next exercise in the file",
    fr: "Superset avec l’exercice suivant du fichier",
  },
  "gymPlans.review.badSet": {
    en: "Fix the highlighted sets to continue.",
    fr: "Corrigez les séries signalées pour continuer.",
  },
  "gymPlans.summary.rpe": { en: "RPE {value}", fr: "RPE {value}" },
  "gymPlans.summary.rir": { en: "{value} in reserve", fr: "{value} en réserve" },
  "gymPlans.summary.tempo": { en: "tempo {value}", fr: "tempo {value}" },
  "gymPlans.summary.superset": { en: "superset {value}", fr: "superset {value}" },
  "gymPlans.summary.warmupSet": { en: "{text} (warm-up)", fr: "{text} (échauffement)" },
  "gymPlans.summary.setsList": { en: "Sets: {list}", fr: "Séries : {list}" },
  "gymPlans.video.preview": { en: "Preview", fr: "Aperçu" },
} satisfies Record<string, Entry>;
