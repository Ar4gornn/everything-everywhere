import type { Entry } from "../catalogue";

/**
 * Epic 43: the texts of the AI prompts (`gym/prompts.ts`) and the titles of the six cards that
 * offer them. The English is the spec's (docs/epic-43-gym-ai-and-rest.md §6); the French is a
 * translation of it. JSON keys ("rest_after_seconds"), enum values ("reps", "duration",
 * "distance") and the file name stay English in both: the importer reads them as written.
 */

const FORMAT_EN = `When every exercise is confirmed, reply with ONLY one JSON code block, nothing before or after it, in exactly this format:

{
  "format": "ee-workout/1",
  "weight_unit": "kg",
  "schedule": ["Push day", "rest", "Pull day", "rest", "Legs", "rest", "rest"],
  "routines": [
    {
      "name": "Routine name",
      "note": "optional",
      "exercises": [
        { "name": "Bench press", "kind": "reps", "sets": 4, "reps": 8, "weight": 60, "rest_seconds": 90, "rest_after_seconds": 120, "note": "optional" },
        { "name": "Plank", "kind": "duration", "sets": 3, "seconds": 45, "rest_seconds": 60 },
        { "name": "Rowing", "kind": "distance", "sets": 1, "distance_m": 2000 }
      ]
    }
  ]
}

Rules for the JSON: "kind" is one of "reps", "duration", "distance". Use "reps" for reps exercises, "seconds" for duration exercises, "distance_m" (metres) for distance exercises. "weight" is a number in my unit, or omit it for bodyweight. "rest_seconds" is the rest between sets; "rest_after_seconds" is the rest after the last set of the exercise, before the next exercise. "schedule" is optional: an array of day labels for a week, using "rest" for a rest day; include it only when you proposed a weekly plan. Whole numbers for sets, reps, seconds, rest_seconds, rest_after_seconds and distance_m. Names under 80 characters, notes under 200. No comments inside the JSON.

Finally tell me: "Save this as workout.json and share it to Everything Everywhere, or copy it and paste it in Gym → New workout → Ask an AI."`;

const FORMAT_FR = `Quand chaque exercice est confirmé, réponds avec UNIQUEMENT un bloc de code JSON, rien avant ni après, exactement dans ce format :

{
  "format": "ee-workout/1",
  "weight_unit": "kg",
  "schedule": ["Push day", "rest", "Pull day", "rest", "Legs", "rest", "rest"],
  "routines": [
    {
      "name": "Routine name",
      "note": "optional",
      "exercises": [
        { "name": "Bench press", "kind": "reps", "sets": 4, "reps": 8, "weight": 60, "rest_seconds": 90, "rest_after_seconds": 120, "note": "optional" },
        { "name": "Plank", "kind": "duration", "sets": 3, "seconds": 45, "rest_seconds": 60 },
        { "name": "Rowing", "kind": "distance", "sets": 1, "distance_m": 2000 }
      ]
    }
  ]
}

Règles pour le JSON : "kind" vaut "reps", "duration" ou "distance". Utilise "reps" pour les exercices en répétitions, "seconds" pour les exercices de durée, "distance_m" (en mètres) pour les exercices de distance. "weight" est un nombre dans mon unité, ou omets-le pour le poids du corps. "rest_seconds" est le repos entre les séries ; "rest_after_seconds" est le repos après la dernière série de l'exercice, avant l'exercice suivant. "schedule" est facultatif : un tableau d'étiquettes de jours pour une semaine, avec "rest" pour un jour de repos ; ajoute-le seulement si tu as proposé un plan hebdomadaire. Des nombres entiers pour sets, reps, seconds, rest_seconds, rest_after_seconds et distance_m. Noms de moins de 80 caractères, notes de moins de 200. Pas de commentaires dans le JSON.

Dis-moi enfin : "Save this as workout.json and share it to Everything Everywhere, or copy it and paste it in Gym → New workout → Ask an AI." (Enregistre ceci sous workout.json et partage-le à Everything Everywhere, ou copie-le et colle-le dans Sport → Nouvelle séance → Demander à une IA.)`;

