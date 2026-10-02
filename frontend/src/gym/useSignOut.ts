import { useCallback } from "react";

import { useAuth } from "../auth/AuthContext";
import { useT } from "../i18n";
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
    if (userId && hasUnsentGym(userId) && !window.confirm(t("gymCore.signOut.unsent"))) return;
    signOut();
  }, [userId, signOut, t]);
}
