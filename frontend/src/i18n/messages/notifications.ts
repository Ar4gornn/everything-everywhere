import type { Entry } from "../catalogue";

/** Epic 36: what the daily digest mentions, when it arrives, and the bells on rows. */
export const notifications = {
  "notify.whatTitle": { en: "What to mention", fr: "Ce qui est signalé" },
  "notify.kindStock": { en: "Items to restock", fr: "Articles à racheter" },
  "notify.kindRecurring": {
    en: "Recurring entries waiting",
    fr: "Opérations récurrentes en attente",
  },
  "notify.kindHabits": {
    en: "Habits still to do (those set to remind)",
    fr: "Habitudes à faire (celles avec rappel)",
  },
  "notify.kindDueTomorrow": {
    en: "Recurring entries due tomorrow",
    fr: "Opérations récurrentes prévues demain",
  },
  "notify.kindSavings": {
    en: "Savings goals falling behind",
    fr: "Objectifs d’épargne en retard",
  },
  "notify.moduleOff": { en: "module turned off", fr: "module désactivé" },

  "notify.time": { en: "Arrives at", fr: "Arrive à" },
  "notify.zone": { en: "Time zone", fr: "Fuseau horaire" },
  "notify.scheduleSaved": { en: "Saved.", fr: "Enregistré." },
  "notify.serverClock": { en: "the server’s clock", fr: "l’horloge du serveur" },

  "notify.previewTitle": { en: "Tonight’s notification", fr: "La notification de ce soir" },
  "notify.previewWhen": {
    en: "At {time} ({zone}), if there is still something to say:",
    fr: "À {time} ({zone}), s’il reste quelque chose à signaler :",
  },
  "notify.previewEmpty": {
    en: "Nothing to say right now, so nothing would be sent.",
    fr: "Rien à signaler pour l’instant : aucune notification ne serait envoyée.",
  },

  "notify.sendTest": { en: "Send a test", fr: "Envoyer un test" },
  "notify.testSent": {
    en: "Sent to this device. It does not count as today’s notification.",
    fr: "Envoyé à cet appareil. Il ne compte pas comme la notification du jour.",
  },
  "notify.testNeedsDevice": {
    en: "This device is not receiving notifications. Turn them on first.",
    fr: "Cet appareil ne reçoit pas de notifications. Activez-les d’abord.",
  },

  "notify.mutedTitle": { en: "Kept quiet", fr: "Mis en sourdine" },
  "notify.mutedNone": {
    en: "Nothing is muted. Use the bell beside a pot, a recurring entry or a stock item to keep it out of notifications.",
    fr: "Rien n’est en sourdine. La cloche à côté d’une enveloppe, d’une opération récurrente ou d’un article l’exclut des notifications.",
  },
  "notify.mutedStock": { en: "stock", fr: "stock" },
  "notify.mutedRecurring": { en: "recurring", fr: "récurrente" },
  "notify.mutedSavings": { en: "savings", fr: "épargne" },
  "notify.unmute": { en: "Unmute", fr: "Réactiver" },

  "notify.muteNamed": {
    en: "Stop mentioning {name} in notifications",
    fr: "Ne plus signaler {name} dans les notifications",
  },
  "notify.unmuteNamed": {
    en: "Mention {name} in notifications again",
    fr: "Signaler de nouveau {name} dans les notifications",
  },
  "notify.onTitle": { en: "In notifications", fr: "Dans les notifications" },
  "notify.offTitle": { en: "Kept out of notifications", fr: "Exclu des notifications" },

  "notify.couldNotLoad": {
    en: "Could not load the notification settings.",
    fr: "Impossible de charger les réglages des notifications.",
  },
  "notify.couldNotSave": {
    en: "Could not save that change.",
    fr: "Impossible d’enregistrer cette modification.",
  },
  "notify.couldNotTest": {
    en: "Could not send the test.",
    fr: "Impossible d’envoyer le test.",
  },
} satisfies Record<string, Entry>;
