# Epic 45: Offline entries — the quick-add sheet keeps working without a network

**Status:** Scoped 2026-10-02, building on `feat/offline-entries` (worktree `ee-quickadd`, from `fd3c902`)
**Builds on:** Epic 44 (`docs/epic-44-quick-add.md`, AD-60) and Gym's outbox (AD-58, `frontend/src/gym/store.ts`)
**New decision record:** AD-61
**Migration:** `0037` (`entries.client_ref`, unique per user)

---

## 1. Scope (locked in the interview, 2026-10-02)

Spending happens in shops, and shops have bad signal. Today a sheet save with no network is an
error and the typed entry is gone.

| Question | Chosen | Rejected |
|---|---|---|
| No doubles | **`client_ref` minted by the phone; `UNIQUE (user_id, client_ref)`; a resend answers 200 with the row already written** | client-chosen id + `PUT` (a second create path); none (a lost answer records the coffee twice) |
| Offline scope | **Creates through the sheet only** | + deletes; + edits + deletes (conflict rules, another epic) |
| Chips offline | **Last good copy on the device, per account; shown at once, replaced by the server's answer** | plain form offline |
| Refused on send | **Kept, marked "Not sent" with the reason; Edit (sheet, prefilled) or Discard; never retried by itself** | retry/discard only; dropped with a message |
| Path | **Every sheet save goes through the queue, then is sent at once** | queue only after a failed send (two paths, the second only runs on the bad day) |
| Visibility | **Count on the `+`; "Waiting to send" block on Entries; one dashboard line "N entries not sent yet"; totals stay server-only (AD-9)** | Entries only; waiting amounts added into totals |
| Sign-out | **Confirm when entries wait, then clear the device; an expired session keeps the queue** | drop silently (as Notes); block sign-out |

### Explicitly out

Offline edits/deletes on the Entries page; desktop offline; waiting amounts in any total;
two-device conflict handling (creates cannot conflict); background sync via the service worker
(the queue flushes while the app is open).

---

## 2. AD-61 — A sheet entry is written on the device first, under a ref the device coined; the server makes a resend harmless

**Binds:** `POST /api/entries`, `entries` (migration 0037), the quick-add sheet, `entries/outbox.ts`,
sign-out. **Extends:** AD-58 (same outbox shape), AD-48 (per-account device storage, cleared on
explicit sign-out), AD-60 (the sheet), AD-9 (totals are SQL only).

**Server.**
1. `EntryCreate.client_ref: uuid | None`. Absent → today's behaviour exactly (desktop form).
2. Present and new → created, **201**. Present and already used by this account → **200** with
   the existing entry; nothing is written, whatever else the body says (the ref names the entry).
   A ref used by another account is invisible (RLS) and does not clash: the key is
   `(user_id, client_ref)`.
3. The replay check reads first; a race between two sends of the same ref is caught as the
   unique violation (SQLSTATE 23505 on `entries_user_client_ref_key` only) and answered with the
   row. Any other IntegrityError stays what it was.

**Device.**
1. **Queue first.** Every sheet save appends `{client_ref, body, queued_at, refused: null}` to
   `localStorage` under `everything-everywhere.entries.<userId>.outbox`, then calls `flushEntries`.
   Storage blocked (private mode, quota) → the save is sent directly, as before Epic 45.
2. **Flush** is single-flight per account (a second call while one runs returns the running
   promise). Triggers: right after a queue, the browser's `online` event, app start (signed in),
   sheet open. Entries are sent oldest first, one at a time.
