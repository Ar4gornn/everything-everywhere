import type { Entry } from "../catalogue";

/**
 * Epic 46 (AD-62 §3): the words of the `/install` page and its diagrams. The shared install
 * words (card, consent, welcome, Settings, tour) live in `install.ts`.
 *
 * The quoted menu labels are the ones the platforms show. English: iOS 26 Safari, Chrome for
 * Android, Chrome/Edge on desktop, Safari on macOS. French: Apple's and Chrome's own French
 * strings as best known — see the report for the ones not verified against a device.
 */
export const installGuide = {
  "installGuide.title": { en: "Install EEwhere", fr: "Installer EEwhere" },
  "installGuide.why": {
    en: "Put the app on your home screen in a few taps. It opens full screen, like any other app.",
    fr: "Mettez l’application sur votre écran d’accueil en quelques gestes : elle s’ouvre en plein écran, comme n’importe quelle autre.",
  },
  "installGuide.installed.title": {
    en: "Already installed on this device",
    fr: "Déjà installée sur cet appareil",
  },
  "installGuide.installed.body": {
    en: "You are using EEwhere as an installed app. There is nothing more to do here.",
    fr: "Vous utilisez EEwhere comme une application installée. Il n’y a rien d’autre à faire ici.",
  },
  "installGuide.open": { en: "Open EEwhere", fr: "Ouvrir EEwhere" },
  "installGuide.tabs": { en: "Choose your device", fr: "Choisissez votre appareil" },
  "installGuide.tab.iphone": { en: "iPhone", fr: "iPhone" },
  "installGuide.tab.android": { en: "Android", fr: "Android" },
  "installGuide.tab.computer": { en: "Computer", fr: "Ordinateur" },

  // The one-tap button (Chromium) and what happens after it.
  "installGuide.button": { en: "Install now", fr: "Installer maintenant" },
  "installGuide.buttonHint": {
    en: "Your browser will ask you to confirm.",
    fr: "Votre navigateur vous demandera de confirmer.",
  },
  "installGuide.accepted": {
    en: "Done — find EEwhere on your home screen",
    fr: "Terminé — retrouvez EEwhere sur votre écran d’accueil",
  },
  "installGuide.dismissed": {
    en: "No problem. You can also install it from the browser menu:",
    fr: "Pas de souci. Vous pouvez aussi l’installer depuis le menu du navigateur :",
  },

  // iPhone
  "installGuide.ios.safariHeading": { en: "On iPhone, in Safari", fr: "Sur iPhone, dans Safari" },
  "installGuide.ios.s1": {
    en: "Tap the ⋯ button next to the address bar, then tap “Share”.",
    fr: "Touchez le bouton ⋯ à côté de la barre d’adresse, puis touchez « Partager ».",
  },
  "installGuide.ios.s2": {
    en: "Scroll the list and tap “Add to Home Screen”.",
    fr: "Faites défiler la liste et touchez « Sur l’écran d’accueil ».",
  },
  "installGuide.ios.s3": {
    en: "Keep “Open as Web App” switched on.",
    fr: "Laissez « Ouvrir comme app web » activé.",
  },
  "installGuide.ios.s4": {
    en: "Tap “Add”. EEwhere appears on your home screen.",
    fr: "Touchez « Ajouter ». EEwhere apparaît sur votre écran d’accueil.",
  },
  "installGuide.ios.olderSummary": {
    en: "Older iPhone (iOS 16.4–18)",
    fr: "iPhone plus ancien (iOS 16.4 à 18)",
  },
  "installGuide.ios.o1": {
    en: "Tap the Share button in the bottom bar of Safari.",
    fr: "Touchez le bouton de partage dans la barre du bas de Safari.",
  },
  "installGuide.ios.o2": {
    en: "Scroll down and tap “Add to Home Screen”.",
    fr: "Faites défiler vers le bas et touchez « Sur l’écran d’accueil ».",
  },
  "installGuide.ios.o3": {
    en: "Tap “Add” at the top right.",
    fr: "Touchez « Ajouter » en haut à droite.",
  },
  "installGuide.ios.otherHeading": {
    en: "On iPhone, in Chrome, Edge or Firefox",
    fr: "Sur iPhone, dans Chrome, Edge ou Firefox",
  },
  "installGuide.ios.c1": {
    en: "Tap the Share button in the address bar.",
    fr: "Touchez le bouton de partage dans la barre d’adresse.",
  },
  "installGuide.ios.c2": {
    en: "Tap “Add to Home Screen”. You may need to scroll the list.",
    fr: "Touchez « Sur l’écran d’accueil ». Il faudra peut-être faire défiler la liste.",
  },
  "installGuide.ios.c3": {
    en: "On iOS 26, keep “Open as Web App” switched on, then tap “Add”.",
    fr: "Sous iOS 26, laissez « Ouvrir comme app web » activé, puis touchez « Ajouter ».",
  },
  "installGuide.ios.otherNote": {
    en: "This needs iOS 16.4 or later. Safari works on every version.",
    fr: "Cela demande iOS 16.4 ou plus récent. Safari fonctionne sur toutes les versions.",
  },

  // Android
  "installGuide.android.chromeHeading": {
    en: "On Android, in Chrome or Edge",
    fr: "Sur Android, dans Chrome ou Edge",
  },
  "installGuide.android.a1": {
    en: "On the right of the address bar, tap “More” ⋮.",
    fr: "À droite de la barre d’adresse, touchez « Plus » ⋮.",
  },
  "installGuide.android.a2": {
    en: "Tap “Install and create shortcut” (older versions: “Add to Home screen”).",
    fr: "Touchez « Installer et créer un raccourci » (anciennes versions : « Ajouter à l’écran d’accueil »).",
  },
  "installGuide.android.a3": {
    en: "Tap “Install” to confirm.",
    fr: "Touchez « Installer » pour confirmer.",
  },
  "installGuide.android.firefoxHeading": {
    en: "On Android, in Firefox",
    fr: "Sur Android, dans Firefox",
  },
  "installGuide.android.f1": {
    en: "Tap the ⋮ menu at the top right.",
    fr: "Touchez le menu ⋮ en haut à droite.",
  },
  "installGuide.android.f2": {
    en: "Tap “Install” (or “Add to Home screen”).",
    fr: "Touchez « Installer » (ou « Ajouter à l’écran d’accueil »).",
  },
  "installGuide.android.f3": {
    en: "Tap “Add” to confirm.",
    fr: "Touchez « Ajouter » pour confirmer.",
  },
  "installGuide.samsung.note": {
    en: "Samsung Internet may not install the full app. For the best result, open this page in Chrome.",
    fr: "Samsung Internet peut ne pas installer l’application complète. Pour un meilleur résultat, ouvrez cette page dans Chrome.",
  },
  "installGuide.samsung.copy": { en: "Copy link", fr: "Copier le lien" },
  "installGuide.samsung.copied": {
    en: "Link copied. Paste it into Chrome.",
    fr: "Lien copié. Collez-le dans Chrome.",
  },
  "installGuide.samsung.copyFailed": {
    en: "Could not copy. Press and hold the address bar to copy the link yourself.",
    fr: "Copie impossible. Appuyez longuement sur la barre d’adresse pour copier le lien vous-même.",
  },

  // Computer
  "installGuide.desktop.chromeHeading": {
    en: "On a computer, in Chrome or Edge",
    fr: "Sur ordinateur, dans Chrome ou Edge",
  },
  "installGuide.desktop.d1": {
    en: "Click the install icon at the right end of the address bar.",
    fr: "Cliquez sur l’icône d’installation à droite de la barre d’adresse.",
  },
  "installGuide.desktop.d2": {
    en: "Click “Install” in the box that appears. EEwhere opens in its own window.",
    fr: "Cliquez sur « Installer » dans la fenêtre qui apparaît. EEwhere s’ouvre dans sa propre fenêtre.",
  },
  "installGuide.desktop.safariHeading": {
    en: "On a Mac, in Safari (macOS Sonoma or later)",
    fr: "Sur Mac, dans Safari (macOS Sonoma ou plus récent)",
  },
  "installGuide.desktop.m1": {
    en: "Open the “File” menu and click “Add to Dock”.",
    fr: "Ouvrez le menu « Fichier » et cliquez sur « Ajouter au Dock ».",
  },
  "installGuide.desktop.m3": { en: "Click “Add”.", fr: "Cliquez sur « Ajouter »." },
  "installGuide.desktop.firefox": {
    en: "Firefox on a computer cannot install web apps. Open this page in Chrome or Edge to install it.",
    fr: "Firefox sur ordinateur ne peut pas installer d’applications web. Ouvrez cette page dans Chrome ou Edge pour l’installer.",
  },
  "installGuide.desktop.also": {
    en: "On a Mac, Safari can do it too: File, then “Add to Dock”. Firefox cannot install web apps.",
    fr: "Sur Mac, Safari le permet aussi : Fichier, puis « Ajouter au Dock ». Firefox ne peut pas installer d’applications web.",
  },

  // Why install
  "installGuide.why.title": { en: "Why install?", fr: "Pourquoi l’installer ?" },
  "installGuide.why.1": {
    en: "It opens full screen, without the browser bars.",
    fr: "Elle s’ouvre en plein écran, sans les barres du navigateur.",
  },
  "installGuide.why.2": {
    en: "It starts quickly and the basics keep working offline.",
    fr: "Elle démarre vite et l’essentiel continue de marcher hors ligne.",
  },
  "installGuide.why.3": {
    en: "On iPhone, notifications only work once it is on your home screen.",
    fr: "Sur iPhone, les notifications ne marchent qu’une fois l’application sur l’écran d’accueil.",
  },

  // Diagram descriptions (aria-label of each drawing) and the words drawn inside them.
  "installGuide.dia.menuBottom": {
    en: "Safari on iPhone with the ⋯ button next to the address bar highlighted",
    fr: "Safari sur iPhone avec le bouton ⋯ à côté de la barre d’adresse mis en évidence",
  },
  "installGuide.dia.shareSheet": {
    en: "The share list with “Add to Home Screen” highlighted",
    fr: "La liste de partage avec l’option « Sur l’écran d’accueil » mise en évidence",
  },
  "installGuide.dia.webAppToggle": {
    en: "The add dialog with the “Open as Web App” switch on and highlighted",
    fr: "La fenêtre d’ajout avec l’interrupteur « Ouvrir comme app web » activé et mis en évidence",
  },
  "installGuide.dia.addButton": {
    en: "The add dialog with the “Add” button highlighted",
    fr: "La fenêtre d’ajout avec le bouton « Ajouter » mis en évidence",
  },
  "installGuide.dia.shareBottom": {
    en: "Safari on iPhone with the Share button in the bottom bar highlighted",
    fr: "Safari sur iPhone avec le bouton de partage de la barre du bas mis en évidence",
  },
  "installGuide.dia.shareTop": {
    en: "A browser on iPhone with the Share button in the address bar highlighted",
    fr: "Un navigateur sur iPhone avec le bouton de partage de la barre d’adresse mis en évidence",
  },
  "installGuide.dia.androidMenu": {
    en: "A browser on Android with “More” ⋮ at the right of the address bar highlighted",
    fr: "Un navigateur sur Android avec « Plus » ⋮ à droite de la barre d’adresse mis en évidence",
  },
  "installGuide.dia.androidFirefoxMenu": {
    en: "Firefox on Android with the ⋮ menu at the top right highlighted",
    fr: "Firefox sur Android avec le menu ⋮ en haut à droite mis en évidence",
  },
  "installGuide.dia.androidFirefoxConfirm": {
    en: "The Firefox confirmation box with the “Add” button highlighted",
    fr: "La fenêtre de confirmation de Firefox avec le bouton « Ajouter » mis en évidence",
  },
  "installGuide.dia.androidList": {
    en: "The browser menu with “Install and create shortcut” highlighted",
    fr: "Le menu du navigateur avec « Installer et créer un raccourci » mis en évidence",
  },
  "installGuide.dia.androidConfirm": {
    en: "The confirmation box with the “Install” button highlighted",
    fr: "La fenêtre de confirmation avec le bouton « Installer » mis en évidence",
  },
  "installGuide.dia.desktopIcon": {
    en: "A desktop browser with the install icon at the right end of the address bar highlighted",
    fr: "Un navigateur d’ordinateur avec l’icône d’installation à droite de la barre d’adresse mise en évidence",
  },
  "installGuide.dia.desktopConfirm": {
    en: "The desktop confirmation box with the “Install” button highlighted",
    fr: "La fenêtre de confirmation sur ordinateur avec le bouton « Installer » mis en évidence",
  },
  "installGuide.dia.macFile": {
    en: "The Safari File menu on a Mac with “Add to Dock” highlighted",
    fr: "Le menu Fichier de Safari sur Mac avec « Ajouter au Dock » mis en évidence",
  },
  "installGuide.dia.macAdd": {
    en: "The Mac add dialog with the “Add” button highlighted",
    fr: "La fenêtre d’ajout sur Mac avec le bouton « Ajouter » mis en évidence",
  },
  "installGuide.dia.menuFirefox": {
    en: "The Firefox menu on Android with “Install” highlighted",
    fr: "Le menu de Firefox sur Android avec « Installer » mis en évidence",
  },
  // Words inside the drawings (the real menu labels).
  "installGuide.lbl.share": { en: "Share", fr: "Partager" },
  "installGuide.lbl.addToHome": { en: "Add to Home Screen", fr: "Sur l’écran d’accueil" },
  "installGuide.lbl.openWebApp": { en: "Open as Web App", fr: "Ouvrir comme app web" },
  "installGuide.lbl.add": { en: "Add", fr: "Ajouter" },
  "installGuide.lbl.installApp": {
    en: "Install and create shortcut",
    fr: "Installer et créer un raccourci",
  },
  "installGuide.lbl.install": { en: "Install", fr: "Installer" },
  "installGuide.lbl.addToDock": { en: "Add to Dock", fr: "Ajouter au Dock" },
  "installGuide.lbl.file": { en: "File", fr: "Fichier" },
} satisfies Record<string, Entry>;
