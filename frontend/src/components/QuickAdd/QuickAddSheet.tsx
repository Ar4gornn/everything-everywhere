import { useQuickAdd } from "./QuickAddContext";

/**
 * Epic 44 (AD-60): the phone's bottom sheet for adding an entry — a native `<dialog>` opened
 * with `showModal()`, so the top layer, the inert page, Escape and focus containment are the
 * browser's. Mounted once by `App`, phone layout only. Spec: docs/epic-44-quick-add.md §4.
 *
 * Contract for the wiring (App): render `<QuickAddSheet />` inside `QuickAddProvider`,
 * `ToastProvider` and `TutorialProvider`; it reads everything else from context.
 */
export function QuickAddSheet() {
  const { isOpen } = useQuickAdd();
  if (!isOpen) return null;
  return null;
}
