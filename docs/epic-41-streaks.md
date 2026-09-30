# Epic 41: Streaks and points — show up every day, earn for it, spend it to stay on track

**Status:** Scoped 2026-09-29 on `feat/streaks` (worktree `ee-streaks`). Nothing built.
**New decision record:** AD-57 (a day is active once, stored; a streak, a balance and a freeze's use are computed; only purchases are stored)
**Migrations:** `0033` (activity days, Story 41.1), `0034` (purchases, Story 41.4).

---

## 1. Scope (locked in the interview, 2026-09-29)

| Question | Chosen | Rejected |
|---|---|---|
| What makes a day active | **Any successful write, or a Check in button** — one on the dashboard (the app), one on each tab whose streak is shown | Opening the app (a streak for looking); derived from each module's own rows (edits invisible, deleting a row rewrites a past streak, one query per module) |
| Tab streaks | **Every module tracked, Settings chooses which are shown.** A module off (AD-49) hides its streak | A fixed short list (not modular); a cadence per tab, Gym 3×/week (doubles the epic — later) |
| Rules | **Strict daily, with points.** Today is pending until the local midnight. Points buy streak help now and "other things" later | A free weekly freeze; weekly streaks |
| Earning | **1 per active day, +1 per module active that day, milestone bonuses** | Escalating (day 30 pays 30 — prices unsettable); overall only |
| Spending | **Both a freeze (bought ahead) and a repair (after a break)** | One of them; nothing yet |
| Display | **A dashboard card** in the Epic 33 card system | A top-bar chip (the phone top bar is full in French); a page of its own |
| Reminder | **Yes, as a digest kind** (Epic 36) | Later |
| Points' name | **The person chooses it** (default "Points") | Fixed "Points" / "Sparks" / "Coins" |

One change from the restated spec, made while writing this: points are earned by **every**
module active that day, not only by the streaks that are shown. Balances are computed on read
(AD-57), so earning by "shown" would let hiding a streak take points back, and could push a
balance below what was already spent.

### Explicitly out

Leaderboards and anything social; shop items other than freeze and repair; backfilling from
data written before the deploy; a cadence per tab; a streak page or heatmap beyond the card's
four weeks; streaks in the CSV export (they are derived); the guided tour (Epic 30) mentioning
streaks; a push other than the one daily digest.

---

## 2. Rules

Everything here is defined once, in `backend/app/services/streaks.py`, and tested there.

### 2.1 The day

A day is the **account's local date** (`users.timezone`, AD-52) at the moment of the write.
Null timezone means the host clock, as for the digest. The date the person writes *about*
(an entry dated last month) is irrelevant: editing it today makes **today** active. The
client never sends the day; the server computes it, so it cannot be backdated.

`local_now` moves from `services/push.py` to `core/clock.py` as `local_today(timezone, now)`,
with `now` from one overridable dependency, so every test can pin the clock. The digest
imports it from there. That leaves one definition, as AD-30 requires.

### 2.2 Activity

One row per `(user, day, module)`, written at most once (`ON CONFLICT DO NOTHING`).

| Activity module | Written by | Counts for |
|---|---|---|
| `entries` | writes under `/api/entries`, `/api/vendors`; Check in on Entries | `entries`, overall |
| `plan` | `/api/budgets`, `/api/categories`, `/api/recurring`; Check in on Plan | `plan`, overall |
| `grow` | `/api/savings`; Check in on Grow | `grow`, overall |
| `habits` | `/api/habits`; Check in on Habits | `habits`, overall |
| `mood` | `/api/mood` (recording a mood *is* its check-in: no button) | `mood`, overall |
| `books` | `/api/books`; Check in on Books | `books`, overall |
| `stock` | `/api/inventory` (the shopping list lives there); Check in on Stock | `stock`, overall |
| `gym` | `/api/gym`; Check in on Gym | `gym`, overall |
| `recipes` | `/api/recipes`, `/api/foods`, `/api/meals`; Check in on Recipes | `recipes`, overall |
| `notes` | `/api/notes` (a synced draft counts on the day it syncs); Check in on Notes | `notes`, overall |
| `app` | Check in on the dashboard; writes under `/api/dashboard` | overall only |
| — | `/api/auth` (sign-in, settings, preferences), `/api/push`, `/api/export`, `/api/admin`, `/api/calendar`, `/api/streaks` purchases | nothing |

- **A write** is POST, PUT, PATCH or DELETE that returned without raising. A 4xx or 5xx does
  not count. Signing in, changing a setting, or buying a freeze does not make a day.
- **How:** a router-level yield dependency `record_activity("<module>")` in
  `services/activity.py`. It shares the request session. The session already commits before
  the response (`scope="function"`, lab note 2026-09-20), so the row lands in the same
  transaction as the write it records, and rolls back with it.
- **Enforced:** `test_activity_map.py` walks `app.routes`. It fails if any route with a write
  method sits under a prefix that is neither mapped nor listed as "counts nothing". A new
  router therefore needs a classification to pass.
- **Modular:** the module ids are a Python tuple, **not a database CHECK**. A later module
  adds a streak with one tuple entry and one map line, and needs no migration. Rows whose id
  is no longer in the catalogue are ignored on read, the same way AD-49 treats preferences.

### 2.3 Streaks

Streak ids: `overall`, plus one per activity module except `app`: `entries`, `plan`,
`grow`, `habits`, `mood`, `books`, `stock`, `gym`, `recipes`, `notes`.

For streak `s` and each day `d`, from its first active day up to local today `T`:

| State | When |
|---|---|
| `active` | an activity row exists (for `overall`: any module, `app` included) |
| `repaired` | a repair was bought for `(s, d)` |
| `frozen` | a freeze was consumed on `d` (below) |
| `pending` | `d = T` and not active |
| `missed` | anything else |

A day before the first active one is outside the walk; the dots show it as `before` (a small
speck, read "before you started"), never as `missed` (decided 2026-09-30).

*Covered* means `active`, `repaired` or `frozen`. The walk runs forward in time and keeps
`run`, the current length:

- covered → `run += 1`. Frozen and repaired days lengthen the streak but earn nothing.
- missed, `run > 0`, and a freeze held with `bought_on ≤ d` → consume the **oldest** such
  freeze, the day becomes `frozen`, `run += 1`.
- missed otherwise → `run = 0`. A freeze held while `run = 0` stays held.
- pending → no change.

**Current** is `run` after the walk. Because today is pending, a streak is not lost until
the local midnight. **Best** is the highest `run` seen at any point.

### 2.4 Freeze

- Costs `FREEZE_COST` (20). At most `MAX_HELD` (2) held per streak, where *held* means
  bought and not yet consumed by the walk.
- One freeze covers one missed day of **its own** streak, and only a day on or after the day
  it was bought. So a freeze cannot rescue yesterday; that is what a repair is for. A freeze
  bought today, on a day that stays inactive, covers today once today has passed.
- Refused with `409 points_insufficient` or `409 freeze_limit`.

### 2.5 Repair

- **Offered** when the missed days directly before today form a gap `g` of 1 or 2 days, and
  the day before the gap is covered. That covered day ended a run of length `L ≥ 1`. So
  "within 48 hours": three missed days are past repair.
- Costs `g × (REPAIR_PER_DAY + L // 2)`, which is 30 + L/2 per day. A bigger streak costs more
  to save.
- Buying it stores one row per missed day (`covers = d`). The walk then treats those days as
  `repaired` and the run joins up: `L + g`, and today's activity adds to it.
- Refused with `409 points_insufficient` or `409 repair_unavailable`. A double submit
  collides on the unique `(user_id, streak, covers)` and is reported as `repair_unavailable`.
  Only that one `23505` is caught (lab note 2026-09-26).

### 2.6 Points

**Earned** (computed, never stored):

- +1 for each day on which `overall` is active;
- +1 for each `(day, module)` active, for all ten module streaks, shown or not;
- a bonus each time a run reaches exactly 7, 30, 100 or 365 days: +10, +30, +100, +365, for
  any streak, once per run. It is paid on the day the run reaches the length, frozen or
  repaired days included.

**Balance** = earned − the sum of purchase costs.

**Invariant, tested:** earned never decreases. Activity rows are never deleted, and every
purchase can only turn a missed day into a covered one, which can only lengthen a run. So a
balance checked at purchase time cannot go negative later. Purchases take
`pg_advisory_xact_lock` on the user's id before they recompute the balance, so a double
click cannot spend the same points twice. `users` is not locked: its grants are by column
(AD-19).

**Name:** `preferences.points_name`, 1 to 24 characters after trimming. Null or empty means
the default ("Points" in both languages). It is shown verbatim as a label beside the
number: "42 · Sparks". It is never inflected, so there is no plural rule to get wrong
(lab note 2026-09-07).

All five numbers (`FREEZE_COST`, `MAX_HELD`, `REPAIR_PER_DAY`, the milestones, their bonuses)
are module constants. `GET /api/streaks` returns them and the client never hardcodes a
price. Tests read the constants too.

### 2.7 What is shown

- `preferences.streaks`, sparse, resolved on read (AD-49): `{ "<module streak id>": bool }`,
  every id **off** by default, so tab streaks stay optional. `overall` is not a key; sending
  it is `pref_unknown_id`. Values are `StrictBool` (lab note 2026-09-26).
- A streak is shown when its preference is on **and** its module is on. Core sections
  (`entries`, `plan`, `grow`) cannot be switched off. When a module is off, its streak is
  hidden, its Check in button is gone, and its earning continues, because off hides UI only
  (AD-49).
- A new card id `streaks` goes into `CARDS` straight after `stats`, so it is shown by
  default, per AD-49's merge rule.

---

## 3. Data

**`0033_activity_days`** (after `0032`)

```
activity_days
  user_id  uuid  NOT NULL  REFERENCES users(id) ON DELETE CASCADE
  day      date  NOT NULL
  module   text  NOT NULL  CHECK (length(module) BETWEEN 1 AND 32)
  PRIMARY KEY (user_id, day, module)
```

**`0034_streak_purchases`** (after `0033`)

```
streak_purchases
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid()
  user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE
  streak     text        NOT NULL CHECK (length(streak) BETWEEN 1 AND 32)
  kind       text        NOT NULL CHECK (kind IN ('freeze', 'repair'))
  cost       integer     NOT NULL CHECK (cost > 0)
  bought_on  date        NOT NULL          -- local day of purchase
  covers     date        NULL              -- repair only
  created_at timestamptz NOT NULL DEFAULT now()
  CHECK ((kind = 'repair') = (covers IS NOT NULL))
  UNIQUE (user_id, streak, covers)         -- NULLs distinct: freezes unaffected
```

Both tables use `ENABLE` + `FORCE ROW LEVEL SECURITY` and the usual `user_id =
current_setting('app.user_id')` policy. The app role gets `SELECT, INSERT` only: both tables
are **append-only**, and the earned-never-decreases invariant rests on that. The notify
runtime role gets `SELECT` for the digest clause (41.6). Neither table has a foreign key to
another user-scoped table, so the composite-FK rule has nothing to apply to.

**Cost of a read:** one query per table for the whole history. Ten years × 11 ids is under
41k rows. If that ever matters, a window can come later; a window is not correct for
"best".

---

## 4. API

| Method | Path | Body | Answer |
|---|---|---|---|
| GET | `/api/streaks` | — | `{ today, points: { balance, earned, spent }, prices: { freeze, max_held, repair_per_day, milestones }, streaks: [ { id, current, best, today_active, held_freezes, repair: null \| { days, cost }, recent: [ { day, state } × 28 ] } ] }`. All 11 streaks, always. The client decides what to show (§2.7) |
| POST | `/api/streaks/check-in` | `{ streak }` | 200 with that streak. `overall` writes `app`; a module id writes itself. Idempotent. `422 streak_unknown` |
| POST | `/api/streaks/freezes` | `{ streak }` | 201 with the balance and the streak. `409 points_insufficient` / `freeze_limit` |
| POST | `/api/streaks/repairs` | `{ streak }` | 201, same shape. `409 points_insufficient` / `repair_unavailable` |
| PATCH | `/api/auth/me/preferences` | `streaks`, `points_name` | Existing endpoint, two new keys (§2.6, §2.7) |

Every new code has an English and a French sentence (AD-44).

---

## 5. Client

- `api/streaks.ts`, plus one loader via `useLoad` (never a fresh `useCallback` + effect).
- **`components/StreakCard.tsx`** (card `streaks`). The overall streak is the big number,
  with best beside it, and the dashboard's **Check in** (shows "Checked in ✓" when today is
  active). Below it, one compact row per shown tab streak (`ListRow`, AD-53: name, current,
  best, a ✓ for today). Then 28 dots for the overall streak (active / frozen / repaired /
  missed / pending / before, each with a text alternative, never colour alone), and the balance under
  the chosen name.
