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
export default function InstallPage() {
  return null;
}
