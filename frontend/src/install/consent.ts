/**
 * What this device said about installing (Epic 46, AD-62 §3). Device-level, not per account:
 * installing is about the phone. Keys `everything-everywhere.install.{consent,dismissedAt,welcomed}`,
 * every read and write in try/catch — blocked storage reads as "unset" and never loops the
 * question or crashes the dashboard.
 *
 * Blocked storage, per key: consent reads from an in-memory copy of this session's answer (so
 * the question is not asked twice in one session; it returns on the next launch, nothing can
 * remember it), dismissed false, and welcomed TRUE — a welcome that cannot be remembered would
 * show on every launch, so it is better never shown.
 */

import { PREFIX } from "../storage";

export type InstallConsent = "yes" | "no" | null;

/** How long "Not now" on the card hides it on this device. */
export const DISMISS_DAYS = 30;

const CONSENT = `${PREFIX}install.consent`;
const DISMISSED_AT = `${PREFIX}install.dismissedAt`;
const WELCOMED = `${PREFIX}install.welcomed`;
const DAY_MS = 24 * 60 * 60 * 1000;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** True when the write landed. */
function write(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** The answer given this session when storage refused it; null whenever storage took it. */
let unsaved: "yes" | "no" | null = null;

export function readConsent(): InstallConsent {
  const raw = read(CONSENT);
  if (raw === "yes" || raw === "no") return raw;
  return unsaved;
}

export function writeConsent(answer: "yes" | "no"): void {
  unsaved = write(CONSENT, answer) ? null : answer;
}

/** Hide the card for `DISMISS_DAYS` from `now`. */
export function dismissCard(now: Date = new Date()): void {
  write(DISMISSED_AT, String(now.getTime()));
}

/** True while a dismissal is still in force at `now`. */
export function cardDismissed(now: Date = new Date()): boolean {
  const raw = read(DISMISSED_AT);
  if (raw === null) return false;
  const at = Number(raw);
  if (!Number.isFinite(at)) return false;
  // A dismissal "from the future" (the clock was moved back) is not in force.
  if (now.getTime() < at) return false;
  return now.getTime() - at < DISMISS_DAYS * DAY_MS;
}

/**
 * The installed app's one-time welcome: has this device shown it? Reads TRUE when storage is
 * blocked, so the welcome cannot show on every launch.
 */
export function readWelcomed(): boolean {
  try {
    return window.localStorage.getItem(WELCOMED) !== null;
  } catch {
    return true;
  }
}

export function markWelcomed(): void {
  write(WELCOMED, "1");
}

/**
 * The one rule for the dashboard, pure so it can be table-tested:
 * - `"welcome"` installed and not yet welcomed;
 * - `"question"` phone, not installed, consent unset, has used the app;
 * - `"card"` phone, not installed, consent yes, not dismissed;
 * - `null` otherwise (incl. consent "no", desktop, no use yet).
 */
export function installOffer(state: {
  phone: boolean;
  installed: boolean;
  welcomed: boolean;
  consent: InstallConsent;
  dismissed: boolean;
  hasUsedApp: boolean;
}): "welcome" | "question" | "card" | null {
  if (state.installed) return state.welcomed ? null : "welcome";
  if (!state.phone) return null;
  if (state.consent === null) return state.hasUsedApp ? "question" : null;
  if (state.consent === "yes" && !state.dismissed) return "card";
  return null;
}
