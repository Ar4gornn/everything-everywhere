import { useEffect, useState } from "react";

import { useT } from "../i18n";
import { pushEnabledOnce } from "../push";

/** Whether this instance sends pushes at all; false until known, false on any failure. */
export function usePushEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void pushEnabledOnce().then((on) => {
      if (!cancelled) setEnabled(on);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return enabled;
}

/**
 * Keep one pot, recurring rule or stock item in or out of the daily digest (Epic 36,
 * AD-52). A toggle button, so a screen reader hears "pressed" for "will be mentioned", and
 * the label names the row and says what pressing it does. Muting changes the push only:
 * the row stays on its page. Every muted row is listed in Settings, where it can be found
 * again.
 */
export function NotifyBell({
  on,
  name,
  disabled,
  onToggle,
}: {
  on: boolean;
  name: string;
  disabled?: boolean;
  onToggle: (next: boolean) => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      className="quiet bell"
      aria-pressed={on}
      aria-label={t(on ? "notify.muteNamed" : "notify.unmuteNamed", { name })}
      title={t(on ? "notify.onTitle" : "notify.offTitle")}
      disabled={disabled}
      onClick={() => onToggle(!on)}
    >
      <span aria-hidden="true">{on ? "🔔" : "🔕"}</span>
    </button>
  );
}
