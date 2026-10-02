import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import type { RoutineDetail, WeightUnit } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { startSession } from "../../gym/session";
import { useGymData, type GymData } from "../../gym/store";
import { useT } from "../../i18n";
import { useBrowserOffline } from "./device";
import { newId } from "./measure";

/**
 * What every gym view reads, from one `useGymData()` so the views do not each refresh the
 * cache. `offline` is the store's verdict or the browser's, whichever says it first.
 */
export interface GymContextValue extends GymData {
  userId: string;
  unit: WeightUnit;
  /** Server writes are off: the store could not reach it, or the browser says no network. */
  isOffline: boolean;
  /** Begin a session (empty, or from a routine) and open it. Asks first if one is running. */
  start: (routine: RoutineDetail | null) => void;
}

const GymContext = createContext<GymContextValue | null>(null);

export function GymProvider({ children }: { children: ReactNode }) {
  const data = useGymData();
  const { user } = useAuth();
  const t = useT();
  const navigate = useNavigate();
  const browserOffline = useBrowserOffline();
  const isOffline = data.offline || browserOffline;
  const { active, setActive } = data;

  const value = useMemo<GymContextValue>(
    () => ({
      ...data,
      userId: user?.id ?? "",
      unit: user?.weight_unit ?? "kg",
      isOffline,
      start: (routine) => {
        // One session at a time: starting another would silently drop the sets already done.
        if (active && !window.confirm(t("gym.replaceConfirm"))) return;
        setActive(startSession(routine, new Date(), newId));
        navigate("/gym/session");
      },
    }),
    [data, user, isOffline, active, setActive, t, navigate],
  );
  return <GymContext.Provider value={value}>{children}</GymContext.Provider>;
}

export function useGym(): GymContextValue {
  const context = useContext(GymContext);
  if (!context) throw new Error("useGym must be used inside GymProvider");
  return context;
}
