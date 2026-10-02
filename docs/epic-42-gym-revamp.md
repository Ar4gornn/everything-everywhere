# Epic 42 — Gym, rebuilt: offline sessions, timed exercises, workouts from a file

Status: **skeleton** (2026-10-02, Opus). Build by Sonnet agents against the contracts below.
Branch `feat/gym-revamp`, worktree `ee-gym`. Migration `0035` after `0034`. Decision record AD-58.

## 1. What Alex asked for (verbatim intent → story)

| Ask | Story |
|---|---|
| Revamp the gym tab, well thought out, easy to use | 42.4 (page), 42.5 (live session) |
| Accessible offline once the app is installed | 42.3 (offline core) |
| Start a gym session from the dashboard | 42.6 (dashboard card) |
| Duration exercises | 42.1 (model), every UI story |
| Send a file → workout created on the phone | 42.2 (import endpoint), 42.7 (file / paste / share target + review) |
| Track the workout while working out: sets, reps, weight, time, whatever unit | 42.5 |
| Template so Claude/GPT writes the file, confirming each exercise with a chance to correct | 42.7 (in-app prompt + per-exercise review), `docs/gym-import.md` |

Decisions taken without an interview (the goal said not to pause). Recorded so Alex can overturn:

- **Three exercise kinds**: `reps`, `duration`, `distance`. "Whatever unit" read as: reps, seconds,
  metres — each with an optional weight (a weighted plank, a loaded carry). Rejected: free-form
  units per exercise (unchartable, unsummable).
- **Weight stays in the account's unit** (`user.weight_unit`), as today. A file that says
  `"weight_unit": "lb"` on a kg account is converted at review time (rounded to 0.5) and flagged.
