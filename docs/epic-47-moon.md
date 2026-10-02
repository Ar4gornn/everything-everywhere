# Epic 47: The moon — phases, rise and set, and your days against them

**Status:** Scoped 2026-10-03, building on `feat/moon` (worktree `ee-quickadd`, from `95ecfa8`)
**New decision record:** AD-63
**Migration:** none (preferences is JSONB; a new key and a new module name need no DDL).
**Backlog split off:** Epic 49 cycle tracking, 50 sky, 51 tides (`docs/epics.md`).

---

## 1. Scope (locked in the interview, 2026-10-03)

| Question | Chosen | Rejected |
|---|---|---|
| What | **Moon phases + your data against them** | phases only; a menstrual-cycle tracker (→ Epic 49, its own privacy design) |
| Where | **Calendar days, dashboard title line, a Moon page, an opt-in digest line** | — |
| Accuracy | **Phases to the minute + moonrise/moonset**, computed on the device | an astronomy web service |
| Location (rise/set only) | **Rough (rounded to 0.1°, ~10 km), on this device only, never sent; cleared on sign-out** | on the account; exact |
| Overlay | **Mood, habits, spending, gym against the phases** | — |
| Overlay shape | **Side by side, no verdict; states how many cycles the figures cover** | a highlighted "difference" |
| Setup | **Hemisphere setting (auto from time zone) + a Moon module (Epic 33)** | always northern; no lit side |
| Astrology | moon sign belongs to Epic 50, as a fact; **no horoscope readings, ever** | readings |

### Explicitly out
Cycle tracking (49), eclipses/planets/moon sign/lunar calendars (50), tides (51), any claim that
the moon affects the person's data.

---

## 2. AD-63 — The moon is computed, never stored; one engine on both sides; the place stays on the device

**Binds:** `frontend/src/moon/*`, `MoonPage`, calendar, dashboard, Settings, `services/moon.py`,
the digest, preferences. **Extends:** AD-9/AD-41 (computed, not stored), AD-37 (cross-module
reads composed at the edge), AD-48 (device storage cleared on explicit sign-out), AD-49
(modules), AD-52 (digest kinds, account time zone).

1. **One engine.** Astronomy Engine (`astronomy-engine`, MIT, Don Cross; validated against
   NOVAS/JPL) on npm for the browser and on PyPI for the digest, pinned to the same version, so
   both sides agree on when the full moon is. The browser loads it with a dynamic `import()`
   (`moon/engine.ts`) so it is never in the main chunk; callers use `useMoonEngine()` and render
   nothing moon-related until it has loaded. Dependency audit before adding: licence, install
   scripts (none allowed), maintainer, download counts — recorded in the LOG.
2. **Nothing stored on the server.** Phase, illumination, quarters, rise/set are pure functions of
   time (and place). The only server state is two preferences keys: `modules.moon` (bool, default
   **true**, like every module — an account can switch it off in Customise) and
   `moon_hemisphere` (`"north" | "south" | null`; null = derived on the device from the account's
   time zone, `moon/hemisphere.ts`). The digest kind `moon` (AD-52) is **off by default**.
3. **The place stays on the device.** `moon/location.ts` keeps `{lat, lon, label}` under
   `everything-everywhere.moon.<userId>.place`, rounded to one decimal before it is written (a
   test reads the stored bytes), set from "Use my location" (`navigator.geolocation`, one-shot,
   `enableHighAccuracy: false`) or a typed latitude/longitude pair with an optional label. No
   reverse geocoding, no city search service (both would send the place somewhere). Removed by
   explicit sign-out with the gym store and drafts; kept on expiry. Without a place, rise/set is
   simply not shown and the page says why.
4. **Hemisphere.** South flips the drawn lit side (and "waxing" still means waxing). Auto: the
   account's IANA zone against a small table of southern-hemisphere zone prefixes/names
   (`Australia/`, `Pacific/Auckland`, `America/Argentina/…`, `America/Santiago`, `America/Sao_Paulo`,
   `Africa/Johannesburg`, …); unknown → north. The setting overrides.