- **Shop**, a disclosure inside the card, not a modal (house rule since Epic 24). Each shown
  streak plus overall gets "Freeze · 20 · held 1/2" with Buy. A repair offer is a banner at
  the top of the card whenever one exists: "Your 12-day Gym streak broke yesterday. Repair
  for 36 Sparks?" Both need a second press to confirm, because they spend.
- **`components/CheckInButton.tsx`** sits in the header of each section view whose streak
  is shown and whose module is on. Mood has none. The button is idempotent, so a stale
  "Check in" after a write on the same page is harmless; it reloads on mount.
- **Settings → Streaks:** a switch per module streak (modules that are off are not listed)
  and the points name field.
- **Settings → Notifications:** the new `streak` kind (41.6).
- The only colours used are the existing tokens. Any new text pair goes into `TEXT_PAIRS`
  (`theme.test.tsx`). CSS classes are qualified by component (lab note 2026-09-27:
  global class reuse).

---

## 6. Stories

### 41.1 Activity and the overall streak

- `core/clock.py` (`local_today`, the clock dependency), with the digest moved onto it.
- Migration `0033`, `services/activity.py` with the map and the dependency on every mapped
  router, `test_activity_map.py`.
- `services/streaks.py`: the walk (§2.3) without freezes or repairs; `GET /api/streaks`
  (overall only is enough); `POST /api/streaks/check-in`.
