import { useState } from "react";

import type { StreakModuleId } from "../api/types";
import { useT } from "../i18n";
import { STREAK_NAME } from "../layout/modules";
import { STREAKS, STREAK_MODULE } from "../layout/preferences";
import { usePreferences } from "../layout/useLayout";
import { Card, ErrorBanner } from "./ui";

/**
 * Settings → Streaks (Epic 41.2): which tab streaks are shown. One switch per module
 * streak, all off until chosen. A module that is switched off is not listed — its streak
 * is hidden with it (AD-49) — and the core sections (Entries, Plan, Grow) always are.
 * Hiding never takes anything back: every tab keeps counting.
 *
 * The whole `streaks` subtree is sent, as the layout editor does, because the server
 * replaces a top-level key wholesale.
 */
export function StreaksSettingsCard() {
  const t = useT();
  const { preferences, update } = usePreferences();
  const [failed, setFailed] = useState(false);

  const listed = STREAKS.filter((id) => {
    const module = STREAK_MODULE[id];
    return module === undefined || preferences.modules[module];
  });

  function set(id: StreakModuleId, on: boolean) {
    setFailed(false);
    update({ streaks: { ...preferences.streaks, [id]: on } }).catch(() => setFailed(true));
  }

  return (
    <Card title={t("streaks.settingsTitle")}>
      <p className="hint" style={{ marginTop: 0 }}>
        {t("streaks.settingsHint")}
      </p>
      <ul className="streak-settings" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {listed.map((id) => (
          <li key={id} style={{ margin: "4px 0" }}>
            <label className="check" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                aria-label={t("streaks.show", { name: t(STREAK_NAME[id]) })}
                checked={preferences.streaks[id]}
                onChange={(event) => set(id, event.target.checked)}
              />
              {t(STREAK_NAME[id])}
            </label>
          </li>
        ))}
      </ul>
      <ErrorBanner message={failed ? t("streaks.couldNotSave") : null} />
    </Card>
  );
}
