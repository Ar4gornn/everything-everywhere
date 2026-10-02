import { useEffect, useState } from "react";

import { api } from "../api/client";
import { type MessageKey, useT } from "../i18n";
import { installOffer, markWelcomed, readConsent, readWelcomed } from "../install/consent";
import { enablePush, pushSupported } from "../push";
import { isInstalled } from "../pwa";
import { Card, ErrorBanner } from "./ui";

/**
 * Epic 46 (AD-62 §6): the first launch of the installed app. Shown once per device — it marks
 * itself seen on first render and keeps showing until Done, so a re-render never swallows it.
 * The notifications button appears only where this browser can push AND the server offers it,
 * the same two checks `NotificationsCard` makes, and runs the same `enablePush()` flow.
 */
export function InstalledWelcome() {
  const t = useT();
  const [shown, setShown] = useState(
    () =>
      installOffer({
        phone: true,
        installed: isInstalled(),
        welcomed: readWelcomed(),
        consent: readConsent(),
        dismissed: false,
        hasUsedApp: false,
      }) === "welcome",
  );
  const [canNotify, setCanNotify] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (shown) markWelcomed();
  }, [shown]);

  useEffect(() => {
    if (!shown || !pushSupported()) return;
    let cancelled = false;
    void api.pushStatus().then(
      (status) => {
        if (!cancelled) setCanNotify(status.enabled === true);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [shown]);

  if (!shown) return null;

  async function turnOn() {
    setError(null);
    setBusy(true);
    try {
      const outcome = await enablePush();
      if (outcome === "subscribed") setDone(true);
      else if (outcome === "denied") setError("settings.pushBlocked");
      else if (outcome === "unsupported") setError("settings.pushUnsupported");
      else setError("settings.pushUnavailable");
    } catch {
      setError("settings.couldNotChange");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="install-offer" data-testid="install-welcome">
      <Card title={t("install.welcome.title")}>
        <p className="hint">{t("install.welcome.body")}</p>
        <ErrorBanner message={error ? t(error) : null} />
        <div className="install-offer-actions">
          {canNotify && !done && (
            <button type="button" disabled={busy} onClick={() => void turnOn()}>
              {busy ? t("state.working") : t("install.welcome.notify")}
            </button>
          )}
          <button type="button" className="quiet" onClick={() => setShown(false)}>
            {t("install.welcome.done")}
          </button>
        </div>
      </Card>
    </div>
  );
}
