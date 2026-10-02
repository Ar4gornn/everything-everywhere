import { beforeEach, describe, expect, it, vi } from "vitest";

type Prompt = typeof import("./prompt");

/** A stand-in for Chromium's BeforeInstallPromptEvent. */
function fakeEvent(outcome: string = "accepted") {
  const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
    prompt: ReturnType<typeof vi.fn>;
    userChoice: Promise<{ outcome: string }>;
  };
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome });
  return event;
}

// Module state is the point (captured once, early), so each test gets a fresh module — and the
// listeners of the previous one are removed with it.
let mod: Prompt;
const added: [string, EventListenerOrEventListenerObject][] = [];
const realAdd = window.addEventListener.bind(window);

beforeEach(async () => {
  for (const [type, fn] of added.splice(0)) window.removeEventListener(type, fn);
  vi.spyOn(window, "addEventListener").mockImplementation((type, fn, opts) => {
    added.push([type, fn as EventListenerOrEventListenerObject]);
    realAdd(type, fn as EventListenerOrEventListenerObject, opts);
  });
  vi.resetModules();
  mod = await import("./prompt");
});

describe("install prompt capture", () => {
  it("keeps an event fired right after capture, before any React", () => {
    mod.captureInstallPrompt();
    expect(mod.canPrompt()).toBe(false);
    window.dispatchEvent(fakeEvent());
    expect(mod.canPrompt()).toBe(true);
  });

  it("does not listen until captureInstallPrompt is called", () => {
    window.dispatchEvent(fakeEvent());
    expect(mod.canPrompt()).toBe(false);
  });

  it("is idempotent: two calls register one listener per event", () => {
    mod.captureInstallPrompt();
    mod.captureInstallPrompt();
    expect(added.filter(([type]) => type === "beforeinstallprompt")).toHaveLength(1);
    expect(added.filter(([type]) => type === "appinstalled")).toHaveLength(1);
  });

  it("calls preventDefault so there is no mini-infobar", () => {
    mod.captureInstallPrompt();
    const event = fakeEvent();
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("maps accepted and dismissed", async () => {
    mod.captureInstallPrompt();
    const yes = fakeEvent("accepted");
    window.dispatchEvent(yes);
    await expect(mod.promptInstall()).resolves.toBe("accepted");
    expect(yes.prompt).toHaveBeenCalledTimes(1);

    const no = fakeEvent("dismissed");
    window.dispatchEvent(no);
    await expect(mod.promptInstall()).resolves.toBe("dismissed");
  });

  it("is single use: after prompt() the event is gone and a second call is unavailable", async () => {
    mod.captureInstallPrompt();
    const event = fakeEvent();
    window.dispatchEvent(event);
    await mod.promptInstall();
    expect(mod.canPrompt()).toBe(false);
    await expect(mod.promptInstall()).resolves.toBe("unavailable");
    expect(event.prompt).toHaveBeenCalledTimes(1);
  });

  it("is unavailable when no event ever came", async () => {
    mod.captureInstallPrompt();
    await expect(mod.promptInstall()).resolves.toBe("unavailable");
  });

  it("is unavailable when the browser refuses prompt()", async () => {
    mod.captureInstallPrompt();
    const event = fakeEvent();
    event.prompt.mockRejectedValue(new Error("not from a gesture"));
    window.dispatchEvent(event);
    await expect(mod.promptInstall()).resolves.toBe("unavailable");
  });

  it("appinstalled marks the device installed and clears the event", () => {
    mod.captureInstallPrompt();
    window.dispatchEvent(fakeEvent());
    expect(mod.justInstalled()).toBe(false);
    window.dispatchEvent(new Event("appinstalled"));
    expect(mod.justInstalled()).toBe(true);
    expect(mod.canPrompt()).toBe(false);
  });

  it("notifies subscribers on change, and not after unsubscribe", () => {
    mod.captureInstallPrompt();
    const listener = vi.fn();
    const off = mod.subscribeInstall(listener);
    window.dispatchEvent(fakeEvent());
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    window.dispatchEvent(new Event("appinstalled"));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("install prompt snapshot", () => {
  it("a second event while one is kept changes nothing visible: no notification", () => {
    mod.captureInstallPrompt();
    window.dispatchEvent(fakeEvent());
    const listener = vi.fn();
    mod.subscribeInstall(listener);
    window.dispatchEvent(fakeEvent());
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("useInstallPrompt", () => {
  it("re-renders on the event and keeps a stable snapshot between changes", async () => {
    const { act, renderHook } = await import("@testing-library/react");
    mod.captureInstallPrompt();
    const { result, rerender } = renderHook(() => mod.useInstallPrompt());
    expect(result.current.canPrompt).toBe(false);
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    act(() => {
      window.dispatchEvent(fakeEvent());
    });
    expect(result.current.canPrompt).toBe(true);
    await act(async () => {
      await expect(result.current.prompt()).resolves.toBe("accepted");
    });
    expect(result.current.canPrompt).toBe(false);
  });
});
