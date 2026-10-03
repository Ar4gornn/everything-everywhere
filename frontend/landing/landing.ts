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

for (const a of document.querySelectorAll<HTMLAnchorElement>("a[data-lang]")) {
  a.addEventListener("click", () => {
    try {
      localStorage.setItem(KEY, a.dataset.lang ?? "");
    } catch {
      // Not remembering the choice is harmless.
    }
  });
}
