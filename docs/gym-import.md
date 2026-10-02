# Getting a workout from Claude or ChatGPT into Everything Everywhere

Epics 42 and 43. You pick the kind of workout you want, the app writes a prompt that already knows
your unit, your exercises and your last sessions, you carry it to Claude or ChatGPT, the chat asks
the right questions and confirms every exercise with you, and hands you one small JSON file. The
app reads that file on your phone, shows each exercise again for a last check, creates the
routine, and **starts it**.

Two confirmations, on purpose: the chat confirms the **plan** (is this the right exercise, the
right weight?), the app's review confirms the **transcription** (did the numbers arrive as
meant?). Nothing is created until you press **Create and start** (or **Create only**) at the end.

## 1. The flow

In the app: **Gym → Start a session → Ask an AI** (or **Routines → New workout → Ask an AI**).
The page has two halves.

**Get a workout from an AI.** Six cards, one per kind of person. Tap one to open it.

| Card | For | The AI starts by |
|---|---|---|
| I know what I want | Your own notes, possibly messy (there is a notes box whose text goes into the prompt) | Asking only what is missing, then listing everything once |
| Build me one | No idea where to start | Interviewing you about goal, level, time, equipment, injuries; proposes a weekly plan with rest days |
| Something new every day | A different workout each time | Reading your last sessions, asking how long, what area, your energy |
| Short on time | 15 to 30 minutes | Asking minutes and equipment, one short routine |
| Make my routine harder | Progress from your history | Asking which routine and how the last ones felt; small steps only |
| Home or travel | Bodyweight or a few items | Asking what you have, space and time |

Each card offers **Show prompt** (a preview), **Copy & open Claude** (copies the prompt, then opens
`claude.ai/new`), **Copy & open ChatGPT** (copies, then opens `chatgpt.com`) and **Copy only**.
The prompt travels by the clipboard only: it and your history never go in a URL.

**Bring it back.** Chat, confirm each exercise, come back and tap **Paste from clipboard**. If the
browser refuses to let the page read the clipboard, the paste box is focused: long-press and
paste. You can also **Choose a file**, or share the file to the app (Android, section 3). On
returning to the tab with a card open and nothing pasted yet, a banner says "Got your workout?
Paste it here."

### The prompt

Every prompt is: a role, the profile's own instructions, a block about you ("About me": unit,
your exercises, your routines, your last sessions, each part left out when empty), the rules for
confirming exercises, and the format below. This is the **Build me one** prompt as it reads for
an account with nothing in it yet, word for word (a test keeps this text identical to what the
app builds). With data, the "About me" block lists your exercises, routines and sessions, and
the French variant keeps every JSON key in English.

```text
You are helping me build a gym workout that I will import into my app "Everything Everywhere".

I don't know what to do at the gym. Interview me before proposing anything: ask about my goal, my experience, how often and how long I can train, my equipment, injuries or pain, what I enjoy or hate, and anything else you need — a few questions per message, as many messages as needed. Find my real level; when unsure, choose the easier option. Then propose a weekly plan with rest days (fill "schedule") and the routines for it.

About me (from my app):
- I count weight in kg.

Then go through the exercises ONE AT A TIME. For each, show: name, kind (reps, duration or distance), sets, reps or seconds or metres, weight, rest between sets in seconds, rest after the exercise in seconds, and a short note. Ask me to confirm or correct it, and do not move on until I confirm. Keep each message short — I am probably at the gym.

When every exercise is confirmed, reply with ONLY one JSON code block, nothing before or after it, in exactly this format:

{
  "format": "ee-workout/1",
  "weight_unit": "kg",
  "schedule": ["Push day", "rest", "Pull day", "rest", "Legs", "rest", "rest"],
  "routines": [
    {
      "name": "Routine name",
      "note": "optional",
      "exercises": [
        { "name": "Bench press", "kind": "reps", "sets": 4, "reps": 8, "weight": 60, "rest_seconds": 90, "rest_after_seconds": 120, "note": "optional" },
        { "name": "Plank", "kind": "duration", "sets": 3, "seconds": 45, "rest_seconds": 60 },
        { "name": "Rowing", "kind": "distance", "sets": 1, "distance_m": 2000 }
      ]
    }
  ]
}

Rules for the JSON: "kind" is one of "reps", "duration", "distance". Use "reps" for reps exercises, "seconds" for duration exercises, "distance_m" (metres) for distance exercises. "weight" is a number in my unit, or omit it for bodyweight. "rest_seconds" is the rest between sets; "rest_after_seconds" is the rest after the last set of the exercise, before the next exercise. "schedule" is optional: an array of day labels for a week, using "rest" for a rest day; include it only when you proposed a weekly plan. Whole numbers for sets, reps, seconds, rest_seconds, rest_after_seconds and distance_m. Names under 80 characters, notes under 200. No comments inside the JSON.

Finally tell me: "Save this as workout.json and share it to Everything Everywhere, or copy it and paste it in Gym → New workout → Ask an AI."
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
| `schedule` | top | Optional (Epic 43). An array of day labels for a week, `"rest"` for a rest day, for example `["Push day", "rest", "Pull day", "rest", "Legs", "rest", "rest"]`. Shown in the review as a read-only week strip. Nothing is scheduled by the app. | up to 14 labels |
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
| `rest_seconds` | exercise | Rest between sets | 0 to 3 600 |
| `rest_after_seconds` | exercise | Rest after the last set of the exercise, before the next exercise (Epic 43). Used by the live session in place of the between-sets rest at that moment. | 0 to 3 600 |
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
2. **Pick the file.** Gym → Routines → New workout → Import a file → *Choose a file*, then select `workout.json`
   from Files or Downloads (`.json` or `.txt`, 256 KB at most).
3. **Paste it.** Copy the JSON from the chat, come back to Gym → Ask an AI and tap *Paste from
   clipboard* (or paste into the box and press *Read workout*).

Importing needs a connection for the final Create step only. You can read and review offline;
the review is kept in that tab until you are back online.

## 4. What the review does

After the file is read, the app walks you through **one exercise at a time** (*Exercise 3 of 8*).
Every field is editable: name, kind, sets, reps or seconds or metres, weight, rest, note, video
link, and **Rest after (s)**. If the file has a `schedule`, the week strip is shown above the
first exercise and on the last page.

- If the name matches an exercise you already have, it says *Uses your existing ...* and the
  kind is shown and locked to that exercise's kind. Rename the exercise to make a new one.
- Otherwise it says *New exercise* and the kind is yours to choose.
- A field that is out of range or unreadable shows its problem under the field, and **Confirm**
  stays disabled until it is fixed.
- **Confirm** accepts the exercise, **Skip** leaves it out, **Back** returns to the previous one.
- The last page lists what will be created, per routine. **Create and start** posts each routine in
  one transaction and starts the first one as a live session; **Create only** creates them and
  goes back to the gym. A routine whose every exercise was skipped is not created.
