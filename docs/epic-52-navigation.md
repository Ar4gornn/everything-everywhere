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
