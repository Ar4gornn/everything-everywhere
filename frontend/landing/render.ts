import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Lang } from "../src/i18n/catalogue.ts";
import { type LandingKey, landing } from "./messages.ts";

export type Page = "home" | "privacy";
export const ORIGIN = "https://everything-everywhere.app";

const LANGS: readonly Lang[] = ["en", "fr"];
const LOCALE: Record<Lang, string> = { en: "en_US", fr: "fr_FR" };
const GITHUB = "https://github.com/Ar4gornn/everything-everywhere";
const SIGN_IN = "/signin";
const INSTALL = "/install";
const REGISTER = "/signin?mode=register";

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

// `**label**` in a message is the app's own UI label: rendered bold, after escaping.
function rich(lang: Lang, key: LandingKey): string {
  return tr(lang, key).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

export type Shot = "dashboard" | "plan" | "stock" | "habits";

// Indirection so tests can pretend the screenshots exist (ESM builtins cannot be spied on).
export const imageProbe = { exists: (path: string): boolean => existsSync(path) };

const IMG_DIR = join(dirname(fileURLToPath(import.meta.url)), "img");

// render.ts only ever runs in Node (the Vite plugin and vitest), so node:fs is fine here.
// Vite fails the build on a reference to a file that does not exist, and the screenshots
// arrive in a later story (53.5), so an image that is not on disk renders as nothing and
// the page lays out without a media column.
export function img(lang: Lang, shot: Shot, alt: string, opts: { eager?: boolean } = {}): string {
  if (!imageProbe.exists(join(IMG_DIR, `${lang}-${shot}.webp`))) return "";
  const loading = opts.eager ? 'fetchpriority="high"' : 'loading="lazy"';
  return `<img src="/landing/img/${lang}-${shot}.webp" alt="${esc(alt)}" width="390" height="844" ${loading}>`;
}

function figure(lang: Lang, which: Shot, alt: LandingKey, eager = false): string {
  const tag = img(lang, which, landing[alt][lang], { eager });
  return tag ? `<figure class="shot">${tag}</figure>` : "";
}

function head(lang: Lang, page: Page): string {
  const title = page === "home" ? tr(lang, "meta.homeTitle") : `${tr(lang, "privacy.title")} - ${tr(lang, "meta.title")}`;
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
    // Preloaded so the body face is not discovered only after the stylesheet is parsed; the
    // same file landing.css imports, so Vite hashes both references to one asset.
    '<link rel="preload" href="/node_modules/@fontsource/lato/files/lato-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>',
    '<link rel="stylesheet" href="/landing/landing.css">',
    '<script type="module" src="/landing/landing.ts"></script>',
  ].join("\n    ");
}

// An item is `<base>.t` (title) + `<base>.d` (sentence) in messages.ts.
type ItemBase = LandingKey extends infer K ? (K extends `${infer B}.t` ? B : never) : never;

const SECTIONS: {
  id: string;
  h: LandingKey;
  lead: LandingKey;
  shot?: { which: Shot; alt: LandingKey };
  items: ItemBase[];
}[] = [
  {
    id: "money",
    h: "money.h",
    lead: "money.lead",
    shot: { which: "plan", alt: "alt.plan" },
    items: ["money.entries", "money.recurring", "money.plan", "money.totals", "money.pots"],
  },
  {
    id: "home",
    h: "home.h",
    lead: "home.lead",
    shot: { which: "stock", alt: "alt.stock" },
    items: ["home.stock", "home.shopping", "home.recipes", "home.meals"],
  },
  {
    id: "you",
    h: "you.h",
    lead: "you.lead",
    shot: { which: "habits", alt: "alt.habits" },
    items: ["you.habits", "you.gym", "you.books", "you.streaks", "you.clocks"],
  },
  {
    id: "everywhere",
    h: "everywhere.h",
    lead: "everywhere.lead",
    items: [
      "everywhere.offline",
      "everywhere.calendar",
      "everywhere.looks",
      "everywhere.yours",
    ],
  },
];

