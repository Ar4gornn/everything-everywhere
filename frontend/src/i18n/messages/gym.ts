import type { Entry } from "../catalogue";

/**
 * The gym page (Epic 42): home, the live session, the routine editor and the import review.
 * The dashboard card, the offline store and the file parser's errors are in `gymCore.ts`.
 */

// The prompt a person gives Claude or ChatGPT to write a workout file (spec §10, also
// `docs/gym-import.md` — a test keeps the two identical). The JSON keys stay English in French:
// they are the file format, not words.
const PROMPT_EN = `You are helping me build a gym workout that I will import into my app "Everything Everywhere".

1. First ask me, in one message: my goal, my level, how many days a week, how long a session can
   be, what equipment I have, any injuries, and whether I count weight in kg or lb.
2. Propose the routine(s) as a short list (name, exercises with sets × reps or time or distance).
3. Then go through the exercises ONE AT A TIME. For each, show: name, kind (reps, duration or
   distance), sets, reps or seconds or metres, weight, rest in seconds, and a short note. Ask me
   to confirm or correct it. Apply my corrections and show it again until I say it is right.
   Do not move to the next exercise before I confirm the current one.
4. When every exercise is confirmed, reply with ONLY one JSON code block, nothing before or after
   it, in exactly this format:

{
  "format": "ee-workout/1",
  "weight_unit": "kg",
  "routines": [
    {
      "name": "Routine name",
      "note": "optional",
      "exercises": [
        { "name": "Bench press", "kind": "reps", "sets": 4, "reps": 8, "weight": 60, "rest_seconds": 90, "note": "optional" },
        { "name": "Plank", "kind": "duration", "sets": 3, "seconds": 45, "rest_seconds": 60 },
        { "name": "Rowing", "kind": "distance", "sets": 1, "distance_m": 2000 }
      ]
    }
  ]
}

Rules for the JSON: "kind" is one of "reps", "duration", "distance". Use "reps" for reps
exercises, "seconds" for duration exercises, "distance_m" (metres) for distance exercises.
"weight" is a number in my unit, or omit it for bodyweight. Whole numbers for sets, reps,
seconds, rest_seconds and distance_m. Names under 80 characters, notes under 200. No comments
inside the JSON.

5. Finally tell me: "Save this as workout.json and share it to Everything Everywhere, or copy it
   and paste it in Gym → Import."`;

const PROMPT_FR = `Tu m’aides à construire une séance de sport que j’importerai dans mon application « Everything Everywhere ».

1. Commence par me poser, en un seul message, ces questions : mon objectif, mon niveau, combien de
   jours par semaine, la durée maximale d’une séance, le matériel dont je dispose, mes éventuelles
   blessures, et si je compte les poids en kg ou en lb.
2. Propose-moi le ou les programmes sous forme de courte liste (nom, exercices avec séries × répétitions,
   ou durée, ou distance).
3. Passe ensuite en revue les exercices UN PAR UN. Pour chacun, indique : le nom, le type (reps,
   duration ou distance), les séries, les répétitions ou les secondes ou les mètres, le poids, le repos
   en secondes et une courte note. Demande-moi de confirmer ou de corriger. Applique mes corrections et
   montre-le de nouveau jusqu’à ce que je dise que c’est bon. Ne passe pas à l’exercice suivant avant
   que j’aie confirmé l’exercice en cours.
4. Quand tous les exercices sont confirmés, réponds avec UNIQUEMENT un bloc de code JSON, rien avant
   ni après, exactement dans ce format :

{
  "format": "ee-workout/1",
  "weight_unit": "kg",
  "routines": [
    {
      "name": "Routine name",
      "note": "optional",
      "exercises": [
        { "name": "Bench press", "kind": "reps", "sets": 4, "reps": 8, "weight": 60, "rest_seconds": 90, "note": "optional" },
        { "name": "Plank", "kind": "duration", "sets": 3, "seconds": 45, "rest_seconds": 60 },
        { "name": "Rowing", "kind": "distance", "sets": 1, "distance_m": 2000 }
      ]
    }
  ]
}

Règles pour le JSON : "kind" vaut "reps", "duration" ou "distance". Utilise "reps" pour les exercices
en répétitions, "seconds" pour les exercices de durée, "distance_m" (en mètres) pour les exercices de
distance. "weight" est un nombre dans mon unité, ou omets-le pour le poids du corps. Des nombres
entiers pour sets, reps, seconds, rest_seconds et distance_m. Des noms de moins de 80 caractères, des
notes de moins de 200. Aucun commentaire dans le JSON.

5. Pour finir, dis-moi : « Enregistre ceci sous workout.json et partage-le vers Everything Everywhere,
   ou copie-le et colle-le dans Sport → Importer. »`;

