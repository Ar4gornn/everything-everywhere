import type { Entry } from "../catalogue";

/** Epic 39 (AD-55): the calendar feed in Settings, and "Add to calendar". */
export const calendarFeed = {
  "feed.title": { en: "Calendar apps", fr: "Applications d’agenda" },
  "feed.hint": {
    en: "Subscribe from Google Calendar, Apple Calendar or Outlook to see Everything Everywhere dates there. Read-only: changes are made here.",
    fr: "Abonnez-vous depuis Google Agenda, Calendrier Apple ou Outlook pour y voir les dates d’Everything Everywhere. Lecture seule : les modifications se font ici.",
  },
  "feed.turnOn": { en: "Create a subscribe link", fr: "Créer un lien d’abonnement" },
  "feed.turnOff": { en: "Turn off", fr: "Désactiver" },
  "feed.rotate": { en: "New link", fr: "Nouveau lien" },
  "feed.rotateConfirm": {
    en: "The current link stops working at once. Calendars subscribed to it must be given the new one.",
    fr: "Le lien actuel cesse de fonctionner immédiatement. Les agendas abonnés devront recevoir le nouveau.",
  },
  "feed.turnOffConfirm": {
    en: "Turn off the calendar link? Subscribed calendars stop updating and keep the last copy they fetched.",
    fr: "Désactiver le lien d’agenda ? Les agendas abonnés ne seront plus mis à jour et garderont la dernière copie reçue.",
  },
  "feed.linkLabel": { en: "Subscribe link", fr: "Lien d’abonnement" },
  "feed.linkOnce": {
    en: "Shown only now. Copy it into your calendar app; anyone holding it can read what it sends.",
    fr: "Affiché une seule fois. Copiez-le dans votre agenda ; toute personne qui le détient peut lire ce qu’il envoie.",
  },
  "feed.copy": { en: "Copy", fr: "Copier" },
  "feed.copied": { en: "Copied.", fr: "Copié." },
  "feed.open": { en: "Open in calendar app", fr: "Ouvrir dans l’agenda" },
  "feed.linkHidden": {
    en: "The link is on. It is not shown again; make a new link if you have lost it.",
    fr: "Le lien est actif. Il n’est plus affiché ; créez un nouveau lien si vous l’avez perdu.",
  },
  "feed.lastFetched": { en: "Last read by a calendar: {when}", fr: "Dernière lecture par un agenda : {when}" },
  "feed.neverFetched": {
    en: "Not read by any calendar yet.",
    fr: "Encore lu par aucun agenda.",
  },
  "feed.googleSlow": {
    en: "Google Calendar refreshes subscriptions every few hours, on its own schedule.",
    fr: "Google Agenda actualise les abonnements toutes les quelques heures, à son rythme.",
  },

  "feed.whatTitle": { en: "What to send", fr: "Ce qui est envoyé" },
  "feed.layerDue": { en: "Bills and income due", fr: "Paiements et revenus prévus" },
  "feed.layerMoney": { en: "Entries", fr: "Opérations" },
  "feed.layerSavings": { en: "Savings movements", fr: "Mouvements d’épargne" },
  "feed.layerStock": { en: "Stock changes", fr: "Changements de stock" },
  "feed.layerGym": { en: "Workouts", fr: "Séances" },
  "feed.layerHabits": { en: "Habits done", fr: "Habitudes faites" },
  "feed.layerSchedule": { en: "Habits to do", fr: "Habitudes à faire" },
  "feed.layerMood": { en: "Mood", fr: "Humeur" },
  "feed.layerMeals": { en: "Meals", fr: "Repas" },
  "feed.moduleOff": { en: "module turned off", fr: "module désactivé" },

  "feed.detailed": { en: "Show names and amounts", fr: "Afficher noms et montants" },
  "feed.detailedHint": {
    en: "Off, events say only “Bill due”. On, they name the bill and its amount, and your calendar provider stores that.",
    fr: "Désactivé, les événements disent seulement « Paiement prévu ». Activé, ils indiquent le nom et le montant, que votre fournisseur d’agenda conserve.",
  },
  "feed.alarm": { en: "Reminder at 9:00 on the day", fr: "Rappel à 9 h le jour même" },
  "feed.alarmHint": {
    en: "Apple Calendar and Outlook honour it; Google Calendar ignores reminders in subscriptions.",
    fr: "Calendrier Apple et Outlook le respectent ; Google Agenda ignore les rappels des abonnements.",
  },
  "feed.window": {
    en: "Covers last month through six months ahead, as all-day events.",
    fr: "Couvre le mois dernier et les six mois à venir, en événements sur la journée.",
  },

  "feed.couldNotLoad": {
    en: "Could not load the calendar link.",
    fr: "Impossible de charger le lien d’agenda.",
  },
  "feed.couldNotChange": {
    en: "Could not change the calendar link.",
    fr: "Impossible de modifier le lien d’agenda.",
  },

  "feed.addToCalendar": { en: "Add to calendar", fr: "Ajouter à l’agenda" },
  "feed.addNamed": { en: "Add {name} to calendar", fr: "Ajouter {name} à l’agenda" },
} satisfies Record<string, Entry>;
