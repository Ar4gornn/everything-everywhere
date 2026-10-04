import type { Entry } from "../catalogue";

/**
 * Epic 43 / 54: the texts of the AI prompts (`gym/prompts.ts`) and the titles of the six cards
 * that offer them. Every prompt is five labelled sections (ROLE, ABOUT ME, TASK, CONFIRM,
 * OUTPUT); the English is the spec's (docs/epic-43-gym-ai-and-rest.md §6, docs/epic-54-gym-format-v2.md),
 * the French is a translation of it. JSON keys ("rest_after_seconds"), enum values ("reps",
 * "duration", "distance") and the file name stay English in both: the importer reads them as
 * written.
 */

const FORMAT_EN = `When every exercise is confirmed, reply with ONLY one JSON code block, nothing before or after it, in exactly this format:

{
  "format": "ee-workout/2",
  "weight_unit": "{unit}",
  "schedule": ["Push day", "rest", "Pull day", "rest", "Legs", "rest", "rest"],
  "routines": [
    {
      "name": "Push day",
      "note": "optional",
      "exercises": [
        {
          "name": "Bench press", "kind": "reps",
          "video_url": "https://www.youtube.com/watch?v=VIDEO_ID",
          "rpe": 8, "tempo": "3-1-1-0", "rest_seconds": 90, "rest_after_seconds": 120,
          "note": "optional",
          "sets": [
            { "reps": 12, "weight": 40, "warmup": true },
            { "reps": 8, "weight": 60 },
            { "reps": 8, "weight": 60 }
          ]
        },
        { "name": "Pull-up", "kind": "reps", "superset": "A", "sets": 3, "reps": 8, "rir": 2 },
        { "name": "Dips", "kind": "reps", "superset": "A", "sets": 3, "reps": 10 },
        { "name": "Plank", "kind": "duration", "sets": 3, "seconds": 45, "rest_seconds": 60 },
        { "name": "Rowing", "kind": "distance", "sets": 1, "distance_m": 2000 }
      ]
    }
  ]
}

The JSON keys and values are always in English, whatever language we talk in. Fields:
- "format": always "ee-workout/2".
- "weight_unit": always "{unit}". Give every weight in {unit}.
- "schedule": optional. An array of day labels for a week, with "rest" for a rest day. Include it only when you proposed a weekly plan.
- "routines": each has a "name" (under 80 characters), an optional "note" (under 500) and its "exercises" (1 to 60, in order).
- "name": the exercise name, under 80 characters.
- "kind": one of "reps", "duration", "distance".
- "video_url": a YouTube link to a short form video for this exercise, only one you are confident exists; omit it otherwise. Never invent a link.
- "sets": a whole number from 1 to 99 when every set has the same target, or a list of set objects when the sets differ. Use a list for pyramids, ramps and warm-up sets; use a number otherwise.
- "reps" ("reps" exercises), "seconds" ("duration" exercises) and "distance_m" in metres ("distance" exercises): whole numbers. Put them on the exercise when "sets" is a number, and inside each set object when "sets" is a list.
- "weight": a number in {unit}, or omit it for bodyweight. Same placement as the measures above.
- "warmup": true inside a set object marks a warm-up set; leave it out for a working set. Warm-up sets are kept out of my history and records.
- "rpe": the effort I am aiming for, 1 to 10 in steps of 0.5. "rir": reps in reserve, a whole number from 0 to 10. Give one of them or neither, never both.
- "tempo": four characters, digits or X, joined by dashes: lowering, pause at the bottom, lifting, pause at the top, in seconds, like "3-1-1-0". Omit it when no tempo matters.
- "superset": a short label (8 characters at most, like "A") written on each of two or more CONSECUTIVE exercises that I do back to back, set by set. Give a different label to each superset and never reuse a label after another exercise has come between. Omit it otherwise.
- "rest_seconds": the rest between sets. "rest_after_seconds": the rest after the last set of the exercise, before the next exercise. Whole numbers, 0 to 3600.
- "note": a short remark, under 200 characters.
No comments inside the JSON.

Finally tell me: "Save this as workout.json and share it to Everything Everywhere, or copy it and paste it in Gym → New workout → Ask an AI."`;

