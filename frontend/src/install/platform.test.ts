import { describe, expect, it } from "vitest";

import { detectPlatform } from "./platform";

/*
 * Real user-agent strings, in the shapes published by: Apple/WebKit UA freeze for iOS 26
 * (Version/26.5 with `iPhone OS 18_7`; singular.net, appsflyer.com and docs.uaparser.dev
 * "How to Detect iOS >= 26"), the Chromium docs "User Agent in Chrome for iOS", MDN
 * "Browser detection using the user agent", user-agents.net and useragents.io listings, and
 * testmuai.com "Latest ... User Agent Strings". Version numbers drift; the tokens tested here
 * (CriOS, EdgiOS, FxiOS, SamsungBrowser, EdgA, Edg, Version/, Macintosh) are stable.
 */
const SAFARI_IOS26 =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1";
const SAFARI_IOS26_FIRST =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const SAFARI_IOS17 =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const CHROME_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1";
const EDGE_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/126.2592.87 Mobile/15E148 Safari/605.1.15";
const FIREFOX_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15";
const SAFARI_IPADOS =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
const SAFARI_IPADOS26 =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const SAMSUNG =
  "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36";
const FIREFOX_ANDROID = "Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0";
const EDGE_ANDROID =
  "Mozilla/5.0 (Linux; Android 10; HD1913) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 EdgA/126.0.2592.80";
const CHROME_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const EDGE_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.81";
const SAFARI_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const FIREFOX_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0";

describe("detectPlatform", () => {
  const rows: [string, string, number, string, string, number | null][] = [
    ["iPhone Safari iOS 26 (frozen OS token)", SAFARI_IOS26, 5, "ios", "safari", 26],
    ["iPhone Safari iOS 26.0", SAFARI_IOS26_FIRST, 5, "ios", "safari", 26],
    ["iPhone Safari iOS 17", SAFARI_IOS17, 5, "ios", "safari", 17],
    ["iPhone Chrome (CriOS)", CHROME_IOS, 5, "ios", "chrome", 17],
    ["iPhone Edge (EdgiOS)", EDGE_IOS, 5, "ios", "edge", 17],
    ["iPhone Firefox (FxiOS)", FIREFOX_IOS, 5, "ios", "firefox", 17],
    ["iPadOS Safari (Mac UA, 5 touch points)", SAFARI_IPADOS, 5, "ios", "safari", 18],
    ["iPadOS 26 Safari", SAFARI_IPADOS26, 5, "ios", "safari", 26],
    ["Android Chrome", CHROME_ANDROID, 5, "android", "chrome", null],
    ["Android Samsung Internet", SAMSUNG, 5, "android", "samsung", null],
    ["Android Firefox", FIREFOX_ANDROID, 5, "android", "firefox", null],
    ["Android Edge (EdgA)", EDGE_ANDROID, 5, "android", "edge", null],
    ["Windows Chrome", CHROME_WIN, 0, "desktop", "chrome", null],
    ["Windows Edge", EDGE_WIN, 0, "desktop", "edge", null],
    ["macOS Safari (no touch)", SAFARI_MAC, 0, "desktop", "safari", null],
    ["Windows Firefox", FIREFOX_WIN, 0, "desktop", "firefox", null],
  ];

  it.each(rows)("%s", (_name, ua, touch, os, browser, iosMajor) => {
    expect(detectPlatform(ua, touch)).toEqual({ os, browser, iosMajor });
  });

  it("a touch-screen Mac UA with exactly one touch point stays desktop", () => {
    expect(detectPlatform(SAFARI_MAC, 1).os).toBe("desktop");
  });

  it("an unknown browser on desktop is other", () => {
    expect(detectPlatform("curl/8.0", 0)).toEqual({ os: "desktop", browser: "other", iosMajor: null });
  });
});