- `StreakCard` with the overall streak, best, Check in and the 28 dots; card id `streaks`.

**Accepted when:**
- A successful write makes today active for its module and for overall. A 422 does not.
  Neither does a sign-in, a settings change or a preferences PATCH. The write and the
  activity row commit or roll back together.
- A write at 23:30 local on the 5th and one at 00:30 local on the 6th land on two days for a
  zone east of UTC and for one west of it. A null zone uses the host clock.
- Streak: 3 active days → 3. Today pending → still 3. A missed yesterday → 0. Best survives a
  break.
- Check in is idempotent: two presses make one row.
- User B's activity never appears in A's streaks. Proven by querying as B, not by reading the
  policy.
- Adding an unmapped router with a POST turns `test_activity_map.py` red (mutation).

### 41.2 Tab streaks

- All ten module streaks in `GET`; `preferences.streaks`; Settings → Streaks; a
  `CheckInButton` on Entries, Plan, Grow, Habits, Books, Stock, Gym, Recipes, Notes; shown tab
  streaks as rows on the card.

**Accepted when:**
- A Gym write moves the `gym` streak and overall, and nothing else. A dashboard check-in
  moves overall only.
- Every tab streak is off by default. Switching one on shows its row and its button.
  Switching its module off hides both and leaves its earning alone. `{"gym": "off"}` is a 422.
