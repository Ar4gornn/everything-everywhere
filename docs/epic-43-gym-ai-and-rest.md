# Epic 43 — Gym: less friction, AI workouts for every kind of person, rest

Status: **skeleton** (2026-10-02, Opus). Build by Sonnet agents against the contracts below.
Branch `feat/gym-ai-rest`, worktree `ee-gym`, from `main` = `ea2b2a5`. Migration `0036` after `0035`.
Decision record AD-59. Builds on Epic 42 (`docs/epic-42-gym-revamp.md`, AD-58) — read it first.

## 1. The person this is for

Someone who goes to the gym without much motivation. Every decision and every form between "I'm
here" and "first set done" is a reason to leave. So:

- **Never a blank form first.** Starting a session asks one question with three big answers.
- **Writing a workout is the AI's job, not theirs.** Import is the main way a workout is made, it
  is offered everywhere a workout could be missing, and the prompt already knows the person's
  unit, exercises and recent sessions.
- **After a workout is created, it starts.** No "now go back and find it".
- **Rest is a first-class thing**: a rest day is logged in one tap and counts; rest between
  exercises is planned; a rest timer is one tap away mid-session.

Decisions taken with Alex (2026-10-02 interview): all three kinds of rest; six prompt profiles
(his three + three); hand-off is "copy + open the AI app" and "paste from clipboard" on return —
the prompt and its history never travel in a URL. Rejected: prefilled `?q=` links (history in
URLs and logs, length limits), only three profiles, server-side LLM calls (out of scope, keys).

## 2. AD-59 — A rest day is a workout with no sets; one per day

