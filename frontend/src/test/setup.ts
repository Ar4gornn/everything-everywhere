import "@testing-library/jest-dom/vitest";

import { afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * English is the language a test renders in, pinned rather than inherited (Epic 25).
 *
 * Without this the suite asserts against whatever `navigator.languages` happens to say on the
 * machine running it — and the development machine here is set to French, so half the
 * expectations in this repository would fail for one developer and pass for another. It is
 * the same hazard `money.ts` and `months.ts` already avoid by pinning their own formatting:
 * the *machine's* locale is never the language under test.
 *
 * A test that wants French sets it explicitly, either by storing the preference or by asking
 * for a `translator("fr")`.
 */
Object.defineProperty(window.navigator, "languages", {
  value: ["en-GB", "en"],
  configurable: true,
});
Object.defineProperty(window.navigator, "language", {
  value: "en-GB",
  configurable: true,
});

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

/**
 * jsdom has no `showModal`/`close` on <dialog> (Epic 44, AD-60: the quick-add sheet is a native
 * dialog). Stubbed once here: opening sets `open`, closing removes it and fires "close".
 */
if (typeof HTMLDialogElement !== "undefined") {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      if (!this.hasAttribute("open")) return;
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  }
}
