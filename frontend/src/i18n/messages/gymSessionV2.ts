import type { Entry } from "../catalogue";

/** Epic 54.4: live session hints, warm-up sets, supersets. */
export const gymSessionV2 = {
  "gymSessionV2.warmup": { en: "Warm-up", fr: "Échauffement" },
  "gymSessionV2.warmupHelp": {
    en: "A warm-up set is kept in the session but not counted in your volume or records.",
    fr: "Une série d'échauffement reste dans la séance mais n'est comptée ni dans votre volume ni dans vos records.",
  },
  "gymSessionV2.rpe": { en: "Effort: RPE {n}", fr: "Effort : RPE {n}" },
  "gymSessionV2.rpeHelp": {
    en: "RPE is how hard the set feels, from 1 (very easy) to 10 (nothing left in the tank).",
    fr: "Le RPE est la difficulté ressentie de la série, de 1 (très facile) à 10 (rien en réserve).",
  },
  "gymSessionV2.rir_one": { en: "Stop with {count} rep in reserve", fr: "Arrêtez avec {count} répétition en réserve" },
  "gymSessionV2.rir_other": { en: "Stop with {count} reps in reserve", fr: "Arrêtez avec {count} répétitions en réserve" },
  "gymSessionV2.rirHelp": {
    en: "Reps in reserve is how many more clean reps you could still have done when you stop.",
    fr: "Les répétitions en réserve sont celles que vous auriez encore pu faire proprement en vous arrêtant.",
  },
  "gymSessionV2.tempo": { en: "Tempo {value}", fr: "Rythme {value}" },
  "gymSessionV2.tempoHelp": {
    en: "Four numbers, in seconds: lowering, pause at the bottom, lifting, pause at the top. X means as fast as you can.",
    fr: "Quatre nombres, en secondes : descente, pause en bas, montée, pause en haut. X signifie aussi vite que possible.",
  },
  "gymSessionV2.superset": { en: "Superset: {names}", fr: "Superset : {names}" },
  "gymSessionV2.supersetNext": { en: "Next in the superset: {name}", fr: "Ensuite dans le superset : {name}" },
} satisfies Record<string, Entry>;
