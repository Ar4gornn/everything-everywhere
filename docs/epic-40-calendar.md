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
