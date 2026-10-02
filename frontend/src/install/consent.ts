/**
 * What this device said about installing (Epic 46, AD-62 §3). Device-level, not per account:
 * installing is about the phone. Keys `everything-everywhere.install.{consent,dismissedAt,welcomed}`,
 * every read and write in try/catch — blocked storage reads as "unset" and never loops the
 * question or crashes the dashboard.
 */

export type InstallConsent = "yes" | "no" | null;

/** How long "Not now" on the card hides it on this device. */
export const DISMISS_DAYS = 30;

export function readConsent(): InstallConsent {
  throw new Error("not built");
}

export function writeConsent(answer: "yes" | "no"): void {
  void answer;
  throw new Error("not built");
}

/** Hide the card for `DISMISS_DAYS` from `now`. */
export function dismissCard(now?: Date): void {
  void now;
  throw new Error("not built");
}

/** True while a dismissal is still in force at `now`. */
export function cardDismissed(now?: Date): boolean {
  void now;
  throw new Error("not built");
}

/** The installed app's one-time welcome: has this device shown it? */
export function readWelcomed(): boolean {
  throw new Error("not built");
}

export function markWelcomed(): void {
  throw new Error("not built");
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
  void state;
  throw new Error("not built");
}
