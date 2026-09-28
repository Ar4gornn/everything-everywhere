# Epic 40: The calendar, rebuilt for both screens

**Status:** Scoped 2026-09-28, building on `feat/calendar-ux` (worktree `ee-cal`)
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
