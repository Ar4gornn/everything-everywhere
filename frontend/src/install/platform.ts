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
 * The iOS major version, as far as a user agent can say.
 *
 * Since iOS 26 Safari FREEZES the OS token: `CPU iPhone OS 18_6` (18_7 in later 26.x) on every
 * iOS 26 device (Apple, WebKit UA freeze; see docs.uaparser.dev "How to Detect iOS >= 26").
 * The real release is only in Safari's `Version/26.x` token, and since iOS 13 Safari's version
 * equals the iOS version. So: `Version/N` wins when present (Safari, iPhone and iPadOS);
 * otherwise the `iPhone OS N_` token. Third-party iOS browsers (CriOS, EdgiOS, FxiOS) carry no
 * `Version/` token; whether they freeze the OS token on iOS 26 is NOT verified, so for them
 * `iosMajor` is the OS token and may read 18 on an iOS 26 phone. The guide must not depend on
 * it for those browsers (its iOS 26 step is phrased as "if you see the toggle").
 */
function iosMajorOf(ua: string): number | null {
  const version = /\bVersion\/(\d+)/.exec(ua);
  if (version?.[1]) return Number(version[1]);
  const os = /\bOS (\d+)_\d+/.exec(ua);
  if (os?.[1]) return Number(os[1]);
  return null;
}

/**
 * `userAgent` and `maxTouchPoints` from `navigator`. iPadOS reports a Mac user agent: a Mac UA
 * with more than one touch point is iOS. On iOS every browser is WebKit, so the browser is
 * named by its UA token (CriOS = Chrome, EdgiOS = Edge, FxiOS = Firefox, else Safari).
 */
export function detectPlatform(userAgent: string, maxTouchPoints: number): InstallPlatform {
  const ua = userAgent;
  const isIos = /\b(iPhone|iPad|iPod)\b/.test(ua) || (/\bMacintosh\b/.test(ua) && maxTouchPoints > 1);
  if (isIos) {
    let browser: InstallBrowser = "safari";
    // Opera (OPT), Opera Mini (OPiOS) and Opera GX (OPX) on iOS carry Safari's own tokens,
    // GX even `Version/`, so they are named before anything else.
    if (/\b(OPX|OPT|OPiOS)\//.test(ua)) browser = "other";
    else if (/\bCriOS\//.test(ua)) browser = "chrome";
    else if (/\bEdgiOS\//.test(ua)) browser = "edge";
    else if (/\bFxiOS\//.test(ua)) browser = "firefox";
    return { os: "ios", browser, iosMajor: iosMajorOf(ua) };
  }
  if (/\bAndroid\b/.test(ua)) {
    let browser: InstallBrowser = "other";
    // Samsung Internet also says "Chrome/", so it is named first.
    if (/\bSamsungBrowser\//.test(ua)) browser = "samsung";
    else if (/\bEdgA\//.test(ua)) browser = "edge";
    else if (/\bFirefox\//.test(ua)) browser = "firefox";
    else if (/\b(OPR|OPX)\//.test(ua)) browser = "other";
    else if (/\bChrome\//.test(ua)) browser = "chrome";
    return { os: "android", browser, iosMajor: null };
  }
  let browser: InstallBrowser = "other";
  if (/\bEdg\//.test(ua)) browser = "edge";
  else if (/\bFirefox\//.test(ua)) browser = "firefox";
  else if (/\bOPR\//.test(ua)) browser = "other";
  else if (/\bChrome\//.test(ua)) browser = "chrome";
  else if (/\bSafari\//.test(ua)) browser = "safari";
  return { os: "desktop", browser, iosMajor: null };
}

/** The platform of the browser running this code. */
export function currentPlatform(): InstallPlatform {
  return detectPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0);
}
