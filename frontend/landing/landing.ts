// Landing page script: a one-time language hint and the toggle's memory. The page works
// fully without it. Must stay free of react and of anything under ../src/ except
// i18n/catalogue types.
const KEY = "everything-everywhere.landing-lang";

let stored: string | null = null;
try {
  stored = localStorage.getItem(KEY);
} catch {
  // Storage can be blocked; treat it as "no choice yet".
}

if (location.pathname === "/" && !stored && navigator.language.toLowerCase().startsWith("fr")) {
  location.replace("/fr/");
}

// The app's sign-in page opens in the language this page was read in, not the browser's: a
// visitor who switched to French here should not be handed back to English at the door.
// Same key as the app's i18n (src/i18n/index.tsx STORAGE_KEY); the account's own language
// still wins once signed in.
for (const a of document.querySelectorAll<HTMLAnchorElement>('a[href^="/signin"]')) {
  a.addEventListener("click", () => {
    try {
      localStorage.setItem("everything-everywhere.language", document.documentElement.lang);
    } catch {
      // The sign-in page then falls back to the browser's language.
    }
  });
}

for (const a of document.querySelectorAll<HTMLAnchorElement>("a[data-lang]")) {
  a.addEventListener("click", () => {
    try {
      localStorage.setItem(KEY, a.dataset.lang ?? "");
    } catch {
      // Not remembering the choice is harmless.
    }
  });
}
