import { type ReactNode, useEffect, useMemo, useState } from "react";

import { useOptionalAuth } from "../auth/AuthContext";
import { useModule } from "../layout/modules";
import { preferencesOf } from "../layout/preferences";
import { deviceZone } from "../push";
import { type MoonEngine, type MoonState, useMoonEngine } from "./engine";
import { type Hemisphere, resolveHemisphere } from "./hemisphere";

/**
 * What a page needs to draw the moon (Epic 47): the loaded engine and the hemisphere to
 * draw it in. `view` is null while the module is off or the engine has not arrived, and a
 * caller then renders nothing moon-related at all (no placeholder, no layout shift).
 *
 * `probe` must be rendered by the caller. It is what asks for the engine, and it exists only
 * while the module is on, so a hook that cannot be conditional still never starts the lazy
 * chunk for an account that switched the moon off.
 */
export interface MoonView {
  engine: MoonEngine;
  hemisphere: Hemisphere;
}

function EngineProbe({ onLoad }: { onLoad: (engine: MoonEngine | null) => void }) {
  const engine = useMoonEngine();
  useEffect(() => {
    onLoad(engine);
  }, [engine, onLoad]);
  return null;
}

export function useMoonView(): { view: MoonView | null; probe: ReactNode } {
  const on = useModule("moon");
  const user = useOptionalAuth()?.user;
  const [engine, setEngine] = useState<MoonEngine | null>(null);
  // The account's zone decides "auto"; an account with none uses the device's.
  const hemisphere = resolveHemisphere(
    preferencesOf(user).moon_hemisphere ?? null,
    user?.timezone ?? deviceZone(),
  );
  const view = useMemo(
    () => (on && engine ? { engine, hemisphere } : null),
    [on, engine, hemisphere],
  );
  return {
    view,
    probe: on ? <EngineProbe onLoad={setEngine} /> : null,
  };
}

/** The moon on a local day, taken at noon so that the day has one answer. */
export function moonOnDay(engine: MoonEngine, day: Date): MoonState {
  return engine.stateAt(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12));
}