- A module off at load hides the row even when its preference is on.

### 41.3 Points

- Earned, spent and balance in `GET`; milestones; `preferences.points_name`; the balance and
  the name on the card; the name field in Settings.

**Accepted when:**
- A day active in overall + Gym + Entries earns 3. Reaching 7 in a run adds 10, once per
  run. A second run reaching 7 pays again.
- Hiding a streak does not change the balance.
- The name is trimmed. 25 characters is a 422, and empty falls back to the default in both
  languages.

### 41.4 Freeze

- Migration `0034`; `POST /api/streaks/freezes`; freeze consumption in the walk; held
  freezes and Buy in the shop.

**Accepted when:**
- A held freeze covers one missed day and the streak goes on. Two missed days with one
  freeze break it. A freeze bought today does not cover yesterday. A third freeze is
  `freeze_limit`, and too few points is `points_insufficient`.
- Two simultaneous purchases with points for one: exactly one succeeds. Proven with two
  real concurrent sessions, and the test goes red with the advisory lock removed.
- The balance never goes below zero across any sequence in the property test (random
  activity, purchases, clock moves).

### 41.5 Repair

- `POST /api/streaks/repairs`; `repair` in `GET`; the offer banner.

**Accepted when:**
- A 10-day run, one missed day, today T: offered at `30 + 5 = 35`. After buying, the streak
  reads 11 and becomes 12 with today's activity.
