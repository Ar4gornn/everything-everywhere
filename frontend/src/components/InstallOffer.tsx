import { useState } from "react";
import { Link } from "react-router-dom";

import { useT } from "../i18n";
import { cardDismissed, dismissCard, installOffer, readConsent, readWelcomed, writeConsent } from "../install/consent";
import { useInstallPrompt } from "../install/prompt";
import { useLayout } from "../layout/useLayout";
import { isInstalled } from "../pwa";
import { useTutorial } from "./Tutorial/useTutorial";
import { Card } from "./ui";

/**
 * Epic 46 (AD-62 §3, §4): the dashboard's install offer, phone only. First a question, once
 * the account has been used ("Want help installing the app on this phone?"); a Yes unlocks
 * the card, a No ends it on this device. The card is one tap where the browser handed us an
 * install dialog, else a link to the illustrated guide. The rule itself is `installOffer`.
 */
export function InstallOffer({ hasUsedApp }: { hasUsedApp: boolean }) {
  const t = useT();
  const phone = useLayout() === "phone";
  const { canPrompt, justInstalled, prompt } = useInstallPrompt();
  // Read on every render, not once: the tour's install step writes the same answer while this
  // card is mounted, and a stale copy would ask again after a "No". `answered` only re-renders.
  const [, answered] = useState(0);
  const setConsent = (_answer: "yes" | "no") => answered((n) => n + 1);
  const consent = readConsent();
  const { step } = useTutorial();
  const [dismissed, setDismissed] = useState(() => cardDismissed());
  const [accepted, setAccepted] = useState(false);

  // While the tour runs it asks this itself (its install step); never both at once.
  const offer = step !== null ? null : installOffer({
    phone,
    installed: isInstalled() || justInstalled || accepted,
    welcomed: readWelcomed(),
    consent,
    dismissed,
    hasUsedApp,
  });

  if (offer === "question") {
    return (
      <div className="install-offer" data-testid="install-question">
        <Card title={t("install.ask.title")}>
          <p className="hint">{t("install.ask.body")}</p>
          <div className="install-offer-actions">
            <button
              type="button"
              onClick={() => {
                writeConsent("yes");
                setConsent("yes");
              }}
            >
              {t("install.ask.yes")}
            </button>
            <button
              type="button"
              className="quiet"
              onClick={() => {
                writeConsent("no");
                setConsent("no");
              }}
            >
              {t("install.ask.no")}
            </button>
          </div>
        </Card>
      </div>
    );
  }

  if (offer === "card") {
    return (
      <div className="install-offer" data-testid="install-card">
        <Card title={t("install.card.title")}>
          <p className="hint">{t("install.card.body")}</p>
          <div className="install-offer-actions">
            {canPrompt ? (
              <button
                type="button"
                onClick={() =>
                  void prompt().then((outcome) => {
                    if (outcome === "accepted") setAccepted(true);
                  })
                }
              >
                {t("install.card.oneTap")}
              </button>
            ) : (
              <Link className="install-offer-link" to="/install">
                {t("install.card.howTo")}
              </Link>
            )}
            <button
              type="button"
              className="quiet"
              onClick={() => {
                dismissCard();
                setDismissed(true);
              }}
            >
              {t("install.card.notNow")}
            </button>
          </div>
        </Card>
      </div>
    );
  }

  return null;
}
