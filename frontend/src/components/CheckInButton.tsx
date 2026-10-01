import { useState } from "react";

import { api } from "../api/client";
import type { Streak, StreakModuleId } from "../api/types";
import { useT } from "../i18n";
import { errorMessage } from "../i18n/errors";
import { useShownStreaks } from "../layout/modules";
import { useLoad } from "../useLoad";
import { ErrorBanner } from "./ui";

/**
 * A tab's own Check in (Epic 41, AD-57): makes today active for that tab's streak and for
 * the overall one without any other write.
 *
 * Drawn only while the tab's streak is shown — its preference on **and** its module on —
 * and it asks for nothing while hidden. It reads the streak when it mounts, so it says
 * "Checked in" if a write earlier today already made the day; a write made on this same
 * page afterwards leaves it stale, which is harmless because the press is idempotent. The
 * server owns the day: the body is the streak's name and nothing else.
 *
 * `bar` wraps it in a right-aligned line of its own, for a page with no heading row.
 */
export function CheckInButton({ streak, bar = false }: { streak: StreakModuleId; bar?: boolean }) {
  const t = useT();
  const shown = useShownStreaks().includes(streak);
  const { data, setData } = useLoad<Streak | null>(
    async () =>
      shown ? ((await api.getStreaks()).streaks ?? []).find((s) => s.id === streak) ?? null : null,
    null,
    [shown, streak],
    "streaks.couldNotLoad",
  );
  const [pressing, setPressing] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  if (!shown) return null;

  async function press() {
    if (pressing) return;
    setPressing(true);
    setFailed(null);
    try {
      setData(await api.streakCheckIn(streak));
    } catch (caught) {
      setFailed(errorMessage(t, caught, "streaks.couldNotCheckIn"));
    } finally {
      setPressing(false);
    }
  }

  const done = data?.today_active === true;
  const button = (
    <button
      type="button"
      className="quiet streak-checkin"
      data-streak={streak}
      onClick={() => void press()}
      disabled={done || pressing}
    >
      {done ? t("streaks.tabCheckedIn") : t("streaks.tabCheckIn")}
    </button>
  );
  // The banner stays out of the flex row that holds the button: in the row it would be
  // squeezed against the right edge beside it.
  return bar ? (
    <>
      <div className="streak-checkin-bar">{button}</div>
      <ErrorBanner message={failed} />
    </>
  ) : (
    <div className="streak-checkin-slot">
      {button}
      <ErrorBanner message={failed} />
    </div>
  );
}
