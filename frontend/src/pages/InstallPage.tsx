import { useState, type ReactNode } from "react";

import { useOptionalAuth } from "../auth/AuthContext";
import type { Language } from "../api/types";
import { LANGUAGES, useLanguage } from "../i18n";
import type { MessageKey } from "../i18n/catalogue";
import { AndroidConfirm, AndroidFirefoxList, AndroidMenuButton, AndroidMenuList } from "../install/diagrams/android";
import { DesktopConfirm, DesktopInstallIcon, MacAdd, MacFileMenu } from "../install/diagrams/desktop";
import {
  IosAddButton,
  IosMenuButton,
  IosShareBottom,
  IosShareSheet,
  IosShareTop,
  IosWebAppToggle,
} from "../install/diagrams/ios";
import { currentPlatform, type InstallPlatform } from "../install/platform";
import { useInstallPrompt } from "../install/prompt";
import { isInstalled } from "../pwa";

/**
 * `/install` (Epic 46, AD-62 §3, §2.5): the step-by-step guide, public — rendered before the
 * sign-in gate as well as a normal route — so the link can be sent to someone without an
 * account. Detects the platform (`install/platform.ts`), shows its steps first with a switcher
 * (iPhone · Android · Computer), the one-tap button where `useInstallPrompt().canPrompt`, and
 * "Already installed" when `isInstalled()`. Spec: docs/epic-46-install.md §3.
 *
 * Contract for the wiring (App): default export, no props; it reads language from
 * `useLanguage()` (works signed out) and needs no auth.
 */

type Tab = "iphone" | "android" | "computer";
const TABS: Tab[] = ["iphone", "android", "computer"];

const tabOf = (os: InstallPlatform["os"]): Tab => (os === "ios" ? "iphone" : os === "android" ? "android" : "computer");

interface Step {
  text: MessageKey;
  art: ReactNode;
}

function StepList({ heading, steps }: { heading?: MessageKey; steps: Step[] }) {
  const { t } = useLanguage();
  return (
    <section className="install-steps">
      {heading && <h3 className="install-heading">{t(heading)}</h3>}
      <ol>
        {steps.map((step) => (
          <li key={step.text}>
            <p>{t(step.text)}</p>
            {step.art}
          </li>
        ))}
      </ol>
    </section>
  );
}

const IOS_SAFARI: Step[] = [
  { text: "installGuide.ios.s1", art: <IosMenuButton /> },
  { text: "installGuide.ios.s2", art: <IosShareSheet /> },
  { text: "installGuide.ios.s3", art: <IosWebAppToggle /> },
  { text: "installGuide.ios.s4", art: <IosAddButton /> },
];
const IOS_OLDER: Step[] = [
  { text: "installGuide.ios.o1", art: <IosShareBottom /> },
  { text: "installGuide.ios.o2", art: <IosShareSheet /> },
  { text: "installGuide.ios.o3", art: <IosAddButton /> },
];
const IOS_OTHER: Step[] = [
  { text: "installGuide.ios.c1", art: <IosShareTop /> },
  { text: "installGuide.ios.c2", art: <IosShareSheet /> },
  { text: "installGuide.ios.c3", art: <IosWebAppToggle /> },
];
const ANDROID_CHROME: Step[] = [
  { text: "installGuide.android.a1", art: <AndroidMenuButton /> },
  { text: "installGuide.android.a2", art: <AndroidMenuList /> },
  { text: "installGuide.android.a3", art: <AndroidConfirm /> },
];
const ANDROID_FIREFOX: Step[] = [
  { text: "installGuide.android.a1", art: <AndroidMenuButton /> },
  { text: "installGuide.android.f2", art: <AndroidFirefoxList /> },
  { text: "installGuide.android.f3", art: <IosAddButton /> },
];
const DESKTOP_CHROME: Step[] = [
  { text: "installGuide.desktop.d1", art: <DesktopInstallIcon /> },
  { text: "installGuide.desktop.d2", art: <DesktopConfirm /> },
];
const DESKTOP_SAFARI: Step[] = [
  { text: "installGuide.desktop.m1", art: <MacFileMenu /> },
  { text: "installGuide.desktop.m3", art: <MacAdd /> },
];

