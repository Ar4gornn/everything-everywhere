# Preferences freshness — a stale tab cannot undo another device

**Status:** Built 2026-10-03 on `feat/prefs-freshness` (worktree `ee-prefs`, from `013274b`)
**New decision record:** AD-65
**Migration:** none.

---

## 1. The defect (found in Epic 48 QA)

Preferences (AD-49) are one JSONB column, and `PATCH /api/auth/me/preferences` replaces each
top-level key it carries. The client builds a key's new value from its own copy — the Layout
card sends the whole `phone` layout, a module switch sends the whole `modules` map. The client
never re-read the account once open, so a tab left open for days sent its days-old `modules`
with one switch flipped and silently switched back whatever another device had changed in
the meantime. Epic 48 fixed only its own `clocks` key, with operation-based writes.

## 2. AD-65 — Every preferences write names the version it was made against; a tab re-reads when it comes back

**Context.** Whole-subtree replace keeps the server simple and two writes to different keys
both land (AD-49). What it cannot do is tell an edit made against today's subtree from one
made against last week's.

**Decision.**

1. **The server versions the column.** Every user answer carries `preferences_version`, the
   `md5` of the stored JSONB, computed by Postgres. A PATCH may send it back as `If-Match`
   (bare or quoted, `W/` tolerated); the `UPDATE` then carries `AND md5(preferences::text) =
   :expected`, so the check and the write are one statement and a write landing in between
   cannot slip past. No match is a 409 `preferences_changed`, and nothing is written. No
   header, no check: an installed app that has not updated yet keeps working.
2. **The saver re-bases on a 409** (`layout/preferences.ts`). It re-reads the account, then
   for each key of the refused patch: unchanged elsewhere since this tab's base — still this
   tab's to write, sent again on the fresh version; changed elsewhere to exactly this value
   — done; changed elsewhere to something else — the other device wins, and the callers that
   asked for that key are rejected, so their control says the save did not happen. At most
   three re-bases, then the refusal goes to the callers.
3. **A tab coming back re-reads.** `AuthProvider` refreshes the profile on
   `visibilitychange` → visible and on window `focus`, at most once per 30 s since it last
   heard from the server (`REREAD_MS`). Most stale writes are then never attempted; the
   version check is the backstop for two windows side by side, where neither leaves view.
4. **A read never undoes a write.** A profile read takes a stamp from the saver when it
   starts; the saver ignores its answer if a write was sent or answered, or a later read was
   adopted, since then. Queued and in-flight patches stay on screen over any adopted read,
   as before.

**Rejected.**

- *Operation-based patches everywhere* (as Epic 48 did for `clocks`). Right for a list edited
  by position; for the other keys every control would need its edit re-expressed as a
  function of the current value, and the re-base above already keeps every edit that did
  not collide.
- *A counter column.* A migration for what a digest of the stored value already gives.
  A digest also means writing back the same value is no change, which is the truth.
- *Re-read before every write.* One more round trip per tap, and still racy without a
  server-side check.

**Consequences.** A collision on the same key is now visible (the control's save-failed
state) instead of silent. `md5` here is change detection, not security. The CORS allow-list
gains `If-Match`.
