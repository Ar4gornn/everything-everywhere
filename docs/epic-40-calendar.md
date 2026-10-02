# Epic 40: The calendar, rebuilt for both screens

**Status:** Scoped 2026-09-28, all four stories built on `feat/calendar-ux` (worktree `ee-cal`)
**New decision record:** AD-56 (the day panel sits beside the grid on a wide screen, over it on a phone, and is never a modal)
**Migration:** none. No backend change.

---

## 1. Scope (locked in the interview, 2026-09-28)

Every option offered was picked, on both layouts, plus week navigation on phones. Split
into four stories so each one can ship and be reviewed alone.

| Story | Scope |
|---|---|
| **40.1 Basics + day detail** | Today ringed, a Today button, arrow keys / Home / End between days with a roving tabindex, Enter opens. Day detail pinned beside the grid at ≥1000px (today open on arrival), a panel over the lower screen on phones (Close, Escape, tap outside). |
| 40.2 Readable cells + layers menu | Phone dots → coloured bars in fixed layer order, legend; desktop up to 4 layer-tinted lines; the 8 chips → one "Layers (n/8)" menu. |
| 40.3 Month summary + swipe | In / out / net and per-layer counts above the grid, for the layers that are on; horizontal swipe changes the month (the week in week view). |
| 40.4 Week view | Month / Week toggle on both screens, remembered per device; every item in full. |

### Explicitly out

Drag to reschedule, creating records inside the grid (the "Add on this day" hand-off stays),
a day view, any change to the Epic 39 feed.

## 2. Story 40.1 — as built

- **Beside, over, below.** One markup, `.cal-side` after the grid card inside `.cal-layout`.
  ≥1000px: a two-column grid, the panel 320px and `position: sticky`. 721–999px: the panel
  follows the grid in the flow, as before. ≤720px: `position: fixed` above the tabs,
  `max-height: 45vh`, `z-index` over the quick-add button, `hidden` while no day is chosen.
- **What "nothing selected" means differs.** A desktop opens on today (room to spare); a
  phone opens on the month, because an open panel on arrival would hide half of it. A tap on
  the chosen day closes the phone panel; on a desktop a tap only ever chooses.
- **Not a modal** — AD-56, following `MoodCheckin`'s reasoning: no backdrop, nothing inert,
  no trap. Escape and a tap outside the grid and panel close it; Escape and Close put focus
  back on the day. While open, the shell gains bottom padding and each cell a
  `scroll-margin-bottom`, so the chosen day is scrolled above the panel rather than under it.
- **Keyboard.** One cell has `tabIndex=0`: the focused day, else the chosen one, else today,
  else the period's first day. Arrows move ±1 / ±7, Home / End to the week's ends; a target
  off the drawn grid turns to the period it belongs to and focus follows after that render.
  Arrows move focus only; Enter or Space chooses.
- **Today.** `aria-current="date"`, number in a `--primary` disc with `--on-primary` text (a
  pair `theme.test.tsx` already checks). The Today button is disabled when it would change
  nothing.

### Verified

- `CalendarPage.test.tsx`: 7 new tests; 11 mutants of the new code, all killed (one
  survived the first pass — Escape was pressed with focus already on the day — and the test
  now starts from inside the panel). Full suite 580/580, exit 0, no unhandled errors.
- Verify stack (`cal-verify`, :8019): desktop 1280 grid 704px + panel 320px sticky, today
  open and the only tabbable cell; phone 375 panel bottom 748px vs tabs at 753px. Overflow
  sweep at 320 and 375, EN and FR, viewport and card edges, left and right: clean.
- Known: at 320 (EN) and 375 (FR) the panel's header wraps to two lines (date, then Add +
  Close), 92px of a 45vh panel. Left for 40.2, which reworks the phone cell and panel text.

## 3. Story 40.2 — as built

- **One colour per layer, one place.** `[data-layer="…"]` sets `--layer` from existing fill
  tokens (money `--warning`, savings `--accent`, stock `--accent-2`, gym `--spend`, habits
  `--text`, mood `--mood-4`, meals `--mood-2`, due `--muted` as an outline). No new token, so
  no theme block to extend; never used as `color:`.
- **Phone: bars.** One 3px full-width bar per layer with something on the day, in `LAYERS`
  order, so a bar's place names it as well as its colour. Money counts entries, not the net,
  so a day that nets to zero still shows. Hidden above 720px. A 4-layer day is 58px tall.
- **Desktop: tinted lines.** Up to 4, each with a 3px start border in its layer's colour and
  text in `--text`; past 4, three and "+n more", so a busy day is as tall as any other.
- **Key** under the grid on both layouts, listing only the layers that are on.
- **Layers menu.** The 8 chips became one "Layers (n/total)" button with a checkbox panel
  (disclosure, not modal: Escape returns focus to the button, a tap outside closes). The last
  layer on is disabled rather than silently refusing.
- **Phone panel header.** "Add on this day" is a 44px "+" named by its `aria-label` on a
  phone; the header is now one 44px line at 320/375, EN and FR (was 92px).

### Verified

