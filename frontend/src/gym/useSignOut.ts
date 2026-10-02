import { useCallback } from "react";

import { useAuth } from "../auth/AuthContext";
import { useT } from "../i18n";
import { countUnsent } from "../entries/outbox";
import { hasUnsentGym } from "./store";

/**
 * The sign-out the controls call (Epic 42, AD-58). Signing out removes the gym's data from
 * the device — a session being recorded, sessions waiting to sync — so when there is any, the
 * person is asked once before it goes. Nothing else changes: no unsent gym data, no question.
 *
 * `confirm` is the browser's own; a modal of the app's would be one more piece of UI for the
 * rarest tap in the app.
 */
export function useSignOut(): () => void {
  const { user, signOut } = useAuth();
  const t = useT();
  const userId = user?.id;
  return useCallback(() => {
    if (userId) {
      // One question, never two: the entries' wording when entries wait (it says what is
      // lost), the gym's when only the gym has something.
      const entries = countUnsent(userId) > 0;
      if (entries || hasUnsentGym(userId)) {
        if (!window.confirm(t(entries ? "offline.signOutUnsent" : "gymCore.signOut.unsent"))) return;
      }
    }
    signOut();
  }, [userId, signOut, t]);
}
