import type { Entry } from "../catalogue";

/** Epic 54.2: messages of the ee-workout/2 parser and review flags. */
export const gymFormat = {
  "gymFormat.rpeStep": {
    en: "RPE goes from 1 to 10, in steps of 0.5.",
    fr: "Le RPE va de 1 à 10, par pas de 0,5.",
  },
  "gymFormat.effortBoth": {
    en: "Give RPE or RIR, not both. Clear one of them.",
    fr: "Indiquez le RPE ou le RIR, pas les deux. Videz l’un des deux.",
  },
  "gymFormat.tempo": {
    en: "Use four digits or X joined by dashes, like 3-1-1-0.",
    fr: "Utilisez quatre chiffres ou X reliés par des tirets, comme 3-1-1-0.",
  },
  "gymFormat.supersetLong": {
    en: "A superset label is 8 characters at most.",
    fr: "Une étiquette de superset fait 8 caractères au plus.",
  },
  "gymFormat.supersetSplit": {
    en: "This label comes back after another exercise. A superset must be consecutive.",
    fr: "Cette étiquette revient après un autre exercice. Un superset doit être consécutif.",
  },
  "gymFormat.setsInvalid": {
    en: "One of the sets has a problem. Fix it below.",
    fr: "L’une des séries pose problème. Corrigez-la ci-dessous.",
  },
  "gymFormat.warn.lonelySuperset": {
    en: "A superset label used by only one exercise was ignored.",
    fr: "Une étiquette de superset utilisée par un seul exercice a été ignorée.",
  },
} satisfies Record<string, Entry>;
