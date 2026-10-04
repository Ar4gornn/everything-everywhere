# Epic 54: Gym format v2 — per-set targets, effort, tempo, supersets, warm-ups, video player

Decision record **AD-67**. Migration **`0038`** (after `0037`). Both numbers are provisional until
merge: re-check `docs/epics.md` and `backend/migrations/versions/` on `origin/main` first.

Scoped with Alex 2026-10-04. Chosen: `ee-workout/2` (v1 still read), per-set targets, RPE/RIR,
tempo, supersets, warm-up sets, YouTube links from the AI opening a tap-to-load mini-player,
sectioned prompts. Rejected: thumbnails (Google contacted on every render), always-embedded
player, AI giving only a search phrase, extending v1 in place. Out: logging RPE per set during a
session, checking a YouTube id exists.

## 1. Wire contract (frozen — every story builds against this)

`frontend/src/api/types.ts` already carries it (`SetTarget`, `LineTargets`, `WorkoutSet.is_warmup`,
`SetInput.is_warmup`, `RoutineImportLine`). The backend mirrors it field for field.

### Routine line (create, update, import, out)

| Field | Type | Rule |
|---|---|---|
| `set_targets` | `SetTarget[] \| null` | 1–99 items. Each: `reps`, `seconds`, `distance_m`, `weight` (null = no target), `warmup` (bool, default false). Only the measure matching the exercise's kind may be non-null (422 otherwise). Ranges as the flat fields: reps 1–999, seconds 1–86 400, distance_m 1–1 000 000, weight 0–99 999.99 (two-place string out, like `target_weight`). |
| `target_rpe` | number \| null | 1–10, multiple of 0.5. JSON number out. |
| `target_rir` | int \| null | 0–10. **Not both** `target_rpe` and `target_rir` (422). |
| `tempo` | string \| null | `^[0-9X]-[0-9X]-[0-9X]-[0-9X]$` after trim + uppercase. Empty string → null. |
| `superset_group` | int \| null | 1–99. Lines with the same group must be consecutive by position to act as a superset; the server stores what it is given (the client normalises). |

**Normalisation (server, on every write):** when `set_targets` is non-null, `target_sets` is set to
its length, and `target_reps` / `target_seconds` / `target_distance_m` / `target_weight` to the
first non-warm-up set's values (or the first set's if all are warm-ups). Older readers (GymCard,
prompts context, session fallback) keep working unchanged. When `set_targets` is null the flat
fields are as today. An update that sends `set_targets: null` explicitly clears it and leaves the
flat fields as sent/stored.

### Workout sets

`workout_sets.is_warmup BOOLEAN NOT NULL DEFAULT false`. `SetInput.is_warmup` optional (absent =
false). `WorkoutSet.is_warmup` always present in responses. **Warm-up sets are excluded from**
`HistoryPoint.top_weight`, `volume`, `reps`, `sets`, best/total seconds/distance, and any
record/PR computation; they still appear in the workout detail.

## 2. File format `ee-workout/2`

```json
{
  "format": "ee-workout/2",
  "weight_unit": "kg",
  "schedule": ["Push day", "rest", "Pull day", "rest", "Legs", "rest", "rest"],
  "routines": [
    {
      "name": "Push day",
      "note": "optional",
      "exercises": [
        {
          "name": "Bench press", "kind": "reps",
          "video_url": "https://www.youtube.com/watch?v=VIDEO_ID",
          "rpe": 8, "tempo": "3-1-1-0", "rest_seconds": 90, "rest_after_seconds": 120,
          "note": "optional",
          "sets": [
            { "reps": 12, "weight": 40, "warmup": true },
            { "reps": 8, "weight": 60 },
            { "reps": 8, "weight": 60 }
          ]
        },
        { "name": "Pull-up", "kind": "reps", "superset": "A", "sets": 3, "reps": 8, "rir": 2 },
        { "name": "Dips", "kind": "reps", "superset": "A", "sets": 3, "reps": 10 },
        { "name": "Plank", "kind": "duration", "sets": 3, "seconds": 45, "rest_seconds": 60 },
        { "name": "Rowing", "kind": "distance", "sets": 1, "distance_m": 2000 }
      ]
    }
  ]
}
```

- `format` may be `ee-workout/1`, `ee-workout/2`, or absent. Same parser for both; v1 is a subset.
- `sets` is a **number** (same target each set; `reps`/`seconds`/`distance_m`/`weight` at the
  exercise level, exactly as v1) **or an array** of per-set objects. Per-set objects read
  `reps`/`seconds`/`distance_m`/`weight`/`warmup` with the same forgiving-shape, strict-number
  rules as today (`"8"` and `"62,5"` read; out of range kept and flagged). Weights convert by
  `weight_unit` like the flat weight.
- `rpe` / `rir` / `tempo` as §1. Both rpe and rir present → flag, keep both for the person to fix.
- `superset`: any short string label (≤ 8 chars). Consecutive exercises sharing a label form a
  superset; a label that reappears non-consecutively is flagged. `toImportBody` maps labels to
  `superset_group` 1, 2, … per routine in order of first appearance; a group of one exercise is
  sent as null.
- `video_url` as today (https only).

## 3. Stories and file ownership

Parallel builders share one worktree (`C:\dev\PersoProject\ee-gymfmt`, branch
`feat/gym-format-v2`). **Edit only the files your story owns.** Need something from another
story's file? Stop and report it; do not edit it.

