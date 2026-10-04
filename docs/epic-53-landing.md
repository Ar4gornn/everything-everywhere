# Epic 53: A public front door — the landing page

Scoped 2026-10-03 in a two-round interview; chosen and rejected options are in `LOG.md`
("EE Epic 53 public landing page scoped"). AD-66. No migration, no new dependency.

Today `https://everything-everywhere.app/` shows a sign-in box to everyone. A visitor learns
nothing about what the app does, link previews show the bare title, and search engines index
a login form. This epic puts a static, prerendered page at `/` for visitors, in English and
French. A signed-in person never sees it.

## 1. Scope (locked in the interview)

- **Where:** a second Vite input that is not the app. Caddy serves it at `/` to a visitor.
  The app is served instead when the request carries the marker cookie `ee_app=1` or **any**
  query string (`/?invite=CODE` from AD-54, `/?pwa=1`, `/?mood=1`). Also `/fr/`,
  `/privacy/` and `/fr/privacy/`.
- **Call to action:** prod runs `REGISTRATION_MODE=invite`, hardcoded in
  `docker-compose.prod.yml`. So the page offers **Sign in** (→ `/signin`) and
  **Have an invite? Create an account** (→ `/signin?mode=register`), and says plainly that
  the app is invite-only. It also links the public MIT source on GitHub.
- **Content:** one page. Hero → four sections (Money, Home, You, Everywhere) → a privacy and
  open-source strip → footer. Every claim traces to code on `main`; the inventory is §3.
- **Visuals:** about four real phone screenshots per language, light theme, captured from a
  seeded verify stack by a script kept in the repo (`ops/landing-shots/`).
- **Look:** the app's own tokens and fonts. `/theme.js` runs on the landing page too, so a
  saved or system theme (light, dark, oled, hc, sepia) and accent apply. EN and FR are
  separate URLs with a visible toggle.
- **Tech:** vanilla TypeScript (no React). The EN and FR HTML is prerendered at build time
  from one `{ en, fr }` message module. hreflang, canonical, title and description, Open
  Graph and Twitter tags per language. Also robots.txt and sitemap.xml. One OG image per
  language, 1200×630.
- **Privacy:** no analytics. `/privacy/` (and `/fr/privacy/`) lists what is stored, where it
  is hosted, the one cookie, and contact via GitHub issues.

### Explicitly out

Pricing, blog, testimonials, newsletter, request-access form, open sign-up, roadmap or
changelog, demo account, analytics, cookie banner (the one cookie is strictly functional),
imprint, JSON-LD, auto-redirect by IP, any new npm or pip dependency.

## 2. UX (bmad-ux, condensed: the interview answered the elicitation)

### 2.1 Information architecture

```
/            EN landing         /fr/          FR landing
/privacy/    EN privacy         /fr/privacy/  FR privacy
/signin      app (SignInPage)   /signin?mode=register  app, register form open
```

Landing, top to bottom:

1. **Header bar.** Wordmark "Everything Everywhere" (links to its own language's home), an
   EN | FR toggle (two links, current one `aria-current="page"`), and a **Sign in** link.
2. **Hero.** `h1`, one sentence of sub-copy, primary button **Sign in** and secondary link
   **Have an invite? Create an account**. A one-line note that it is invite-only. (Purpose,
   clarified 2026-10-04: the page is a guide for family and friends Alex invites, not a pitch.
   The app is not free yet: never say "free" or give a price. No personal names.)
   The dashboard screenshot sits beside the text on wide screens and below it on phones.
   This is the LCP image: `fetchpriority="high"`, not lazy.
3. **Getting started** (`#getting-started`): an `<ol>` of eight steps from invite link to a
   useful first week, each naming the app's own labels in bold. **Tips** (`#tips`): seven
   habits. Then a short **What's inside** heading and
   **four sections**, each with an `h2`, a one-sentence lead, a 3–5 item feature list
   (short noun phrase + one plain sentence each), and at most one screenshot.
   Order: Money → Home → You → Everywhere.
4. **Your data, your server.** Three facts: no ads or trackers; hosted in Germany;
   open source (MIT) so anyone can run their own. Links: GitHub, privacy page.
5. **Closing CTA.** Repeat of the two hero actions.
6. **Footer.** Privacy · Source on GitHub · language toggle · "© year" built at build time.

### 2.2 Voice

Matches the app: plain, concrete, second person, no superlatives, and no "AI" or
"revolutionary". Every sentence describes what someone can do today. French is
written as French, not translated word for word, and uses "vous". Feature names match
the app's own labels in each language (for example Stock, Habits, Plan). Builders read
the labels from `frontend/src/i18n/messages/*.ts`.

### 2.3 Responsive and accessibility

- Mobile first. One column below 720 px; hero and section media go two-column at ≥ 720 px.
  Max content width 1080 px. There is no horizontal scroll at 320 px in either language.
- One `h1`. Landmarks: `header`, `main`, `footer`, plus `nav` for the toggle. A skip link
  to `main`.
- Every image has `alt` in the page's language, plus `width` and `height` attributes so
  there is no layout shift.
- Tap targets are ≥ 44 px. `:focus-visible` is inherited from the token styles. Respect
  `prefers-reduced-motion` (there is no motion beyond hover colour).
- `<html lang="en|fr">`. The toggle link has `hreflang` and `lang`.

## 3. Feature inventory (what may be claimed)

Filled from a read-only code audit on 2026-10-03 and a live prod probe. Only §3.1 may
appear in copy. Module-gated features are described as optional ("switch off what you
don't use"): all nine modules are on for a new account; turning one off hides it.

### 3.1 May be claimed

**Money:**
- Record income and expenses with a category, an optional quantity and unit, and a shop
  (vendor).
- Search entries.
- Quick add from a bottom sheet on phones.
- Recurring entries that are proposed for you to confirm or skip.
- A monthly plan per category, with spent against planned.
- The budget month starts on a day you choose.
- Month, year and all-time totals.
- Unit-price and shop price comparison.
- Savings pots with goals and dates, deposits and withdrawals, and a proposed monthly
  amount. An expense can be paid from a pot.
- Grow: compare interest rates. This runs on the device; nothing is stored.
- CSV export of entries, savings, stock and books.
- USD or EUR.

**Home:**
- Stock: spaces and items with a restock level and a history chart.
- A shopping list built from what is low. Ticking an item restocks it and can record the
  expense in one step.
- Recipes with ingredients, steps and servings.
- Foods with kcal and macros. Log a meal and it shows on the calendar.

**You:**
- Habits with flexible schedules (times a week, weekdays, every N days, day of month,
  nth weekday), check-ins and a heatmap.
- A daily mood check-in with a note.
- Gym: exercises, routines, sessions, rest days, history and a strength chart. You can
  build a prompt from your own training data, paste it into the AI assistant of your
  choice, and import the plan it returns. The app itself calls no AI.
- Books with ratings, series, tags and quotes.
- Notes, typed or drawn with a finger.
- Streaks with points. Spend points on a freeze or a repair.
- Moon phase and moonrise, computed on the device.
- World clocks.

**Everywhere:**
- Install it on a phone or computer (`/install` guide).
- Entries, gym sessions and notes made offline are sent later.
- A calendar view with layers.
- A private subscribe link for Google, Apple or Outlook calendars.
- Add a single item to a calendar.
- English and French.
- Five themes (light, dark, OLED black, high contrast, sepia) and nine accents.
- Switch modules off, and arrange the tabs separately for phone and desktop.
- A guided tour.

**Getting started and tips (2026-10-04; labels are the app's own, from `i18n/messages/`):**
- The invite link opens sign-up with the invite code filled in (AD-54); the form asks Email,
  Password (10+ characters), Invite code, Currency; the currency locks once the account has data.
- `/install` works signed out. The tour opens on first sign-in and replays from Settings.
- Settings: Account currency, Budget month (Starts on day), Password and recovery (Generate
  codes, self-service), Calendar apps (subscribe link), Export (Entries, Savings, Stock CSV),
  Layout (Sections you use). On a phone, More → "Change what's in the bar" opens Layout.
- The + button (Add an entry) opens quick add on a phone; Plan holds Recurring, Savings (goal
  amount, goal date) and Monthly budgets; Stock holds the Shopping list (Bought); Check in keeps
  a streak; points buy a freeze.

**Privacy facts (privacy page):**
- Accounts never see each other's data; the person who runs the server has technical access to
  the database (said on the home strip and the privacy page).
- No third-party requests: no analytics, no ads, no font CDN, and the CSP enforces
  `'self'`.
- Passwords are hashed with Argon2. Refresh tokens and calendar-feed tokens are stored
  only as hashes.
- Data is isolated per account by Postgres row-level security.
- The moon location stays on the device, rounded to about 10 km.
- Hosted by Hetzner in Germany.
- One cookie, `ee_app`. It holds no identity; it only tells the server to show the app
  instead of this page.
- Sign-in tokens live in the browser's storage.
- Export your data to CSV at any time.
- Open source (MIT): `https://github.com/Ar4gornn/everything-everywhere`. Contact via
  its issues.
- Account deletion: not claimed unless code proves it. The builder checks
  `backend/app/api/auth.py`. If no delete-account endpoint exists, the page says to ask
  via GitHub issues.

### 3.2 Must NOT be claimed (absent, partial, or off in prod)

- **Push notifications, daily digest, restock or habit reminders.** Prod answers
  `/api/push/key` 503 "not configured" (probed 2026-10-03).
- A weight-unit setting (no UI control).
- A year filter on Entries.
- A mood CSV (no button).
- Bank sync, shared or household accounts, native apps, anything "AI-powered".
- "Free", "gratuit" and any price: Alex never confirmed it, so it was removed in QA
  (2026-10-04). A test refuses the words. Add it to §3.1 only if he confirms it.
- Shared or household accounts: say each person has their own account.
- Anything about what the server logs hold beyond "can include" the source address
  (uvicorn access logs, rotated 10 MB × 5; Caddy writes none).

## 4. Architecture — AD-66

Full text is in `docs/architecture.md` (AD-66). In short:

- **Build.** `vite.config.ts` gets `build.rollupOptions.input` with five HTML entries:
  `index.html` (the app, unchanged), `landing.html`, `fr/index.html`, `privacy/index.html`,
  and `fr/privacy/index.html`. The four landing stubs contain only
  `<!-- landing:<lang>:<page> -->`. The plugin `landingPages()` from
  `frontend/landing/vitePlugin.ts` replaces the stub with `renderPage(lang, page)` in a
  `transformIndexHtml` hook with `order: "pre"`, so Vite still hashes the script, the
  stylesheet and the images the rendered HTML references. In dev the same plugin serves
  `/landing.html`, `/fr/` and `/privacy/`.
- **No app code on the landing.** `frontend/landing/` may import from `frontend/src/` only
  in these cases: `i18n/catalogue.ts`, for the `Lang` and `Entry` types, and `tokens.css`.
  A test enforces this. The landing JS is under 10 KB gzip and never imports react.
- **Tokens.** The theme and accent blocks at the top of `src/styles.css` move verbatim into
  `src/tokens.css`. `styles.css` starts with `@import "./tokens.css";`, and `landing.css`
  does the same. `theme.test.tsx` reads both files, and the computed pair count is unchanged.
- **Routing (Caddy).** A matcher sends `/` with no `ee_app=1` cookie and an empty query to
  `/landing.html`. Every landing response gets `X-EE-Page: landing` and
  `Cache-Control: no-cache`. CSP is unchanged: the landing has no inline script, no inline
  style and no `style=` attributes.
- **Marker cookie.** `frontend/src/session/marker.ts` sets
  `ee_app=1; Path=/; Max-Age=34560000; SameSite=Lax` (+ `; Secure` on https) whenever a
  refresh token is stored, and on app boot if one already exists. That boot step migrates
  everyone signed in today. It clears the cookie in `clearTokens()`. The cookie carries no
  authority. A forged one shows the sign-in page; a missing one shows the landing once.
- **PWA identity.** The manifest gets `"id": "/"`, which equals today's implicit id, so
  installed apps keep their identity. `start_url` becomes `/?pwa=1`, so a launch never
  meets the landing, even in iOS's separate standalone cookie jar. The manifest link moves
  to `?v=3`.
- **Service worker.** A navigation response is stored as the app shell only if
  `response.ok`, it is not opaque, and it has no `X-EE-Page` header. Today every
  navigation response is cached as `/index.html`, so one visit to the landing would make
  the installed app open offline onto the marketing page.
- **`/signin`.** The app's signed-out branch already renders `SignInPage` on any path.
  Signed in, the existing `*` → `/` fallback already covers `/signin` (an explicit route was built and removed in review: redundant, untestable). `SignInPage` reads
  `?mode=register` once, opens the register form and strips the parameter, the same way it
  handles `?invite=` (AD-54).

## 5. Fixed contracts (builders run in parallel against these)

```ts
// frontend/landing/messages.ts
import type { Entry } from "../src/i18n/catalogue";
export const landing = { /* key: { en, fr } */ } satisfies Record<string, Entry>;
export type LandingKey = keyof typeof landing;

// frontend/landing/render.ts
import type { Lang } from "../src/i18n/catalogue";
export type Page = "home" | "privacy";
export const ORIGIN = "https://everything-everywhere.app";
export function pagePath(lang: Lang, page: Page): string; // "/", "/fr/", "/privacy/", "/fr/privacy/"
export function renderPage(lang: Lang, page: Page): string; // full <!doctype html> document

// frontend/landing/vitePlugin.ts
import type { Plugin } from "vite";
export function landingPages(): Plugin;

// frontend/src/session/marker.ts
export const MARKER_COOKIE = "ee_app";
export function setMarker(): void;
export function clearMarker(): void;
```

- Landing assets: `frontend/landing/landing.ts` (module script), `frontend/landing/landing.css`,
  images `frontend/landing/img/<lang>-<shot>.webp` with
  `shot ∈ dashboard | plan | stock | habits` (780×1688, 2× of 390×844), and
  `frontend/public/og-<lang>.png` (1200×630).
- Caddy header name `X-EE-Page`, value `landing`. The SW checks only that the header is
  present.
- `renderPage` references images through a single `img(lang, shot)` helper, so 53.5 can
  land images without touching copy.

## 6. Stories

Waves: **A** = 53.1 ∥ 53.2 ∥ 53.3 (disjoint files) → **B** = 53.4 → **C** = 53.5 → **D** = 53.6 QA.
Builders do not commit. Opus reviews each story and commits it.

### 53.1 Foundation: tokens split, multi-page build, renderer skeleton

- Move the token and theme blocks (`:root` … last `[data-accent]` rule) from `styles.css`
  into `src/tokens.css` verbatim. `styles.css` begins with `@import "./tokens.css";`.
  `theme.test.tsx` reads `tokens.css` + `styles.css`. Every existing assertion is unchanged
  and still green.
- `frontend/landing/{messages.ts,render.ts,vitePlugin.ts,landing.ts,landing.css}` per §5.
  Copy is placeholder-only (one hero key). The four stub HTML entries are added.
  `vite.config.ts` gets the inputs and the plugin.
- `npm run build` emits `dist/index.html` (app, byte-for-byte the same template as before
  apart from asset hashes), `dist/landing.html`, `dist/fr/index.html`,
  `dist/privacy/index.html` and `dist/fr/privacy/index.html`.
- **Tests (`landing/landing.test.ts`):**
  - `renderPage` output for all 4 (lang, page) pairs has `lang`, one `h1`, a canonical,
    hreflang alternates for en, fr and x-default, `og:title`, `og:description`, `og:image`,
    `og:url` and `og:locale`, and no `<script>` without `src`, no `style=` and no `<style>`.
  - An import-boundary test fails if any file under `landing/` imports from `../src/`
    other than `i18n/catalogue` and `tokens.css`, or imports `react`.

### 53.2 App side: marker cookie, /signin, manifest, service worker

- `src/session/marker.ts`. Wire it in `api/client.ts`: call `setMarker()` where the
  refresh token is stored and `clearMarker()` in `clearTokens()`. Call `setMarker()` on
  boot when a refresh token exists.
- `App.tsx`: no change; the `*` fallback covers signed-in `/signin`.
  `SignInPage` reads `?mode=register` once (like `takeInviteFromUrl`) and strips it.
- `public/manifest.webmanifest`: `"id": "/"`, `"start_url": "/?pwa=1"`. In `index.html`,
  `manifest.webmanifest?v=3`.
- `public/sw.js`: the navigation cache rule from §4. Add a comment that names the reason.
- **Tests:**
  - marker set on sign-in and register, cleared on sign-out and on a failed refresh, set on
    boot with a stored token;
  - `Secure` added only on https;
  - `?mode=register` opens register and is stripped; `?invite=` still wins;
  - manifest has `id` "/" and `start_url` "/?pwa=1";
  - sw: a landing-marked response is not cached, an ok app response is cached, a 404 is
    not cached. Existing sw tests stay green. Find them with `grep -rl "sw.js" src`.

### 53.3 Caddy routing, headers, robots, sitemap

- `ops/Caddyfile`:
  - a `@landing` matcher (path `/`, no `ee_app=1` cookie, empty query) → rewrite to
    `/landing.html`;
  - `X-EE-Page: landing` and `Cache-Control: no-cache` on `/`-landing, `/fr/*`, `/privacy/*`
    and `/landing.html`;
  - `/fr`, `/privacy` and `/fr/privacy` (without the trailing slash) redirect 308 to the
    slash form.
  - Order relative to `handle /api/*` and `/health` is preserved. The SPA fallback is
    unchanged for every other path.
- `frontend/public/robots.txt` (allow `/`, `/fr/`, `/privacy/` and `/fr/privacy/`; disallow
  everything else is **not** wanted, since app paths are just SPA shells; list the sitemap)
  and `frontend/public/sitemap.xml` (4 URLs with `xhtml:link` alternates).
- **Proof, not reading:**
  - Run the prod stack locally:
    `docker compose -p ee-landing-verify -f docker-compose.prod.yml -f ops/compose.verify.yml up -d --build`
    on :8080. **Check `docker compose ls` first; never touch another project's stack.**
  - Run a curl matrix and record it in the story notes:

    | Request | Expected |
    |---|---|
    | `/` without cookie | landing + header |
    | `/` with `Cookie: ee_app=1` | app shell, no header |
    | `/?invite=x` | app |
    | `/?pwa=1` | app |
    | `/fr/` | FR landing |
    | `/fr` | 308 |
    | `/privacy/` | privacy page |
    | `/entries` | app |
    | `/health` | API |
    | `/api/auth/me` | 401 JSON |
    | `/robots.txt`, `/sitemap.xml` | 200 |
    | `/sw.js` | `no-store` |

  - Check the CSP header on `/`.
  - Then `down` (not `-v` unless the stack is yours and empty).

### 53.4 Content: copy, layout, privacy page, language toggle, meta

- All copy lives in `landing/messages.ts` (`{ en, fr }`), from §3.1 only. The privacy page
  copy comes from §3.1's data answers.
- `render.ts` builds the full IA of §2.1. `landing.css` sets the layout of §2.3. Every
  `color:` / `background:` names a token that `theme.test.tsx` checks for text contrast
  (`TEXT_PAIRS`). There are no literal colours.
- `landing.ts` (≤ 1.5 KB):
  - On `/` only, with no stored choice and `navigator.language` starting with `fr`, it does
    `location.replace("/fr/")`.
  - A click on the toggle stores `everything-everywhere.landing-lang`.
  - Nothing else. The page works fully without JS.
- Fonts: Lato 400 and 700, latin only. Preload the 400 woff2.
- **Tests:**
  - every key has non-empty `en` and `fr`;
  - no sentence-length entry (> 3 words) is byte-identical across languages;
  - no unused key (each key referenced in `render.ts`);
  - rendered EN contains no FR entry text and vice versa;
  - every `<img>` has alt, width and height.

### 53.5 Screenshots and OG images

- `ops/landing-shots/capture.mjs` uses Node 22 with the built-in `WebSocket` and Chrome
  DevTools Protocol, so there is no dependency. It does the following:
  1. Launches `chrome.exe --headless=new --remote-debugging-port=<free>` with a temp
     profile.
  2. Against a verify API (`VERIFY_STATIC` dist), registers or logs in a fixture account
     through the API.
  3. Seeds habits, check-ins, mood and plan via API calls on top of `backend/seed.py`
     (`ALLOW_SEED=1`), which seeds entries, stock and savings.
  4. Injects the tokens into localStorage and sets the language preference.
  5. At 390×844 with DPR 2 and the light theme, captures the shots in §5 as WebP (CDP
     `Page.captureScreenshot` `format: "webp"`), EN and FR.
  6. Renders `ops/landing-shots/og.html` at 1200×630 into `public/og-<lang>.png`.
- A README in the same folder gives the exact commands.
- Every shot is seeded demo data. No real account, no real email address in frame (fixture
  `demo@example.com`).
- Each image is ≤ 120 KB, and the total images on first load are ≤ 400 KB.

### 53.6 QA (a separate Sonnet agent, then an Opus review)

See §7. The QA agent fixes nothing; it reports.

## 7. Test design (bmad-testarch-test-design, condensed)

| Risk | Score (P×I) | Mitigation / proof |
|---|---|---|
| Signed-in user or installed PWA lands on marketing page | 3×3 | marker on boot; `start_url ?pwa=1`; curl matrix; Browser: sign in → reload `/` → dashboard |
| Invite link swallowed by landing | 2×3 | any query → app; curl `/?invite=x`; RTL invite test unchanged |
| SW caches landing as app shell → offline app opens marketing page | 3×3 | header-gated cache; sw unit test **mutated red**; Browser: visit landing, go offline, launch `/?pwa=1` → app shell |
| PWA identity change on start_url edit | 2×3 | `id: "/"`; manifest test |
| Claim in copy not backed by code | 2×2 | §3.1 inventory; reviewer checks each list item against it |
| CSP blocks landing asset / inline | 2×2 | render test (no inline); prod-stack console clean |
| Token split breaks app theming | 2×3 | theme.test pair count unchanged; app 5 themes screenshot spot-check |
| Landing pulls app bundle | 2×2 | build-output test: landing HTML references no `index-*.js`; network panel on landing |
| FR overflow / clipped text | 3×1 | sweep EN+FR × 320/375: viewport, left edge, card edge, `scrollWidth > clientWidth` |
| Contrast in dark/oled/hc/sepia | 2×2 | only `TEXT_PAIRS` tokens; screenshots in all 5 themes |

**Gates.**
- `npm run lint`.
- `npm test`: exit code 0 **and** `grep -c Unhandled` = 0.
- `npm run build`.
- Backend pytest. No backend change is expected; it is run to prove no regression.
- Every new guard is mutated red once: SW cache rule, marker clear, import boundary,
  query passthrough (Caddy, via curl).

**Browser checks (verify stack and the prod stack on :8080).**
- Signed out: `/` → landing, then Sign in → app.
- Signed in: `/` → dashboard, `/entries` deep link, `/fr/` → FR landing.
- Before measuring, unregister the SW and clear caches; check the `index-*.js` hash.
- Meta and OG tags are present in the served HTML (curl, not the DOM).
- LCP image is eager; no app chunk in the landing's network list.

## 8. Traps already paid for (read before building)

- The CSP has no `'unsafe-inline'`: no inline script, no `style=`, no `<style>`.
- `theme.js` is cached by the SW cache-first. If it changes, bump `?v=` in **both**
  `index.html` and the landing template. (This epic should not need to change it.)
- `Write` emits CRLF. The Caddyfile is LF-sensitive? No, but `.sh` files are; check
  `.gitattributes` for anything new.
- `npm run lint`, never `npx biome check`.
- A vitest run fails on unhandled errors even with every test passing.
- Overflow sweeps must check the left edge, the card edge and `scrollWidth` vs `clientWidth`.
- A hidden Browser pane does not paint. Take a screenshot before measuring after a scroll
  or resize.
- The SW serves the previous build after a rebuild. Unregister it and clear caches.
- The Browser pane refuses `127.0.0.1`. Use `localhost:<port>` with a same-origin dist
  (`VITE_API_BASE_URL=` empty).
- Never `git checkout -- <file>` to undo a mutation. Restore the saved bytes and assert.

## 9. Outcome (2026-10-04) and follow-ups

Built in waves A–C by Sonnet builders. A separate Sonnet agent ran QA on the local prod
stack: verdict ship-with-fixes, no high findings. Fixes are in `2f58ae4`.

Deliberately not done; candidates for a later story:
- `Vary: Cookie` on `/`. It only matters behind a CDN or shared cache, and there is none
  today.
- Strip `?pwa=1` from the URL after launch. Cosmetic; only `mood` is stripped.
- Carry the language chosen on the landing into the app's sign-in page.
- Any query on `/` (for example `?utm_source=`) shows the app. This is by design (AD-66).
- At 375 px the header's Sign in wraps under the wordmark. No overflow; cosmetic.
- The screenshots are light-theme only, so they look pale on dark themes.
- A delete-account endpoint. Until it exists, the privacy page says to ask via GitHub.