export const gym = {
  "gym.title": { en: "Gym", fr: "Sport" },
  "gym.freeSession": { en: "Free session", fr: "Séance libre" },
  "gym.sets": { en: "Sets", fr: "Séries" },
  "gym.reps": { en: "Reps", fr: "Répétitions" },
  "gym.seconds": { en: "Seconds", fr: "Secondes" },
  "gym.metres": { en: "Metres", fr: "Mètres" },
  "gym.weightIn": { en: "Weight ({unit})", fr: "Poids ({unit})" },
  "gym.restSeconds": { en: "Rest (s)", fr: "Repos (s)" },
  "gym.video": { en: "video", fr: "vidéo" },
  "gym.videoLink": { en: "Video link", fr: "Lien vidéo" },
  "gym.kind": { en: "Counts in", fr: "Se compte en" },
  "gym.kind.reps": { en: "Reps", fr: "Répétitions" },
  "gym.kind.duration": { en: "Time", fr: "Durée" },
  "gym.kind.distance": { en: "Distance", fr: "Distance" },
  "gym.noTarget": { en: "No target", fr: "Pas d’objectif" },
  "gym.back": { en: "Back", fr: "Retour" },
  "gym.backToGym": { en: "Back to the gym", fr: "Retour au sport" },
  "gym.discard": { en: "Discard", fr: "Abandonner" },
  "gym.minutes": { en: "{n} min", fr: "{n} min" },

  // --- counted things
  "gym.setsCount_one": { en: "{count} set", fr: "{count} série" },
  "gym.setsCount_other": { en: "{count} sets", fr: "{count} séries" },
  "gym.repsCount_one": { en: "{count} rep", fr: "{count} répétition" },
  "gym.repsCount_other": { en: "{count} reps", fr: "{count} répétitions" },
  "gym.exercisesCount_one": { en: "{count} exercise", fr: "{count} exercice" },
  "gym.exercisesCount_other": { en: "{count} exercises", fr: "{count} exercices" },
  "gym.waiting_one": {
    en: "{count} session waiting to sync",
    fr: "{count} séance en attente de synchronisation",
  },
  "gym.waiting_other": {
    en: "{count} sessions waiting to sync",
    fr: "{count} séances en attente de synchronisation",
  },

  // --- home
  "gym.offlinePill": {
    en: "Offline. Sessions are saved on this phone.",
    fr: "Hors ligne. Les séances sont enregistrées sur ce téléphone.",
  },
  "gym.refused": {
    en: "The session “{name}” of {date} was refused by the server and is kept on this phone.",
    fr: "La séance « {name} » du {date} a été refusée par le serveur et reste sur ce téléphone.",
  },
  "gym.inProgress": { en: "Session in progress", fr: "Séance en cours" },
  "gym.resume": { en: "Resume", fr: "Reprendre" },
  "gym.discardConfirm": {
    en: "Discard this session? The sets logged so far will be lost.",
    fr: "Abandonner cette séance ? Les séries déjà enregistrées seront perdues.",
  },
  "gym.replaceConfirm": {
    en: "A session is already in progress. Replace it with a new one? Its sets will be lost.",
    fr: "Une séance est déjà en cours. La remplacer par une nouvelle ? Ses séries seront perdues.",
  },
  "gym.startSession": { en: "Start a session", fr: "Commencer une séance" },
  "gym.startEmpty": { en: "Start empty session", fr: "Commencer une séance vide" },
  "gym.startNamed": { en: "Start {name}", fr: "Commencer {name}" },
  "gym.noRoutinesHint": {
    en: "No routines yet. A routine is a named list of exercises you start a session from; you can also just start empty.",
    fr: "Aucun programme pour l’instant. Un programme est une liste d’exercices nommée par laquelle commencer une séance ; vous pouvez aussi commencer à vide.",
  },
  "gym.about": { en: "about {n} min", fr: "environ {n} min" },
  "gym.lastDone": { en: "Last done {date}", fr: "Dernière séance : {date}" },
  "gym.neverDone": { en: "Not done yet", fr: "Pas encore faite" },
  "gym.routines": { en: "Routines", fr: "Programmes" },
  "gym.noRoutines": { en: "No routines yet.", fr: "Aucun programme pour l’instant." },
  "gym.newRoutine": { en: "New routine", fr: "Nouveau programme" },
  "gym.routineName": { en: "Routine name", fr: "Nom du programme" },
  "gym.routinePlaceholder": { en: "Push day", fr: "Jour poussée" },
  "gym.createRoutine": { en: "Create routine", fr: "Créer le programme" },
  "gym.importFromFile": { en: "Import from file", fr: "Importer depuis un fichier" },
  "gym.needsConnection": {
    en: "Editing routines needs a connection. Your sessions still work offline.",
    fr: "Modifier les programmes demande une connexion. Vos séances fonctionnent toujours hors ligne.",
  },
  "gym.couldNotCreateRoutine": {
    en: "Could not create that routine.",
    fr: "Impossible de créer ce programme.",
  },

  // --- history and exercises
  "gym.history": { en: "History", fr: "Historique" },
  "gym.nothingLogged": { en: "Nothing logged yet.", fr: "Rien d’enregistré pour l’instant." },
  "gym.noSets": { en: "No sets yet.", fr: "Aucune série pour l’instant." },
  "gym.offlineDetail": {
    en: "Open this session online to see its sets.",
    fr: "Ouvrez cette séance en ligne pour voir ses séries.",
  },
  "gym.deleteSession": { en: "Delete session of {date}", fr: "Supprimer la séance du {date}" },
  "gym.deleteSessionConfirm": {
    en: "Delete this session and its sets?",
    fr: "Supprimer cette séance et ses séries ?",
  },
  "gym.couldNotOpenSession": {
    en: "Could not open that session.",
    fr: "Impossible d’ouvrir cette séance.",
  },
  "gym.couldNotDeleteSession": {
    en: "Could not delete that session.",
    fr: "Impossible de supprimer cette séance.",
  },
  "gym.exercises": { en: "Exercises", fr: "Exercices" },
  "gym.progress": { en: "Progress", fr: "Progression" },
  "gym.progressOf": { en: "Progress of {name}", fr: "Progression : {name}" },
  "gym.logToSee": {
    en: "Log a set and the history appears here.",
    fr: "Enregistrez une série et l’historique apparaîtra ici.",
  },
  "gym.nothingLoggedFor": {
    en: "Nothing logged for {name} yet.",
    fr: "Rien d’enregistré pour {name} pour l’instant.",
  },
  "gym.couldNotLoadHistory": {
    en: "Could not load that history.",
    fr: "Impossible de charger cet historique.",
  },
  "gym.editNamed": { en: "Edit {name}", fr: "Modifier {name}" },
  "gym.couldNotSaveExercise": {
    en: "Could not save that exercise.",
    fr: "Impossible d’enregistrer cet exercice.",
  },
  "gym.offlineReadOnly": {
    en: "Offline: exercises can be read, not changed.",
    fr: "Hors ligne : les exercices sont consultables, pas modifiables.",
  },

  // --- adding an exercise (session and routine)
  "gym.exerciseName": { en: "Exercise name", fr: "Nom de l’exercice" },
  "gym.exercisePlaceholder": { en: "Bench press", fr: "Développé couché" },
  "gym.usesExisting": {
    en: "Uses your existing {name}",
    fr: "Utilise votre exercice « {name} »",
  },
  "gym.addExercise": { en: "Add exercise", fr: "Ajouter un exercice" },
  "gym.addToSession": { en: "Add to session", fr: "Ajouter à la séance" },
  "gym.addToRoutine": { en: "Add to routine", fr: "Ajouter au programme" },

  // --- the live session
  "gym.sessionTitle": { en: "Session", fr: "Séance" },
  "gym.noActive": { en: "No session in progress.", fr: "Aucune séance en cours." },
  "gym.finish": { en: "Finish", fr: "Terminer" },
  "gym.menuLabel": { en: "Session options", fr: "Options de la séance" },
  "gym.sessionNote": { en: "Note for this session", fr: "Note pour cette séance" },
  "gym.progressLine": {
    en: "Exercise {n}/{total} · {done}/{planned} sets",
    fr: "Exercice {n}/{total} · {done}/{planned} séries",
  },
  "gym.finishConfirm_one": {
    en: "{count} planned set is not done. Finish anyway?",
    fr: "{count} série prévue n’est pas faite. Terminer quand même ?",
  },
  "gym.finishConfirm_other": {
    en: "{count} planned sets are not done. Finish anyway?",
    fr: "{count} séries prévues ne sont pas faites. Terminer quand même ?",
  },
  "gym.couldNotFinish": {
    en: "Could not finish the session. It is still saved on this phone.",
    fr: "Impossible de terminer la séance. Elle reste enregistrée sur ce téléphone.",
  },
  "gym.rest": { en: "Rest", fr: "Repos" },
  "gym.skipRest": { en: "Skip rest", fr: "Passer le repos" },
  "gym.exerciseDone": { en: "Done", fr: "Terminé" },
  "gym.target": { en: "Target {target}", fr: "Objectif {target}" },
  "gym.lastTime": { en: "Last time: {last}", fr: "La dernière fois : {last}" },
  "gym.editSet": { en: "Edit set {n} of {name}", fr: "Modifier la série {n} de {name}" },
  "gym.removeSet": { en: "Remove set {n} of {name}", fr: "Retirer la série {n} de {name}" },
  "gym.doneSet": { en: "Done", fr: "Fait" },
  "gym.need.reps": {
    en: "Enter the reps for this set (at least 1).",
    fr: "Saisissez les répétitions de cette série (au moins 1).",
  },
  "gym.need.duration": {
    en: "Enter the time in seconds (at least 1).",
    fr: "Saisissez la durée en secondes (au moins 1).",
  },
  "gym.need.distance": {
    en: "Enter the distance in metres (at least 1).",
    fr: "Saisissez la distance en mètres (au moins 1).",
  },
  "gym.removeExercise": { en: "Remove this exercise", fr: "Retirer cet exercice" },
  "gym.startTimer": { en: "Start timer", fr: "Lancer le chrono" },
  "gym.stopTimer": { en: "Stop", fr: "Arrêter" },
  "gym.timer": { en: "Timer", fr: "Chrono" },
  "gym.less": { en: "Decrease {field}", fr: "Diminuer {field}" },
  "gym.more": { en: "Increase {field}", fr: "Augmenter {field}" },
  "gym.summaryTitle": { en: "Session complete", fr: "Séance terminée" },
  "gym.duration": { en: "Duration", fr: "Durée" },
  "gym.volume": { en: "Volume", fr: "Volume" },
  "gym.bests": {
    en: "Up on last time: {names}.",
    fr: "En progrès par rapport à la dernière fois : {names}.",
  },
  "gym.syncSaved": { en: "Saved.", fr: "Enregistrée." },
  "gym.syncQueued": {
    en: "Saved on this phone. It will be sent when you are back online.",
    fr: "Enregistrée sur ce téléphone. Elle sera envoyée dès que vous serez de nouveau en ligne.",
  },
  "gym.syncRefused": {
    en: "The server refused this session. It is kept on this phone.",
    fr: "Le serveur a refusé cette séance. Elle reste sur ce téléphone.",
  },

  // --- the routine editor
  "gym.saveDetails": { en: "Save details", fr: "Enregistrer les détails" },
  "gym.startThis": { en: "Start this routine", fr: "Commencer ce programme" },
  "gym.deleteRoutine": { en: "Delete routine", fr: "Supprimer le programme" },
  "gym.deleteRoutineConfirm": {
    en: "Delete {name}? Sessions already done stay in your history.",
    fr: "Supprimer {name} ? Les séances déjà faites restent dans votre historique.",
  },
  "gym.exercisesOf": { en: "{name} exercises", fr: "Exercices : {name}" },
  "gym.emptyRoutine": { en: "Nothing in {name} yet.", fr: "{name} est encore vide." },
  "gym.routineNotFound": {
    en: "That routine does not exist.",
    fr: "Ce programme n’existe pas.",
  },
  "gym.moveUp": { en: "Move {name} up", fr: "Monter {name}" },
  "gym.moveDown": { en: "Move {name} down", fr: "Descendre {name}" },
  "gym.targetSetsOf": { en: "Target sets of {name}", fr: "Séries visées de {name}" },
  "gym.targetRepsOf": { en: "Target reps of {name}", fr: "Répétitions visées de {name}" },
  "gym.targetSecondsOf": { en: "Target seconds of {name}", fr: "Secondes visées de {name}" },
  "gym.targetMetresOf": { en: "Target metres of {name}", fr: "Mètres visés de {name}" },
  "gym.targetWeightOf": { en: "Target weight of {name}", fr: "Poids visé de {name}" },
  "gym.restOf": { en: "Rest after {name}", fr: "Repos après {name}" },
  "gym.noteOf": { en: "Note for {name}", fr: "Note pour {name}" },
  "gym.saveLine": { en: "Save {name}", fr: "Enregistrer {name}" },
  "gym.removeLine": { en: "Remove {name} from the routine", fr: "Retirer {name} du programme" },
  "gym.couldNotReorder": {
    en: "Could not change the order.",
    fr: "Impossible de changer l’ordre.",
  },
  "gym.couldNotSaveRoutine": {
    en: "Could not save that routine.",
    fr: "Impossible d’enregistrer ce programme.",
  },
  "gym.couldNotSaveLine": {
    en: "Could not save that exercise.",
    fr: "Impossible d’enregistrer cet exercice.",
  },
  "gym.couldNotAddExercise": {
    en: "Could not add that exercise.",
    fr: "Impossible d’ajouter cet exercice.",
  },
  "gym.couldNotRemove": { en: "Could not remove that.", fr: "Impossible de retirer cela." },
  "gym.couldNotDeleteRoutine": {
    en: "Could not delete that routine.",
    fr: "Impossible de supprimer ce programme.",
  },

  // --- import
  "gym.importTitle": { en: "Import a workout", fr: "Importer une séance" },
  "gym.importIntro": {
    en: "Pick a .json file, paste the text, or share the file to this app. You check every exercise before anything is created.",
    fr: "Choisissez un fichier .json, collez le texte, ou partagez le fichier vers cette application. Vous vérifiez chaque exercice avant que quoi que ce soit soit créé.",
  },
  "gym.chooseFile": { en: "Choose a file", fr: "Choisir un fichier" },
  "gym.pasteLabel": { en: "Or paste the workout", fr: "Ou collez la séance" },
  "gym.pastePlaceholder": { en: "{ \"format\": \"ee-workout/1\", … }", fr: "{ \"format\": \"ee-workout/1\", … }" },
  "gym.readWorkout": { en: "Read workout", fr: "Lire la séance" },
  "gym.importEmpty": {
    en: "That file holds no exercises.",
    fr: "Ce fichier ne contient aucun exercice.",
  },
  "gym.importUnreadable": {
    en: "That text could not be read as a workout.",
    fr: "Ce texte n’a pas pu être lu comme une séance.",
  },
  "gym.nothingShared": {
    en: "Nothing was shared, or it was already taken.",
    fr: "Rien n’a été partagé, ou le contenu a déjà été récupéré.",
  },
  "gym.fileTooBig": {
    en: "That file is too big to be a workout (256 KB at most).",
    fr: "Ce fichier est trop gros pour être une séance (256 Ko au plus).",
  },
  "gym.promptTitle": { en: "Prompt for Claude / ChatGPT", fr: "Prompt pour Claude / ChatGPT" },
  "gym.promptHint": {
    en: "Give this to Claude or ChatGPT. It asks about your goals, walks you through each exercise, and ends with the file to import.",
    fr: "Donnez ceci à Claude ou à ChatGPT. Il vous interroge sur vos objectifs, passe chaque exercice en revue et termine par le fichier à importer.",
  },
  "gym.prompt": { en: PROMPT_EN, fr: PROMPT_FR },
  "gym.copyPrompt": { en: "Copy prompt", fr: "Copier le prompt" },
  "gym.copied": { en: "Prompt copied", fr: "Prompt copié" },
  "gym.copySelected": {
    en: "Prompt selected. Copy it from the menu.",
    fr: "Prompt sélectionné. Copiez-le depuis le menu.",
  },
  "gym.reviewTitle": { en: "Exercise {n} of {total}", fr: "Exercice {n} sur {total}" },
  "gym.inRoutine": { en: "Routine: {name}", fr: "Programme : {name}" },
  "gym.newExerciseHint": { en: "New exercise", fr: "Nouvel exercice" },
  "gym.kindLocked": {
    en: "The type of an existing exercise cannot change here. Rename the exercise to create a new one.",
    fr: "Le type d’un exercice existant ne peut pas changer ici. Renommez l’exercice pour en créer un nouveau.",
  },
  "gym.weightConverted": {
    en: "Weight converted to {unit} and rounded to the nearest 0.5. Check it.",
    fr: "Poids converti en {unit} et arrondi à 0,5 près. Vérifiez-le.",
  },
  "gym.confirm": { en: "Confirm", fr: "Confirmer" },
  "gym.skip": { en: "Skip", fr: "Passer" },
  "gym.reviewSummary": { en: "Ready to create", fr: "Prêt à créer" },
  "gym.routineSkipped": {
    en: "Every exercise was skipped, so nothing will be created.",
    fr: "Tous les exercices ont été passés : rien ne sera créé.",
  },
  "gym.existingExercise": { en: "existing exercise", fr: "exercice existant" },
  "gym.newExercise": { en: "new exercise", fr: "nouvel exercice" },
  "gym.createNeedsConnection": {
    en: "Creating needs a connection. Your review is kept in this tab until you are back online.",
    fr: "La création demande une connexion. Votre relecture est conservée dans cet onglet jusqu’au retour en ligne.",
  },
  "gym.createRoutines_one": { en: "Create {count} routine", fr: "Créer {count} programme" },
  "gym.createRoutines_other": { en: "Create {count} routines", fr: "Créer {count} programmes" },
  "gym.startOver": { en: "Start over", fr: "Recommencer" },
  "gym.imported_one": { en: "{count} routine created", fr: "{count} programme créé" },
  "gym.imported_other": { en: "{count} routines created", fr: "{count} programmes créés" },
  "gym.couldNotImport": {
    en: "Could not create the routines.",
    fr: "Impossible de créer les programmes.",
  },

  // --- refusals the server words with a code
  "error.exercise_kind_locked": {
    en: "This exercise already has sets, so its type cannot change.",
    fr: "Cet exercice a déjà des séries : son type ne peut plus changer.",
  },
  "error.exercise_kind_mismatch": {
    en: "An exercise with that name already exists with another type. Rename it, or use its type.",
    fr: "Un exercice portant ce nom existe déjà avec un autre type. Renommez-le, ou utilisez son type.",
  },
  "error.order_mismatch": {
    en: "The routine changed elsewhere. Reload and try again.",
    fr: "Le programme a changé ailleurs. Rechargez et réessayez.",
  },
} satisfies Record<string, Entry>;
