import type { Entry } from "../src/i18n/catalogue.ts";

// Every claim here traces to docs/epic-53-landing.md section 3.1. Section 3.2 (push,
// reminders, digest, bank sync, "free", prices ...) must never appear; landing.test.ts guards
// the words. Feature names follow the app's own labels in each language, quoted between
// double asterisks (render.ts turns them into <strong>): the strings are in
// frontend/src/i18n/messages/*.ts and are listed in the story notes.
//
// Naming: `<name>.t` is an item's title and `<name>.d` its sentence; render.ts refers to the
// shared `<name>` and the unused-key test accounts for that.
export const landing = {
  "meta.title": { en: "Everything Everywhere", fr: "Everything Everywhere" },
  "meta.homeTitle": {
    en: "Everything Everywhere: a guide for family and friends",
    fr: "Everything Everywhere : le guide pour la famille et les amis",
  },
  "meta.description": {
    en: "A guide for family and friends invited to Everything Everywhere: how to get started, and how to use it well to track money, home and daily habits. Invite-only, open source.",
    fr: "Le guide des proches invités sur Everything Everywhere : comment démarrer et bien s’en servir pour suivre l’argent, la maison et les habitudes du quotidien. Sur invitation, code source ouvert.",
  },
  "skip.link": { en: "Skip to content", fr: "Aller au contenu" },
  "lang.label": { en: "Language", fr: "Langue" },
  "action.signin": { en: "Sign in", fr: "Se connecter" },

  "hero.title": {
    en: "Money, home and daily habits in one app, for family and friends",
    fr: "L’argent, la maison et les habitudes du quotidien dans une seule application, pour la famille et les amis",
  },
  "hero.sub": {
    en: "Everything Everywhere is an app shared with family and friends. Each person has their own account to track money, home and daily habits. This page shows you how to get started and how to use it well.",
    fr: "Everything Everywhere est une application partagée entre proches. Chacun a son propre compte pour suivre l’argent, la maison et les habitudes du quotidien. Cette page vous montre comment démarrer et bien vous en servir.",
  },
  "hero.register": { en: "Have an invite? Create an account", fr: "Une invitation ? Créez un compte" },
  "hero.note": {
    en: "It is invite-only: you need an invitation from the person who shared it with you.",
    fr: "Elle fonctionne sur invitation : il vous faut celle de la personne qui vous l’a fait découvrir.",
  },

  "start.h": { en: "Getting started", fr: "Pour bien démarrer" },
  "start.lead": {
    en: "From your invitation to a useful first week, in eight steps.",
    fr: "De l’invitation à une première semaine utile, en huit étapes.",
  },
  "start.invite.t": { en: "Open your invite link and create your account", fr: "Ouvrez votre lien d’invitation et créez votre compte" },
  "start.invite.d": {
    en: "The link opens the sign-up form with your **Invite code** already filled in; it works once. Enter your **Email**, a **Password** of at least 10 characters and your **Currency**, then press **Create account**. The currency can only be changed while the account is still empty.",
    fr: "Le lien ouvre le formulaire d’inscription avec votre **Code d’invitation** déjà rempli ; il ne sert qu’une fois. Saisissez votre **Adresse e-mail**, un **Mot de passe** d’au moins 10 caractères et votre **Devise**, puis appuyez sur **Créer le compte**. La devise ne se change que tant que le compte est vide.",
  },
  "start.install.t": { en: "Install it on your phone", fr: "Installez-la sur votre téléphone" },
  "start.install.d": {
    en: "The install guide works even before you sign in. Later you can find it in **Settings**, under **Install the app**, with **Open the guide**.",
    fr: "Le guide d’installation fonctionne même avant la connexion. Vous le retrouverez plus tard dans les **Réglages**, sous **Installer l’application**, avec **Ouvrir le guide**.",
  },
  "start.tour.t": { en: "Take the short tour", fr: "Faites la courte visite" },
  "start.tour.d": {
    en: "The first time you sign in, a short tour shows you how to record an entry, set a budget and read the dashboard. You can play it again from **Settings**, with **Show the tour again**.",
    fr: "À votre première connexion, une courte visite vous montre comment enregistrer une opération, fixer un budget et lire le tableau de bord. Vous pouvez la rejouer depuis les **Réglages**, avec **Revoir la visite**.",
  },
  "start.settings.t": { en: "Check your settings", fr: "Vérifiez vos réglages" },
  "start.settings.d": {
    en: "In **Settings**, look at **Account currency**, then set **Budget month** to start on the day you are paid (**Starts on day**).",
    fr: "Dans les **Réglages**, vérifiez la **Devise du compte**, puis faites commencer le **Mois budgétaire** le jour de votre paie (**Commence le jour**).",
  },
  "start.first.t": { en: "Record your first expense", fr: "Notez votre première dépense" },
  "start.first.d": {
    en: "On a phone, tap the **+** button (**Add an entry**), choose a category, enter the amount and press **Save**. On a computer, open **Entries**.",
    fr: "Sur téléphone, touchez le bouton **+** (**Ajouter une opération**), choisissez une catégorie, saisissez le montant et appuyez sur **Enregistrer**. Sur ordinateur, ouvrez **Opérations**.",
  },
  "start.plan.t": { en: "Set a monthly plan", fr: "Fixez un budget mensuel" },
  "start.plan.d": {
    en: "Open **Plan**, find **Monthly budgets** and give each category an amount. You will then see what you spent against what you planned.",
    fr: "Ouvrez **Budget**, repérez **Budgets mensuels** et donnez un montant à chaque catégorie. Vous verrez alors ce que vous avez dépensé face à ce que vous aviez prévu.",
  },
  "start.recovery.t": { en: "Keep your recovery codes", fr: "Gardez vos codes de récupération" },
  "start.recovery.d": {
    en: "In **Settings**, under **Password and recovery**, press **Generate codes** and keep them somewhere that is not this app. If you forget your password, **Forgot your password?** on the sign-in page lets you set a new one with your email and one code.",
    fr: "Dans les **Réglages**, sous **Mot de passe et récupération**, appuyez sur **Générer des codes** et conservez-les ailleurs que dans l’application. Si vous oubliez votre mot de passe, **Mot de passe oublié ?** sur la page de connexion vous permet d’en définir un nouveau avec votre e-mail et un code.",
  },
  "start.yours.t": { en: "Make it yours", fr: "Faites-en votre outil" },
  "start.yours.d": {
    en: "On a phone, **More** then **Change what’s in the bar** lets you pin the four places you use most. In **Settings**, **Layout** also has **Sections you use**: switch off what you don’t need.",
    fr: "Sur téléphone, **Plus** puis **Modifier la barre** vous permet d’épingler les quatre rubriques que vous utilisez le plus. Dans les **Réglages**, **Disposition** propose aussi **Rubriques utilisées** : désactivez ce qui ne vous sert pas.",
  },
  "start.install.link": { en: "Open the install guide", fr: "Ouvrir le guide d’installation" },

  "tips.h": { en: "Tips to get the most out of it", fr: "Nos conseils pour en profiter" },
  "tips.lead": {
    en: "Small habits that make the app more useful.",
    fr: "De petites habitudes qui rendent l’application plus utile.",
  },
  "tips.asyougo.t": { en: "Record purchases as they happen", fr: "Notez les achats sur le moment" },
  "tips.asyougo.d": {
    en: "The **+** button on your phone is the fastest way. Without a connection, the entry waits on your phone and is sent when you are back online.",
    fr: "Le bouton **+** de votre téléphone est le plus rapide. Sans connexion, l’opération attend sur votre téléphone et part dès que le réseau revient.",
  },
  "tips.recurring.t": { en: "Make rent and salary recurring", fr: "Rendez le loyer et le salaire récurrents" },
  "tips.recurring.d": {
    en: "On **Plan**, use **Recurring** and **Add a recurring entry**. Each one is proposed when it is due and you confirm it or press **Skip**. Tick **Add automatically** only for a fixed amount like rent.",
    fr: "Sur **Budget**, utilisez **Récurrent** puis **Ajouter une récurrence**. Chacune vous est proposée à l’échéance et vous la confirmez ou appuyez sur **Passer**. Ne cochez **Ajouter automatiquement** que pour un montant fixe, comme un loyer.",
  },
  "tips.pots.t": { en: "Give savings pots a goal and a date", fr: "Donnez un objectif et une date aux pots d’épargne" },
  "tips.pots.d": {
    en: "In the **Savings** card on **Plan**, fill in **Goal amount** and **Goal date**. The app then proposes how much to put aside each month.",
    fr: "Dans la carte **Épargne** de **Budget**, renseignez **Montant visé** et **Date visée**. L’application vous propose alors combien mettre de côté chaque mois.",
  },
  "tips.stock.t": { en: "Keep Stock levels up to date", fr: "Tenez les niveaux du Stock à jour" },
  "tips.stock.d": {
    en: "Give each item a restock level in **Stock**. Items that run low appear in the **Shopping list**, and ticking one as **Bought** restocks it and can record the expense in the same step.",
    fr: "Donnez à chaque article un seuil de réapprovisionnement dans **Stock**. Ceux qui manquent arrivent dans la **Liste de courses** ; cocher **Acheté** les réapprovisionne et peut enregistrer la dépense dans la foulée.",
  },
  "tips.calendar.t": { en: "Put it in your phone’s calendar", fr: "Mettez-le dans l’agenda de votre téléphone" },
  "tips.calendar.d": {
    en: "In **Settings**, under **Calendar apps**, press **Create a subscribe link** and paste it into Google, Apple or Outlook calendar. It is read-only: changes are made in the app.",
    fr: "Dans les **Réglages**, sous **Applications d’agenda**, appuyez sur **Créer un lien d’abonnement** et collez-le dans Google, Apple ou Outlook. C’est en lecture seule : les modifications se font dans l’application.",
  },
  "tips.streak.t": { en: "Check in every day", fr: "Validez votre journée chaque jour" },
  "tips.streak.d": {
    en: "Press **Check in** to keep your streak going and earn points. Points can buy a freeze that covers a day off.",
    fr: "Appuyez sur **Valider aujourd’hui** pour entretenir votre série et gagner des points. Les points achètent un gel qui couvre un jour d’absence.",
  },
  "tips.export.t": { en: "Export your data when you like", fr: "Exportez vos données quand vous voulez" },
  "tips.export.d": {
    en: "In **Settings**, under **Export**, download **Entries CSV**, **Savings CSV** or **Stock CSV** for a spreadsheet or to keep.",
    fr: "Dans les **Réglages**, sous **Export**, téléchargez **Opérations (CSV)**, **Épargne (CSV)** ou **Stock (CSV)** pour un tableur ou pour les conserver.",
  },

  "inside.h": { en: "What’s inside", fr: "Ce que vous y trouverez" },
  "inside.lead": {
    en: "The main places, in four groups.",
    fr: "Les principales rubriques, en quatre groupes.",
  },

  "money.h": { en: "Money", fr: "Argent" },
  "money.lead": {
    en: "Record what comes in and goes out, then see where you stand.",
    fr: "Notez ce qui entre et ce qui sort, puis voyez où vous en êtes.",
  },
  "money.entries.t": { en: "Income and expenses", fr: "Revenus et dépenses" },
  "money.entries.d": {
    en: "Each with a category, an optional quantity and unit, and the shop. Search them later.",
    fr: "Chacun avec une catégorie, une quantité et une unité facultatives, et le magasin. Retrouvez-les avec la recherche.",
  },
  "money.recurring.t": { en: "Recurring entries", fr: "Opérations récurrentes" },
  "money.recurring.d": {
    en: "Rent, subscriptions and salary are proposed when due; you confirm or skip.",
    fr: "Loyer, abonnements et salaire vous sont proposés à l’échéance ; vous confirmez ou vous passez.",
  },
  "money.plan.t": { en: "A monthly plan", fr: "Un budget mensuel" },
  "money.plan.d": {
    en: "An amount per category, against what you spent. Your budget month can start on any day.",
    fr: "Un montant par catégorie, face à ce que vous avez dépensé. Votre mois budgétaire peut commencer n’importe quel jour.",
  },
  "money.totals.t": { en: "Totals and comparisons", fr: "Totaux et comparaisons" },
  "money.totals.d": {
    en: "Totals for the month, the year and all time, and what you pay per unit in each shop. Grow compares interest rates on your device and stores nothing.",
    fr: "Les totaux du mois, de l’année et de tous les temps, et ce que vous payez par unité dans chaque magasin. L’onglet Épargne compare des taux d’intérêt sur votre appareil, sans rien enregistrer.",
  },
  "money.pots.t": { en: "Savings pots", fr: "Pots d’épargne" },
  "money.pots.d": {
    en: "A goal and a date for each pot, deposits and withdrawals, and a proposed monthly amount. An expense can be paid from a pot.",
    fr: "Un objectif et une date par pot, des dépôts et des retraits, et un montant mensuel proposé. Une dépense peut être payée depuis un pot.",
  },

  "home.h": { en: "Home", fr: "Maison" },
  "home.lead": {
    en: "Know what you have, what to buy and what to cook.",
    fr: "Sachez ce que vous avez, ce qu’il faut acheter et ce que vous allez cuisiner.",
  },
  "home.stock.t": { en: "Stock", fr: "Stock" },
  "home.stock.d": {
    en: "Spaces and items with a restock level, and a history chart for each item.",
    fr: "Des espaces et des articles avec un seuil de réapprovisionnement, et un graphique d’historique par article.",
  },
  "home.shopping.t": { en: "Shopping list", fr: "Liste de courses" },
  "home.shopping.d": {
    en: "Built from what is running low. Tick an item to restock it and, if you want, record the expense.",
    fr: "Construite à partir de ce qui manque. Cochez un article pour le réapprovisionner et, si vous le souhaitez, enregistrer la dépense.",
  },
  "home.recipes.t": { en: "Recipes", fr: "Recettes" },
  "home.recipes.d": {
    en: "Ingredients, steps and servings.",
    fr: "Les ingrédients, les étapes et le nombre de portions.",
  },
  "home.meals.t": { en: "Foods and meals", fr: "Aliments et repas" },
  "home.meals.d": {
    en: "Foods with their kcal and macros; a logged meal shows on your calendar.",
    fr: "Des aliments avec leurs kcal et leurs macros ; un repas enregistré apparaît dans votre calendrier.",
  },

  "you.h": { en: "You", fr: "Vous" },
  "you.lead": {
    en: "Keep track of the things you do for yourself.",
    fr: "Gardez la trace de ce que vous faites pour vous.",
  },
  "you.habits.t": { en: "Habits and mood", fr: "Habitudes et humeur" },
  "you.habits.d": {
    en: "Flexible schedules, a daily check-in and a heatmap, plus a daily mood check-in with an optional note.",
    fr: "Des fréquences souples, un suivi quotidien et une carte de chaleur, plus un point d’humeur chaque jour avec une note facultative.",
  },
  "you.gym.t": { en: "Gym", fr: "Sport" },
  "you.gym.d": {
    en: "Exercises, routines, sessions, rest days and a strength chart. You can build a prompt from your own data for the AI assistant of your choice and import its plan. The app itself calls no AI.",
    fr: "Exercices, programmes, séances, jours de repos et courbe de force. Vous pouvez générer une consigne à partir de vos données pour l’assistant IA de votre choix et importer son plan. L’application elle-même n’appelle aucune IA.",
  },
  "you.books.t": { en: "Books and notes", fr: "Livres et notes" },
  "you.books.d": {
    en: "Rate books, keep their quotes, and write notes by typing or drawing with a finger.",
    fr: "Notez vos livres, gardez leurs citations et écrivez des notes au clavier ou en dessinant du bout du doigt.",
  },
  "you.streaks.t": { en: "Streaks and points", fr: "Séries et points" },
  "you.streaks.d": {
    en: "Keep a streak going, earn points, and spend them on a freeze or a repair.",
    fr: "Entretenez une série, gagnez des points et dépensez-les pour un gel ou une réparation.",
  },
  "you.clocks.t": { en: "Moon and clocks", fr: "Lune et horloges" },
  "you.clocks.d": {
    en: "Moon phase and moonrise, computed on your device, and clocks for other time zones.",
    fr: "Phase de la lune et son lever, calculés sur votre appareil, et des horloges pour d’autres fuseaux horaires.",
  },

  "everywhere.h": { en: "Everywhere", fr: "Partout" },
  "everywhere.lead": {
    en: "On your phone, on your computer, and when the signal drops.",
    fr: "Sur votre téléphone, sur votre ordinateur, et quand le réseau disparaît.",
  },
  "everywhere.offline.t": { en: "Offline entries", fr: "Saisie hors connexion" },
  "everywhere.offline.d": {
    en: "Entries, gym sessions and notes made without a connection are sent later.",
    fr: "Les opérations, séances de sport et notes saisies sans connexion sont envoyées plus tard.",
  },
  "everywhere.calendar.t": { en: "Calendar", fr: "Calendrier" },
  "everywhere.calendar.d": {
    en: "Your records on a calendar with layers, a private link for Google, Apple or Outlook, and a way to add a single item to your own calendar.",
    fr: "Vos données dans un calendrier à calques, un lien privé pour Google, Apple ou Outlook, et de quoi ajouter un seul élément à votre propre calendrier.",
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
  "data.access": {
    en: "Accounts never see each other’s data. As with any hosted service, the person who runs the server has technical access to the database.",
    fr: "Les comptes ne voient jamais les données des autres. Comme pour tout service hébergé, la personne qui gère le serveur a un accès technique à la base de données.",
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
  "privacy.updated": { en: "Last updated: 2026-10-04", fr: "Dernière mise à jour : 2026-10-04" },
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
  "privacy.access.t": { en: "Who can see your data", fr: "Qui peut voir vos données" },
  "privacy.access.d": {
    en: "Accounts never see each other’s data. As with any hosted service, the person who runs the server has technical access to the database.",
    fr: "Les comptes ne voient jamais les données des autres. Comme pour tout service hébergé, la personne qui gère le serveur a un accès technique à la base de données.",
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