- **One file format, JSON, `ee-workout/1`.** The parser tolerates a pasted chat answer (JSON inside a
  ```json fence or surrounded by prose). Rejected: CSV (no nesting), free text parsed by heuristics
  (silently wrong numbers — the one thing a log must not do).
- **Two confirmations, on purpose**: the LLM prompt confirms each exercise in the chat; the app's
  review then walks each exercise again with every field editable. The first catches the plan,
  the second catches the transcription.
- **Offline = the gym only.** Routines and exercises are cached on the device; a session is
  recorded entirely on the device and sent whole when the network is back. Every other page still
  needs the server (AD-58 says why).
- Repeats allowed in a routine (the old `UNIQUE (routine_id, exercise_id)` is dropped): an
  imported program may use the same movement twice (warm-up and working sets).

Non-scope: supersets/circuits as a structure, plate calculator, editing a past session's sets,
Apple Health / Google Fit, scanning a photo of a program, LLM calls from the server.

## 2. AD-58 — A gym session is recorded on the device and sent whole

A set logged at the gym must not depend on the gym's wifi. So the live session no longer creates a
workout row and posts sets one by one; it lives in `localStorage` (keyed by user id), every change
written synchronously, and is sent **once**, on Finish, as one body to
`POST /api/gym/workouts/complete`, idempotent on a client-generated `client_ref` (UUID). A Finish
that cannot reach the server goes to an **outbox**, flushed on `online`, on app start and on
opening the gym. A replay of the same `client_ref` returns the row already written (200), never a
second workout. The uniqueness is `UNIQUE (user_id, client_ref)` — scoped to the tenant so an
`ON CONFLICT` can never meet a row RLS hides (lab note: that raises instead of resolving).

The service worker still never caches `/api/*` (Story 8.1's rule stands). The *app* caches the gym's
read data — routines with their lines, exercises, last 20 workouts, last-time figures — under
`everything-everywhere.gym.<userId>.*`, removed on explicit sign-out like note drafts (AD-48).
The outbox and the active session go too — data left in a browser after its owner signed out is
the leak sign-out exists to prevent. Sign-out warns first (one `confirm`) when either holds
something. An *expired* session (401) keeps them, so signing back in sends them.

Two prerequisites the rest of the app did not need until now:

1. **Auth must survive an offline launch.** `AuthContext` currently clears the tokens when
   `api.me()` fails for *any* reason, so opening the installed app with no network signs the
   person out. Now: only an `ApiError` with status 401 clears; a network failure (`TypeError`,
   or `ApiError` status 0 if the client maps it so) adopts the last user snapshot stored at
   `everything-everywhere.user.<…>` (written by `adopt`, removed by `signOut` and the 401
   handler) and exposes `offline: true` on the auth state. With no snapshot, behave as today.
2. **The gym chunks must be on the device before they are needed.** Pages are lazy chunks cached
   by the worker only once fetched. After sign-in (production only, on idle) the app imports the
   Dashboard and Gym page modules so the worker caches them; `vite build` must not split the
   session/import views into chunks that are not covered — they are part of the Gym chunk.

## 3. Data (migration 0035 — written in the skeleton)

- `exercises.kind text NOT NULL DEFAULT 'reps' CHECK (kind IN ('reps','duration','distance'))`.
  Kind changes only while the exercise has no logged sets (409 `exercise_kind_locked`).
- `routine_exercises`: `target_seconds int` (1..86400), `target_distance_m int` (1..1_000_000),
  `target_weight numeric(7,2)` (≥0), `rest_seconds int` (0..3600), `note varchar(200)`; unique
  `(routine_id, exercise_id)` dropped.
- `workout_sets`: `reps` nullable; `duration_seconds int` (1..86400), `distance_m int`
  (1..1_000_000); CHECK at least one of the three is set. Which one is *required* follows the
  exercise kind and is enforced in the service: `reps` → reps; `duration` → duration_seconds;
  `distance` → distance_m. Weight optional for all three.
- `workouts`: `started_at timestamptz`, `ended_at timestamptz` (CHECK ended ≥ started),
  `client_ref uuid` with `UNIQUE (user_id, client_ref)`.

## 4. API contract (backend story 42.1 + 42.2)

Existing endpoints keep working; additions are **bold**.

| Method | Path | Body → Response |
|---|---|---|
| GET | `/api/gym/exercises` | → `Page[ExerciseOut]`, ExerciseOut **+ `kind`** |
| POST | `/api/gym/exercises` | `{name, video_url?, note?, **kind?**}` → ExerciseOut. Idempotent by name (AD-12); an existing exercise keeps its kind. |
| PATCH | `/api/gym/exercises/{id}` | **+ `kind`** (409 `exercise_kind_locked` if it has sets) |
| GET | `/api/gym/exercises/{id}/history` | points **+ `best_seconds`, `total_seconds`, `best_distance_m`, `total_distance_m`** (all nullable), `reps` = total reps (0 when none) |
| **GET** | **`/api/gym/routines/full`** | → `Page[RoutineDetailOut]` — every routine with its lines, one request, for the offline cache. Declared **before** `/routines/{routine_id}`. |
| **PATCH** | **`/api/gym/routines/{id}`** | `{name?, note?}` → RoutineOut |
| POST | `/api/gym/routines/{id}/exercises` | **+ `kind?` (used only when `exercise_name` coins a new exercise), `target_seconds?`, `target_distance_m?`, `target_weight?`, `rest_seconds?`, `note?`** |
| **PATCH** | **`/api/gym/routines/lines/{line_id}`** | `{target_sets?, target_reps?, target_seconds?, target_distance_m?, target_weight?, rest_seconds?, note?}` — explicit null clears, absent leaves → RoutineLineOut |
| **PUT** | **`/api/gym/routines/{id}/order`** | `{line_ids: [uuid…]}` — must be exactly the routine's lines (422 `order_mismatch`) → RoutineDetailOut |
| **POST** | **`/api/gym/routines/import`** | RoutineImport → 201 RoutineDetailOut. One transaction: routine + get-or-create each exercise by name + lines in order. An existing exercise whose kind differs from the line's → 422 `exercise_kind_mismatch` (detail names it), nothing written. 1..60 lines. |
| **POST** | **`/api/gym/workouts/complete`** | WorkoutComplete → 201 WorkoutDetailOut, or **200** with the existing workout when `client_ref` was already used by this user. Sets 0..500. |
| POST | `/api/gym/workouts/{id}/sets` | SetCreate: `reps` now optional, **+ `duration_seconds?`, `distance_m?`**; validated against the exercise kind (422 `set_missing_measure`) |

RoutineLineOut **+ `kind`, `target_seconds`, `target_distance_m`, `target_weight`, `rest_seconds`,
`note`**. SetOut **+ `kind`, `duration_seconds`, `distance_m`**, `reps` nullable. WorkoutOut and
WorkoutDetailOut **+ `started_at`, `ended_at`** (nullable).

```text
RoutineImport  { name: str 1..80, note?: str ≤500,
                 lines: [ { exercise_name: str 1..80, kind: reps|duration|distance,
                            video_url?: https str, target_sets?: 1..99, target_reps?: 1..999,
                            target_seconds?: 1..86400, target_distance_m?: 1..1000000,
                            target_weight?: Weight, rest_seconds?: 0..3600, note?: str ≤200 } ] }
WorkoutComplete { client_ref: uuid, routine_id?: uuid (unknown → stored null, not 404: the routine
                  may have been deleted while the phone was offline), performed_on: date,
                  started_at?: datetime, ended_at?: datetime, note?: str ≤500,
                  sets: [ { exercise_id?: uuid | exercise_name?: str (exactly one; a name coins
                            the exercise with `kind`), kind?: reps|duration|distance,
                            reps?: 1..999, weight?: Weight, duration_seconds?: 1..86400,
                            distance_m?: 1..1000000 } ] }
```

Sets in WorkoutComplete are stored with `position` = their index. An `exercise_id` that is not the
caller's → 404 like everywhere else (composite FK already guarantees it). Activity tracking
(`services/activity.py` maps `/api/gym` → `gym`) needs nothing: a complete is a `/api/gym` write.

All strings that reach JSONB/text pass the existing lone-surrogate guard (app-wide dependency).

## 5. The import format `ee-workout/1`

```json
{
  "format": "ee-workout/1",
  "weight_unit": "kg",
  "routines": [
    {
      "name": "Push day",
      "note": "Optional, ≤500 chars",
      "exercises": [
        { "name": "Bench press", "kind": "reps", "sets": 4, "reps": 8, "weight": 60, "rest_seconds": 90 },
        { "name": "Plank", "kind": "duration", "sets": 3, "seconds": 45, "rest_seconds": 60 },
        { "name": "Rowing", "kind": "distance", "sets": 1, "distance_m": 2000, "note": "Easy pace" }
      ]
    }
  ]
}
```

Parser rules (`frontend/src/gym/format.ts`, pure, offline):
- Accept the object above; also a single routine at top level (`{name, exercises}`), and the
  same with `"format"` missing. Anything else → a typed error with a translated message key.
- Extract JSON from a ```json fence, else from the first `{` to the matching last `}`.
- `kind` missing → inferred: `seconds` present → duration, `distance_m` → distance, else reps.
- Numbers may arrive as strings (`"8"`) or with a decimal comma (`"62,5"`) → normalised; anything
  non-finite, negative or out of the §4 ranges is kept but flagged as a field error for the review.
- `weight_unit` ≠ the account's → weight converted (kg↔lb, factor 2.20462, rounded to 0.5),
  flagged `converted`.
- Unknown keys ignored, never an error (LLMs add keys).
- Output: `ParsedImport { routines: DraftRoutine[], warnings: MessageKey[] }`, every
  `DraftLine` carrying `errors: Partial<Record<field, MessageKey>>`.

## 6. Frontend — modules and ownership

Contracts are in the skeleton files; agents fill bodies, do not change exported signatures
without saying so in their report.

| File | Owner | Role |
|---|---|---|
| `src/api/types.ts`, `src/api/client.ts` (gym part) | skeleton (done) | Wire types + calls of §4 |
| `src/gym/format.ts` | F1 | §5 parser + `toImportBody` |
| `src/gym/session.ts` | F1 | Pure live-session model: start, add set, edit/remove set, add exercise, next target, finish → `WorkoutComplete` body |
| `src/gym/store.ts` | F1 | Per-user cache, active session persistence, outbox + `flushOutbox`, `useGymData()` hook (cache-first, refresh from server when online) |
| `src/gym/share.ts` | F1 | Read + clear a file/text the service worker received via the share target |
| `src/auth/AuthContext.tsx` | F1 | Offline launch (§2.1), `offline` flag, clear gym store on sign-out, warn if outbox non-empty |
| `src/App.tsx` | F1 | Idle preload of Dashboard + Gym chunks after sign-in; routes `/gym`, `/gym/session`, `/gym/import`, `/gym/routines/:id` all render inside the Gym chunk |
| `public/sw.js`, `public/manifest.webmanifest` | F1 | Share target (§7), keep the share cache on activate |
| `src/components/GymCard.tsx` + dashboard wiring + `layout/preferences.ts` card id `gym` | F1 | §8 |
| `src/i18n/messages/gymCore.ts` | F1 | Strings for the above |
| `src/pages/GymPage.tsx` and `src/pages/gym/*` | F2 | §9 page, session, import review, routine editor |
| `src/i18n/messages/gym.ts` | F2 | Strings for the page (rewrite freely; delete unused keys) |
| `src/styles.css` (gym block) | F2 | Qualified class names (`.gym-…`) — class names are global here |
| `docs/gym-import.md` | F2 | The LLM prompt, the format, how to send the file to the phone |
| backend `app/models/gym.py`, `schemas/gym.py`, `services/gym.py`, `api/gym.py`, `services/preferences.py` (card `gym`), `tests/test_gym*.py` | B | §3, §4 |

F2 imports F1's modules by their skeleton signatures; while F1's bodies are TODO, F2 tests mock
them (`vi.mock("../gym/store")`) or wait — the integration run is after both report.

## 7. Share target (Android Chrome; iOS has none — the file picker and paste cover it)

`manifest.webmanifest` gains:

```json
"share_target": {
  "action": "/gym/share",
  "method": "POST",
  "enctype": "multipart/form-data",
  "params": { "title": "title", "text": "text",
              "files": [{ "name": "file", "accept": ["application/json", ".json", "text/plain", ".txt"] }] }
}
```

`sw.js`: before the `GET`-only early return, a `POST` to `/gym/share` is answered by reading the
form data (first file's text, else `text`), refusing anything over 256 KB, storing it as a
`Response` in cache `share-inbox` under `/__share/gym`, and answering `Response.redirect("/gym/import?shared=1", 303)`.
`activate` keeps `share-inbox` alongside SHELL and ASSETS. `src/gym/share.ts` reads that entry and
deletes it in the same call. Nothing in the shared text is evaluated — it goes to the parser.

## 8. Dashboard card `gym`

Card id `gym` (backend `CARDS` + frontend list; module `gym`, so hidden when Gym is off). Draws:
- an active session → "Session in progress · {minutes} min" + **Resume** (→ `/gym/session`);
- else **Start session** (empty) and up to 3 routines (most recently used first) as one-tap start
  buttons → creates the active session from the cached routine and navigates to `/gym/session`;
- outbox non-empty → "{n} sessions waiting to sync" (plural forms);
- works offline from the cache. Draws nothing when the gym module is off.

## 9. The Gym page (F2)

Phone first, thumb reach, one job per screen.

`/gym` (home), top to bottom:
1. **Resume banner** when a session is active (elapsed time, Resume, Discard with confirm).
2. **Start**: "Start empty session" + routine cards (name, n exercises, est. duration from targets
   + rests, last done date). Tap → session starts, navigates to `/gym/session`.
3. **Routines**: list with Edit (→ `/gym/routines/:id`), **New routine**, **Import from file**
   (→ `/gym/import`). Offline: edit/new/import disabled with a one-line reason.
4. **History**: last sessions (date, routine, duration, exercise count, sets), expand for sets by
   exercise, delete with confirm (online only). Per-exercise progress chart (existing
   `StrengthChart` for weight; seconds/metres for the other kinds).
5. **Exercises**: name, kind, video link, note; edit inline; offline read-only.
6. Offline pill + "{n} waiting to sync" when relevant.

`/gym/session` (live):
- Sticky header: routine name, elapsed timer, **Finish** (confirm if a planned set is undone),
  overflow: Discard (confirm), add note.
- One card per exercise in plan order; the **current** one expanded, done ones collapsed with a ✓.
  Card: name, kind, target ("4 × 8 · 60 kg", "3 × 45 s", "1 × 2 km"), "Last time: …" from cache,
  video link.
- Logged sets as rows (set n, value, weight) — tap to edit, swipe/delete button to remove.
- The **next set row** is prefilled from the previous set of this exercise, else the target; big
  steppers (±1 rep, ±2.5 kg / ±5 lb, ±5 s, ±100 m) and one large **Done** button. For `duration`:
  a **Start timer** that counts up and stops into the seconds field (or counts down from the
  target and vibrates at zero, `navigator.vibrate` if present).
- After **Done**: rest countdown (line's `rest_seconds`, default 90 s for reps, 60 s otherwise),
  skippable, vibrates at zero. Screen wake lock (`navigator.wakeLock`) while the session page is
  open, if supported, released on leave.
- **Add exercise** to the session (pick existing or type a new name + kind).
- Progress line: "Exercise 2/6 · 7/20 sets".
- Every change persisted immediately (store). Survives reload, app kill, offline.
- Finish → summary (duration, sets, total volume, new bests vs cache) → queued + flushed.

`/gym/import`:
- Three ways in: **Choose file** (`accept=".json,.txt,application/json,text/plain"`), **Paste**,
  and arriving via the share target (`?shared=1`).
- **Prompt for Claude / ChatGPT**: collapsible block with the prompt (§10) and **Copy prompt**
  (Clipboard API, fallback select-all).
- Review wizard: per routine, then **one exercise per step** — "Exercise 3 of 8", every field
  editable (name, kind, sets, reps/seconds/metres, weight, rest, note), matched against existing
  exercises ("Uses your existing Bench press" / "New exercise"; existing kind shown and locked
  unless renamed), field errors inline, **Confirm** / **Skip** / **Back**. Final step lists what
  will be created; **Create** posts `/routines/import` per routine (online only; offline → a clear
  message, draft kept in sessionStorage).

`/gym/routines/:id`: rename, note, lines with kind-aware targets (PATCH line), reorder ↑/↓ (PUT
order), add exercise (existing or new + kind), remove, delete routine (confirm), start session.

i18n: every string `{ en, fr }`; plurals via the catalogue's plural helper; French measured at
375 and 320 (lab notes). Every number display via the existing formatting helpers.

## 10. The LLM prompt (shipped in-app and in `docs/gym-import.md`)

Keep this text exact in English; F2 translates it for the French catalogue entry (the JSON keys
stay English).

```text
You are helping me build a gym workout that I will import into my app "Everything Everywhere".

1. First ask me, in one message: my goal, my level, how many days a week, how long a session can
   be, what equipment I have, any injuries, and whether I count weight in kg or lb.
2. Propose the routine(s) as a short list (name, exercises with sets × reps or time or distance).
3. Then go through the exercises ONE AT A TIME. For each, show: name, kind (reps, duration or
   distance), sets, reps or seconds or metres, weight, rest in seconds, and a short note. Ask me
   to confirm or correct it. Apply my corrections and show it again until I say it is right.
   Do not move to the next exercise before I confirm the current one.
4. When every exercise is confirmed, reply with ONLY one JSON code block, nothing before or after
   it, in exactly this format:

{
  "format": "ee-workout/1",
  "weight_unit": "kg",
  "routines": [
    {
      "name": "Routine name",
      "note": "optional",
      "exercises": [
        { "name": "Bench press", "kind": "reps", "sets": 4, "reps": 8, "weight": 60, "rest_seconds": 90, "note": "optional" },
        { "name": "Plank", "kind": "duration", "sets": 3, "seconds": 45, "rest_seconds": 60 },
        { "name": "Rowing", "kind": "distance", "sets": 1, "distance_m": 2000 }
      ]
    }
  ]
}

Rules for the JSON: "kind" is one of "reps", "duration", "distance". Use "reps" for reps
exercises, "seconds" for duration exercises, "distance_m" (metres) for distance exercises.
"weight" is a number in my unit, or omit it for bodyweight. Whole numbers for sets, reps,
seconds, rest_seconds and distance_m. Names under 80 characters, notes under 200. No comments
inside the JSON.

5. Finally tell me: "Save this as workout.json and share it to Everything Everywhere, or copy it
   and paste it in Gym → Import."
```

## 11. Tests (each agent; mutation-check the guards per lab notes)

Backend (B): kind validation per set; complete idempotency (same `client_ref` twice → one row,
200 the second time; different user same `client_ref` → two rows); import atomic on
`exercise_kind_mismatch`; order mismatch 422; kind lock 409; history duration/distance sums;
cross-user ids → 404 on every new endpoint; `/routines/full` route not shadowed; `EE_TEST_DB=ee_gym_test`.
Frontend (F1): parser table (fence, prose, single routine, string numbers, decimal comma, unit
conversion, out-of-range flags, unknown keys, garbage); session model; outbox flush (network
failure keeps, 4xx marks refused and keeps for the UI, success removes, replay safe); auth offline
launch (network failure keeps the session, 401 clears); dashboard card states.
Frontend (F2): session page flow (prefill, Done, rest, edit/remove, finish → queued), duration
timer with fake timers, import wizard (confirm/skip/back, edit a field, kind lock on existing),
routine editor calls, offline-disabled controls. `npm run lint`, `npx tsc -b`, full `npx vitest run`
exit 0 with `grep -c Unhandled` = 0.

## 12. Gym tour (replaces the text-only help popup)

`frontend/src/pages/gym/GymTour.tsx`: a spotlight coach-mark over the gym **home** only. A dimmed
layer with a cut-out around the real card a step is about (`data-tour="gym-start|gym-routines|
gym-import|gym-history"`), and a panel (bottom sheet on phones, 360px card on desktop, centred when
a step has no target or the target is missing). The round `?` button at the end of the title row
replays it; Escape, arrows and Enter work; focus moves to each step's heading and returns to `?`.

Nine steps: welcome, start a session, log a set (demo), time a hold (demo), routines, import
(demo: the four stages + a real Copy prompt), history, offline (live device status), done
(offers "Start a session"). Collapsed cards a step needs are opened and put back on close.

**Why the demos are sandboxed.** `SetDemo` and `TimerDemo` hold their numbers in local state; they
never call `api.*`, never `setActive`, never write the store. A tour that left a set in the
person's history, or a session the resume card then offers, would cost more trust than the tour
earns. A test snapshots the mock call counts and localStorage around a full run of the demos.
`TimerDemo` reuses the real `SetTimer` (exported from `SetFields.tsx`), so what is taught is what runs.

**Opening.** Once per user per device: `everything-everywhere.gym.<userId>.tourSeen` = `"1"`,
written on any close. Not while a session is running, not while the app's first-login tour is
running (`useTutorial().step`), decided once per mount. Blocked storage falls back to a
page-lifetime memory so it does not reopen on every visit. Strings: `gym.tour.*` in
`i18n/messages/gym.ts`; the old `gym.help.*` keys and `GymHelp` are gone.
