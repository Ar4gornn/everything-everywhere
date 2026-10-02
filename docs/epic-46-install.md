# Epic 46: Install the app — the best guide we can give, one tap where the browser allows it

**Status:** Scoped 2026-10-03, building on `feat/install` (worktree `ee-quickadd`, from `bc27812`)
**New decision record:** AD-62
**Migration:** none. Frontend only (+ manifest and `index.html`).

---

## 1. Scope (locked in the interview, 2026-10-02/03)

Facts checked before scoping (sources in the LOG entry):
- **iPhone has no install API.** Since iOS 26 every site added to the Home Screen opens as a web
  app by default; the path is Share → "Add to Home Screen" → keep **"Open as Web App"** on → Add.
  Since iOS 16.4 Chrome/Edge/Firefox on iPhone can do it from their own share menu. Before 26,
  there is no toggle.
- **Android Chrome / Edge / Samsung Internet** fire `beforeinstallprompt`: our button can open the
  browser's own install dialog. A tap is always required. Firefox Android: no event, menu only.
- **Samsung Internet** may fail silently to install a manifest whose `share_target` uses POST —
  ours does (Gym import, Epic 42).

| Question | Chosen | Rejected |
|---|---|---|
| Where | **Public `/install` page (works signed out) + an in-app card** | in-app only; Settings only |
| Android | **One-tap Install button via the browser's prompt; illustrated menu steps where no prompt** | auto-open (browsers refuse without a tap) |
| When | **After the first saved entry / check-in, a consent question first** ("Want help installing the app on this phone?") — Yes unlocks the card + tour step; No: never unprompted again on this device | from the first visit; tour only |
| Visuals | **Drawn SVG diagrams, light/dark, EN/FR** | real screenshots; text only |
| After install | **First installed launch: "Installed" welcome + turn on notifications (once per device)** | welcome only; nothing |
| Samsung | **Detect it, steer to Chrome** (keep Gym's share target) | drop the share target; ignore |
| Icon name | **EEwhere** (iPhone `apple-mobile-web-app-title`, manifest `short_name`) | Everywhere; Everything; EE |
| Extras | **Desktop Chrome/Edge button + desktop steps; Settings entry; install step in the guided tour on phones** | — |

### Explicitly out
Installing without a tap; app-store packaging (TWA, Capacitor); real screenshots; dropping the
share target; nagging after a "No".

---

## 2. AD-62 — Installing is offered, never pushed; the browser's own dialog where it exists, our diagrams where it does not

**Binds:** `src/install/*`, `InstallPage`, the dashboard, Settings, the tour, `main.tsx`,
`manifest.webmanifest`, `index.html`.

1. **Capture early.** `beforeinstallprompt` fires once, early, and is lost if nobody listens.
   `install/prompt.ts` registers its listener at module load from `main.tsx` (before React),
   calls `preventDefault()` (no mini-infobar: we offer it at a better moment), and keeps the
   event. `appinstalled` marks the device installed. `useInstallPrompt()` exposes
   `{ canPrompt, prompt() }`; `prompt()` resolves `"accepted" | "dismissed" | "unavailable"` and
   the event is single-use (cleared after `prompt()`).
2. **Detect, don't assume.** `install/platform.ts` turns `navigator.userAgent` +
   `maxTouchPoints` into `{ os: "ios" | "android" | "desktop", browser: "safari" | "chrome" |
   "edge" | "firefox" | "samsung" | "other", iosMajor: number | null }`. iPadOS reports a Mac UA:
   Mac + `maxTouchPoints > 1` = iOS. Pure function, table-tested against real UA strings.
3. **Consent before offering (device-level).** `install/consent.ts` keeps, per device (not per
   account: installing is about the phone), `everything-everywhere.install.{consent,dismissedAt,
   welcomed}`. `consent`: unset → the question may be asked; `"yes"` → card/tour step allowed;
   `"no"` → nothing unprompted, ever (Settings + `/install` still work). The card's dismiss hides it
   30 days (`dismissedAt`). Every read/write in try/catch (blocked storage = treat as unset, never
   crash, never loop the question).
4. **When the question appears.** Phone layout, not installed, consent unset, and the account has
   at least one entry or one habit check-in — read from data the dashboard already loads (no new
   request). It is a small dashboard card with two buttons. If the guided tour is running on a
   phone, its last numbered step is the same question (answering it there sets `consent`).
5. **`/install` is public.** Rendered before the sign-in gate when the path is `/install`, inside
   the language provider (the page has the language switch the sign-in page has). Signed in, it is
   also a normal route. It shows the steps for the detected platform first, a switcher for the
   others (iPhone · Android · Computer), and "Already installed" when `isInstalled()`.
6. **First installed launch.** When `isInstalled()` and `welcomed` is unset and a user is signed
   in: a dashboard card "EEwhere is installed" + a button that runs the existing `enablePush()`
   flow when push is supported and offered by the server (else just the note); `welcomed` is set on
   first render so it shows once.
7. **Name.** `short_name` and `apple-mobile-web-app-title` = `EEwhere`. `name` stays
   "Everything Everywhere". `?v=` bumps where the worker caches.

**Consequences.** No install API on iOS means the iPhone guide is the product there: it must
match iOS 26 exactly and still help on iOS 16.4–18 (no "Open as Web App" toggle; Safari's share
button is in the bottom bar). A device answer of "No" also hides the tour step for any later
account on that device — chosen: the answer is about the device.

---

## 3. The `/install` page

Sections per platform, each a numbered list of 3-4 steps, every step one short sentence + one SVG
diagram (inline React SVG components in `install/diagrams/`, `currentColor` + theme tokens, so
light/dark/OLED/high-contrast all work; text inside diagrams is rendered from `t()`, not baked):

- **iPhone · Safari (iOS 26+):** ⋯ / Share → "Add to Home Screen" → "Open as Web App" on → Add.
- **iPhone · Safari (iOS 16.4–18):** Share (bottom bar) → "Add to Home Screen" → Add.
- **iPhone · Chrome/Edge/Firefox:** Share (address bar) → "Add to Home Screen" → (toggle on iOS 26) → Add.
- **Android · Chrome/Edge:** **Install** button (one tap) → confirm. Fallback steps: ⋮ menu → "Install app" (or "Add to Home screen") → Install.
- **Android · Samsung Internet:** note: "For the full app, open this page in Chrome" + a copy-link button; then the Chrome steps.
- **Android · Firefox:** ⋮ → "Install" (or "Add to Home screen") → Add.
- **Computer · Chrome/Edge:** **Install** button, or the install icon in the address bar. Safari on Mac (Sonoma+): File → Add to Dock. Firefox desktop: not supported — say so.
- Under the steps: "Why install?" (full screen, opens offline, notifications on iPhone need it).

## 4. Builders (parallel, disjoint files)

| Builder | Owns | Must not touch |
|---|---|---|
| **A — detection + prompt + consent** | `install/platform.ts`, `install/prompt.ts`, `install/consent.ts` (fill), their tests, `main.tsx` (import the prompt module first), manifest `short_name`, `index.html` title | pages, components, CSS |
| **B — `/install` page + diagrams** | `pages/InstallPage.tsx`, `install/diagrams/*`, `i18n/messages/installGuide.ts`, page CSS (marked block), its tests | `install/*.ts` internals, App, dashboard, tour |
| **C — wiring** | `App.tsx` (public `/install` + route), `components/InstallOffer.tsx` (consent question + card), `components/InstalledWelcome.tsx`, `DashboardPage.tsx`, `SettingsPage.tsx`, tour step in `useTutorial.tsx`/`TutorialModal.tsx`, their tests, card CSS | `install/*.ts` internals, `InstallPage.tsx`, diagrams |

Contracts (skeleton): `install/*.ts` signatures, `i18n/messages/install.ts` (card, consent,
welcome, Settings, tour keys), `InstallPage` default export, the manifest name.

## 5. Done means
UA table tests (≥ 12 real UAs incl. iPadOS, Samsung, Firefox Android, Edge iOS); prompt capture
before React and single use; consent states incl. blocked storage; card/question/welcome rules;
public `/install` signed out in FR; full vitest exit 0 + 0 Unhandled; lint; tsc; browser:
`/install` signed out at 375/320 EN/FR, each platform tab, light + dark, no overflow; the
`beforeinstallprompt` path simulated with a dispatched event; welcome in a `display-mode:
standalone` emulation if the tool allows, else proven by tests.