const PRIVACY_SECTIONS: ItemBase[] = [
  "privacy.stored",
  "privacy.where",
  "privacy.security",
  "privacy.access",
  "privacy.third",
  "privacy.logs",
  "privacy.device",
  "privacy.cookie",
  "privacy.export",
  "privacy.delete",
  "privacy.contact",
];

function langLinks(lang: Lang, page: Page): string {
  return LANGS.map((l) => {
    const href = pagePath(l, page);
    const label = l.toUpperCase();
    if (l === lang) return `<a href="${href}" lang="${l}" data-lang="${l}" aria-current="page">${label}</a>`;
    return `<a href="${href}" lang="${l}" hreflang="${l}" data-lang="${l}">${label}</a>`;
  }).join("\n          ");
}

function header(lang: Lang, page: Page): string {
  return `<a class="skip" href="#main">${tr(lang, "skip.link")}</a>
    <header class="top">
      <div class="wrap bar">
        <a class="brand" href="${pagePath(lang, "home")}">${tr(lang, "meta.title")}</a>
        <nav class="lang" aria-label="${tr(lang, "lang.label")}">
          ${langLinks(lang, page)}
        </nav>
        <a class="btn btn-quiet" href="${SIGN_IN}">${tr(lang, "action.signin")}</a>
      </div>
    </header>`;
}

function actions(lang: Lang): string {
  return `<div class="actions">
          <a class="btn btn-primary" href="${SIGN_IN}">${tr(lang, "action.signin")}</a>
          <a class="btn btn-link" href="${REGISTER}">${tr(lang, "hero.register")}</a>
        </div>`;
}

function hero(lang: Lang): string {
  const media = figure(lang, "dashboard", "alt.dashboard", true);
  return `<section class="hero${media ? " has-media" : ""}" aria-labelledby="hero-title">
      <div class="wrap hero-grid">
        <div class="hero-text">
          <h1 id="hero-title">${tr(lang, "hero.title")}</h1>
          <p class="sub">${tr(lang, "hero.sub")}</p>
          ${actions(lang)}
          <p class="note">${tr(lang, "hero.note")}</p>
        </div>
        ${media}
      </div>
    </section>`;
}

function items(lang: Lang, bases: ItemBase[]): string {
  const lis = bases.map(
    (b) => `<li><h3>${tr(lang, `${b}.t` as LandingKey)}</h3><p>${tr(lang, `${b}.d` as LandingKey)}</p></li>`,
  );
  return `<ul class="items">${lis.join("")}</ul>`;
}

const STEPS: ItemBase[] = [
  "start.invite",
  "start.install",
  "start.tour",
  "start.settings",
  "start.first",
  "start.plan",
  "start.recovery",
  "start.yours",
];

const TIPS: ItemBase[] = [
  "tips.asyougo",
  "tips.recurring",
  "tips.pots",
  "tips.stock",
  "tips.calendar",
  "tips.streak",
  "tips.export",
];

// Steps are an ordered list; the numbers come from the list itself (CSS counter, tokens only).
function gettingStarted(lang: Lang): string {
  const lis = STEPS.map((b) => {
    const link =
      b === "start.install" ? `<a class="step-link" href="${INSTALL}">${tr(lang, "start.install.link")}</a>` : "";
    return `<li><h3>${tr(lang, `${b}.t` as LandingKey)}</h3><p>${rich(lang, `${b}.d` as LandingKey)}</p>${link}</li>`;
  });
  return `<section class="guide" id="getting-started" aria-labelledby="start-h">
      <div class="wrap">
        <h2 id="start-h">${tr(lang, "start.h")}</h2>
        <p class="lead">${tr(lang, "start.lead")}</p>
        <ol class="steps">${lis.join("")}</ol>
      </div>
    </section>`;
}

function tips(lang: Lang): string {
  const lis = TIPS.map(
    (b) =>
      `<li><h3>${tr(lang, `${b}.t` as LandingKey)}</h3><p>${rich(lang, `${b}.d` as LandingKey)}</p></li>`,
  );
  return `<section class="guide tips" id="tips" aria-labelledby="tips-h">
      <div class="wrap">
        <h2 id="tips-h">${tr(lang, "tips.h")}</h2>
        <p class="lead">${tr(lang, "tips.lead")}</p>
        <ul class="items">${lis.join("")}</ul>
      </div>
    </section>`;
}

