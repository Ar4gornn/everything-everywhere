import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import type { QueuedEntry } from "../../entries/outbox";

/**
 * Epic 44 (AD-60): one quick-add sheet for the whole app, opened from anywhere.
 *
 * The provider owns whether the sheet is open and with what, and a `version` that goes up after
 * every write made through it (a save, or an undo). A page that shows entries lists `version`
 * in its `useLoad` dependencies, so whatever is behind the sheet refreshes on its own: no event
 * bus, no shared store. Spec: docs/epic-44-quick-add.md §2.
 */

export interface QuickAddOptions {
  /** `YYYY-MM-DD`; the sheet's date starts here instead of today (the calendar's day). */
  date?: string;
  /**
   * Epic 45 (AD-61): a refused queued entry being fixed. The sheet opens prefilled from it and
   * its Save replaces that queue item (same `client_ref`).
   */
  draft?: QueuedEntry;
}

interface QuickAddApi {
  isOpen: boolean;
  /** What `open` was last called with; read by the sheet when it opens. */
  options: QuickAddOptions;
  open: (options?: QuickAddOptions) => void;
  close: () => void;
  /** Bumped after each write through the sheet. */
  version: number;
  /** Called by the sheet after a save and after an undo. */
  bump: () => void;
}

const QuickAddContext = createContext<QuickAddApi | null>(null);

export function QuickAddProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const [options, setOptions] = useState<QuickAddOptions>({});
  const [version, setVersion] = useState(0);

  const open = useCallback((next: QuickAddOptions = {}) => {
    setOptions(next);
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  const bump = useCallback(() => setVersion((current) => current + 1), []);

  const value = useMemo(
    () => ({ isOpen, options, open, close, version, bump }),
    [isOpen, options, open, close, version, bump],
  );
  return <QuickAddContext.Provider value={value}>{children}</QuickAddContext.Provider>;
}

/** The sheet's controls. Throws outside the provider, like `useToast`. */
export function useQuickAdd(): QuickAddApi {
  const value = useContext(QuickAddContext);
  if (!value) throw new Error("useQuickAdd outside QuickAddProvider");
  return value;
}

/**
 * The write counter alone, for a page's `useLoad` dependencies. 0 outside the provider, so a
 * page rendered by itself in a test needs no wrapper.
 */
export function useEntriesVersion(): number {
  return useContext(QuickAddContext)?.version ?? 0;
}