const FORMAT_FR = `Quand chaque exercice est confirmé, réponds avec UNIQUEMENT un bloc de code JSON, rien avant ni après, exactement dans ce format :

{
  "format": "ee-workout/2",
  "weight_unit": "{unit}",
  "schedule": ["Push day", "rest", "Pull day", "rest", "Legs", "rest", "rest"],
  "routines": [
    {
      "name": "Push day",
      "note": "optional",
      "exercises": [
        {
          "name": "Bench press", "kind": "reps",
          "video_url": "https://www.youtube.com/watch?v=VIDEO_ID",
          "rpe": 8, "tempo": "3-1-1-0", "rest_seconds": 90, "rest_after_seconds": 120,
          "note": "optional",
          "sets": [
            { "reps": 12, "weight": 40, "warmup": true },
            { "reps": 8, "weight": 60 },
            { "reps": 8, "weight": 60 }
          ]
        },
        { "name": "Pull-up", "kind": "reps", "superset": "A", "sets": 3, "reps": 8, "rir": 2 },
        { "name": "Dips", "kind": "reps", "superset": "A", "sets": 3, "reps": 10 },
        { "name": "Plank", "kind": "duration", "sets": 3, "seconds": 45, "rest_seconds": 60 },
        { "name": "Rowing", "kind": "distance", "sets": 1, "distance_m": 2000 }
      ]
    }
  ]
}

Les clés et les valeurs du JSON restent toujours en anglais, quelle que soit la langue de notre échange. Champs :
- "format" : toujours "ee-workout/2".
- "weight_unit" : toujours "{unit}". Donne chaque poids en {unit}.
- "schedule" : facultatif. Un tableau d’étiquettes de jours pour une semaine, avec "rest" pour un jour de repos. Ajoute-le seulement si tu as proposé un plan hebdomadaire.
- "routines" : chacune a un "name" (moins de 80 caractères), une "note" facultative (moins de 500) et ses "exercises" (de 1 à 60, dans l’ordre).
- "name" : le nom de l’exercice, moins de 80 caractères.
- "kind" : l’un de "reps", "duration", "distance".
- "video_url" : un lien YouTube vers une courte vidéo de la bonne exécution de cet exercice, seulement si tu es certain qu’elle existe ; sinon omets-le. N’invente jamais de lien.
- "sets" : un nombre entier de 1 à 99 quand chaque série a le même objectif, ou une liste d’objets série quand les séries diffèrent. Utilise une liste pour les pyramides, les montées en charge et les séries d’échauffement ; sinon utilise un nombre.
- "reps" (exercices "reps"), "seconds" (exercices "duration") et "distance_m" en mètres (exercices "distance") : des nombres entiers. Mets-les sur l’exercice quand "sets" est un nombre, et dans chaque objet série quand "sets" est une liste.
- "weight" : un nombre en {unit}, ou omets-le pour le poids du corps. Même emplacement que les mesures ci-dessus.
- "warmup" : true dans un objet série marque une série d’échauffement ; ne l’écris pas pour une série de travail. Les séries d’échauffement ne comptent ni dans mon historique ni dans mes records.
- "rpe" : l’effort visé, de 1 à 10 par pas de 0,5. "rir" : les répétitions en réserve, un entier de 0 à 10. Donne l’un des deux ou aucun, jamais les deux.
- "tempo" : quatre caractères, chiffres ou X, reliés par des tirets : descente, pause en bas, montée, pause en haut, en secondes, comme "3-1-1-0". Omets-le quand le tempo n’a pas d’importance.
- "superset" : une courte étiquette (8 caractères au plus, comme "A") écrite sur chacun de deux exercices CONSÉCUTIFS ou plus que j’enchaîne, série par série. Donne une étiquette différente à chaque superset et ne réutilise jamais une étiquette après qu’un autre exercice s’est intercalé. Omets-le sinon.
- "rest_seconds" : le repos entre les séries. "rest_after_seconds" : le repos après la dernière série de l’exercice, avant l’exercice suivant. Des nombres entiers, de 0 à 3600.
- "note" : une courte remarque, moins de 200 caractères.
Pas de commentaires dans le JSON.

Dis-moi enfin : "Save this as workout.json and share it to Everything Everywhere, or copy it and paste it in Gym → New workout → Ask an AI." (Enregistre ceci sous workout.json et partage-le à Everything Everywhere, ou copie-le et colle-le dans Sport → Nouvelle séance → Demander à une IA.)`;

