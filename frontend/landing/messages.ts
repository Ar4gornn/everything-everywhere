import type { Entry } from "../src/i18n/catalogue.ts";

// Every claim here traces to docs/epic-53-landing.md section 3.1. Section 3.2 (push,
// reminders, digest, bank sync, ...) must never appear; landing.test.ts guards the words.
// Feature names follow the app's own French labels (Opérations, Budget, Épargne, Sport...).
//
// Naming: `<name>.t` is an item's title and `<name>.d` its sentence; render.ts refers to the
// shared `<name>` and the unused-key test accounts for that.
export const landing = {
  "meta.title": { en: "Everything Everywhere", fr: "Everything Everywhere" },
  "meta.homeTitle": {
    en: "Everything Everywhere: money, home and habits in one app",
    fr: "Everything Everywhere : argent, maison et habitudes dans une seule application",
  },
  "meta.description": {
    en: "Track money, stock, recipes, habits, workouts and notes in one invite-only app you can install on your phone. Open source.",
    fr: "Suivez votre argent, votre stock, vos recettes, vos habitudes, votre sport et vos notes dans une seule application sur invitation, à installer sur votre téléphone. Code source ouvert.",
  },
  "skip.link": { en: "Skip to content", fr: "Aller au contenu" },
  "lang.label": { en: "Language", fr: "Langue" },
  "action.signin": { en: "Sign in", fr: "Se connecter" },

  "hero.title": {
    en: "Your money, home and habits in one place",
    fr: "Votre argent, votre foyer et vos habitudes au même endroit",
  },
  "hero.sub": {
    en: "Track spending and savings, stock and recipes, habits, workouts and notes in one app you can install on your phone.",
    fr: "Suivez vos dépenses et votre épargne, votre stock et vos recettes, vos habitudes, vos séances de sport et vos notes dans une seule application, à installer sur votre téléphone.",
  },
  "hero.register": { en: "Have an invite? Create an account", fr: "Une invitation ? Créez un compte" },
  "hero.note": {
    en: "Everything Everywhere is invite-only: you need an invitation to create an account.",
    fr: "Everything Everywhere fonctionne sur invitation : il faut être invité pour créer un compte.",
  },

  "money.h": { en: "Money", fr: "Argent" },
  "money.lead": {
    en: "Record what comes in and goes out, then see where you stand.",
    fr: "Notez ce qui entre et ce qui sort, puis voyez où vous en êtes.",
  },
  "money.entries.t": { en: "Income and expenses", fr: "Revenus et dépenses" },
  "money.entries.d": {
    en: "Record each one with a category, an optional quantity and unit, and the shop it came from. Search them later, or add one from a bottom sheet on your phone.",
    fr: "Notez chacun avec une catégorie, une quantité et une unité facultatives, et le magasin. Retrouvez-les avec la recherche, ou ajoutez-en un depuis un panneau en bas de l’écran sur téléphone.",
  },
  "money.recurring.t": { en: "Recurring entries", fr: "Opérations récurrentes" },
  "money.recurring.d": {
    en: "Rent, subscriptions and salary are proposed each time they are due, and you confirm or skip them.",
    fr: "Loyer, abonnements et salaire vous sont proposés à chaque échéance, et vous les confirmez ou vous les passez.",
  },
  "money.plan.t": { en: "A monthly plan", fr: "Un budget mensuel" },
  "money.plan.d": {
    en: "Set an amount per category and see what you spent against what you planned. Your budget month can start on any day you choose.",
    fr: "Fixez un montant par catégorie et comparez-le à ce que vous avez dépensé. Votre mois budgétaire peut commencer le jour de votre choix.",
  },
  "money.totals.t": { en: "Totals and prices", fr: "Totaux et prix" },
  "money.totals.d": {
    en: "See totals for the month, the year and all time, and compare unit prices between shops. Amounts are in US dollars or euros.",
    fr: "Consultez les totaux du mois, de l’année et de tous les temps, et comparez les prix unitaires d’un magasin à l’autre. Les montants sont en dollars américains ou en euros.",
  },
  "money.pots.t": { en: "Savings pots", fr: "Pots d’épargne" },
  "money.pots.d": {
    en: "Give each pot a goal and a date, make deposits and withdrawals, and get a proposed monthly amount. An expense can be paid from a pot.",
    fr: "Donnez à chaque pot un objectif et une date, faites des dépôts et des retraits, et obtenez un montant mensuel proposé. Une dépense peut être payée depuis un pot.",
  },
  "money.grow.t": { en: "Rates and export", fr: "Taux et export" },
  "money.grow.d": {
    en: "Grow compares interest rates on your device and stores nothing. Export your entries, savings, stock and books to CSV.",
    fr: "L’onglet Épargne compare des taux d’intérêt sur votre appareil, sans rien enregistrer. Exportez vos opérations, votre épargne, votre stock et vos livres en CSV.",
  },

  "home.h": { en: "Home", fr: "Maison" },
  "home.lead": {
    en: "Know what you have, what to buy and what to cook.",
    fr: "Sachez ce que vous avez, ce qu’il faut acheter et ce que vous allez cuisiner.",
  },
  "home.stock.t": { en: "Stock", fr: "Stock" },
  "home.stock.d": {
    en: "Keep spaces and items with a restock level, and see each item’s history on a chart.",
    fr: "Organisez des espaces et des articles avec un seuil de réapprovisionnement, et voyez l’historique de chaque article sur un graphique.",
  },
  "home.shopping.t": { en: "Shopping list", fr: "Liste de courses" },
  "home.shopping.d": {
    en: "It is built from what is running low. Tick an item to restock it and, if you want, record the expense in the same step.",
    fr: "Elle se construit à partir de ce qui manque. Cochez un article pour le réapprovisionner et, si vous le souhaitez, enregistrer la dépense dans la foulée.",
  },
  "home.recipes.t": { en: "Recipes", fr: "Recettes" },
  "home.recipes.d": {
    en: "Write down ingredients, steps and servings.",
    fr: "Notez les ingrédients, les étapes et le nombre de portions.",
  },
  "home.meals.t": { en: "Foods and meals", fr: "Aliments et repas" },
  "home.meals.d": {
    en: "Add foods with their kcal and macros, log a meal, and it shows on your calendar.",
    fr: "Ajoutez des aliments avec leurs kcal et leurs macros, enregistrez un repas, et il apparaît dans votre calendrier.",
  },

  "you.h": { en: "You", fr: "Vous" },
  "you.lead": {
    en: "Keep track of the things you do for yourself.",
    fr: "Gardez la trace de ce que vous faites pour vous.",
  },
  "you.habits.t": { en: "Habits", fr: "Habitudes" },
  "you.habits.d": {
    en: "Flexible schedules: a number of times a week, certain weekdays, every few days, a day of the month or the nth weekday. Check in each day and see a heatmap.",
    fr: "Des fréquences souples : un nombre de fois par semaine, certains jours, tous les quelques jours, un jour du mois ou le énième jour de la semaine. Validez chaque jour et suivez une carte de chaleur.",
  },
  "you.mood.t": { en: "Mood", fr: "Humeur" },
  "you.mood.d": {
    en: "A daily check-in, with a note if you want one.",
    fr: "Un point quotidien, avec une note si vous le souhaitez.",
  },
  "you.gym.t": { en: "Gym", fr: "Sport" },
  "you.gym.d": {
    en: "Exercises, routines, sessions, rest days, history and a strength chart. You can build a prompt from your own training data, paste it into the AI assistant of your choice and import the plan it returns. The app itself calls no AI.",
    fr: "Exercices, programmes, séances, jours de repos, historique et courbe de force. Vous pouvez générer une consigne à partir de vos propres données d’entraînement, la coller dans l’assistant IA de votre choix et importer le plan qu’il vous renvoie. L’application elle-même n’appelle aucune IA.",
  },
  "you.books.t": { en: "Books and notes", fr: "Livres et notes" },
  "you.books.d": {
    en: "Rate books, group them in series, tag them and keep their quotes. Write notes by typing or by drawing with a finger.",
    fr: "Notez vos livres, regroupez-les en séries, ajoutez des étiquettes et gardez leurs citations. Écrivez des notes au clavier ou dessinez-les du bout du doigt.",
  },
  "you.streaks.t": { en: "Streaks and points", fr: "Séries et points" },
  "you.streaks.d": {
    en: "Keep a streak going, earn points, and spend them on a freeze or a repair.",
    fr: "Entretenez une série, gagnez des points et dépensez-les pour un gel ou une réparation.",
  },
  "you.clocks.t": { en: "Moon and clocks", fr: "Lune et horloges" },
  "you.clocks.d": {
    en: "See the moon phase and moonrise, computed on your device, and keep clocks for other time zones.",
    fr: "Consultez la phase de la lune et son lever, calculés sur votre appareil, et gardez des horloges pour d’autres fuseaux horaires.",
  },

  "everywhere.h": { en: "Everywhere", fr: "Partout" },
  "everywhere.lead": {
    en: "On your phone, on your computer, and when the signal drops.",
    fr: "Sur votre téléphone, sur votre ordinateur, et quand le réseau disparaît.",
  },
  "everywhere.install.t": { en: "Install it", fr: "Installez-la" },
  "everywhere.install.d": {
    en: "Put it on your phone or computer like an app. A built-in guide shows you how.",
    fr: "Ajoutez-la à votre téléphone ou à votre ordinateur comme une application. Un guide intégré vous montre comment faire.",
  },
  "everywhere.offline.t": { en: "Offline entries", fr: "Saisie hors connexion" },
  "everywhere.offline.d": {
    en: "Entries, gym sessions and notes you make without a connection are sent later, when you are back online.",
    fr: "Les opérations, séances de sport et notes saisies sans connexion sont envoyées plus tard, au retour du réseau.",
  },
  "everywhere.calendar.t": { en: "Calendar", fr: "Calendrier" },
  "everywhere.calendar.d": {
    en: "See your records on a calendar with layers. Subscribe from Google, Apple or Outlook with a private link, or add a single item to your own calendar.",
    fr: "Retrouvez vos données dans un calendrier à calques. Abonnez-vous depuis Google, Apple ou Outlook avec un lien privé, ou ajoutez un seul élément à votre propre calendrier.",
  },
  "everywhere.looks.t": { en: "Languages and looks", fr: "Langues et apparence" },
  "everywhere.looks.d": {
    en: "English or French, five themes (light, dark, OLED black, high contrast and sepia) and nine accent colours.",
    fr: "Français ou anglais, cinq thèmes (clair, sombre, noir OLED, contraste élevé et sépia) et neuf couleurs d’accent.",
  },
  "everywhere.yours.t": { en: "Switch off what you don’t use", fr: "Gardez ce qui vous sert" },
  "everywhere.yours.d": {
    en: "Turn modules off, and arrange the tabs separately for your phone and your computer.",
    fr: "Désactivez les rubriques inutiles et disposez les onglets séparément sur votre téléphone et sur votre ordinateur.",
  },

  "data.h": { en: "Your data, your server", fr: "Vos données, votre serveur" },
  "data.noads": { en: "No ads and no trackers.", fr: "Aucune publicité, aucun traceur." },
  "data.host": {
    en: "Hosted by Hetzner in Germany.",
    fr: "Hébergé par Hetzner, en Allemagne.",
  },
  "data.open": {
    en: "Open source under the MIT licence, so anyone can run their own copy.",
    fr: "Code source ouvert sous licence MIT : chacun peut faire tourner sa propre copie.",
  },
  "data.privacy": { en: "How your data is handled", fr: "Comment vos données sont traitées" },
  "data.source": { en: "Source on GitHub", fr: "Code source sur GitHub" },

  "cta.h": { en: "Sign in, or start with an invite", fr: "Connectez-vous, ou commencez avec une invitation" },

  "footer.privacy": { en: "Privacy", fr: "Confidentialité" },
  "footer.source": { en: "Source on GitHub", fr: "Code source sur GitHub" },

  "alt.dashboard": {
    en: "Screenshot of the Dashboard on a phone: each category’s spending against its budget, then savings progress.",
    fr: "Capture d’écran du Tableau sur un téléphone : les dépenses de chaque catégorie face au budget, puis l’avancement de l’épargne.",
  },
  "alt.plan": {
    en: "Screenshot of the Plan tab on a phone, with savings pots and a proposed amount to put aside.",
    fr: "Capture d’écran de l’onglet Budget sur un téléphone, avec les pots d’épargne et un montant proposé à mettre de côté.",
  },
  "alt.stock": {
    en: "Screenshot of the Stock tab on a phone, with a shopping list built from items running low.",
    fr: "Capture d’écran de l’onglet Stock sur un téléphone, avec une liste de courses tirée des articles presque épuisés.",
  },
  "alt.habits": {
    en: "Screenshot of the Habits tab on a phone, with today’s habits, their streaks and check-ins.",
    fr: "Capture d’écran de l’onglet Habitudes sur un téléphone, avec les habitudes du jour, leurs séries et le suivi.",
  },

  "privacy.title": { en: "Privacy", fr: "Confidentialité" },
  "privacy.updated": { en: "Last updated: 2026-10-03", fr: "Dernière mise à jour : 2026-10-03" },
  "privacy.intro": {
    en: "Everything Everywhere is a small, invite-only app. This page says plainly what it stores and where.",
    fr: "Everything Everywhere est une petite application sur invitation. Cette page dit simplement ce qu’elle conserve, et où.",
  },
  "privacy.stored.t": { en: "What is stored", fr: "Ce qui est conservé" },
  "privacy.stored.d": {
    en: "Your account, which is an email address and a hashed password, and the records you create in each module: entries, savings, stock, recipes, habits, mood, gym, books, notes and so on.",
    fr: "Votre compte, c’est-à-dire une adresse e-mail et un mot de passe haché, et les données que vous créez dans chaque rubrique : opérations, épargne, stock, recettes, habitudes, humeur, sport, livres, notes, etc.",
  },
  "privacy.where.t": { en: "Where it is hosted", fr: "Où c’est hébergé" },
  "privacy.where.d": {
    en: "On a server run by Hetzner in Germany.",
    fr: "Sur un serveur géré par Hetzner, en Allemagne.",
  },
  "privacy.security.t": { en: "How it is protected", fr: "Comment c’est protégé" },
  "privacy.security.d": {
    en: "Passwords are hashed with Argon2. Sign-in refresh tokens and calendar-feed tokens are stored only as hashes. Each account’s data is kept apart from every other account’s by Postgres row-level security.",
    fr: "Les mots de passe sont hachés avec Argon2. Les jetons de renouvellement de connexion et les jetons des flux de calendrier ne sont conservés que sous forme de hachages. Les données de chaque compte sont isolées de celles des autres par la sécurité au niveau des lignes de Postgres.",
  },
  "privacy.third.t": { en: "No third parties", fr: "Aucun tiers" },
  "privacy.third.d": {
    en: "There are no analytics, no ads and no font CDN. The security policy of the pages blocks requests to any other site, so your browser talks only to this server.",
    fr: "Pas de mesure d’audience, pas de publicité, pas de CDN de polices. La politique de sécurité des pages bloque les requêtes vers tout autre site : votre navigateur ne parle qu’à ce serveur.",
  },
  "privacy.logs.t": { en: "Server logs", fr: "Journaux du serveur" },
  "privacy.logs.d": {
    en: "To keep the service running and fix problems, the server keeps technical logs of requests, which can include the time, the network address the request came from, the page requested and the result. They stay on the server, are capped in size and are overwritten as they fill up.",
    fr: "Pour faire fonctionner le service et corriger les problèmes, le serveur conserve des journaux techniques des requêtes, qui peuvent contenir l’heure, l’adresse réseau d’origine, la page demandée et le résultat. Ils restent sur le serveur, leur taille est plafonnée et ils sont écrasés au fur et à mesure.",
  },
  "privacy.device.t": { en: "On your device", fr: "Sur votre appareil" },
  "privacy.device.d": {
    en: "Your sign-in tokens are kept in your browser’s storage. If you set a place for moonrise, it stays on your device, rounded to about 10 km.",
    fr: "Vos jetons de connexion sont conservés dans le stockage de votre navigateur. Si vous indiquez un lieu pour le lever de lune, il reste sur votre appareil, arrondi à environ 10 km.",
  },
  "privacy.cookie.t": { en: "One cookie", fr: "Un seul cookie" },
  "privacy.cookie.d": {
    en: "The cookie ee_app holds no identity. It only tells the server to show you the app instead of this page. It is strictly functional, so there is no cookie banner.",
    fr: "Le cookie ee_app ne contient aucune identité. Il indique seulement au serveur de vous montrer l’application plutôt que cette page. Il est strictement fonctionnel, donc il n’y a pas de bandeau de cookies.",
  },
  "privacy.export.t": { en: "Your data is yours", fr: "Vos données vous appartiennent" },
  "privacy.export.d": {
    en: "You can export your entries, savings, stock and books to CSV from Settings at any time.",
    fr: "Vous pouvez exporter vos opérations, votre épargne, votre stock et vos livres en CSV depuis les réglages, à tout moment.",
  },
  "privacy.delete.t": { en: "Deleting your account", fr: "Supprimer votre compte" },
  "privacy.delete.d": {
    en: "The app has no delete-account button yet. To delete your account and its data, open an issue on GitHub.",
    fr: "L’application n’a pas encore de bouton pour supprimer un compte. Pour supprimer votre compte et ses données, ouvrez un ticket sur GitHub.",
  },
  "privacy.contact.t": { en: "Contact and source code", fr: "Contact et code source" },
  "privacy.contact.d": {
    en: "Everything Everywhere is open source under the MIT licence. For questions or requests, open an issue on GitHub.",
    fr: "Everything Everywhere est un logiciel libre sous licence MIT. Pour une question ou une demande, ouvrez un ticket sur GitHub.",
  },
  "privacy.back": { en: "Back to the home page", fr: "Retour à l’accueil" },
} satisfies Record<string, Entry>;

export type LandingKey = keyof typeof landing;