5. **Overlay composed at the edge.** The Moon page reads, per budget month in the window, the
   module reads the calendar already uses (`moodDays`, `listCheckins`, `listEntries`,
   `listWorkouts`) — only for modules switched on — and buckets **days** into the 8 phases
   (`phaseOn(noon local)`). Per phase: number of days, and the figure: mood = mean of the day's
   answer on its own scale; habits = check-ins per day; spending = expenses per day (cents, summed
   in integers like the calendar); gym = sessions per day (rest days not counted). Window: the
   last 3 full lunar cycles (switchable to 6 and 12). The page says "N cycles, D days" and never
   ranks, colours or words a difference.
6. **Digest.** `services/moon.py` answers "is there a new or full moon on this local date?" for the
   account's zone; `notify.py` adds one clause when the kind is on and the module is on. EN/FR.

**Consequences.** One more client dependency (lazy chunk) and one more server dependency.
Rise/set accuracy at a 0.1° place is a minute or two; good enough for "when does it rise". A
person who never gives a place sees everything except rise/set.

---

## 3. UI

- **Calendar:** a 14-16px glyph (`MoonGlyph`, SVG, lit fraction + side) on each day cell, named in
  the day's accessible label ("Full moon"); new/full moon days get the phase word in the day panel.
- **Dashboard title line:** after the date, "🌔 Waxing gibbous · 82%" style text with the glyph
  (no emoji in the DOM — the SVG), tapping it opens `/moon`.
- **Moon page `/moon`** (Moon module; reachable from the dashboard line and the calendar's day
  panel; a link in the top bar only if the layout has room — the builder measures FR at 320):
  today (glyph, name, illumination, age in days, next new and full moon with dates and times,
  rise/set if a place is set), this month's quarters list, "Your days against the moon" overlay
  (one small table per module: 8 phase rows × days + figure, plus a line chart per module on a
  shared time axis with the phase band behind it), place controls (Use my location / enter /
  remove, with the privacy sentence "Stays on this device, rounded to about 10 km").
- **Settings:** Moon section — hemisphere (Auto · North · South), the place controls again.
- **Notifications card:** the `moon` kind toggle (Epic 36 pattern).

## 4. Builders

| Builder | Owns | Must not touch |
|---|---|---|
| **A — engines + server** | dependency audit + install (npm + PyPI, pinned), `moon/engine.ts`, `moon/hemisphere.ts`, `moon/location.ts`, their tests (shared vectors with Python), `services/moon.py` + tests, preferences (`modules.moon`, `moon_hemisphere`) + tests, digest kind `moon` + clause + tests | pages, components, App, CSS |
| **B — Moon page** | `pages/MoonPage.tsx`, `components/MoonGlyph.tsx`, `moon/overlay.ts` (pure bucketing) + tests, `i18n/messages/moon.ts` additions, page CSS block | engine/location internals, App, calendar, dashboard, Settings, backend |
| **C — wiring** | App route + module gate + nav, calendar day glyphs, dashboard title line, Settings Moon section, Notifications card toggle, sign-out clearing, tests | engine internals, MoonPage internals, backend |

## 5. Done means
Shared test vectors (≥ 6 published new/full moon instants, both languages, ± 2 min); illumination
and phase-name table; rise/set for 2 known places/dates vs a published almanac (± 3 min);
hemisphere table; location rounding read from stored bytes, never sent (a test asserts no
request body/URL contains the coordinates); overlay bucketing table incl. a phase with 0 days;
module off hides everything; digest clause EN/FR, off by default; full vitest exit 0 + 0
Unhandled; backend suite green; browser EN/FR at 375/320, light + dark, Moon page, calendar,
dashboard line, the main chunk does not contain the engine.
