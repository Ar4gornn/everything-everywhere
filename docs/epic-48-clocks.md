# Epic 48: Clocks — other places' time, at a glance

**Status:** Scoped 2026-10-03, building on `feat/clocks` (worktree `ee-clocks`, from `c561999`)
**New decision record:** AD-64
**Migration:** none (preferences is JSONB; three new keys, a module and a card need no DDL).

---

## 1. Scope (locked in the interview, 2026-10-03)

| Question | Chosen | Rejected |
|---|---|---|
| Where | **Dashboard card + `/clocks` page**, the Dashboard section's third view (`ViewSwitch`); a **Clocks module** (Epic 33) | card only; a page only |
| Adding a place | **Searchable IANA zone list (`Intl.supportedValuesOf`) + the person's own label** | city search (bundled city table); both |
| Storage | **Account preferences**, same list on every device | this device only |
| Extras | **Night/work shading, a time slider, the calendar's "also in" zone** | — |
| Calendar | **Display toggle**: one zone chosen, each timed row shows both times; read-only | events stored with a zone (migration); split off |
| Hours | **One account default in Settings, per-place override** | fixed hours; per place only |
| Slider | **±12 h, 15-minute steps, resets on leaving** | a date + time picker; both |
| Name, cap | **Clocks / Horloges, at most 12 places** (own zone first, not counted) | "World time"; 6 |

### Explicitly out
City search, events stored with a time zone, a date picker for the slider, clocks in push
notifications, per-device storage, seconds hands, analogue faces.

---

## 2. AD-64 — Clocks are computed from `Intl` on the device; only the choices are stored

**Binds:** `frontend/src/clocks/*`, `ClocksPage`, `ClocksCard`, `ClocksSettingsCard`,
`CalendarPage`, preferences (both sides). **Extends:** AD-49 (modules, cards, sparse
preferences), AD-52 (account time zone), AD-63 (computed, not stored).

1. **No tz data shipped, no library.** Every conversion is `Intl.DateTimeFormat` with a
   `timeZone` (`clocks/time.ts`), so DST is the browser's ICU, as it already is for dates
   everywhere in the app. The server checks zones with `zoneinfo` (`tzdata` pinned), the
   same judge as `check_timezone` (AD-52); a zone one side knows and the other does not is
   refused on write (`422 invalid_timezone`) and skipped on read, never a 500 on `/me`.
   **Zone aliases:** Chrome's `Intl.supportedValuesOf("timeZone")` still lists legacy ids
   (`Asia/Calcutta`, `Europe/Kiev`, `Asia/Katmandu`, `America/Buenos_Aires`, ...), so the same
   place would appear twice. `clocks/time.ts` carries a legacy to current map (the IANA
   `backward` file, about 30 ids); `canonicalZone(zone)` applies it, `allZones()` returns
   canonical, deduplicated, sorted ids, `searchZones` also matches the legacy spelling
   ("calcutta" finds `Asia/Kolkata`), and new places store the canonical id. `zoneCity`
   names a legacy id after its current one everywhere (page, card, Settings, calendar).
   Search also knows a curated **place alias** table (about 110 big cities and single-zone
   countries: Delhi, Mumbai, India → `Asia/Kolkata`; "Washington DC", not "Washington"; no
   abbreviations such as PST/CET/IST, which are ambiguous). A result found by an alias reads
   "Delhi → Kolkata — Asia/Kolkata · 13:41 (+3h30)" and names the new place "Delhi". Dots and
   apostrophes are ignored ("st. john's"); past 20 results the list says "Showing 20 of N". The server
   accepts both spellings, so an older saved id keeps working; wherever two zones are
   compared (calendar place lookup, Settings select) both go through `canonicalZone`.
