# Getting a workout from Claude or ChatGPT into Everything Everywhere

Epic 42. You describe what you want to a chat assistant, it asks the right questions and walks
you through every exercise, then hands you one small JSON file. The app reads that file on your
phone, shows you each exercise again for a last check, and only then creates the routine.

Two confirmations, on purpose: the chat confirms the **plan** (is this the right exercise, the
right weight?), the app's review confirms the **transcription** (did the numbers arrive as
meant?). Nothing is created until you press Create at the end.

## 1. The prompt

In the app: **Gym → Import from file → Prompt for Claude / ChatGPT → Copy prompt**. Or copy it
from here. Paste it as your first message in Claude or ChatGPT. It is the same text, word for
word, that the app ships (a test keeps the two identical).

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

## 2. The format, `ee-workout/1`

```json
{
  "format": "ee-workout/1",
  "weight_unit": "kg",
  "routines": [
    {
      "name": "Push day",
      "note": "Optional",
      "exercises": [
        { "name": "Bench press", "kind": "reps", "sets": 4, "reps": 8, "weight": 60, "rest_seconds": 90 },
        { "name": "Plank", "kind": "duration", "sets": 3, "seconds": 45, "rest_seconds": 60 },
        { "name": "Rowing", "kind": "distance", "sets": 1, "distance_m": 2000, "note": "Easy pace" }
      ]
    }
  ]
}
```

| Field | Where | Meaning | Limits |
|---|---|---|---|
| `format` | top | Always `"ee-workout/1"`. May be left out. | |
| `weight_unit` | top | `"kg"` or `"lb"`. If it differs from your account's unit, weights are converted and rounded to the nearest 0.5, and the review flags them. | |
| `routines` | top | One or more routines. A single routine may also be the whole file (`{ "name": ..., "exercises": [...] }`). | |
| `name` | routine | Routine name | 1 to 80 characters |
| `note` | routine | Free text | up to 500 characters |
| `exercises` | routine | The lines, in order. The same movement may appear twice (warm-up and working sets). | 1 to 60 |
| `name` | exercise | Matched to your existing exercises by name, ignoring case. | 1 to 80 characters |
| `kind` | exercise | `reps`, `duration` or `distance`. If missing it is inferred: `seconds` present means duration, `distance_m` means distance, else reps. | |
| `sets` | exercise | Number of sets | 1 to 99 |
| `reps` | `reps` exercises | Repetitions per set | 1 to 999 |
| `seconds` | `duration` exercises | Seconds per set | 1 to 86 400 |
| `distance_m` | `distance` exercises | Metres per set | 1 to 1 000 000 |
| `weight` | exercise | Optional load, in `weight_unit`. Leave it out for bodyweight. Works for all three kinds (a weighted plank, a loaded carry). | 0 to 99 999.99 |
| `rest_seconds` | exercise | Rest after each set | 0 to 3 600 |
| `note` | exercise | Short remark shown during the session | up to 200 characters |

The reader is forgiving about shape and strict about numbers. A chat answer with prose around
a JSON code block is fine. Numbers written as text (`"8"`, `"62,5"`) are read. Unknown keys are
ignored. A value that cannot be read exactly (negative, out of range, not a number) is never
guessed: it is kept and flagged in the review for you to fix.

## 3. Getting the file into the phone

1. **Share it to the installed app (Android).** Save the assistant's answer as `workout.json`
   (or share the text), open the share sheet and pick *Everything Everywhere*. The app opens on
   the import page with the workout already read. This needs the app installed from the browser
   (Add to Home screen). iOS has no share target; use 2 or 3.
2. **Pick the file.** Gym → Import from file → *Choose a file*, then select `workout.json`
   from Files or Downloads (`.json` or `.txt`, 256 KB at most).
3. **Paste it.** Copy the JSON from the chat, open Gym → Import from file, paste into the box
   and press *Read workout*.

Importing needs a connection for the final Create step only. You can read and review offline;
the review is kept in that tab until you are back online.

## 4. What the review does

After the file is read, the app walks you through **one exercise at a time** (*Exercise 3 of 8*).
Every field is editable: name, kind, sets, reps or seconds or metres, weight, rest, note, video
link.

- If the name matches an exercise you already have, it says *Uses your existing ...* and the
  kind is shown and locked to that exercise's kind. Rename the exercise to make a new one.
- Otherwise it says *New exercise* and the kind is yours to choose.
- A field that is out of range or unreadable shows its problem under the field, and **Confirm**
  stays disabled until it is fixed.
- **Confirm** accepts the exercise, **Skip** leaves it out, **Back** returns to the previous one.
- The last page lists what will be created, per routine. **Create** posts each routine in one
  transaction; a routine whose every exercise was skipped is not created.
