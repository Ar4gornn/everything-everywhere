# Epic 44: Quick add — recording an entry from anywhere on a phone

**Status:** Scoped 2026-10-02, building on `feat/quick-add` (worktree `ee-quickadd`, from `c9cfb2d`)
**New decision record:** AD-60 (a phone bottom sheet, the app's first modal, is how an entry is added)
**Migration:** none. One new read endpoint.
**Process:** Opus skeleton → 3 Sonnet builders in parallel → separate Sonnet QA → Opus final review → browser sweep.

---

## 1. Scope (locked in the interview, 2026-10-02)

Recording a transaction is the loop people repeat most. On `main` a phone's `+` navigates to
`/entries?add=1`: the whole Entries page loads (its list included), then a nine-field form
with a `<select>` for the kind and a free-text category box. Audit item "entry friction"
(2026-09-27) was never addressed.

| Question | Chosen | Rejected |
|---|---|---|
| Where | **Bottom sheet over the current page; `+` on every phone route** | sheet on the 4 current routes only; keep `/entries?add=1` with a slimmer form |
| Category chips | **Top 8 by use over 90 days, recency breaks ties; one set per kind; padded with unused categories; "Other…" = today's text box** | chips pinned in Settings (new setting); last 8 used (one-off purchases push daily ones out) |
| Repeat | **3 most recent distinct category + vendor + amount combos per kind; a tap fills, Save still needed** | one-tap save (an accidental tap records money); none |
| Vendor | **A known vendor fills its last category only when no category is chosen yet (then that category's default pot)** | a suggestion chip needing a tap; no vendor logic |
| Data | **New `GET /api/entries/quick-picks`, SQL, under RLS** | 90 days of entries fetched to the phone; endpoint + localStorage cache (left for the offline slice) |
| After save | **Close + "Saved · Undo" toast; second button "Save & add another" keeps date + kind, clears the rest** | close + undo only; no undo |
| Desktop | **Phone only (`useLayout() === "phone"`)** | desktop panel + `N` shortcut |
| Entries page form | **Phone: replaced by a button opening the sheet; desktop unchanged** | keep both forms on a phone |

### Explicitly out

Offline entries (next slice: Gym's AD-58 outbox), desktop sheet, keyboard shortcut, pinned
chips, one-tap save from a combo, amount arithmetic (`12+3`), templates, natural-language
parsing, receipt photo, bank CSV, PWA manifest shortcut, notification action, a remembered
draft across close/reopen.

---

## 2. AD-60 — On a phone, an entry is added in a bottom sheet; this is the app's first modal

**Context.** `MoodCheckin.tsx` records why the app had no modal: a popup is new machinery
(focus trap, scroll lock, `aria-modal`, inert background) and a centred-dialog/bottom-sheet
fork between widths. Both objections are answered here, not waived:

- **The machinery is the browser's.** The sheet is a native `<dialog>` opened with
  `showModal()`: the top layer, the inert background, Escape and focus containment are the
  platform's, not code of ours to keep right. (Gym's help popup made the same call on
  2026-10-02 before the tour replaced it.)
- **There is no fork.** The sheet exists only when `useLayout()` is `phone`. Desktop keeps the
  inline Entries form, one click away, unchanged.

**Why a modal at all.** A disclosure in the flow (the MoodCheckin shape) would sit wherever the
`+` was pressed, under whatever page is there, and could scroll away from the keyboard. The
point of this epic is that adding is the same three taps from every page; that needs a surface
that is the same everywhere, i.e. one above the page.

**Decision.**
1. One `QuickAddProvider` (inside the router and `ToastProvider`) owns the sheet. `open({ date? })`
   from anywhere; the sheet is mounted once, in `App`.
2. `?add=1` (optionally `&date=YYYY-MM-DD`) **on any route, on a phone**, opens the sheet and is
   then stripped from the URL. That keeps every existing deep link working without edits: the
   calendar's "add on this day", the category page's "Add an entry", and the tour's `entry`
   step (`/entries?add=1`, target `record-form` — the sheet's form carries `data-tour="record-form"`).
   On desktop `?add=1` keeps today's behaviour (EntriesPage focuses its amount field).
3. A write through the sheet bumps `version` in the provider. Pages that show entries
   (Dashboard, Entries, Category, Calendar) list `version` in their `useLoad` dependencies, so
   the page behind refreshes after a save or an undo. No event bus, no global store.
4. Undo deletes the created entry (`DELETE /api/entries/{id}`) — the server stays the source of
   truth, exactly as the Toast's own doc comment describes for deletes.
5. The sheet calls `tour.notify("entry-created")` after a save, as EntriesPage does.

**Consequences.** One new accessibility surface to verify (focus lands on the amount on open,
returns to the `+` on close, Escape closes). jsdom has no `showModal`: tests stub it once in
`test/setup.ts`.

---

## 3. The endpoint

`GET /api/entries/quick-picks` → `QuickPicksOut` (schema in `backend/app/schemas/quick_picks.py`).

```
{
  "expense": { "categories": [CategoryPick ≤ 8], "combos": [Combo ≤ 3] },
  "income":  { "categories": [CategoryPick ≤ 8], "combos": [Combo ≤ 3] },
  "vendors": [VendorPick ≤ 200]
}
```

- **Window:** `occurred_on >= today - 90 days` and `occurred_on <= today`, where `today` is the
  account's local date from `core/clock.local_today(users.timezone, now)` with `Now` injected
  (tests override `get_now`; never `date.today()` — see the 2026-10-01 lab note).
- **categories (per kind):** categories of that kind with ≥1 entry in the window, ordered by
  entry count desc, then latest `occurred_on` desc, then latest `entries.created_at` desc, then
  `lower(name)`, `id`. If fewer than 8, padded with that kind's remaining categories (no use in
  the window) by `categories.created_at` desc, `id`. `uses` = count in window (0 for padding).
  Carries `default_savings_type_id` (expense; null for income).
- **combos (per kind):** distinct `(category_id, vendor_id, amount)` in the window (vendor may be
  null), ordered by the group's latest `occurred_on` desc, then latest `created_at` desc; first 3.
- **vendors:** for each vendor with at least one entry (**all time**, not the window), the most
  recent entry's `kind`, `category_id`, category `name` — "most recent" = `occurred_on` desc,
  `created_at` desc, `id` desc (`DISTINCT ON (vendor_id)`). Ordered by that entry's recency;
  first 200.
- Every query carries an explicit `user_id` filter in addition to RLS (AD-1 defence in depth).
- SQL aggregates only (AD-9). No migration; reads `entries`, `categories`, `vendors`.
- Route order: `/quick-picks` is a GET; `entries.py` has no `GET /{entry_id}`, so no clash —
  but register it above the `/{entry_id}` routes anyway.

---

## 4. The sheet (phone)

Top to bottom inside `<dialog class="sheet" data-tour="record-form">`:

1. Header: title "Add an entry", ✕ close button.
2. **Kind toggle:** two buttons, `aria-pressed`, Expense first and default. Switching kind clears
   a category of the other kind, the pot, and (for income) the quantity section.
3. **Amount:** one large `inputMode="decimal"` field, focused on open, `aria-label` with the
   currency. Accepts a decimal comma (`normalizeMoney`).
4. **Repeat chips** (this kind's combos): label `Category · Vendor · amount` (vendor dropped when
   null). Tap → sets category name, vendor name, amount, and the category's default pot. Date
   and kind untouched. Not saved.
5. **Category chips** (this kind's picks) + **"Other…"**: a chip tap selects it
   (`aria-pressed`); "Other…" reveals the text box with the `datalist` of all categories of the
   kind — today's behaviour, new names still create a category (AD-12).
6. **Date chips:** Today / Yesterday / a date input (the third shows the chosen date when it
   is neither). Defaults to the `date` passed to `open()`, else today (`todayIso()`).
7. **Paid from line** (expense, when a pot is set): "Paid from {pot}" visible *outside* More,
   so a default pot is never applied unseen.
8. **More** (disclosure, closed by default): vendor (datalist of all vendors; auto-fill rule
   below), note, paid-from select, quantity / unit / unit price with the same three-way solve and
   remembered unit as EntriesPage (`quantity.ts`, `recallUnit`/`rememberUnit`).
9. Buttons: **Save** (primary) and **Save & add another**. Validation messages inline, reusing
   `entries.badAmount`, `entries.badQuantity`, `entries.needUnit`, `entries.couldNotSave`.

**Vendor auto-fill:** when the vendor text matches a `VendorPick` case-insensitively (trimmed)
whose `kind` equals the current kind, **and** no category is chosen yet, set the category to
that pick's name and the pot to its default (expense). Never overwrites a chosen category.

**After Save:** close, `toast.show(t("quickAdd.saved"), { onUndo })`, bump `version`, notify the
tour. **Save & add another:** same toast and bump, sheet stays open; amount, note, vendor,
category, pot and quantity cleared; kind and date kept; focus back on the amount.

**Data on open:** `Promise.all([quickPicks, listCategories, listVendors, savingsOverview().pots])`,
re-fetched on every open (picks change after each save). Chips render when their part arrives;
a failure shows `ErrorBanner` inside the sheet but leaves the plain fields usable.

**The `+`:** rendered on every route on a phone except where a page owns the bottom of the
screen: `/gym` and below (session bar, rest bar), and `/notes/` editor routes. Hidden while the
sheet is open. Tap → `open()`.

**Entries page on a phone:** the `record-form` Card is replaced by a full-width button
"Add an entry" that calls `open()`. Desktop renders the existing Card unchanged.

---

## 5. Builders (parallel, one worktree, disjoint files)

| Builder | Owns | Must not touch |
|---|---|---|
| **A — backend** | `services/quick_picks.py` (fill), `tests/test_quick_picks.py`, `tests/test_isolation_quick_picks.py` | any frontend file, any migration, other services |
| **B — sheet** | `components/QuickAdd/QuickAddSheet.tsx` (fill), `components/QuickAdd/picks.ts` (fill), `QuickAddSheet.test.tsx`, `picks.test.ts`, sheet CSS block in `styles.css` (marked section) | `App.tsx`, pages, `QuickAddContext.tsx` contract, backend |
| **C — wiring** | `App.tsx` (provider, `+`, `?add=1`), `EntriesPage.tsx` (phone button), Dashboard/Entries/Category/Calendar `version` deps, `test/setup.ts` (`showModal` stub), `App.test.tsx`/page tests, `.fab` CSS | `QuickAddSheet.tsx` internals, backend |

Contract files are written by the skeleton and change only with a note in the commit body:
`schemas/quick_picks.py`, the route in `api/entries.py`, `api/types.ts` (`QuickPicks*`),
`api/client.ts` (`quickPicks`), `i18n/messages/quickAdd.ts`, `QuickAddContext.tsx`,
`picks.ts` signatures.

## 6. Done means

- Backend: `test_quick_picks.py` covers ranking, ties, padding, window edges (day 90 in, 91 out,
  a future-dated entry out), per-kind separation, combo distinctness with null vendor, vendor
  last-category, caps; second-user proof (B sees none of A's picks, through the API and the
  runtime role). Every guard mutated once and seen red.
- Frontend: red-first tests for each behaviour in §4; `npm run lint` exit 0; full vitest exit 0
  and `grep -c Unhandled` = 0.
- Browser (verify stack): `+` → sheet from Dashboard, Stock, Habits, Calendar day; repeat chip
  → Save → Undo; Save & add another ×2; vendor auto-fill; default pot line; tour entry step on a
  phone; EN + FR at 375 and 320, empty account and rich account, no overflow (card *and*
  viewport, both edges); keyboard does not hide the Save button at 375×667.
