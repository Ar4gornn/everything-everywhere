/**
 * Turning browser push on and off (Epic 18).
 *
 * Kept out of the component because three of these steps fail in ordinary, boring ways —
 * an unsupported browser, a denied permission, an instance with no keys — and each has a
 * different honest answer.
 */

import { api } from "./api/client";

/** The browser needs the key as raw bytes; the server sends it base64url, as the spec says. */
function decodeKey(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  // Backed by a plain ArrayBuffer, which is what `applicationServerKey` accepts — a
  // Uint8Array over a SharedArrayBuffer does not satisfy BufferSource.
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export type PushOutcome = "subscribed" | "denied" | "unsupported" | "unavailable";

export async function enablePush(): Promise<PushOutcome> {
  if (!pushSupported()) return "unsupported";

  // Asked only when someone has actually clicked: a permission prompt on page load is the
  // reason people block notifications for good.
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";

  let key: string;
  try {
    key = (await api.pushKey()).public_key;
  } catch {
    // 503: this instance was never given VAPID keys.
    return "unavailable";
  }

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    // Required by every browser: a push that shows nothing is not allowed.
    userVisibleOnly: true,
    applicationServerKey: decodeKey(key),
  });

  const json = subscription.toJSON();
  await api.pushSubscribe({
    endpoint: subscription.endpoint,
    p256dh: json.keys?.p256dh ?? "",
    auth: json.keys?.auth ?? "",
  });
  return "subscribed";
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  // The server first: if the browser forgets the subscription but the row survives, this
  // device keeps being sent notifications it can no longer show.
  await api.pushUnsubscribe(subscription.endpoint);
  await subscription.unsubscribe();
}

/** This browser's subscription endpoint, or null when it is not subscribed (Epic 36). */
export async function currentEndpoint(): Promise<string | null> {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return subscription?.endpoint ?? null;
}

let enabledOnce: Promise<boolean> | null = null;

/**
 * Whether this instance can send pushes at all, asked once per page load. The bells on
 * pots, recurring rules and stock items (Epic 36) are hidden without it: muting a push
 * that can never be sent is a control that does nothing. A failed ask is "no", and is
 * asked again next time rather than remembered.
 */
export function pushEnabledOnce(): Promise<boolean> {
  enabledOnce ??= api.pushStatus().then(
    (status) => status?.enabled === true && pushSupported(),
    () => {
      enabledOnce = null;
      return false;
    },
  );
  return enabledOnce;
}

/** For tests: forget the cached answer. */
export function resetPushEnabled(): void {
  enabledOnce = null;
}

/** The browser's own IANA zone, or null where `Intl` cannot say (Epic 36). */
export function deviceZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}