2. **Three sparse preferences keys**, each replaced whole by a PATCH (AD-49):
   - `clocks`: `[{id, zone, label, hours|null}]`, ≤ 12, ids unique (`pref_duplicate`), label
     1-32 trimmed with no control characters (Unicode Cc, Cs, Zl, Zp), no bidi
     override/isolate/mark (U+202A-U+202E, U+2066-U+2069, U+200E, U+200F, U+061C; the
     zero-width joiner stays, emoji need it), and at least one visible character (not only
     whitespace, Cf, or the blank fillers U+115F, U+1160, U+3164, U+FFA0, U+2800), in the
     person's order. Two places may share a zone (Mum and Dad in Paris);
   - `clock_hours`: `{work: [start, end], night: [start, end]}`, default 09:00-18:00 /
     23:00-07:00; times `HH:MM` on the 15-minute grid; [start, end), end ≤ start wraps,
     start = end is empty; night wins over work;
   - `calendar_zone`: an IANA zone or null (an explicit null switches it off; the route keeps
     it, as for `moon_hemisphere`).
   Resolved on read: malformed or unknown rows are dropped, not refused.
3. **Home** is the account's `timezone` (AD-52), else the device's zone, else UTC. It is
   always the first clock and is not stored in `clocks`.
4. **Module `clocks`** (default on) hides the view chip, the card, the Settings card and the
   calendar's second times. Card `clocks` sits after `streaks` and draws nothing while there
   are no places, so an account that never adds one sees no change.
5. **Times are 24 h `HH:MM`** in both languages (as `timeLabel` already is); a difference is
   `+1h`, `−7h30`, `+5h45`, `+15 min` / `−30 min` under an hour (U+2212 minus), or "Same time".
6. **The slider's day words are counted from the real today**, not from the shifted instant:
   `readClock(zone, at, home, hours, reference = at)` takes the zone's date at `at` minus the
   home date at `reference`. At -12 h a place that is still today says nothing, and the
   readout shows the home time with its own day word when the shifted home date differs from
   today ("tomorrow 02:15 (+3h)", French "demain ...").

---

## 3. Story 48.1 — Time engine (`clocks/time.ts`, `clocks/useNow.ts`) — builder T

Implement the signatures in `time.ts` exactly. Tests in `clocks/time.test.ts` with fixed
instants (never the wall clock): Paris/New York/Kolkata (+5h30)/Kathmandu (+5h45)/
Chatham (+12h45/+13h45)/Lord Howe (30-minute DST)/Apia; both DST transitions in Europe and
the US (the weeks they disagree: diff Paris−New York is 5h, then 6h); day shift ±1 across
midnight and the date line; `convertWallTime` on a spring-forward gap and a fall-back
overlap; `inRange` wrap and empty; `shadeAt` night-over-work; `searchZones` accents
("sao" → `America/Sao_Paulo`), underscores/spaces, city-prefix first, limit;
`formatDiff` U+2212 minus. `useNow` ticks on the minute boundary (fake timers).

## 4. Story 48.2 — Page and card — builder P

