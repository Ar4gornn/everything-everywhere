import type { Entry } from "../catalogue";

/** Epic 45 (AD-61): entries waiting on the device. Spec: docs/epic-45-offline-entries.md §3. */
export const offlineEntries = {
  "offline.savedQueued": {
    en: "Saved on this phone — it will be sent when you are online",
    fr: "Enregistrée sur ce téléphone — elle sera envoyée une fois en ligne",
  },
  "offline.plusWaiting_one": {
    en: "Add an entry, {count} waiting to send",
    fr: "Ajouter une opération, {count} en attente d’envoi",
  },
  "offline.plusWaiting_other": {
    en: "Add an entry, {count} waiting to send",
    fr: "Ajouter une opération, {count} en attente d’envoi",
  },
  "offline.waitingTitle": { en: "Waiting to send", fr: "En attente d’envoi" },
  "offline.waitingHint": {
    en: "These are on this device only. They are sent as soon as there is a connection.",
    fr: "Elles ne sont que sur cet appareil. Elles sont envoyées dès qu’il y a une connexion.",
  },
  "offline.sendNow": { en: "Send now", fr: "Envoyer maintenant" },
  "offline.notSent": { en: "Not sent: {reason}", fr: "Non envoyée : {reason}" },
  "offline.edit": { en: "Edit", fr: "Modifier" },
  "offline.discard": { en: "Discard", fr: "Supprimer" },
  "offline.discardConfirm": {
    en: "Delete this entry from this device? It was never recorded.",
    fr: "Supprimer cette opération de cet appareil ? Elle n’a jamais été enregistrée.",
  },
  "offline.discardWaitingConfirm": {
    en: "Delete this entry from this device? It has not been confirmed as received. If an earlier attempt reached the server, it will still appear in Entries.",
    fr: "Supprimer cette opération de cet appareil ? Sa réception n’est pas confirmée. Si une tentative précédente est arrivée au serveur, elle apparaîtra quand même dans Opérations.",
  },
  "offline.dashLine_one": {
    en: "{count} entry not sent yet — not in these totals",
    fr: "{count} opération pas encore envoyée — absente de ces totaux",
  },
  "offline.dashLine_other": {
    en: "{count} entries not sent yet — not in these totals",
    fr: "{count} opérations pas encore envoyées — absentes de ces totaux",
  },
  "offline.signOutUnsent": {
    en: "Some entries have not been sent and will be deleted from this device. Sign out anyway?",
    fr: "Des opérations n’ont pas été envoyées et seront supprimées de cet appareil. Se déconnecter quand même ?",
  },
  "offline.cachedChips": {
    en: "Offline — suggestions from your last visit",
    fr: "Hors ligne — suggestions de votre dernière visite",
  },
} satisfies Record<string, Entry>;
