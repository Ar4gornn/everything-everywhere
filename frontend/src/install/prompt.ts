/**
 * The browser's own install dialog (Epic 46, AD-62 §1).
 *
 * `beforeinstallprompt` (Chromium: Chrome, Edge, Samsung Internet) fires once, early, and is
 * lost if nobody is listening — so `main.tsx` calls `captureInstallPrompt()` before React
 * renders. The event is kept, `preventDefault()`ed (no mini-infobar: the app offers installing
 * at a better moment, after consent), and is single use (MDN: `prompt()` may be called once per
 * event). `appinstalled` marks the device installed. Safari and Firefox never fire it; their
 * path is the illustrated guide.
 */

import { useMemo, useSyncExternalStore } from "react";

export type PromptOutcome = "accepted" | "dismissed" | "unavailable";

/** The non-standard Chromium event, as far as this module uses it. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<unknown> | undefined;
  userChoice: Promise<{ outcome: string }>;
}

interface InstallSnapshot {
  canPrompt: boolean;
  justInstalled: boolean;
}

let started = false;
let kept: BeforeInstallPromptEvent | null = null;
let installed = false;
// One object per state: useSyncExternalStore compares snapshots by identity.
let snapshot: InstallSnapshot = { canPrompt: false, justInstalled: false };
const listeners = new Set<() => void>();

function refresh(): void {
  const canPrompt = kept !== null;
  if (snapshot.canPrompt === canPrompt && snapshot.justInstalled === installed) return;
  snapshot = { canPrompt, justInstalled: installed };
  for (const listener of [...listeners]) listener();
}

/** Start listening. Idempotent; called once from `main.tsx`. */
export function captureInstallPrompt(): void {
  if (started) return;
  started = true;
  window.addEventListener("beforeinstallprompt", (event) => {
    // No mini-infobar; we offer it ourselves.
    event.preventDefault();
    kept = event as BeforeInstallPromptEvent;
    refresh();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    kept = null;
    refresh();
  });
}

/** Whether the browser handed us an install dialog we can still show. */
export function canPrompt(): boolean {
  return snapshot.canPrompt;
}

/** Show the browser's install dialog. Single use: after it, `canPrompt()` is false. */
export async function promptInstall(): Promise<PromptOutcome> {
  const event = kept;
  if (!event) return "unavailable";
  // Single use, whatever the answer: clear before awaiting so a second tap cannot reuse it.
  kept = null;
  refresh();
  try {
    await event.prompt();
    const choice = await event.userChoice;
    return choice.outcome === "accepted" ? "accepted" : "dismissed";
  } catch {
    // prompt() refused (not from a tap, or already used): nothing was shown.
    return "unavailable";
  }
}

/** True after `appinstalled` fired in this session (the tab is still a tab until reopened). */
export function justInstalled(): boolean {
  return snapshot.justInstalled;
}

/** Hear `canPrompt`/`justInstalled` changes. Returns unsubscribe. */
export function subscribeInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = (): InstallSnapshot => snapshot;
const SERVER: InstallSnapshot = { canPrompt: false, justInstalled: false };
const getServerSnapshot = (): InstallSnapshot => SERVER;

/** `{ canPrompt, justInstalled, prompt }`, re-rendering on change (useSyncExternalStore). */
export function useInstallPrompt(): {
  canPrompt: boolean;
  justInstalled: boolean;
  prompt: () => Promise<PromptOutcome>;
} {
  const state = useSyncExternalStore(subscribeInstall, getSnapshot, getServerSnapshot);
  return useMemo(() => ({ ...state, prompt: promptInstall }), [state]);
}
