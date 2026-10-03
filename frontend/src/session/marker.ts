/**
 * AD-66: the marker cookie.
 *
 * The reverse proxy answers `/` with the static landing page for a visitor and with the app
 * for anyone carrying `ee_app=1` (or any query string). This cookie is how the server learns,
 * before any JavaScript runs, that this browser has a session here.
 *
 * It is a routing hint, never a credential: it holds no identity and grants nothing. A forged
 * one shows the sign-in page; a missing one shows the landing page once. The tokens stay in
 * localStorage; this only mirrors "a refresh token exists".
 */

export const MARKER_COOKIE = "ee_app";

// 400 days, the longest lifetime browsers honour.
const MAX_AGE = 34560000;

function write(attributes: string): void {
  try {
    // biome-ignore lint/suspicious/noDocumentCookie: the proxy reads this cookie on the very first request; the async Cookie Store API is not in every supported browser.
    document.cookie = `${MARKER_COOKIE}=${attributes}`;
  } catch {
    // Sandboxed documents and blocked cookies throw here. The worst case is the landing
    // page on a visit to `/`, one tap from the app.
  }
}

function secure(): string {
  return window.location.protocol === "https:" ? "; Secure" : "";
}

export function setMarker(): void {
  write(`1; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax${secure()}`);
}

export function clearMarker(): void {
  write(`; Path=/; Max-Age=0; SameSite=Lax${secure()}`);
}
