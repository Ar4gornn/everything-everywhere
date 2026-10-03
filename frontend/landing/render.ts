import type { Lang } from "../src/i18n/catalogue.ts";
import { type LandingKey, landing } from "./messages.ts";

export type Page = "home" | "privacy";
export const ORIGIN = "https://everything-everywhere.app";

const LANGS: readonly Lang[] = ["en", "fr"];
const LOCALE: Record<Lang, string> = { en: "en_US", fr: "fr_FR" };

export function pagePath(lang: Lang, page: Page): string {
  const prefix = lang === "fr" ? "/fr" : "";
  return page === "home" ? `${prefix}/` : `${prefix}/privacy/`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function tr(lang: Lang, key: LandingKey): string {
  return esc(landing[key][lang]);
}

export type Shot = "dashboard" | "plan" | "stock" | "habits";

// Not called by any page yet: the image files land in Story 53.5, and Vite fails the build
// on a reference to a file that does not exist. 53.4 starts calling it.
export function img(lang: Lang, shot: Shot, alt: string, opts: { eager?: boolean } = {}): string {
  const loading = opts.eager ? 'fetchpriority="high"' : 'loading="lazy"';
  return `<img src="/landing/img/${lang}-${shot}.webp" alt="${esc(alt)}" width="390" height="844" ${loading}>`;
}

function head(lang: Lang, page: Page): string {
  const title = page === "home" ? tr(lang, "meta.title") : `${tr(lang, "privacy.title")} - ${tr(lang, "meta.title")}`;
  const desc = tr(lang, "meta.description");
  const url = ORIGIN + pagePath(lang, page);
  const alternates = [
    ...LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${ORIGIN + pagePath(l, page)}">`),
    `<link rel="alternate" hreflang="x-default" href="${ORIGIN + pagePath("en", page)}">`,
  ];
  return [
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">',
    '<meta name="color-scheme" content="light dark">',
    '<meta name="theme-color" content="#f2f2f2">',
    '<script src="/theme.js?v=2"></script>',
    `<title>${title}</title>`,
    `<meta name="description" content="${desc}">`,
    `<link rel="canonical" href="${url}">`,
    ...alternates,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${desc}">`,
    `<meta property="og:image" content="${ORIGIN}/og-${lang}.png">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:locale" content="${LOCALE[lang]}">`,
    '<meta property="og:type" content="website">',
    `<meta property="og:site_name" content="${tr(lang, "meta.title")}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    '<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">',
    '<link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png">',
    '<link rel="stylesheet" href="/landing/landing.css">',
    '<script type="module" src="/landing/landing.ts"></script>',
  ].join("\n    ");
}

function header(lang: Lang): string {
  return `<header><a href="${pagePath(lang, "home")}">${tr(lang, "meta.title")}</a></header>`;
}

function hero(lang: Lang): string {
  return `<h1>${tr(lang, "hero.title")}</h1>`;
}

function sections(_lang: Lang): string {
  return "";
}

function footer(_lang: Lang): string {
  return "<footer></footer>";
}

function privacyBody(lang: Lang): string {
  return `<h1>${tr(lang, "privacy.title")}</h1>`;
}

export function renderPage(lang: Lang, page: Page): string {
  const main = page === "home" ? hero(lang) + sections(lang) : privacyBody(lang);
  return `<!doctype html>
<html lang="${lang}">
  <head>
    ${head(lang, page)}
  </head>
  <body>
    ${header(lang)}
    <main id="main">${main}</main>
    ${footer(lang)}
  </body>
</html>
`;
}
