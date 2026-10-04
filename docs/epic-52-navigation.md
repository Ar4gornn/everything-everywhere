# Epic 52: Navigation — a More drawer on phones, a sidebar on desktops, every place findable

**Status:** Scoped 2026-10-03, building on `feat/navigation` (worktree `ee-nav`, from `76bbfb2`)
**New decision record:** AD-65
**Migration:** none (layouts live in the preferences JSONB; old layouts are read into the
new shape).
**Why:** Alex could not find Clocks: it was the third chip on the Dashboard. Five bottom
tabs, three top links and five places reachable only through chips or links (Calendar,
Clocks, Books, Notes, Moon) had outgrown the shell.

---

## 1. Scope (locked in the interview, 2026-10-03)

| Question | Chosen | Rejected |
|---|---|---|
| Model | **Side drawer, opened by a More tab** | launcher grid on the Dashboard; ☰ in the top bar as well; fixing Clocks only |
| Phone bar | **Dashboard, Entries, Habits, Plan, More** | keeping Gym in the bar; today's five plus More |
| Tiles | **Icon + name + live hint**, computed on the device only | icon + name only |
| Desktop | **Permanent left sidebar, grouped** | the phone drawer; top nav + dropdown |
| Views | **Calendar, Clocks, Books, Notes, Moon get their own entries; the chips stay** | removing the chips |
| Customise | **Pick the 4 bar places + reorder within groups**; old layouts migrated (first 4 bar tabs kept) | pin only |
| Clocks card | **Nothing until a place exists**; the tile is the way in | a one-time prompt card |

### Explicitly out
New pages; page content; swipe gestures; counts that need a server request (Stock low,
Habits left) — no hint for those.

---

## 2. AD-65 — One navigation model, three renderers; layouts carry `items`

**Binds:** `nav/model.ts`, `nav/hints.ts`, `components/nav/*`, `App.tsx` shell,
`LayoutCard.tsx`, preferences (both sides). **Extends:** AD-49 (layouts, modules), AD-60
(native `<dialog>` sheets).

1. **Places.** Thirteen: `dashboard, entries, habits, plan, calendar, books, notes, grow,
   stock, recipes, gym, clocks, moon` (`NAV_ITEMS`, both sides, same order). Settings is not
   a place: it is last in the drawer and the sidebar and stays in the phone top bar.
2. **Layout shape.** Each layout gains `items: [{id, pinned}]`, every place once. On a phone
   the pinned ones (≤ 4, `pref_slot_full`) are the bottom bar in list order; the rest are the
   drawer. On a desktop `pinned` is ignored: the sidebar shows every visible place.
   Validation mirrors `tabs`: unknown id `pref_unknown_id`, duplicate `pref_duplicate`,
   incomplete `pref_incomplete`.
3. **Read-time migration.** A layout without `items` gets them from its `tabs`: the first
   four bar tabs, in order, stay pinned; every other place follows in default order. A
   layout with neither gets the default (Dashboard, Entries, Habits, Plan pinned). `tabs` is
   still accepted and resolved, so an installed app that has not updated keeps working;
   a new client never writes it.
4. **Groups** are fixed in the client (`NAV_DEFS[*].group`): Daily (Dashboard, Calendar,
   Habits, Books, Notes), Money (Entries, Plan, Grow), Home & body (Stock, Recipes, Gym),
   Tools (Clocks, Moon). Within a group, list order. Empty groups are not drawn.
5. **Modules.** A place whose module is off is gone from bar, drawer and sidebar. Habits and
   Books are separate places now, so the "Habits off becomes a Books tab" rule is gone.
6. **Hints** (`useNavHints`) are computed on the device only: Clocks (first place's
   time), Moon (phase glyph and % lit; the engine is requested when the drawer opens or
   the sidebar mounts, if the module is on), Calendar (today's short date), Plan (days left
   in the budget month). No request is made for a hint.
7. **Current place.** `isAt`/`placeOf` decide what is lit: a pinned place in the bar, More
   when the current page is a drawer place, the entry in the sidebar.

---

## 3. Story 52.1 — Phone: bottom bar, More drawer, hints — builder A

- `components/nav/BottomBar.tsx` (exists, refine): 4 pinned + More (`aria-haspopup`,
  `aria-expanded`), More lit when the page is a drawer place; keep `aria-label="Sections"`.
- `components/nav/NavDrawer.tsx`: native modal `<dialog>` bottom sheet (reuse the quick-add
  sheet's CSS approach, AD-60): title, close button, grouped tiles (2 or 3 per row at 320,
  44px+ targets), each tile icon + name + hint, current place marked (`aria-current`),
  Settings last. Closes on tile tap, Escape, close, backdrop; focus returns to More.
  Lab note: anything outside a modal `<dialog>` is inert, so nothing the drawer needs may
  live outside it.
- `nav/hints.ts`: implement per AD-65 §6, minute updates (`clocks/useNow`).
- Phone top bar: the `.nav` / `.nav-extra` CSS goes; brand stays visually hidden; theme
  toggle and Settings pill stay.
- Must fit 320 and 375 in French in all five themes; no overflow; quick-add `+` and note
  button still clear the bar.

## 4. Story 52.2 — Desktop sidebar — builder B

- `components/nav/Sidebar.tsx` (exists, refine): sticky full-height left column ≥ 721px,
  brand at top, group headings, glyph + label + hint per place, current place marked,
  Settings at the bottom with the theme toggle; the top bar on desktop keeps only what the
  sidebar does not have (decide and justify). Content column keeps its max width.
- `.shell` becomes a two-column grid on desktop. Check 768 and 1280, all themes, both
  languages, long FR labels.