export default function InstallPage() {
  const { t, lang, setLanguage } = useLanguage();
  const signedIn = useOptionalAuth()?.user != null;
  const platform = currentPlatform();
  const { canPrompt, justInstalled, prompt } = useInstallPrompt();
  const installed = isInstalled() || justInstalled;

  const deviceTab = tabOf(platform.os);
  const [tab, setTab] = useState<Tab>(deviceTab);
  const [outcome, setOutcome] = useState<"accepted" | "dismissed" | null>(null);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");

  // What the person is actually holding: the detected browser applies only on its own tab.
  const here = tab === deviceTab;
  const browser = here ? platform.browser : null;
  const offerButton = canPrompt && here && tab !== "iphone";
  // The menu steps wait behind the button until it has been tried and refused.
  const showSteps = outcome === "dismissed" || (outcome === null && !offerButton);

  async function install() {
    const result = await prompt();
    setOutcome(result === "accepted" ? "accepted" : "dismissed");
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  }

  const installBlock = (
    <>
      {offerButton && outcome === null && (
        <div className="install-oneTap">
          <button type="button" onClick={() => void install()}>
            {t("installGuide.button")}
          </button>
          <p className="hint">{t("installGuide.buttonHint")}</p>
        </div>
      )}
      {outcome === "accepted" && (
        <p className="install-done" role="status">
          {t("installGuide.accepted")}
        </p>
      )}
      {outcome === "dismissed" && (
        <p className="hint" role="status">
          {t("installGuide.dismissed")}
        </p>
      )}
    </>
  );

  let body: ReactNode;
  if (tab === "iphone") {
    const ios = platform.os === "ios";
    const major = ios ? platform.iosMajor : null;
    const safari = !ios || platform.browser === "safari";
    body = safari ? (
      <>
        <StepList heading="installGuide.ios.safariHeading" steps={IOS_SAFARI} />
        <details className="install-older" open={major !== null && major < 26}>
          <summary>{t("installGuide.ios.olderSummary")}</summary>
          <StepList steps={IOS_OLDER} />
        </details>
      </>
    ) : (
      <>
        <StepList heading="installGuide.ios.otherHeading" steps={IOS_OTHER} />
        <p className="hint">{t("installGuide.ios.otherNote")}</p>
      </>
    );
  } else if (tab === "android") {
    body = (
      <>
        {browser === "samsung" && (
          <div className="install-note">
            <p>{t("installGuide.samsung.note")}</p>
            <button type="button" className="secondary" onClick={() => void copyLink()}>
              {t("installGuide.samsung.copy")}
            </button>
            {copy === "copied" && <p role="status">{t("installGuide.samsung.copied")}</p>}
            {copy === "failed" && <p role="status">{t("installGuide.samsung.copyFailed")}</p>}
          </div>
        )}
        {installBlock}
        {showSteps &&
          (browser === "firefox" ? (
            <StepList heading="installGuide.android.firefoxHeading" steps={ANDROID_FIREFOX} />
          ) : (
            <StepList heading="installGuide.android.chromeHeading" steps={ANDROID_CHROME} />
          ))}
      </>
    );
  } else if (browser === "firefox") {
    body = <p className="install-note">{t("installGuide.desktop.firefox")}</p>;
  } else if (browser === "safari") {
    body = <StepList heading="installGuide.desktop.safariHeading" steps={DESKTOP_SAFARI} />;
  } else {
    body = (
      <>
        {installBlock}
        {showSteps && <StepList heading="installGuide.desktop.chromeHeading" steps={DESKTOP_CHROME} />}
        <p className="hint">{t("installGuide.desktop.also")}</p>
      </>
    );
  }

  return (
    <main className="install-page">
      <header>
        <a className="back" href="/">
          {t("installGuide.open")}
        </a>
        <h1 className="install-title">{t("installGuide.title")}</h1>
        <p className="hint">{t("installGuide.why")}</p>
        {!signedIn && (
          <label className="inline-select">
            {t("signin.language")}
            <select
              aria-label={t("signin.language")}
              value={lang}
              onChange={(event) => void setLanguage(event.target.value as Language)}
            >
              {LANGUAGES.map((option) => (
                <option key={option} value={option}>
                  {option === "en" ? t("settings.languageEn") : t("settings.languageFr")}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      {installed && (
        <section className="install-installed" role="status">
          <h2 className="install-heading">{t("installGuide.installed.title")}</h2>
          <p>{t("installGuide.installed.body")}</p>
        </section>
      )}

      <div className="install-tabs" role="group" aria-label={t("installGuide.tabs")}>
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            className={id === tab ? undefined : "secondary"}
            aria-pressed={id === tab}
            onClick={() => setTab(id)}
          >
            {t(`installGuide.tab.${id}`)}
          </button>
        ))}
      </div>

      {body}

      <section className="install-why">
        <h2 className="install-heading">{t("installGuide.why.title")}</h2>
        <ul>
          <li>{t("installGuide.why.1")}</li>
          <li>{t("installGuide.why.2")}</li>
          <li>{t("installGuide.why.3")}</li>
        </ul>
      </section>
    </main>
  );
}
