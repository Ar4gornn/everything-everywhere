import type { Entry } from "../catalogue";

/**
 * Epic 46 (AD-62): the shared install words — the consent question, the dashboard card, the
 * installed welcome, Settings and the tour step. The `/install` page's own text lives in
 * `installGuide.ts`.
 */
export const install = {
  "install.ask.title": {
    en: "Want help installing the app on this phone?",
    fr: "Voulez-vous de l’aide pour installer l’application sur ce téléphone ?",
  },
  "install.ask.body": {
    en: "It opens full screen from your home screen, works offline, and on iPhone it is how notifications work.",
    fr: "Elle s’ouvre en plein écran depuis l’écran d’accueil, fonctionne hors ligne, et sur iPhone c’est ce qui permet les notifications.",
  },
  "install.ask.yes": { en: "Yes, show me", fr: "Oui, montrez-moi" },
  "install.ask.no": { en: "No thanks", fr: "Non merci" },
  "install.card.title": { en: "Install EEwhere", fr: "Installer EEwhere" },
  "install.card.body": {
    en: "Two or three taps, and it lives on your home screen.",
    fr: "Deux ou trois gestes, et elle est sur votre écran d’accueil.",
  },
  "install.card.oneTap": { en: "Install", fr: "Installer" },
  "install.card.howTo": { en: "Show me how", fr: "Me montrer comment" },
  "install.card.notNow": { en: "Not now", fr: "Plus tard" },
  "install.welcome.title": { en: "EEwhere is installed", fr: "EEwhere est installée" },
  "install.welcome.body": {
    en: "Open it from your home screen from now on. Want a reminder each day for what is due?",
    fr: "Ouvrez-la désormais depuis votre écran d’accueil. Voulez-vous un rappel chaque jour de ce qui est à faire ?",
  },
  "install.welcome.bodyNoNotify": {
    en: "Open it from your home screen from now on.",
    fr: "Ouvrez-la désormais depuis votre écran d’accueil, sans passer par le navigateur.",
  },
  "install.welcome.notify": { en: "Turn on notifications", fr: "Activer les notifications" },
  "install.welcome.done": { en: "Done", fr: "Terminé" },
  "install.settings.title": { en: "Install the app", fr: "Installer l’application" },
  "install.settings.body": {
    en: "Step-by-step help for iPhone, Android and computers.",
    fr: "Une aide pas à pas pour iPhone, Android et ordinateur.",
  },
  "install.settings.installed": {
    en: "Installed on this device.",
    fr: "Installée sur cet appareil.",
  },
  "install.settings.open": { en: "Open the guide", fr: "Ouvrir le guide" },
  "install.tour.title": { en: "Put it on your home screen", fr: "Mettez-la sur l’écran d’accueil" },
  "install.tour.body": {
    en: "Last thing: want help installing the app on this phone? You can always find it in Settings.",
    fr: "Dernière chose : voulez-vous de l’aide pour installer l’application sur ce téléphone ? Vous la retrouverez toujours dans les Réglages.",
  },
} satisfies Record<string, Entry>;