function inside(lang: Lang): string {
  return `<section class="inside" id="inside" aria-labelledby="inside-h">
      <div class="wrap">
        <h2 id="inside-h">${tr(lang, "inside.h")}</h2>
        <p class="lead">${tr(lang, "inside.lead")}</p>
      </div>
    </section>`;
}

function sections(lang: Lang): string {
  return SECTIONS.map((s) => {
    const media = s.shot ? figure(lang, s.shot.which, s.shot.alt) : "";
    return `<section class="feature${media ? " has-media" : ""}" id="${s.id}" aria-labelledby="${s.id}-h">
      <div class="wrap">
        <h2 id="${s.id}-h">${tr(lang, s.h)}</h2>
        <p class="lead">${tr(lang, s.lead)}</p>
        <div class="body">
          ${items(lang, s.items)}
          ${media}
        </div>
      </div>
    </section>`;
  }).join("\n    ");
}

function dataStrip(lang: Lang): string {
  return `<section class="strip" aria-labelledby="data-h">
      <div class="wrap">
        <h2 id="data-h">${tr(lang, "data.h")}</h2>
        <ul class="facts">
          <li>${tr(lang, "data.noads")}</li>
          <li>${tr(lang, "data.host")}</li>
          <li>${tr(lang, "data.access")}</li>
          <li>${tr(lang, "data.open")}</li>
        </ul>
        <p class="links">
          <a href="${GITHUB}">${tr(lang, "data.source")}</a>
          <a href="${pagePath(lang, "privacy")}">${tr(lang, "data.privacy")}</a>
        </p>
      </div>
    </section>`;
}

function closing(lang: Lang): string {
  return `<section class="cta" aria-labelledby="cta-h">
      <div class="wrap">
        <h2 id="cta-h">${tr(lang, "cta.h")}</h2>
        ${actions(lang)}
        <p class="note">${tr(lang, "hero.note")}</p>
      </div>
    </section>`;
}

function footer(lang: Lang, page: Page): string {
  // Built once at build time, so the year is the year of the deploy.
  const year = new Date().getFullYear();
  return `<footer class="foot">
      <div class="wrap foot-grid">
        <p class="links">
          <a href="${pagePath(lang, "privacy")}">${tr(lang, "footer.privacy")}</a>
          <a href="${GITHUB}">${tr(lang, "footer.source")}</a>
        </p>
        <p class="lang">
          ${langLinks(lang, page)}
        </p>
        <p class="copy">&copy; ${year} ${tr(lang, "meta.title")}</p>
      </div>
    </footer>`;
}

function privacyBody(lang: Lang): string {
  const secs = PRIVACY_SECTIONS.map((b) => {
    const id = b.replace(".", "-");
    const issues = b === "privacy.delete" || b === "privacy.contact" ? ` <a href="${GITHUB}/issues">github.com/Ar4gornn/everything-everywhere/issues</a>` : "";
    return `<section class="doc" aria-labelledby="${id}"><h2 id="${id}">${tr(lang, `${b}.t` as LandingKey)}</h2><p>${tr(lang, `${b}.d` as LandingKey)}${issues}</p></section>`;
  });
  return `<div class="wrap prose">
      <h1>${tr(lang, "privacy.title")}</h1>
      <p class="note">${tr(lang, "privacy.updated")}</p>
      <p class="lead">${tr(lang, "privacy.intro")}</p>
      ${secs.join("\n      ")}
      <p><a href="${pagePath(lang, "home")}">${tr(lang, "privacy.back")}</a></p>
    </div>`;
}

export function renderPage(lang: Lang, page: Page): string {
  const main =
    page === "home"
      ? [hero(lang), gettingStarted(lang), tips(lang), inside(lang), sections(lang), dataStrip(lang), closing(lang)].join("\n    ")
      : privacyBody(lang);
  return `<!doctype html>
<html lang="${lang}">
  <head>
    ${head(lang, page)}
  </head>
  <body>
    ${header(lang, page)}
    <main id="main">${main}</main>
    ${footer(lang, page)}
  </body>
</html>
`;
}