- 5 new tests + 3 updated (`CalendarPage`, `App`, `modules`). 11 mutants, all killed. Full
  suite 585/585, exit 0, no unhandled errors (one earlier run flaked on
  `NotificationsCard` under load; passed alone and on the rerun). tsc clean, lint = the 2
  old warnings.
- `cal-verify` :8019: desktop 1280 lines tinted, busy day 3 + "+2 more", bars hidden;
  320/375 EN+FR: 0 overflow (viewport and card edges, both sides) closed, with the menu
  open and with the panel open; menu panel x 20→280.

## 4. Story 40.3 — as built

- **The period in figures.** A `<dl class="cal-summary">` between the layers menu and the
  grid, named as a group ("September 2026 in figures") rather than a region, so the day panel
  stays the page's one landmark. In / Out / Net when the money layer is on, then one count
  per other layer that is on and has something in the period, each with its key swatch.
  Money is the three figures, never a count.
- **Only the period's own days.** Summed from the same `byDay` map the cells read, filtered
  to `periodStart..periodEnd`: the ragged edge days belong to the neighbouring periods, and
  the due list is not month-shaped at all. Money in cents (AD-5).
- **Swipe.** Touch events on the grid, decided on release: one finger, at least 50px
  sideways, and sideways by more than twice the vertical travel, so a drifting scroll stays
  a scroll. Left is the next period, right the previous. Touch only; a mouse has the arrows.
  A phone's grid hint says the grid can be swiped. The week half of the story waits for
  40.4, which brings the week view.
- Rejected: the dashboard's four `Stat` cards (four rows of a phone screen above the month);
  counts with zeros (seven labels at 320 for mostly nothing); pointer events with
  `touch-action: pan-y` (a pointer swipe would also catch mouse drags).

### Verified

- 4 new tests (figures and counts, following the layers menu, ragged edges excluded, swipe
  incl. drift / short / pinch). 11 mutants, all killed. Full suite 589/589, exit 0, 0
  unhandled. tsc clean, lint = the 2 old warnings.
- `cal-verify` :8019, bundle `index-B18BD-20.js`: desktop 1280 one line above the grid;
  320 EN summary 90px, 0 overflow; synthetic `TouchEvent`s in Chromium turned 2026-09 →
  2026-10 → 2026-09 and a drifting stroke did nothing. French not measured in the pane
  (fixture account is EN); the row wraps by construction.

## 5. Story 40.4 — as built

- **A position of its own.** The week is a Monday (`week` state), not a place inside the
  month, so it crosses the account's boundary freely. `periodStart..periodEnd` is either the
  budget month or those seven days, and everything downstream — cells, keyboard, summary,
  swipe — already spoke in "the period", so it follows unchanged.
- **Two months when it must.** Every layer's endpoint takes a budget month (AD-10) and none
  has a date range. A week touches one or two; each layer asks for each month and joins
  them, and fails as one layer, as before. The due list is not month-shaped and is asked
  once.
- **Every item in full.** All of a day's lines, none folded into "+n more"; lines wrap
  instead of being cut; money, savings and due lines carry their exact signed amount; the
  day's net is exact rather than rounded. The weekday names sit in each cell ("Mon 28"),
  since on a phone the seven days stack one per row — the only way a busy day fits in full
  at 320px — and a heading row would sit over the first day only. Bars step aside.
- **The switch.** Two `aria-pressed` buttons in a group beside the layers menu, not a
  `ViewSwitch` (that one changes page). Remembered per device like the layers
  (`everything-everywhere.calendarView`). Switching keeps the place: the chosen day stays
  chosen and decides the other view's period; else today if on screen; else the period's
  first day.
- **Navigation.** ← / → and a swipe turn seven days; an arrow past either end of the week
  opens the neighbouring one with focus following; Today opens today's week. The month
  input shows the month the week ends in, and picking a month opens the week holding its
  first day — so the picked month is the one the input then shows.
- Rejected: a phone week as seven narrow columns (43px holds no words, which is the whole
  point of the view); a new date-range query on nine endpoints for a view that needs at
  most two months; dedupe by id across the two answers (the server's month windows do not
  overlap, so there is nothing to dedupe).

### Verified

- 6 new tests (switch + remembered, every line with amounts + chosen day kept, both months
  asked for, turn + summary + arrow past Sunday, back to the month by the chosen day, phone
  swipe + hint). The fixture answers entries per month only when asked (`windowed`), so the
  ragged-edge test keeps receiving the salary it proves is excluded. 12 mutants, all killed.
  Full suite 595/595, exit 0, 0 unhandled. tsc clean, lint = the 2 old warnings.
- `cal-verify` :8019, bundle `index-DyGJiOXF.js`, fresh fixture: 1280 grid 670px + panel
  320px beside, today open and the one tab stop, 7 equal 232px columns, 0 overflow; 375 EN
  and 320 FR 0 overflow (viewport and card edges, both sides), toolbar one row at 375 and two
  (96px) at 320 FR, both switch buttons 44px. Live toggle 35 ↔ 7 cells, choice stored.
- Known, not from this story: the month input at 320 FR is cut to "octob", and it names the
  month in the machine's locale (UX round 3 finding).
