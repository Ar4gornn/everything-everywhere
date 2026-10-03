import { api } from "../api/client";
import { useOptionalAuth } from "../auth/AuthContext";

/**
 * Epic 48 (round 3): change the account's own time zone (AD-52). The endpoint takes the zone
 * and the digest's hour together, so the account's current hour is sent back unchanged; the
 * profile is then re-read so every clock follows. Rejects when the server refuses.
 */
export function useSaveHomeZone(): (zone: string) => Promise<void> {
  const auth = useOptionalAuth();
  const digest = auth?.user?.digest_time ?? "19:00";
  const refresh = auth?.refreshUser;
  return async (zone: string) => {
    await api.setNotificationSchedule({ timezone: zone, digest_time: digest });
    await refresh?.();
  };
}
