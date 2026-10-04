import type { Entry } from "../catalogue";

/**
 * Epic 33: what the account uses, and the page shown for what it does not.
 *
 * A module's name here is its own key rather than a nav label reused: "Mood" and "Books"
 * are not tabs, and a label written for a 64px tab is not always the word for a switch.
 */
export const layout = {
  "layout.title": { en: "Layout", fr: "Disposition" },
  "layout.modules": { en: "Sections you use", fr: "Rubriques utilisées" },
  "layout.modulesHint": {
    en: "Turning one off hides it everywhere. Nothing is deleted: switch it back on and everything is where you left it.",
    fr: "Désactiver une rubrique la masque partout. Rien n'est supprimé : réactivez-la et tout est là où vous l'avez laissé.",
  },
  "layout.saveFailed": {
    en: "Could not save, so the change was undone.",
    fr: "Enregistrement impossible, la modification a été annulée.",
  },

  "layout.phone": { en: "Phone", fr: "Téléphone" },
  "layout.desktop": { en: "Computer", fr: "Ordinateur" },
  "layout.up": { en: "Move {name} up", fr: "Monter {name}" },
  "layout.down": { en: "Move {name} down", fr: "Descendre {name}" },

  // Epic 52 (AD-65): the place editor.
  "layout.nav.title": { en: "Navigation", fr: "Navigation" },
  "layout.nav.phoneHint": {
    en: "The bar holds four places, then More. Everything else is in the More menu, by group: here you choose the order within each group.",
    fr: "La barre contient quatre rubriques, puis « Plus ». Tout le reste est dans le menu « Plus », par groupe : vous choisissez ici l'ordre au sein de chaque groupe.",
  },
  "layout.nav.desktopHint": {
    en: "The sidebar shows every place, by group: here you choose the order within each group.",
    fr: "La barre latérale affiche toutes les rubriques, par groupe : vous choisissez ici l'ordre au sein de chaque groupe.",
  },
  "layout.nav.bar": { en: "In the bar ({count} of {max})", fr: "Dans la barre ({count} sur {max})" },
  "layout.nav.barEmpty": {
    en: "Nothing is pinned: the bar is only More.",
    fr: "Rien n'est épinglé : la barre ne contient que « Plus ».",
  },
  "layout.nav.pin": { en: "Pin {name} to the bar", fr: "Épingler {name} à la barre" },
  "layout.nav.unpin": { en: "Unpin {name} from the bar", fr: "Retirer {name} de la barre" },
  "layout.nav.pinShort": { en: "Pin", fr: "Épingler" },
  "layout.nav.unpinShort": { en: "Unpin", fr: "Retirer" },
  "layout.nav.full": {
    en: "The bar is full ({max} places). Unpin one to pin another.",
    fr: "La barre est pleine ({max} rubriques). Retirez-en une pour en épingler une autre.",
  },
  "layout.nav.off": { en: "(off)", fr: "(désactivée)" },
  "layout.reset": { en: "Reset this layout", fr: "Rétablir cette disposition" },
  "layout.resetConfirm": {
    en: "Put the {layout} places and cards back as they were?",
    fr: "Remettre les rubriques et les cartes ({layout}) comme à l'origine ?",
  },
  "layout.resetYes": { en: "Reset", fr: "Rétablir" },

  "layout.cards": { en: "Dashboard cards", fr: "Cartes du tableau de bord" },
  "layout.cardsHint": {
    en: "Shown in this order. A hidden card is not loaded at all.",
    fr: "Affichées dans cet ordre. Une carte masquée n'est pas chargée du tout.",
  },
  "layout.show": { en: "Show {name}", fr: "Afficher {name}" },
  "card.stats": { en: "Totals", fr: "Totaux" },
  "card.trends": { en: "Month by month", fr: "Mois par mois" },

  "module.habits": { en: "Habits", fr: "Habitudes" },
  "module.books": { en: "Books", fr: "Livres" },
  "module.mood": { en: "Mood", fr: "Humeur" },
  "module.stock": { en: "Stock", fr: "Stock" },
  "module.gym": { en: "Gym", fr: "Sport" },
  "module.recipes": { en: "Recipes", fr: "Recettes" },
  "module.notes": { en: "Notes", fr: "Notes" },

  "module.offTitle": { en: "{name} is turned off", fr: "La rubrique {name} est désactivée" },
  "module.offBody": {
    en: "Its data is kept. Turn it back on in Settings to use it again.",
    fr: "Ses données sont conservées. Réactivez-la dans les réglages pour l'utiliser à nouveau.",
  },
  "module.offLink": { en: "Open Settings", fr: "Ouvrir les réglages" },
} satisfies Record<string, Entry>;
