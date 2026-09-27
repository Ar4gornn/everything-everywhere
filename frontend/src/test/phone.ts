import { afterEach, beforeEach, vi } from "vitest";

/**
 * Makes `useLayout()` answer "phone" for every test in the enclosing `describe` (AD-53).
 * jsdom has no `matchMedia`, so without this every page draws its desktop tables.
 */
export function onAPhone(): void {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
}