A rest day is stored as a `workouts` row with `rest_day = true` and no sets. That makes it ride
everything a session already has: the offline outbox (AD-58: `POST /workouts/complete` with
`rest_day: true`, idempotent on `client_ref`), history, the calendar layer, the calendar feed, the
activity day / streak (any `/api/gym` write is an active day — `services/activity.py`), delete.
A partial unique index `(user_id, performed_on) WHERE rest_day` makes "rest day today" idempotent
per day too: a second rest day on the same date returns the first (200), never a duplicate. A rest
day with sets is refused (422 `rest_day_has_sets`). A rest day on a date that already has a real
session is allowed (rested after a short session — the person's record wins).

Rest *between exercises* is a plan attribute (`routine_exercises.rest_after_seconds`), used by the
live session when the last target set of an exercise is done. The standalone rest timer is purely
client state (`ActiveSession.rest_until`, which exists already).

## 3. Data (migration 0036 — in the skeleton)

- `workouts.rest_day boolean NOT NULL DEFAULT false`; partial unique index
  `workouts_one_rest_day_per_date ON workouts (user_id, performed_on) WHERE rest_day`.
- `routine_exercises.rest_after_seconds integer` CHECK 0..3600.

## 4. API (backend story)

| Method | Path | Change |
|---|---|---|
| POST | `/api/gym/workouts/complete` | body **+ `rest_day?: bool`**. When true: `sets` must be empty (422 `rest_day_has_sets`), `routine_id` ignored (stored null). Idempotent on `client_ref` as before **and** on the day: an existing rest day for `performed_on` → 200 with it. |
| GET | `/api/gym/workouts`, `/workouts/{id}` | WorkoutOut / WorkoutDetailOut **+ `rest_day`** |
| **GET** | **`/api/gym/workouts/recent?limit=10`** (1..30) | → `Page[WorkoutDetailOut]`: the newest sessions **with their sets**, newest first, in ≤ 2 queries. Declared before `/workouts/{workout_id}`. Feeds the AI prompt context. Rest days included (they say when the person rested). |
| POST | `/routines/{id}/exercises`, PATCH `/routines/lines/{id}`, POST `/routines/import` | line **+ `rest_after_seconds?`** (0..3600) |
| — | RoutineLineOut | **+ `rest_after_seconds`** |
| — | calendar feed (`services/calendar_feed.py`) | a day with only rest days → summary "Rest day" / "Repos"; mixed → the workout summary as today plus "+ rest". |

Tests: rest day idempotent by ref and by day; rest day with sets 422; rest day + session same
date both exist; `recent` returns sets, newest first, other user's sessions never; route not
shadowed; `rest_after_seconds` range and round-trip; feed wording; cross-user 404s. `EE_TEST_DB`.

## 5. Format `ee-workout/1` additions (backward compatible)

Per exercise: **`rest_after_seconds`** (rest after the exercise's last set, before the next one).
Per file, optional: **`"schedule"`**: an array of day labels, e.g.
`["Push day", "rest", "Pull day", "rest", "Legs", "rest", "rest"]` — the parser keeps it as
`ParsedImport.schedule: string[] | null` and the review shows it as a read-only week strip
("Mon Push · Tue rest · …"). Nothing is scheduled by the app (out of scope); it is the plan's
shape, shown so the person sees where the rest days are. Unknown routine names in the schedule
are shown as written.

## 6. Prompt profiles (`frontend/src/gym/prompts.ts`)

Six profiles. Each prompt = **role + profile-specific instructions + the person's context block +
the shared confirmation rules + the shared format**. Keep the English below exact (builders
translate to French for the `fr` variant; JSON keys and enum values stay English).

Context block, generated from the device cache (`GymCache` + `recent`), omitted parts when empty:

```text
About me (from my app):
- I count weight in {unit}.
- Exercises I already have (reuse these exact names when they fit): {name (kind), …}  [max 60]
- My routines: {name: exercise, exercise, …}  [max 10]
- My last sessions, newest first:
  {date} {routine or "free session"}: {exercise} {sets}×{reps or seconds or metres}{ @ weight}, …   [max 10 sessions, rest days as "{date} rest day"]
```

Shared confirmation rules (all profiles except where noted):

```text
Then go through the exercises ONE AT A TIME. For each, show: name, kind (reps, duration or
distance), sets, reps or seconds or metres, weight, rest between sets in seconds, rest after the
exercise in seconds, and a short note. Ask me to confirm or correct it, and do not move on until I
confirm. Keep each message short — I am probably at the gym.
```

Shared format block = §10 of Epic 42 extended with `rest_after_seconds` and `schedule`, and the
final line "Save this as workout.json and share it to Everything Everywhere, or copy it and paste
it in Gym → New workout → Ask an AI."

Profiles (id · card title · one-line card description · specific instructions):

1. **`notes` · "I know what I want"** · "Turn your own notes into a workout. Few questions."
   > "I already know what I want to do. Below are my notes, possibly messy. Turn them into a
   > workout. Do not redesign it and do not add exercises I did not mention. Only ask about what
   > is missing or ambiguous (sets, reps, weight, rest), in one short message. My notes:
   > {notes or '(I will paste them in my next message)'}"
   > (The card has an optional notes box; its text is injected. Confirmation rules: one pass
   > listing everything, then ask "anything to change?" instead of one at a time — the person
   > already decided.)
2. **`build` · "Build me one"** · "No idea where to start? It asks about you and finds your level."
   > "I don't know what to do at the gym. Interview me before proposing anything: ask about my
   > goal, my experience, how often and how long I can train, my equipment, injuries or pain,
   > what I enjoy or hate, and anything else you need — a few questions per message, as many
   > messages as needed. Find my real level; when unsure, choose the easier option. Then propose
   > a weekly plan with rest days (fill "schedule") and the routines for it."
3. **`fresh` · "Something new every day"** · "A different workout each time, based on what you did."
   > "I like a different workout every time. Use my last sessions below so today's workout does not
   > repeat yesterday's and balances the muscle groups I have not trained recently. First ask me in
   > one short message: how long today, which area or style I feel like (or "surprise me"), and my
   > energy level. Then propose ONE routine for today."
4. **`quick` · "Short on time"** · "15–30 minutes, today, whatever you have."
   > "I have little time and little motivation today. Ask me in one message: how many minutes
   > (15, 20 or 30) and what equipment is around. Then give ONE short routine that fits that time
   > including rests (estimate it), with simple exercises and no setup-heavy machines. Use
   > supersets-free straight sets."
5. **`progress` · "Make my routine harder"** · "Small, safe steps up from your history."
   > "I want to progress on what I already do. Look at my routines and last sessions below. Ask me
   > which routine to progress and whether the last sessions felt easy, right or hard. Propose
   > small steps only (about +2.5 kg / +5 lb or +1–2 reps or +5–10 s), never all at once, and keep
   > the same exercises unless I ask."
6. **`home` · "Home or travel"** · "Bodyweight or a few items, any room."
   > "I am training at home or travelling. Ask me in one message what I have (nothing, a mat,
   > dumbbells, bands, a pull-up bar…) and how much space and time. Then propose ONE routine using
   > only that, with duration exercises where reps make no sense."

API: `buildPromptContext(cache, recent, unit) → PromptContext` (pure),
`buildPrompt(profile, context, lang, notes?) → string` (pure), `PROFILES` (ids, title/desc keys).

## 7. UI (frontend stories)

### 7.1 Start chooser — `/gym/start` (new view in the Gym chunk)
Reached from "Start empty session" (home), the dashboard card's Start, and the tour's last step.
Three large cards, one tap each, plus one line:
1. **Just start** — "Timer on, add exercises as you go." → starts an empty session now → `/gym/session`.
2. **Build it now** — "Pick exercises, then go." → quick builder (7.2) → starts.
3. **Ask an AI** — "Claude or ChatGPT writes it with you." → `/gym/import` (7.3).
- Under them: **"Rest day today"** (secondary button) → confirms inline ("Logged — enjoy it.",
  Undo for 5 s) → a `rest_day` complete through the outbox (works offline). Disabled with "Already
  logged" when today's rest day exists in cache.
If routines exist, a fourth compact row on top: "Or follow a routine:" + up to 3 routine chips.

### 7.2 Quick builder — `/gym/build`
One screen, no required field: name prefilled ("Workout · {date}"), an exercise search box with
existing exercises as tappable suggestions (most used first) and "Add '{text}'" for a new one,
kind chips (Reps · Time · Distance) defaulting from the existing exercise; each added line shows
sets × reps/seconds/metres with steppers prefilled 3 × 10 / 3 × 30 s / 1 × 1000 m and optional
weight; ↑↓ and remove. Sticky footer: **Start** (primary) and a checkbox "Save as a routine"
(default on). Start: online + save → `api.importRoutine(...)` then start from the returned
routine; offline or not saved → start a session from the lines directly (`startSession` with a
synthetic `RoutineDetail`, `routine_id` null). Link "Rather ask an AI?" → `/gym/import`.

### 7.3 AI hub — `/gym/import` (reworked)
Two clear halves, the first one being the default focus:
1. **Get a workout from an AI**: six profile cards (title + one line, icon glyph). Tapping one
   expands it in place: (notes box for `notes`), a preview of the prompt (collapsed, "Show
   prompt"), and three buttons: **Copy & open Claude** (copies, then `window.open("https://claude.ai/new", "_blank", "noopener")`),
   **Copy & open ChatGPT** (`https://chatgpt.com/`), **Copy only**. A one-line hint: "Chat, confirm each
   exercise, then come back here and tap Paste."
2. **Bring it back**: big **Paste from clipboard** (`navigator.clipboard.readText()`; on failure or
   no permission, focus the paste box with "Long-press and paste here"), the paste box, **Choose
   file**, and the share-target arrival. Parses as Epic 42, review wizard unchanged except: shows
   `rest_after_seconds`, the schedule strip if present, and the final step's primary button is
   **Create and start** (creates all routines, starts the first / the one picked) with "Create
   only" secondary.
On returning to the tab (`visibilitychange` → visible) with a profile expanded and an empty paste
box, show a gentle banner "Got your workout? Paste it here." with the Paste button.

### 7.4 Everywhere a workout could be missing
- Home "Start a session" card with no routines: primary is the chooser; text "No routine yet —
  let an AI write one" linking `/gym/import`.
- Routines card header: "New workout" button → small menu: Ask an AI (first) · Build it · Import a
  file. The old inline "New routine" name form goes (the builder replaces it).
- Dashboard Gym card: Start → `/gym/start`; with no routines, a second line "Ask an AI for a
  workout" → `/gym/import`; and "Rest day" when nothing logged today.
- Session finished summary: "Want a new one next time? Ask an AI" link only when the session had
  no routine.

### 7.5 Rest in the session
- After the last target set of an exercise, rest = `rest_after_seconds` if set (label "Rest before
  {next exercise}"), else the per-set rest.
- Header gains a **Rest** button → presets 30 / 60 / 90 / 120 / 180 s + "Custom" → `startRest`.
  The rest bar shows remaining time, +15 s, Skip.
- Routine editor and import review: field "Rest after (s)".

### 7.6 History / calendar
History rows and the calendar gym layer show rest days as "Rest day" (glyph ☾), not "Workout".
The session-count in history and the dashboard's "last done" ignore rest days.

## 8. Ownership

| Area | Owner |
|---|---|
| Backend §3–4 (`app/models|schemas|services|api/gym.py`, `services/calendar_feed.py`, tests) | **B** |
| `src/gym/prompts.ts` (+ i18n file `src/i18n/messages/gymPrompts.ts`), `format.ts` (§5), `session.ts` (`startRest`, rest-after logic, `sessionFromLines`), `store.ts` (`recent` in cache, `logRestDay`), `GymCard.tsx` (§7.4), CalendarPage rest label | **F1** |
| `src/pages/gym/*` views: GymStart, GymBuild, GymImport rework, ImportReview, RoutineEditor field, GymSession rest UI, GymHome entry points, GymHistory rest rows, GymTour step text that names changed controls; `src/i18n/messages/gym.ts`; gym CSS; `docs/gym-import.md` | **F2** |

Contracts F2 relies on are the exported signatures in the skeleton (`gym/prompts.ts`, the new
functions in `session.ts` / `store.ts`). Do not change them without saying so.

## 9. Tests (each owner) — same bar as Epic 42

Red-first for every guard (mutation-checked, restored by exact replace), `npm run lint` /
`npx tsc -b` / full `npx vitest run` exit 0 with 0 Unhandled; backend full suite with `EE_TEST_DB`.
Prompts: snapshot-free assertions (contains context lines, omits empty parts, caps lists, French
variant keeps JSON keys English, notes injected, no `undefined`/`null` strings ever in output).