export const gymPrompts = {
  // ---- the pieces every prompt shares
  "gymPrompt.role": {
    en: 'You are helping me build a gym workout that I will import into my app "Everything Everywhere".',
    fr: "Tu m’aides à construire une séance de sport que j’importerai dans mon application « Everything Everywhere ».",
  },
  "gymPrompt.confirm": {
    en: "Then go through the exercises ONE AT A TIME. For each, show: name, kind (reps, duration or distance), sets, reps or seconds or metres, weight, rest between sets in seconds, rest after the exercise in seconds, and a short note. Ask me to confirm or correct it, and do not move on until I confirm. Keep each message short — I am probably at the gym.",
    fr: "Ensuite, passe les exercices en revue UN PAR UN. Pour chacun, montre : le nom, le type (reps, duration ou distance), les séries, les répétitions ou secondes ou mètres, la charge, le repos entre les séries en secondes, le repos après l’exercice en secondes, et une courte note. Demande-moi de confirmer ou de corriger, et ne passe pas à la suite avant ma confirmation. Garde chaque message court — je suis probablement à la salle.",
  },
  "gymPrompt.confirmOnce": {
    en: 'Then list ALL the exercises in one message. For each, show: name, kind (reps, duration or distance), sets, reps or seconds or metres, weight, rest between sets in seconds, rest after the exercise in seconds, and a short note. Then ask me "Anything to change?" and apply my corrections. Keep it short — I am probably at the gym.',
    fr: "Ensuite, liste TOUS les exercices dans un seul message. Pour chacun, montre : le nom, le type (reps, duration ou distance), les séries, les répétitions ou secondes ou mètres, la charge, le repos entre les séries en secondes, le repos après l’exercice en secondes, et une courte note. Puis demande-moi « Quelque chose à changer ? » et applique mes corrections. Reste bref — je suis probablement à la salle.",
  },
  "gymPrompt.format": { en: FORMAT_EN, fr: FORMAT_FR },

  // ---- the person's context block
  "gymPrompt.context.header": {
    en: "About me (from my app):",
    fr: "À propos de moi (depuis mon application) :",
  },
  "gymPrompt.context.unit": {
    en: "- I count weight in {unit}.",
    fr: "- Je compte les charges en {unit}.",
  },
  "gymPrompt.context.exercises": {
    en: "- Exercises I already have (reuse these exact names when they fit): {list}",
    fr: "- Exercices que j’ai déjà (réutilise exactement ces noms quand ils conviennent) : {list}",
  },
  "gymPrompt.context.routines": {
    en: "- My routines: {list}",
    fr: "- Mes programmes : {list}",
  },
  "gymPrompt.context.recent": {
    en: "- My last sessions, newest first:",
    fr: "- Mes dernières séances, de la plus récente à la plus ancienne :",
  },
  "gymPrompt.context.freeSession": { en: "free session", fr: "séance libre" },
  "gymPrompt.context.restDay": { en: "{date} rest day", fr: "{date} jour de repos" },
  "gymPrompt.context.kind.reps": { en: "reps", fr: "reps" },
  "gymPrompt.context.kind.duration": { en: "duration", fr: "duration" },
  "gymPrompt.context.kind.distance": { en: "distance", fr: "distance" },

  // ---- the six profiles: instructions
  "gymPrompt.notes.instructions": {
    en: "I already know what I want to do. Below are my notes, possibly messy. Turn them into a workout. Do not redesign it and do not add exercises I did not mention. Only ask about what is missing or ambiguous (sets, reps, weight, rest), in one short message. My notes:\n{notes}",
    fr: "Je sais déjà ce que je veux faire. Voici mes notes, peut-être en vrac. Transforme-les en séance. Ne la réinvente pas et n’ajoute aucun exercice que je n’ai pas mentionné. Ne pose de questions que sur ce qui manque ou reste ambigu (séries, répétitions, charge, repos), en un seul message court. Mes notes :\n{notes}",
  },
  "gymPrompt.notes.pending": {
    en: "(I will paste them in my next message)",
    fr: "(je les collerai dans mon prochain message)",
  },
  "gymPrompt.build.instructions": {
    en: `I don't know what to do at the gym. Interview me before proposing anything: ask about my goal, my experience, how often and how long I can train, my equipment, injuries or pain, what I enjoy or hate, and anything else you need — a few questions per message, as many messages as needed. Find my real level; when unsure, choose the easier option. Then propose a weekly plan with rest days (fill "schedule") and the routines for it.`,
    fr: "Je ne sais pas quoi faire à la salle. Interroge-moi avant de proposer quoi que ce soit : mon objectif, mon expérience, la fréquence et la durée possibles de mes séances, mon matériel, mes blessures ou douleurs, ce que j’aime ou déteste, et tout ce dont tu as besoin — quelques questions par message, autant de messages que nécessaire. Trouve mon vrai niveau ; en cas de doute, choisis l’option la plus facile. Puis propose un plan hebdomadaire avec des jours de repos (remplis \"schedule\") et les programmes qui vont avec.",
  },
  "gymPrompt.fresh.instructions": {
    en: `I like a different workout every time. Use my last sessions below so today's workout does not repeat yesterday's and balances the muscle groups I have not trained recently. First ask me in one short message: how long today, which area or style I feel like (or "surprise me"), and my energy level. Then propose ONE routine for today.`,
    fr: "J’aime une séance différente à chaque fois. Appuie-toi sur mes dernières séances ci-dessous pour que la séance du jour ne répète pas celle d’hier et équilibre les groupes musculaires que je n’ai pas travaillés récemment. Demande-moi d’abord, en un message court : combien de temps aujourd’hui, quelle zone ou quel style me tente (ou « surprends-moi »), et mon niveau d’énergie. Puis propose UN programme pour aujourd’hui.",
  },
  "gymPrompt.quick.instructions": {
    en: "I have little time and little motivation today. Ask me in one message: how many minutes (15, 20 or 30) and what equipment is around. Then give ONE short routine that fits that time including rests (estimate it), with simple exercises and no setup-heavy machines. Use supersets-free straight sets.",
    fr: "J’ai peu de temps et peu de motivation aujourd’hui. Demande-moi en un message : combien de minutes (15, 20 ou 30) et quel matériel il y a autour. Puis donne UN programme court qui tient dans ce temps, repos compris (estime-le), avec des exercices simples et sans machines longues à régler. Fais des séries classiques, sans supersets.",
  },
  "gymPrompt.progress.instructions": {
    en: "I want to progress on what I already do. Look at my routines and last sessions below. Ask me which routine to progress and whether the last sessions felt easy, right or hard. Propose small steps only (about +2.5 kg / +5 lb or +1–2 reps or +5–10 s), never all at once, and keep the same exercises unless I ask.",
    fr: "Je veux progresser sur ce que je fais déjà. Regarde mes programmes et mes dernières séances ci-dessous. Demande-moi quel programme faire progresser et si les dernières séances étaient faciles, justes ou difficiles. Ne propose que de petits pas (environ +2,5 kg / +5 lb ou +1 à 2 répétitions ou +5 à 10 s), jamais tout à la fois, et garde les mêmes exercices sauf demande contraire.",
  },
  "gymPrompt.home.instructions": {
    en: "I am training at home or travelling. Ask me in one message what I have (nothing, a mat, dumbbells, bands, a pull-up bar…) and how much space and time. Then propose ONE routine using only that, with duration exercises where reps make no sense.",
    fr: "Je m’entraîne à la maison ou en déplacement. Demande-moi en un message ce que j’ai (rien, un tapis, des haltères, des élastiques, une barre de traction…) ainsi que l’espace et le temps disponibles. Puis propose UN programme n’utilisant que cela, avec des exercices de durée là où les répétitions n’ont pas de sens.",
  },

  // ---- the cards
  "gymPrompt.notes.title": { en: "I know what I want", fr: "Je sais ce que je veux" },
  "gymPrompt.notes.description": {
    en: "Turn your own notes into a workout. Few questions.",
    fr: "Transformez vos notes en séance. Peu de questions.",
  },
  "gymPrompt.build.title": { en: "Build me one", fr: "Construisez-m’en une" },
  "gymPrompt.build.description": {
    en: "No idea where to start? It asks about you and finds your level.",
    fr: "Aucune idée par où commencer ? Il vous interroge et trouve votre niveau.",
  },
  "gymPrompt.fresh.title": { en: "Something new every day", fr: "Du nouveau chaque jour" },
  "gymPrompt.fresh.description": {
    en: "A different workout each time, based on what you did.",
    fr: "Une séance différente à chaque fois, d’après ce que vous avez fait.",
  },
  "gymPrompt.quick.title": { en: "Short on time", fr: "Peu de temps" },
  "gymPrompt.quick.description": {
    en: "15–30 minutes, today, whatever you have.",
    fr: "15 à 30 minutes, aujourd’hui, avec ce que vous avez.",
  },
  "gymPrompt.progress.title": { en: "Make my routine harder", fr: "Rendre mon programme plus dur" },
  "gymPrompt.progress.description": {
    en: "Small, safe steps up from your history.",
    fr: "De petits pas prudents à partir de votre historique.",
  },
  "gymPrompt.home.title": { en: "Home or travel", fr: "Maison ou voyage" },
  "gymPrompt.home.description": {
    en: "Bodyweight or a few items, any room.",
    fr: "Poids du corps ou quelques accessoires, dans n’importe quelle pièce.",
  },
} satisfies Record<string, Entry>;