| Story | Owns |
|---|---|
| **54.1 Backend** | `backend/**` (models, schemas, services, api, migration `0038_gym_format_v2.py`, tests) |
| **54.2 Parser + prompts** | `frontend/src/gym/format.ts` (+test), `frontend/src/gym/prompts.ts` (+test), `i18n/messages/gymPrompts.ts`, `i18n/messages/gymFormat.ts`, `docs/gym-import.md`, `frontend/src/pages/gym/GymImport.tsx` (+test) only if the doc test needs it |
| **54.3 Editor + review** | `pages/gym/ImportReview.tsx`, `pages/gym/RoutineEditor.tsx` (+test), `pages/gym/SetFields.tsx`, `api/client.ts`, `i18n/messages/gymPlans.ts`, `styles.css` between the 54.3 markers |
| **54.4 Session** | `gym/session.ts` (+test), `gym/store.ts` (+test), `pages/gym/GymSession.tsx` (+test), `pages/gym/GymRest.test.tsx`, `i18n/messages/gymSessionV2.ts`, `styles.css` between the 54.4 markers |
| **54.5 Video player** | `components/VideoLink.tsx` (+test), `gym/youtube.ts` (+test), `pages/gym/GymHistory.tsx`, `ops/Caddyfile`, `ops/compose.verify.yml` (CSP only), `i18n/messages/gymVideo.ts`, `styles.css` between the 54.5 markers |

Contract already in place (orchestrator): `api/types.ts`, `i18n/catalogue.ts` (the four message
files registered), `pages/gym/testkit.tsx`, `components/GymCard.test.tsx`, `VideoLink` stub with
frozen props `{ url: string; label?: string }`.

### `DraftLine` additions (54.2 defines, 54.3 consumes)

```ts
export interface DraftSet {
  reps: number | null; seconds: number | null; distance_m: number | null;
  weight: number | null; warmup: boolean;
  errors: Partial<Record<"reps" | "seconds" | "distance_m" | "weight", MessageKey>>;
}
// on DraftLine:
setTargets: DraftSet[] | null;   // null = uniform sets (the flat fields apply)
rpe: number | null;
rir: number | null;
tempo: string;                   // "" = none
superset: string;                // "" = none; the file's label
// LineField gains: "set_targets" | "rpe" | "rir" | "tempo" | "superset"
```

`lineErrors`/validation must cover the new fields; the review's Confirm stays disabled while any
per-set error exists. `toImportBody` emits `set_targets` (weights as two-place strings),
`target_rpe`, `target_rir`, `tempo`, `superset_group`.

### 54.3 Editor + review

- Review and routine editor: a "Same every set / Vary per set" switch. Per-set mode shows one row
  per set (measure for the kind, weight, Warm-up checkbox), add/remove set buttons (1–99).
  Switching to per-set seeds rows from the flat values; switching back keeps the first working
  set's values and drops the list (confirm only if rows differ).
- Effort: a small select RPE / RIR / none + number input. Tempo: text input with the pattern hint.
- Superset: "Superset with next" toggle on a line, rendering a bracket/label joining the lines.
  Editor normalises groups so they are consecutive (renumber 1, 2, … on save).
- Every field also visible (read-only) in the review summary page.
- Video URL field uses `VideoLink` for its preview.
- Phone width 320 in French must not overflow (check card edges, left and right).

### 54.4 Session

- `SessionExercise` gains `set_targets`, `target_rpe`, `target_rir`, `tempo`, `superset_group`;
  `SessionSet` gains `is_warmup`. `startSession` copies them; ad-hoc exercises get nulls.
- `nextSetDraft`: with `set_targets`, the draft for set *n* is `set_targets[n]` (beyond the list:
  the last one). The logged set's `is_warmup` comes from that target. A warm-up set is visibly
  badged; done-count/progress still counts it.
- Hints under the exercise: "RPE 8" / "2 reps in reserve", "Tempo 3-1-1-0" (with a one-line
  explanation of tempo on tap or as title).
- Supersets: `currentExercise` alternates: after logging a set of a member, the current exercise
  is the next member of the group that still has sets left (wrapping to the first member);
  rest starts only after the last member of a round, using that member's `rest_seconds`; when
  the whole group is done, `rest_after_seconds` of the last member applies as today.
- `toCompleteBody` sends `is_warmup: true` for warm-up sets (omit when false). The outbox shape is
  otherwise unchanged (AD-58).
- Replace the session's plain video `<a>` with `<VideoLink url=… />`.

### 54.5 Video player

- `gym/youtube.ts`: `youtubeId(url: string): string | null` for `youtube.com/watch?v=`,
  `m.youtube.com`, `music.youtube.com`, `youtu.be/`, `youtube.com/shorts/`, `/embed/`,
  `/live/`, `youtube-nocookie.com/embed/`; ids are exactly `[A-Za-z0-9_-]{11}`; anything else null.
  `youtubeStart(url): number | null` from `t=`/`start=` (`90`, `1m30s`).
- `VideoLink`: YouTube id → a "▶ Watch" button (no thumbnail, no network). Tap → an inline
  16:9 iframe `https://www.youtube-nocookie.com/embed/<id>?playsinline=1&rel=0[&start=n]` with
  `title`, `allow="encrypted-media; picture-in-picture; fullscreen"`, `referrerpolicy=
  "strict-origin-when-cross-origin"`, `loading="lazy"`, a close button, and an "Open on YouTube"
  link. Non-YouTube https URL → the plain external link. Non-https → nothing rendered.
- CSP in `ops/Caddyfile` (and the verify compose if it carries its own): add
  `frame-src https://www.youtube-nocookie.com` and nothing else.
- Use `VideoLink` in `GymHistory.tsx` exercise rows.