- Two missed days: offered at `2 × (30 + L // 2)`. Three: not offered, and POST is
  `repair_unavailable`.
- A double submit makes one repair, and the second answer is `repair_unavailable`, not a
  500.
- Freezes are consumed before a repair is priced: one held freeze and two missed days leave
  a one-day repair.

### 41.6 Streak in the digest

- Kind `streak` in `NOTIFICATIONS`, **off** by default (new kinds are opt-in, AD-52). The
  clause is defined once in `services/push.py`, in English and French. It is included when
  overall's `current ≥ 1` and today is not active on the local today of the digest. It names
  the shown tab streaks that are also at risk, and says so when a freeze will cover tonight.
  The link goes to `/`.

**Accepted when:**
- Off by default, and on after the switch. There is no clause if today is already active or
  if the current streak is 0. The zone across the date line and a DST day give the right
  local today. The preview in Settings shows it.

### 41.7 QA

- Second-user proof across all four endpoints and both tables.
- Every new guard mutated to red: map test, advisory lock, `bought_on ≤ d`, `run > 0` for a
  freeze, the gap ≤ 2 bound, append-only grants, StrictBool, the 23505 catch.
- An overflow sweep of the card, the shop, the repair banner and each tab's header with its
  button, in EN and FR at 375 and 320. It checks card edges and both left and right sides
  (lab notes 2026-09-27), and uses a 24-character points name.
- Judge the run by exit code and `grep -c Unhandled`, not the `Tests` line.

---

## 7. Traps already paid for (read before building)

- `text()` parses `::date` as a parameter: use `CAST(x AS date)`.
- Grants on `users` are by column, so reading `timezone` means naming the column.
- A yield dependency's exit runs after the response unless the session is
  `scope="function"`; the activity row must be in the write's own transaction.
- `ON CONFLICT` under RLS is fine here because the conflicting row is the caller's own. It
  would not be for a row RLS hides (lab note 2026-09-05).
- A pydantic `BeforeValidator` must raise `ValueError`, or the answer is a 500.
- New i18n keys: grep each against `src/` before closing the epic (unused keys are
  invisible to the i18n test).
- Built by a cheaper model? Check its commits against the project `CLAUDE.md` §7 before
  building on them.