3. **Outcomes per entry:** 2xx → removed from the queue, server id remembered in memory for
   Undo; network error or 5xx → stays, flush stops (the network is down, don't hammer it);
   **401** → stays, flush stops (the session refresh path owns that); other **4xx** → marked
   `refused` with the server's `code` (or `"error"`), kept, the flush goes on to the next entry.
4. **Undo** (toast or the sheet's inline row) on an entry still queued removes it from the queue;
   on a sent one deletes it on the server (as Epic 44). An entry being sent at that moment is
   deleted on the server once its send resolves.
5. **Edit** on a refused entry opens the sheet prefilled from its body; Save replaces that queue
   item (same `client_ref` — a refused entry was never written) and flushes.
6. **Picks cache:** each successful sheet load writes `{quickPicks, categories, vendors, pots}` to
   `everything-everywhere.entries.<userId>.picks`. On open the sheet renders from it at once, then
   from the server's answer; offline it stays on the copy and shows no error banner (the copy is
   the expected offline state; with no copy and no network the plain form shows with the banner).
7. **Sign-out:** `useSignOut` confirms when any entry waits (pending or refused), then
   `signOut()` clears the outbox and the picks cache with the gym store and note drafts. An
   expired session (401 path) keeps both, so signing back in sends them.

**Why always through the queue.** One path means the offline path runs on every save, so it is
proven daily, not on the first bad afternoon in a shop. Online cost: one `localStorage` write.

**Consequences.** Dashboard and Entries totals exclude waiting entries; a line says how many,
so a short total is never unexplained. A queued entry naming a new category or vendor creates it
when sent, not before. Two phones offline can each add entries; they cannot conflict.

---

## 3. UI

- **Toast after Save:** "Entry saved" when the send succeeded within the save; "Saved on this
  phone — it will be sent when you are online" when it stayed queued. Both carry Undo. The
  sheet's inline row (add-another) uses the same two messages.
- **`+` badge:** a small count (waiting + refused) on the `+` when > 0, in its accessible name
  ("Add an entry, 2 waiting to send").
- **Entries page (phone and desktop):** a "Waiting to send" card above the list when anything
  waits: one row per entry (amount, category name, date), refused rows carry the reason and
  **Edit** (phone: opens the sheet prefilled; desktop: the sheet does not exist — Discard only,
  and the reason) and **Discard**; a **Send now** button runs a flush.
- **Dashboard:** one line under the totals, "N entries not sent yet" linking to `/entries`, only
  when N > 0.

---

## 4. Builders (parallel, disjoint files)

| Builder | Owns | Must not touch |
|---|---|---|
| **A — backend** | migration `0037` (skeleton written; review), `services/ledger.py` `create_entry` replay, `api/entries.py` 200/201, `tests/test_entry_client_ref.py`, isolation test | any frontend file |
| **B — queue + sheet** | `entries/outbox.ts` (fill), `entries/outbox.test.ts`, `QuickAddSheet.tsx` (save through the queue, toasts, Undo, picks cache, prefill from a draft), its tests | `App.tsx`, pages, `AuthContext.tsx`, `useSignOut.ts`, backend |
| **C — wiring** | `App.tsx` (flush on start/`online`, `+` badge), `EntriesPage.tsx` (Waiting card), `DashboardPage.tsx` (line), `gym/useSignOut.ts` + `AuthContext.tsx` (confirm + clear), their tests | `outbox.ts` internals, `QuickAddSheet.tsx`, backend |

Contracts (skeleton): migration 0037, `EntryCreate.client_ref`, `entries/outbox.ts` signatures and
`useEntryOutbox`, `QuickAddOptions.draft`, `api.createEntry` status callback, i18n keys in
`messages/offlineEntries.ts`.

## 5. Done means

- Backend: replay returns the same id with 200 and writes no second row (also under a forced race
  via two sessions), absent ref unchanged (201, two rows for two posts), same ref on two accounts
  = two rows, refusals (422) on a fresh ref write nothing; migration up/down; every guard mutated.
- Frontend: red-first tests for each outcome in §2 Device 3, single-flight, Undo on queued /
  in-flight / sent, Edit replaces, cache render-then-replace, sign-out confirm + clear, expired
  session keeps the queue; full vitest exit 0 + 0 Unhandled; lint; tsc.
- Browser: real offline (fetch to `/api/` rejected, then the verify server stopped and
  restarted): save 3 offline → badge 3 → Waiting card → back online → sent once each (no
  doubles in the DB) → totals move; a refused entry (pot deleted meanwhile) → Edit → fixed →
  sent; sign-out confirm; EN + FR at 375 and 320, no overflow.
