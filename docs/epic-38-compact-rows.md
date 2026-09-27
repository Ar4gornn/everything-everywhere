# Epic 38: Compact list rows on phones — slice 1 (Dashboard + Entries)

**Status:** Scoped 2026-09-27, building on `feat/compact-rows`
**Depends on:** `fix/fr-phone-overflow` (`3bc3d3d`, `b6354a8`)
**New decision record:** AD-53 (phone lists are rows that expand, desktop keeps its tables)
**Migration:** none. No backend change.
**Numbering:** Epic 37 is reserved for deploying; AD-52 is Epic 36's, on its own branch.

---

## 1. Scope (locked in the interview, 2026-09-27)

The UX audit of 2026-09-27 found every phone list drawn as a stack of label/value blocks:
"CATEGORY / SPENT / BUDGET / LEFT" is ~130px per budget row, an entry ~170px with an empty
NOTE line and its own Edit/Delete. The dashboard was 3755px tall at 375px, Entries 2900px.

| Question | Chosen | Rejected |
|---|---|---|
| How | **A shared `ListRow`, rendered when `useLayout()` is `phone`; desktop keeps tables** | CSS-only restyle of `table.stacked` (cannot merge or reorder cells); lists at every width (loses columns on a wide screen) |
| Row actions | **Tap the row to expand it in place** | a "⋯" menu per row; swipe; buttons kept on the row |
| First slice | **Dashboard + Entries** | Dashboard only; all 17 stacked tables at once |
| Rows with inputs | **Later slice** (Shopping list, Plan, Stock steppers) | edit on expand; inline compacted |
| Category row | **Bar + spent / budget; 6-month trend on expand** | inline sparkline; bar only |
| Entries | **Grouped by day** | flat, date on every row |
| Dashboard order | **Unchanged** (audit item #3, later) | reorder now |
| Process | **This file + build + separate review** | full BMAD epic |

### Explicitly out

The other 12 stacked tables, quick-add (#4), navigation (#7), dashboard order (#3), swipe
gestures, any server change.

---

## 2. AD-53 — On a phone a list is rows that expand; a desktop keeps its table

- **Binds:** every phone list converted from `table.stacked`, starting with the dashboard's
  budgets, savings and categories and the Entries list.
- **Extends:** AD-49 (`useLayout()` is the one phone/desktop switch, the same 720px as CSS).
- **Prevents:** three failures.

  **A phone list you scroll through rather than read.** One row is one line of what it is
  and how much, plus an optional bar. Everything else — the note, the trend, the actions —
  is one tap away, in place, never on another page.

  **Two cards saying the same thing.** On a phone the budgets card carries the category's
  trend on expand, so "Expense by category" is not drawn while budgets is (month view). When
  budgets is hidden, or the period is not a month, categories draws as its own compact rows,
  so no figure disappears.

  **An expanding row that only a mouse can open.** The row's head is a real `<button>` with
  `aria-expanded` and `aria-controls`; one row is open per list; a row with nothing to show
  is not a button at all. A progress bar stays a `role="meter"` outside the button, since a
  button may only hold phrasing content.

- **Desktop is untouched.** The tables stay; a phone row is a second rendering of the same
  data from the same response, never a second request.
- **Editing an entry on a phone** reuses the desktop edit row inside the expanded row, so
  there is one edit form, not two.

---

## 3. Story 38.1 — Compact rows for Dashboard and Entries

**As** someone checking the month on a phone, **I want** one line per category and per
entry, **so that** the list fits on a screen or two instead of five.

### Acceptance criteria

1. On a phone (`(max-width: 720px)`), the dashboard's budgets card draws one row per
   category: name, spent on the right, a bar with "of {budget}" (or "No budget"). Over
   budget colours the amount and the bar.
2. Expanding a budget row shows what is left or how much it is over, the category's
   sparkline when the trends response has it, and "Open category →".
3. On a phone with the month period and the budgets card drawn, "Expense by category" is not
   drawn. Otherwise it draws compact rows (name, this month's amount; trend and link on
   expand).
4. Savings progress draws one static row per pot: name, saved, a bar with "of {target}" (or
   "No target"). Not a button.
5. On a phone the Entries list is grouped under day headings written in the account's
   language ("Mon 14 September" / "lun. 14 septembre"), newest first as served.
6. An entry row shows the category, a line of vendor · note · unit price where present, and
   the signed amount ("−" expense, "+" income in the income colour). A pot tag shows when the
   entry was paid from a pot.
7. Expanding an entry shows its note in full and Edit / Delete, with the same accessible
   names as the desktop buttons. Edit opens the existing edit form inside the row.
8. One row open per list. The row head is a `<button aria-expanded>`, reachable and
   operable by keyboard.
9. Desktop renders exactly what it did (existing tests unchanged and green).
10. At 320 and 375, English and French: nothing past the viewport or its card. Dashboard and
    Entries heights measured before and after, and recorded here.
11. The tour stops `budget-progress` and `entries-rows` still find their targets on a phone.

### Results (2026-09-27, seeded demo account, verify stack)

Page height, measured in a same-origin iframe at the given width:

| Page | 375 EN before | 375 EN after | 375 FR after | 320 FR after |
|---|---|---|---|---|
| Dashboard | 3751px | 2038px (−46%) | 2056px | 2139px |
| Entries | 2919px | 1520px (−48%) | 1538px | 1538px |

- One budget row: ~130px → 73px. One entry row: ~170px → ~44px (plus its day heading).
- Overflow sweep, Dashboard and Entries, 320 and 375, EN and FR, closed and with a row
  open, and the in-row edit form at 320 FR: nothing past the viewport or its card.
- Desktop (1280): three dashboard tables and the Entries table, no list rows.
- Tour targets `budget-progress` and `entries-rows` present on a phone.
- Tests: `ListRow.test.tsx` (4) and a phone block in each page test (5 + 3); vitest
  514/514. Five mutations each turned a new test red: categories repeated, many rows open,
  `aria-expanded` removed, Entries never phone, the sign dropped from an amount.
- Not addressed, noted in the audit: the floating buttons still cover the right edge of the
  last visible row (audit #5).

---

## 4. Story 38.2 — Phone rows for the remaining tables (scoped and built 2026-09-27)

### Scope (interview, 2026-09-27)

| Question | Chosen | Rejected |
|---|---|---|
| Rows with inputs | **Mixed**: a frequent one-tap action stays on the row, rare edits move into the open row | edit on expand everywhere (restocking becomes two taps); inline compacted (does not fit 320 FR) |
| Slice | **All except Stock item rows** (12 tables) | everything incl. Stock (conflicts with `feat/notification-control`, which adds a bell to that row); read-only lists only |
| Grow year by year | **Row: year + balance, the rest on expand** | narrow two-column table; four small columns |
| Gym session sets | **One line per set under an exercise heading** | edit on expand; leave Gym for later |

Correction recorded: Gym's session sets are **not** input rows — sets are logged by the form
above the list, and the list only displays them with Delete. "One line per set" therefore
means grouping + a compact line, not inline inputs.

**Stock item rows** (quantity steppers, remind-at, cost, History/Edit/Delete) are slice 3,
built after Epic 36 merges, with the Mixed rule: −/+ on the row, the rest on expand.

### `ListRow` change

A `trailing` slot: one action button rendered **beside** the head button, never inside it
(a button may not contain a button). The row still expands from its head.

### Per table (phone only; desktop tables unchanged)

| # | Table (file) | Collapsed row | On expand |
|---|---|---|---|
| 1 | Shopping list (`components/ShoppingList.tsx`) | name · space, meta "qty × cost", **Bought** as `trailing` | buy-quantity and cost inputs (same aria-labels) |
| 2 | Plan budgets (`pages/PlanPage.tsx`, `AmountRow`) | category, spent, bar "of {budget}" / "No budget" | monthly amount input + Save, default pot select, Delete |
| 3 | Recurring — to confirm (`components/RecurringCard.tsx`) | category · note, meta due date (`dates.day`), amount, **Add** as `trailing` | amount input, Skip |
| 4 | Recurring — templates (same file) | category + Auto/Paused tags, meta "cadence · next {date}", amount; paused row muted | Pause/Resume, Delete |
| 5 | Savings history (`components/SavingsCard.tsx`) | pot + withdrawal/paid-an-expense tag, meta date, signed amount (withdrawal in spend ink) | Delete, or the "change on the entry" link (AD-51) |
| 6 | Category — by vendor (`pages/CategoryPage.tsx`) | vendor, meta "{rate} /{unit} · {n} entries", spent. Static. | — |
| 7 | Category — entries (same file) | `dates.day(date)`, meta qty · rate · note, amount | note, Delete |
| 8 | Gym — session sets (`pages/GymPage.tsx`) | heading per consecutive exercise; "Set N" + "reps × weight {unit}" or bodyweight | Delete |
| 9 | Gym — routine exercises (same file) | exercise, target "3×8" | video link, Remove |
| 10 | Gym — recent sessions (same file) | `dates.day(performed_on)` · routine name | Open, Delete |
| 11 | Stock — restocks per space (`pages/InventoryPage.tsx`, bottom card only) | space, total, `CountBars` in the bar slot. Static. | — |
| 12 | Grow — year by year (`pages/ProjectionsPage.tsx`) | "Year N", balance (difference when comparing) | paid in + interest (A and B balances when comparing) |

### Acceptance criteria

1. Each of the 12 renders `ListRow`s on a phone and its existing table on a desktop,
   unchanged (existing tests green without edits).
2. Every action keeps the accessible name it has on desktop.
3. A `trailing` action works without opening the row, and is outside the head button.
4. One row open per list; heads are `<button aria-expanded aria-controls>`; static rows are
   not buttons.
5. Any new visible string exists in English and French.
6. Width sweep at 320 and 375, EN and FR, rows closed and one open per list: nothing past the
   viewport or its card. Page heights before/after recorded below.
7. New RTL phone tests per file; each new behaviour made to fail by a mutation first.
8. Separate reviewer pass before the PR.

### Results (2026-09-27, seeded demo account plus recurring, gym, vendor and purchase data)

Page height, measured in a same-origin iframe at the given width. Gym is measured with a
session open (the sets list) and the routine open for editing (its exercises).

| Page | 375 EN before | 375 EN after | 375 FR after | 320 FR after |
|---|---|---|---|---|
| Plan (recurring, savings history, budgets) | 5793px | 3128px (−46%) | 3146px | 3265px |
| Stock (shopping list, restocks) | 4140px | 3645px (−12%) | 3781px | 4158px |
| Category (Fuel: vendors, entries) | 2162px | 1284px (−41%) | 1302px | 1307px |
| Gym | 3056px | 1863px (−39%) | 1863px | 1941px |
| Grow | 2662px | 1583px (−41%) | 1601px | 1628px |

- Stock gains least because its item rows, the bulk of the page, are slice 3.
- Width sweep, the five pages, 320 and 375, EN and FR, rows closed and the first row of
  every list open: nothing past the viewport or its card. Re-run on the final build after
  the review fixes.
- Desktop (1280): the same tables as before on all five pages (4 / 5 / 2 / 3 / 1), no list
  rows.
- `ListRow` gained `trailing` (Shopping's Bought, Recurring's Add) and `muted` (a paused
  template). Labels in an open row name their input by `htmlFor`; the controls themselves
  are shared with the desktop cells, so every accessible name is the desktop's.
- Tests: a phone block per file (16 new, two new files: `CategoryPage.test.tsx`,
  `ProjectionsPage.test.tsx`; `test/phone.ts` stubs the layout); vitest 530/530, exit 0,
  0 unhandled. Twelve mutations each turned a new test red: trailing drawn inside the head,
  Shopping never phone, Plan inputs shown closed, Recurring Add moved off the row, paused
  not muted, deposit unsigned, vendor rows expandable, Gym sets never grouped, restocks
  never phone, Grow details dropped, and the two review fixes below.
- Review (separate agent): one major, fixed — a closed proposal row showed the original
  amount while Add beside it confirmed the corrected one. The row now shows what Add will
  send; the shopping row likewise shows the cost Bought will record. The rule, for any
  later `trailing` action: **the closed row shows the value its action sends.** Also fixed:
  the shopping inputs' visible labels now match their accessible names (WCAG 2.5.3), and
  Grow's B series is computed once, not per row.
- Not fixed, noted: a Plan budget typed and not saved gives no sign on the closed row (Save
  stays enabled on reopening); floating buttons still cover the last row's right edge
  (audit #5).
