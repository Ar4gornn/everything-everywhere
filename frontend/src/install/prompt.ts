/**
 * The browser's own install dialog (Epic 46, AD-62 §1).
 *
 * `beforeinstallprompt` (Chromium: Chrome, Edge, Samsung Internet) fires once, early, and is
 * lost if nobody is listening — so this module listens from the moment it is imported, and
 * `main.tsx` imports it before React renders. The event is kept, `preventDefault()`ed (no
 * mini-infobar: the app offers installing at a better moment, after consent), and is single
 * use. `appinstalled` marks the device installed. Safari and Firefox never fire it; their
 * path is the illustrated guide.
 */

export type PromptOutcome = "accepted" | "dismissed" | "unavailable";

/** Start listening. Idempotent; called once from `main.tsx`. */
export function captureInstallPrompt(): void {
  throw new Error("not built");
}

/** Whether the browser handed us an install dialog we can still show. */
export function canPrompt(): boolean {
  throw new Error("not built");
}

/** Show the browser's install dialog. Single use: after it, `canPrompt()` is false. */
export function promptInstall(): Promise<PromptOutcome> {
  throw new Error("not built");
}

/** True after `appinstalled` fired in this session (the tab is still a tab until reopened). */
export function justInstalled(): boolean {
  throw new Error("not built");
}

/** Hear `canPrompt`/`justInstalled` changes. Returns unsubscribe. */
export function subscribeInstall(listener: () => void): () => void {
  void listener;
  throw new Error("not built");
}

/** `{ canPrompt, justInstalled, prompt }`, re-rendering on change (useSyncExternalStore). */
export function useInstallPrompt(): {
  canPrompt: boolean;
  justInstalled: boolean;
  prompt: () => Promise<PromptOutcome>;
} {
  throw new Error("not built");
}