export const gymPrompts = {
  // ---- the five section headings every prompt carries, in this order
  "gymPrompt.section.role": { en: "ROLE", fr: "RÔLE" },
  "gymPrompt.section.about": { en: "ABOUT ME", fr: "À PROPOS DE MOI" },
  "gymPrompt.section.task": { en: "TASK", fr: "TÂCHE" },
  "gymPrompt.section.confirm": { en: "CONFIRM", fr: "CONFIRMATION" },
  "gymPrompt.section.output": { en: "OUTPUT", fr: "SORTIE" },

  // ---- the pieces every prompt shares
  "gymPrompt.role": {
    en: 'You are helping me build a gym workout that I will import into my app "Everything Everywhere".',
    fr: "Tu m’aides à construire une séance de sport que j’importerai dans mon application « Everything Everywhere ».",
  },
  "gymPrompt.confirm": {
    en: "Go through the exercises ONE AT A TIME. For each, show: name, kind (reps, duration or distance), sets (the same every set, or set by set when they differ, with any warm-up sets), reps or seconds or metres, weight, effort (RPE or RIR) and tempo when they matter, the superset partner if there is one, rest between sets in seconds, rest after the exercise in seconds, and a short note. Ask me to confirm or correct it, and do not move on until I confirm. Keep each message short — I am probably at the gym.",
    fr: "Passe les exercices en revue UN PAR UN. Pour chacun, montre : le nom, le type (reps, duration ou distance), les séries (identiques, ou une par une quand elles diffèrent, avec les éventuelles séries d’échauffement), les répétitions ou secondes ou mètres, la charge, l’effort (RPE ou RIR) et le tempo quand ils comptent, le partenaire de superset s’il y en a un, le repos entre les séries en secondes, le repos après l’exercice en secondes, et une courte note. Demande-moi de confirmer ou de corriger, et ne passe pas à la suite avant ma confirmation. Garde chaque message court — je suis probablement à la salle.",
  },
  "gymPrompt.confirmOnce": {
    en: 'List ALL the exercises in one message. For each, show: name, kind (reps, duration or distance), sets (the same every set, or set by set when they differ, with any warm-up sets), reps or seconds or metres, weight, effort (RPE or RIR) and tempo when they matter, the superset partner if there is one, rest between sets in seconds, rest after the exercise in seconds, and a short note. Then ask me "Anything to change?" and apply my corrections. Keep it short — I am probably at the gym.',
    fr: "Liste TOUS les exercices dans un seul message. Pour chacun, montre : le nom, le type (reps, duration ou distance), les séries (identiques, ou une par une quand elles diffèrent, avec les éventuelles séries d’échauffement), les répétitions ou secondes ou mètres, la charge, l’effort (RPE ou RIR) et le tempo quand ils comptent, le partenaire de superset s’il y en a un, le repos entre les séries en secondes, le repos après l’exercice en secondes, et une courte note. Puis demande-moi « Quelque chose à changer ? » et applique mes corrections. Reste bref — je suis probablement à la salle.",
  },
  "gymPrompt.format": { en: FORMAT_EN, fr: FORMAT_FR },

  // ---- the person's context block (under the ABOUT ME heading)
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

  // ---- the six profiles: instructions (under the TASK heading)
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
