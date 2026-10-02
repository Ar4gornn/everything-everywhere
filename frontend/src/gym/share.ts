/**
 * A workout file shared to the installed app (Epic 42, share target).
 *
 * The service worker answers the share's POST to `/gym/share`, stores the file's text (or the
 * shared text) in the `share-inbox` cache under `/__share/gym`, and redirects to
 * `/gym/import?shared=1`. This reads that entry and deletes it in the same call, so a reload
 * of the import page never re-imports. Returns null when nothing is waiting or the Cache API
 * is unavailable.
 */

export const SHARE_CACHE = "share-inbox";
export const SHARE_KEY = "/__share/gym";

export async function takeSharedWorkout(): Promise<string | null> {
  throw new Error("TODO(F1): takeSharedWorkout");
}
