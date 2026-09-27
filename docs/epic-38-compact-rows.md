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
