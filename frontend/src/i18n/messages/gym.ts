import type { Entry } from "../catalogue";

/**
 * The gym page (Epic 42): home, the live session, the routine editor and the import review.
 * The dashboard card, the offline store and the file parser's errors are in `gymCore.ts`; the
 * prompts for Claude or ChatGPT (Epic 43) are in `gymPrompts.ts`.
 */

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
  "gym.retry": { en: "Retry", fr: "Réessayer" },
  "gym.copyData": { en: "Copy data", fr: "Copier les données" },
  "gym.dataCopied": { en: "Session data copied", fr: "Données de la séance copiées" },
  "gym.discardEntryConfirm": {
    en: "Discard this session for good? Use Copy data first if you want to keep it.",
    fr: "Abandonner définitivement cette séance ? Utilisez d’abord Copier les données pour la garder.",
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
  "gym.startNamed": { en: "Start {name}", fr: "Commencer {name}" },
  "gym.about": { en: "about {n} min", fr: "environ {n} min" },
  "gym.lastDone": { en: "Last done {date}", fr: "Dernière séance : {date}" },
  "gym.neverDone": { en: "Not done yet", fr: "Pas encore faite" },
  "gym.routines": { en: "Routines", fr: "Programmes" },
  "gym.noRoutines": { en: "No routines yet.", fr: "Aucun programme pour l’instant." },
  "gym.routineName": { en: "Routine name", fr: "Nom du programme" },
  "gym.needsConnection": {
    en: "Editing routines needs a connection. Your sessions still work offline.",
    fr: "Modifier les programmes demande une connexion. Vos séances fonctionnent toujours hors ligne.",
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
  "gym.finishing": { en: "Saving…", fr: "Enregistrement…" },
  "gym.tooManySets": {
    en: "A session holds 500 sets at most. Finish it, then start another.",
    fr: "Une séance contient 500 séries au plus. Terminez-la, puis commencez-en une autre.",
  },
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
  // --- the guided tour of the gym home (Epic 42, §12)
  "gym.tour.open": { en: "How the Gym tab works", fr: "Comment fonctionne l’onglet Sport" },
  "gym.tour.stepOf": { en: "Step {n} of {total}", fr: "Étape {n} sur {total}" },
  "gym.tour.start": { en: "Start", fr: "Commencer" },
  "gym.tour.notNow": { en: "Not now", fr: "Plus tard" },
  "gym.tour.next": { en: "Next", fr: "Suivant" },
  "gym.tour.back": { en: "Back", fr: "Retour" },
  "gym.tour.skip": { en: "Skip tour", fr: "Passer la visite" },
  "gym.tour.close": { en: "Close", fr: "Fermer" },
  "gym.tour.practice": {
    en: "Practice only: nothing here is saved.",
    fr: "Simple essai : rien n’est enregistré ici.",
  },
  "gym.tour.welcome.title": { en: "A one-minute tour", fr: "Visite en une minute" },
  "gym.tour.welcome.body": {
    en: "See the Gym tab in a minute. Nothing in this tour changes your data.",
    fr: "Découvrez l’onglet Sport en une minute. Rien dans cette visite ne modifie vos données.",
  },
  "gym.tour.start.title": { en: "Start a session", fr: "Commencer une séance" },
  "gym.tour.log.title": { en: "Log a set", fr: "Noter une série" },
  "gym.tour.log.body": {
    en: "Set reps and weight, tap Done, and the rest timer starts. Try it below.",
    fr: "Réglez répétitions et poids, touchez Fait : le chrono de repos démarre. Essayez ci-dessous.",
  },
  "gym.tour.set.line": {
    en: "Set {n} · {reps} × {weight} {unit}",
    fr: "Série {n} · {reps} × {weight} {unit}",
  },
  "gym.tour.set.done": {
    en: "That’s it — every set is one tap.",
    fr: "Voilà : chaque série tient en un seul geste.",
  },
  "gym.tour.set.list": { en: "Sets logged in this demo", fr: "Séries notées dans cet essai" },
  "gym.tour.timer.title": { en: "Time a hold", fr: "Chronométrer un effort" },
  "gym.tour.timer.body": {
    en: "For a plank or any timed exercise, the timer counts down. Stop writes the seconds for you.",
    fr: "Pour la planche ou tout exercice chronométré, le chrono décompte. Arrêter inscrit les secondes.",
  },
  "gym.tour.timer.label": { en: "Plank · target {n} s", fr: "Planche · objectif {n} s" },
  "gym.tour.timer.held": { en: "Held {n} s", fr: "Tenu {n} s" },
  "gym.tour.routines.title": { en: "Your routines", fr: "Vos programmes" },
  "gym.tour.import.steps": { en: "How an import goes", fr: "Déroulement d’un import" },
  "gym.tour.import.copied": { en: "Copied", fr: "Copié" },
  "gym.tour.import.copyFailed": {
    en: "Copy was blocked. Select the text below and copy it.",
    fr: "Copie bloquée. Sélectionnez le texte ci-dessous et copiez-le.",
  },
  "gym.tour.import.promptField": { en: "The prompt", fr: "Le prompt" },
  "gym.tour.history.title": { en: "Your history", fr: "Votre historique" },
  "gym.tour.history.body": {
    en: "Past sessions are listed here; open one for its sets. Exercises charts your progress.",
    fr: "Les séances passées sont listées ici ; ouvrez-en une pour ses séries. Exercices trace votre progression.",
  },
  "gym.tour.offline.title": { en: "Without a connection", fr: "Sans réseau" },
  "gym.tour.offline.body": {
    en: "Once installed and opened online once, sessions work with no network. A session finished offline stays on the phone and sends itself later.",
    fr: "Une fois l’appli installée et ouverte en ligne, les séances marchent sans réseau. Une séance terminée hors ligne reste sur le téléphone et part plus tard.",
  },
  "gym.tour.offline.installed": {
    en: "App installed on this phone",
    fr: "Appli installée sur ce téléphone",
  },
  "gym.tour.offline.connection": { en: "Connection", fr: "Connexion" },
  "gym.tour.offline.waiting": { en: "Sessions waiting to send", fr: "Séances en attente d’envoi" },
  "gym.tour.offline.yes": { en: "Yes", fr: "Oui" },
  "gym.tour.offline.no": { en: "No", fr: "Non" },
  "gym.tour.offline.online": { en: "Online", fr: "En ligne" },
  "gym.tour.offline.offline": { en: "Offline", fr: "Hors ligne" },
  "gym.tour.offline.installHow": {
    en: "To install: browser menu, then Add to Home screen or Install app.",
    fr: "Pour l’installer : menu du navigateur, puis Ajouter à l’écran d’accueil ou Installer l’application.",
  },
  "gym.tour.done.title": { en: "You’re set", fr: "Tout est prêt" },
  "gym.tour.done.body": {
    en: "Replay this tour any time from the ? button.",
    fr: "Rejouez cette visite à tout moment avec le bouton ?.",
  },

  // --- Epic 43: start chooser, quick builder, AI hub, rest
  "gym.startEmpty": { en: "Start a session", fr: "Commencer une séance" },
  "gym.today": { en: "Today", fr: "Aujourd’hui" },
  "gym.noRoutinesHint": {
    en: "No routine yet — let an AI write one",
    fr: "Pas encore de programme : laissez une IA en écrire un",
  },
  "gym.restDay": { en: "Rest day", fr: "Jour de repos" },
  "gym.restDayRow": { en: "Logged as a rest day.", fr: "Noté comme jour de repos." },

  "gym.start.title": { en: "How do you want to start?", fr: "Comment voulez-vous commencer ?" },
  "gym.start.justStart": { en: "Just start", fr: "Juste commencer" },
  "gym.start.justStartDesc": {
    en: "Timer on, add exercises as you go.",
    fr: "Le chrono tourne, ajoutez les exercices en route.",
  },
  "gym.start.build": { en: "Build it now", fr: "La composer maintenant" },
  "gym.start.buildDesc": {
    en: "Pick exercises, then go.",
    fr: "Choisissez les exercices, puis c’est parti.",
  },
  "gym.start.ai": { en: "Ask an AI", fr: "Demander à une IA" },
  "gym.start.aiDesc": {
    en: "Claude or ChatGPT writes it with you.",
    fr: "Claude ou ChatGPT l’écrit avec vous.",
  },
  "gym.start.follow": { en: "Or follow a routine:", fr: "Ou suivez un programme :" },
  "gym.start.restDay": { en: "Rest day today", fr: "Repos aujourd’hui" },
  "gym.start.restAlready": { en: "Already logged", fr: "Déjà noté" },
  "gym.start.restLogged": { en: "Logged — enjoy it.", fr: "C’est noté, profitez-en." },
  "gym.start.undo": { en: "Undo", fr: "Annuler" },
  "gym.start.couldNotLogRest": {
    en: "Could not log the rest day.",
    fr: "Impossible de noter le jour de repos.",
  },

  "gym.build.title": { en: "Build a workout", fr: "Composer une séance" },
  "gym.build.defaultName": { en: "Workout · {date}", fr: "Séance · {date}" },
  "gym.build.add": { en: "Add an exercise", fr: "Ajouter un exercice" },
  "gym.build.yours": { en: "Your exercises", fr: "Vos exercices" },
  "gym.build.addNew": { en: "Add “{name}”", fr: "Ajouter « {name} »" },
  "gym.build.kindFor": { en: "New exercise counts in", fr: "Le nouvel exercice se compte en" },
  "gym.build.empty": {
    en: "Nothing yet. Tap an exercise above.",
    fr: "Rien pour l’instant. Touchez un exercice ci-dessus.",
  },
  "gym.build.lines": { en: "Exercises in this workout", fr: "Exercices de cette séance" },
  "gym.build.save": { en: "Save as a routine", fr: "Enregistrer comme programme" },
  "gym.build.removeLine": { en: "Remove {name}", fr: "Retirer {name}" },
  "gym.build.start": { en: "Start", fr: "Démarrer" },
  "gym.build.askAi": { en: "Rather ask an AI?", fr: "Plutôt demander à une IA ?" },
  "gym.build.notSaved": {
    en: "Started, but the routine was not saved.",
    fr: "Séance lancée, mais le programme n’a pas été enregistré.",
  },

  "gym.hub.get": { en: "Get a workout from an AI", fr: "Obtenir une séance d’une IA" },
  "gym.hub.back": { en: "Bring it back", fr: "Le rapporter ici" },
  "gym.hub.profiles": { en: "Kinds of workout", fr: "Types de séance" },
  "gym.hub.showPrompt": { en: "Show prompt", fr: "Voir le prompt" },
  "gym.hub.hidePrompt": { en: "Hide prompt", fr: "Masquer le prompt" },
  "gym.hub.notes": { en: "Your notes", fr: "Vos notes" },
  "gym.hub.notesPlaceholder": {
    en: "Bench 4×8, plank 3×45 s, rowing 2 km…",
    fr: "Développé couché 4×8, planche 3×45 s, rameur 2 km…",
  },
  "gym.hub.copyClaude": { en: "Copy & open Claude", fr: "Copier et ouvrir Claude" },
  "gym.hub.copyChatGpt": { en: "Copy & open ChatGPT", fr: "Copier et ouvrir ChatGPT" },
  "gym.hub.copyOnly": { en: "Copy only", fr: "Copier seulement" },
  "gym.hub.openClaude": { en: "Open Claude", fr: "Ouvrir Claude" },
  "gym.hub.openChatGpt": { en: "Open ChatGPT", fr: "Ouvrir ChatGPT" },
  "gym.import.startWhich": { en: "Which one do you start?", fr: "Laquelle commencer ?" },
  "gym.import.startWhichHint": {
    en: "Every routine was created. Today's one in the plan comes first.",
    fr: "Tous les programmes sont créés. Celui du jour dans le plan est en tête.",
  },
  "gym.import.startNone": { en: "Start none", fr: "Ne rien commencer" },
  "gym.hub.hint": {
    en: "Chat, confirm each exercise, then come back here and tap Paste.",
    fr: "Discutez, validez chaque exercice, puis revenez ici et touchez Coller.",
  },
  "gym.hub.paste": { en: "Paste from clipboard", fr: "Coller depuis le presse-papiers" },
  "gym.hub.pasteDenied": {
    en: "Long-press and paste here.",
    fr: "Appui long, puis collez ici.",
  },
  "gym.hub.banner": {
    en: "Got your workout? Paste it here.",
    fr: "Vous avez votre séance ? Collez-la ici.",
  },
  "gym.hub.getHint": {
    en: "Pick the kind of workout you want. The prompt already knows your exercises and last sessions.",
    fr: "Choisissez le type de séance. Le prompt connaît déjà vos exercices et vos dernières séances.",
  },

  "gym.restAfterSeconds": { en: "Rest after (s)", fr: "Repos après l’exercice (s)" },
  "gym.restOf": { en: "Rest between sets of {name}", fr: "Repos entre les séries de {name}" },
  "gym.restAfterOf": { en: "Rest after {name}", fr: "Repos après {name}" },
  "gym.createAndStart": { en: "Create and start", fr: "Créer et commencer" },
  "gym.createOnly": { en: "Create only", fr: "Créer seulement" },
  "gym.importFromFile": { en: "Import a file", fr: "Importer un fichier" },
  "gym.newWorkout": { en: "New workout", fr: "Nouvelle séance" },
  "gym.newWorkoutMenu": { en: "Ways to make a workout", fr: "Façons de créer une séance" },
  "gym.schedule.title": { en: "The week in this plan", fr: "La semaine de ce plan" },
  "gym.schedule.rest": { en: "rest", fr: "repos" },
  "gym.schedule.note": {
    en: "Shown for reference. Nothing is scheduled by the app.",
    fr: "Affiché pour mémoire. L’appli ne planifie rien.",
  },

  "gym.restBefore": { en: "Rest before {name}", fr: "Repos avant {name}" },
  "gym.restPresets": { en: "Rest for", fr: "Se reposer" },
  "gym.restPreset": { en: "{n} s", fr: "{n} s" },
  "gym.restCustom": { en: "Custom", fr: "Autre" },
  "gym.restStart": { en: "Start rest", fr: "Lancer le repos" },
  "gym.restPlus": { en: "+{n} s", fr: "+{n} s" },
  "gym.summaryAskAi": {
    en: "Want a new one next time? Ask an AI",
    fr: "Envie d’une nouvelle séance la prochaine fois ? Demandez à une IA",
  },

  "gym.tour.start.body": {
    en: "Tap a routine to follow it, or tap Start a session to just go, build one, or ask an AI.",
    fr: "Touchez un programme pour le suivre, ou Commencer une séance pour y aller, en composer une ou demander à une IA.",
  },
  "gym.tour.routines.body": {
    en: "Edit targets and rests, reorder exercises with ↑ ↓, or make a new workout.",
    fr: "Modifiez objectifs et repos, réordonnez avec ↑ ↓, ou créez une nouvelle séance.",
  },
  "gym.tour.import.title": { en: "Let an AI write it", fr: "Laissez une IA l’écrire" },
  "gym.tour.import.body": {
    en: "Pick a kind of workout, copy the prompt, chat, then bring the result back.",
    fr: "Choisissez un type de séance, copiez le prompt, discutez, puis rapportez le résultat.",
  },
  "gym.tour.import.step1": {
    en: "Pick a kind of workout and copy the prompt into Claude or ChatGPT.",
    fr: "Choisissez un type de séance et copiez le prompt dans Claude ou ChatGPT.",
  },
  "gym.tour.import.step2": {
    en: "The chat confirms each exercise with you.",
    fr: "Le chat valide chaque exercice avec vous.",
  },
  "gym.tour.import.step3": {
    en: "Come back and tap Paste, pick the file, or share it to the app on Android.",
    fr: "Revenez et touchez Coller, choisissez le fichier, ou partagez-le vers l’appli sur Android.",
  },
  "gym.tour.import.step4": {
    en: "Check each exercise here, then Create and start.",
    fr: "Vérifiez chaque exercice ici, puis Créer et commencer.",
  },
} satisfies Record<string, Entry>;