- **`/clocks`** (`ClocksPage`): `ViewSwitch` (Dashboard views) at the top as on `/calendar`;
  home row first ("You" + zone city); then each place: label, time, `dayShift` word,
  diff, shade badge (text, not colour alone). The list is a grid `name | time | meta` and
  each row a `subgrid` of it, so the time column is one track for every row (on phones:
  `name | time` with the meta under the time); the city is left out when the label already
  says it (case-insensitive). The page is at most 640 px wide.
  The three shades look different (work: tinted fill, free: outline, night: dark fill),
  using existing theme tokens only.
  **Lighter rows (U2):** a row shows only name, time, meta and one toggle on the name's line
  (`aria-expanded`; "Edit {label}" collapsed, "Done editing {label}" expanded; the icon alone
  on phones); expanded: Rename, Custom hours, up/down, Remove (immediate, with an inline
  "Removed Mum. Undo" for 8 s or until the next write; Undo puts it back at its index with
  its hours, one PATCH). A place with its own hours carries a "Custom hours" tag (page only).
  The own-hours editor keeps a local draft of the four selects with Save (one write),
  Cancel and "Use default".
  Add: a search input over `allZones()` via `searchZones` (a list of buttons, max 20, each
  "Kolkata — Asia/Kolkata · 13:41 (+3h30)", U1), then a label field prefilled with `zoneCity`;
  the client refuses control and direction characters with a visible reason. **Empty account
  (U3):** the Add card comes first and the slider card waits for the first place. At 12 places
  the search input is hidden and only the cap message shows. Writes go through
  `usePreferences().update({ clocks })` — the whole list. A refused write is shown where the
  action was: inside the place's row, or in the Add card; a refused rename keeps the form open
  with the typed name; a row's error clears on Cancel, Escape and collapsing. A pending or
  refused add never unmounts the Add form (an add is not counted against the cap until it
  is saved). Focus: rename opens on the name, selected, Escape cancels, and focus returns to
  the row's toggle, as after custom hours Save/Cancel/Use default; after a move it stays on
  the same arrow (the other one if that one just ran out); a picked result → Name; a saved
  add → the new row's toggle; a remove → the next row's toggle, else the previous, else the
  search; Back to now → the slider. In the Add card, Escape starts over in the search;
  editing the search after picking keeps the choice until another result is picked. **Slider**: `<input type="range">` −48..+48 quarter
  hours, labelled with the home time it represents ("Now" at 0); every clock and shade
  follows; a "Back to now" button; state is local, so leaving the page resets it. On
  phones (≤720 px) the slider card is compact and `position: sticky` at the top while the
  list scrolls; focused list controls have a `scroll-margin-top` clear of it.
- **`ClocksCard`** (dashboard): nothing when no places; else home + first 3 places, one line
  each (label · time · diff · shade, no "Custom hours" tag), then "+N more" (plural-correct,
  French singular at 0 and 1) linking to `/clocks`, and an "Open" action (the title is not
  a link). Same grid and shade looks as the page. Live via `useNow()`.
- Route and card wiring exist already (skeleton). CSS in `styles.css`, qualified class names
  (`.clocks-…`) — class names are global here.
- Must fit 320 px in French with 12 places and long labels: no element past its card or the
  viewport, left or right, and no control's `scrollWidth` over its `clientWidth`.
- RTL tests: add/rename/reorder/remove send the right `clocks`; cap; slider moves times;
  card hidden with no places; module off hides chip and card.

## 5. Story 48.3 — Settings, calendar, backend tests — builder S

- **`ClocksSettingsCard`** (Settings, beside `MoonSettingsCard`, only with the module on):
  default work and night hours (same `<select>`s), saved as `clock_hours`; the calendar zone
  as a `<select>`: "Off" + one option per canonical zone (every label sharing it joined by
  ", ", then " · " and the city; the city is left out when it equals the only label), home
  excluded (a place in the home zone is not offered); saved as the canonical id. A saved
  zone whose place was removed stays in the select with the hint "Not one of your places any
  more", or "Same as your own time" when it is the home zone. The hour rows are one grid
  (name | from | to) so the selects line up. A link to `/clocks`.
- **Calendar**: with the module on and `calendar_zone` set, each habit check-in row with a
  `done_at` shows `13:00 · Paris 14:00` (label of the one place in that zone; `zoneCity` when
  there is none or several), plus
  "tomorrow"/"yesterday" when the day shifts. The conversion is `convertWallTime(day,
  done_at, home, calendar_zone)`. Today that is the only timed row on the calendar.
- **Backend tests** (`tests/test_clocks_preferences.py`, and fix the catalogue tests that list
  modules/cards): defaults on a new account; round trip; 13 places → 422; unknown zone →
  422 `invalid_timezone`; duplicate id → 422 `pref_duplicate`; label empty / 33 chars /
  control character → 422; hours off-grid (`09:10`) and `24:00` → 422; `calendar_zone` set,
  then explicit null clears it, and an absent key leaves it; a stored malformed row and an
  unknown stored zone are dropped on read, not a 500; other users' preferences untouched.
- Frontend preference/module tests updated for the new module and card (`clocks` has no
  endpoints, so it joins `moon` in the module test's API exclusion).