## 5. Story 52.3 — Customise, preferences, tests — builder C

- `layout/preferences.ts` `pinItem`, `unpinItem`, `moveItem` (signatures fixed).
- `components/LayoutCard.tsx`: the tab editor becomes a place editor per layout: phone shows
  "In the bar" (≤ 4, reorder, unpin) then each group (reorder within group, pin when there is
  room, otherwise a reason); desktop shows the groups only (order within group). Saves
  `{[layout]: {...current, items}}`. Reset restores the default items.
- Rewrite the old nav-structure tests (`App.test.tsx`, `layout/modules.test.tsx`,
  `layout/preferences.test.ts`, `moon/wiring.test.tsx`, others that use the "More" top nav)
  for the new model; new tests for `navModel`, `isAt`, `itemsOf`, the helpers.
- Backend tests: default items; migration from a customised `tabs`; stored items merged with
  a missing id; >4 pinned on phone refused; desktop uncapped; unknown/duplicate/incomplete;
  old clients writing `tabs` still accepted.

---

## 6. Round 1 amendments (QA, 2026-10-04)

These change §2 and §5 above; where they disagree, this section wins.

- **Bar slots count only places that are on (§2.2).** A pinned place whose module is off is
  not in the bar, so it takes no slot. Client: `barCount(items, modules)` and
  `pinItem(items, id, modules?)`; the editor's "(n of 4)" uses the same count. Server:
  `_check_layout` counts pinned items whose module is on, using the patch's `modules` when it
  carries them and otherwise the stored ones (`update_preferences` reads them); read-time
  trimming of an over-full stored phone bar counts the same way. Turning a module back on
  can leave more than four visible pinned places: reading keeps the first four.
- **A new client never writes `tabs` (§2.3).** `LayoutCard` saves and Reset send
  `{cards, items}` only (`LayoutPatch`; `applyPatch` lays a layout patch over the layout it
  replaces). When a layout has stored `items`, the server derives the resolved `tabs` from
  them for an installed app that has not updated: sections only (dashboard, entries, habits,
  stock, gym, plan, grow, recipes) in items order, the pinned sections first, then the next
  sections to fill the bar to five, the rest "top" (three at most). The old app therefore
  shows the same first places. A layout with no stored `items` keeps its stored tabs.
- **Default order per layout.** A desktop's default `items` are in the sidebar's group order
  (dashboard, calendar, habits, books, notes, entries, plan, grow, stock, recipes, gym,
  clocks, moon), still marking the same four as pinned (ignored there). A phone's default
  stays bar-first. Both sides: `NAV_ITEMS_GROUPED`, `_default_items(name)`, `itemsOf(layout,
  name)`; a desktop layout migrated from `tabs` lists the unpinned in group order.
- **Drawer (§3).** Titled "All places" / "Toutes les rubriques". Last in the sheet, a small
  link "Change what's in the bar" / "Modifier la barre" to `/settings#layout`; the Layout
  card scrolls itself into view for that hash (the page is a lazy chunk, so the browser's
  own anchor jump has nothing to land on). Hints never break a tile: two lines at most.
- **Desktop top bar dropped (§4).** On a desktop layout there is no `<header class="topbar">`:
  the sidebar carries the name, Settings with the signed-in email under it, and the theme
  switch. The phone's top bar is unchanged. `<Sidebar>` is rendered only on a desktop layout;
  `<BottomBar>` is always rendered (CSS hides it on a desktop) and the drawer closes when the
  window becomes a desktop.
- **Rail tooltips.** Between 721 and 960px each link shows its name on hover and keyboard
  focus through the app's `data-tip`.
- **Accessibility.** A "Skip to content" link is the first focusable element and targets
  `<main id="main" tabindex="-1">`. Sidebar group names are labelled groups, not headings.
  A bar tab lit by a sub-path carries `aria-current="page"`; More carries
  `aria-current="true"` on a drawer place and on Settings, and is lit there.
- **Hints.** A clock's name in a hint is cut to 12 characters and an ellipsis. The Clocks
  hint adds "tomorrow"/"yesterday" when the first place's day differs from yours. The Moon
  hint uses the dashboard's own figure (`moonOnDay`, today's local noon) and the app's
  `MoonGlyph` in the right hemisphere (`NavHint.moon`), not an emoji.
- **Bundle.** The clock search (alias and country tables, `findZones`) moved from
  `clocks/time.ts` to `clocks/search.ts`, imported by the Clocks page and the Settings card
  only; `nav/hints.ts` imports the light `time.ts` alone.

## 7. Round 2 amendments (QA, 2026-10-04)

- **Clock hint in parts.** `NavHint.clock = {label, time, day?}` beside `text`; `HintView` draws
  the label as its own span, the only one that may be cut (CSS ellipsis on top of the
  12-character cut). Sidebar: one line, label then time and day. Drawer tile: the label on one
  line, the time and day word on their own line, never cut.
- **Drawer.** "Change what's in the bar" sits under the title in the sheet's head, visible
  without scrolling at 320. Tiles: same layout from the top (glyph, name, hint), 84px
  minimum, every tile in a row the row's height; hints at 11px so the moon's glyph and
  "41 % éclairée" stay on one line at 320.
- **`/settings#layout`** scrolls on every navigation to it (keyed on `location.key`), and the
  card keeps 16px above it (`scroll-margin-top`; the phone top bar is not sticky).
- **Layout editor.** Pin and Unpin are words ("Épingler" / "Retirer"); the accessible names
  still name the place. A full bar's Pin is dashed and muted, unlike a disabled ↑/↓ at a
  list's end, is described by the reason, and the reason is repeated under the groups.
