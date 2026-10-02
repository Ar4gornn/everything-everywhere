import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DISMISS_DAYS,
  type InstallConsent,
  cardDismissed,
  dismissCard,
  installOffer,
  markWelcomed,
  readConsent,
  readWelcomed,
  writeConsent,
} from "./consent";

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("consent storage", () => {
  it("is unset on a fresh device, then keeps yes and no", () => {
    expect(readConsent()).toBeNull();
    writeConsent("yes");
    expect(readConsent()).toBe("yes");
    expect(window.localStorage.getItem("everything-everywhere.install.consent")).toBe("yes");
    writeConsent("no");
    expect(readConsent()).toBe("no");
  });

  it("ignores a garbage stored value", () => {
    window.localStorage.setItem("everything-everywhere.install.consent", "maybe");
    expect(readConsent()).toBeNull();
  });

  it("hides the card for exactly DISMISS_DAYS", () => {
    const t0 = new Date("2026-10-03T10:00:00Z");
    expect(cardDismissed(t0)).toBe(false);
    dismissCard(t0);
    const day = 24 * 60 * 60 * 1000;
    expect(cardDismissed(new Date(t0.getTime() + (DISMISS_DAYS * day - 1)))).toBe(true);
    expect(cardDismissed(new Date(t0.getTime() + DISMISS_DAYS * day))).toBe(false);
  });

  it("a corrupt dismissal reads as not dismissed", () => {
    window.localStorage.setItem("everything-everywhere.install.dismissedAt", "soon");
    expect(cardDismissed()).toBe(false);
  });

  it("welcomed is false until marked, then true", () => {
    expect(readWelcomed()).toBe(false);
    markWelcomed();
    expect(readWelcomed()).toBe(true);
  });
});

describe("blocked storage", () => {
  function block() {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
  }

  it("never throws; dismissed is false; welcomed reads TRUE so it cannot show every launch", () => {
    block();
    expect(() => {
      writeConsent("no");
      dismissCard();
      markWelcomed();
    }).not.toThrow();
    expect(cardDismissed()).toBe(false);
    expect(readWelcomed()).toBe(true);
  });

  it("the session answer is kept in memory when storage refuses it", () => {
    block();
    writeConsent("yes");
    expect(readConsent()).toBe("yes");
  });
});

describe("installOffer", () => {
  const base = {
    phone: true,
    installed: false,
    welcomed: false,
    consent: null as InstallConsent,
    dismissed: false,
    hasUsedApp: true,
  };
  const rows: [string, Partial<typeof base>, ReturnType<typeof installOffer>][] = [
    ["installed, not welcomed -> welcome", { installed: true }, "welcome"],
    ["installed on desktop, not welcomed -> welcome", { installed: true, phone: false }, "welcome"],
    ["installed and welcomed -> nothing", { installed: true, welcomed: true }, null],
    ["installed beats a pending question", { installed: true, consent: null }, "welcome"],
    ["phone, unset, used -> question", {}, "question"],
    ["phone, unset, not used -> nothing", { hasUsedApp: false }, null],
    ["desktop, unset, used -> nothing", { phone: false }, null],
    ["phone, yes -> card", { consent: "yes" }, "card"],
    ["phone, yes, not used yet -> card", { consent: "yes", hasUsedApp: false }, "card"],
    ["phone, yes, dismissed -> nothing", { consent: "yes", dismissed: true }, null],
    ["desktop, yes -> nothing", { consent: "yes", phone: false }, null],
    ["phone, no -> nothing", { consent: "no" }, null],
    ["phone, no, dismissed false -> nothing", { consent: "no", dismissed: false }, null],
  ];
  it.each(rows)("%s", (_name, over, expected) => {
    expect(installOffer({ ...base, ...over })).toBe(expected);
  });
});
