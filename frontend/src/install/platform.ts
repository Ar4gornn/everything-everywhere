/**
 * Which phone and browser this is, for the install guide (Epic 46, AD-62 §2).
 * Spec: docs/epic-46-install.md. Pure: tested against real user-agent strings.
 */

export type InstallOs = "ios" | "android" | "desktop";
export type InstallBrowser = "safari" | "chrome" | "edge" | "firefox" | "samsung" | "other";

export interface InstallPlatform {
  os: InstallOs;
  browser: InstallBrowser;
  /** iOS major version (26, 18, 17…), null elsewhere or when the UA does not say. */
  iosMajor: number | null;
}

/**
 * `userAgent` and `maxTouchPoints` from `navigator`. iPadOS reports a Mac user agent: a Mac UA
 * with more than one touch point is iOS. On iOS every browser is WebKit, so the browser is
 * named by its UA token (CriOS = Chrome, EdgiOS = Edge, FxiOS = Firefox, else Safari).
 */
export function detectPlatform(userAgent: string, maxTouchPoints: number): InstallPlatform {
  void userAgent;
  void maxTouchPoints;
  throw new Error("not built");
}

/** The platform of the browser running this code. */
export function currentPlatform(): InstallPlatform {
  return detectPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0);
}
