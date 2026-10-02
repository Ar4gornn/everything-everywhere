import { render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import InstallPage from "./InstallPage";
import { LanguageProvider } from "../i18n";
import type { InstallPlatform } from "../install/platform";
import { currentPlatform } from "../install/platform";
import { useInstallPrompt } from "../install/prompt";
import { isInstalled } from "../pwa";

vi.mock("../install/platform", () => ({ currentPlatform: vi.fn() }));
vi.mock("../install/prompt", () => ({ useInstallPrompt: vi.fn() }));
vi.mock("../pwa", () => ({ isInstalled: vi.fn() }));

// Signed out on purpose: no AuthProvider, as when `/install` is opened from a link.
function render() {
  return rtlRender(
    <LanguageProvider>
      <InstallPage />
    </LanguageProvider>,
  );
}

const prompt = vi.fn();

function setup(
  platform: InstallPlatform,
  opts: { canPrompt?: boolean; installed?: boolean } = {},
) {
  vi.mocked(currentPlatform).mockReturnValue(platform);
  vi.mocked(isInstalled).mockReturnValue(opts.installed ?? false);
  vi.mocked(useInstallPrompt).mockReturnValue({
    canPrompt: opts.canPrompt ?? false,
    justInstalled: false,
    prompt,
  });
}

const ios = (browser: InstallPlatform["browser"], iosMajor: number | null): InstallPlatform => ({
  os: "ios",
  browser,
  iosMajor,
});
const android = (browser: InstallPlatform["browser"]): InstallPlatform => ({
  os: "android",
  browser,
  iosMajor: null,
});
const desktop = (browser: InstallPlatform["browser"]): InstallPlatform => ({
  os: "desktop",
  browser,
  iosMajor: null,
});

const pressed = (name: string) =>
  screen.getByRole("button", { name }).getAttribute("aria-pressed");

describe("InstallPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    // jsdom's browser language is en-US; pin it so the first render is English.
    vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["en-US"]);
  });

  describe("default tab and steps per platform", () => {
    it("iPhone Safari iOS 26: iPhone tab, the Open as Web App step, older steps closed", () => {
      setup(ios("safari", 26));
      render();
      expect(pressed("iPhone")).toBe("true");
      expect(pressed("Android")).toBe("false");
      expect(screen.getByText("Keep “Open as Web App” switched on.")).toBeTruthy();
      const older = screen.getByText("Older iPhone (iOS 16.4–18)").closest("details");
      expect(older?.open).toBe(false);
    });

    it("iPhone Safari with an unknown version gets the iOS 26 steps", () => {
      setup(ios("safari", null));
      render();
      expect(screen.getByText("Keep “Open as Web App” switched on.")).toBeTruthy();
      expect(screen.getByText("Older iPhone (iOS 16.4–18)").closest("details")?.open).toBe(false);
    });

    it("iPhone Safari iOS 17: the older steps are open", () => {
      setup(ios("safari", 17));
      render();
      expect(pressed("iPhone")).toBe("true");
      expect(screen.getByText("Older iPhone (iOS 16.4–18)").closest("details")?.open).toBe(true);
      expect(screen.getByText("Tap “Add” at the top right.")).toBeTruthy();
    });

    it("iPhone Chrome gets its own share-menu variant, not the Safari steps", () => {
      setup(ios("chrome", 26));
      render();
      expect(pressed("iPhone")).toBe("true");
      expect(screen.getByText("On iPhone, in Chrome, Edge or Firefox")).toBeTruthy();
      expect(screen.getByText("Tap the Share button in the address bar.")).toBeTruthy();
      expect(screen.queryByText("On iPhone, in Safari")).toBeNull();
    });

    it("Android Chrome with a prompt: the Install button, manual steps hidden", () => {
      setup(android("chrome"), { canPrompt: true });
      render();
      expect(pressed("Android")).toBe("true");
      expect(screen.getByRole("button", { name: "Install now" })).toBeTruthy();
      expect(screen.queryByText("Tap “Install” to confirm.")).toBeNull();
    });

    it("Android Chrome without a prompt: menu steps, no button", () => {
      setup(android("chrome"));
      render();
      expect(pressed("Android")).toBe("true");
      expect(screen.queryByRole("button", { name: "Install now" })).toBeNull();
      expect(screen.getByText("Tap “Install” to confirm.")).toBeTruthy();
    });

    it("Samsung Internet: open-in-Chrome note, copy button, then the Chrome steps", () => {
      setup(android("samsung"), { canPrompt: true });
      render();
      expect(pressed("Android")).toBe("true");
      expect(screen.getByText(/open this page in Chrome\./)).toBeTruthy();
      expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
    });

    it("Android Firefox: its own heading, no Install button", () => {
      setup(android("firefox"));
      render();
      expect(screen.getByText("On Android, in Firefox")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Install now" })).toBeNull();
    });

    it("desktop Chrome: Computer tab, the button when the browser offers it", () => {
      setup(desktop("chrome"), { canPrompt: true });
      render();
      expect(pressed("Computer")).toBe("true");
      expect(screen.getByRole("button", { name: "Install now" })).toBeTruthy();
      expect(screen.queryByText("On a computer, in Chrome or Edge")).toBeNull();
    });

    it("desktop Firefox says plainly that it cannot install", () => {
      setup(desktop("firefox"));
      render();
      expect(pressed("Computer")).toBe("true");
      expect(screen.getByText(/cannot install web apps\. Open this page in Chrome or Edge/)).toBeTruthy();
      expect(screen.queryByText("On a computer, in Chrome or Edge")).toBeNull();
    });

    it("Safari on a Mac: File, Add to Dock", () => {
      setup(desktop("safari"));
      render();
      expect(pressed("Computer")).toBe("true");
      expect(screen.getByText("On a Mac, in Safari (macOS Sonoma or later)")).toBeTruthy();
      expect(screen.getByText("Open the “File” menu and click “Add to Dock”.")).toBeTruthy();
    });
  });

  it("switches platform with the tabs and marks the active one", async () => {
    setup(ios("safari", 26));
    const user = userEvent.setup();
    render();
    await user.click(screen.getByRole("button", { name: "Android" }));
    expect(pressed("Android")).toBe("true");
    expect(pressed("iPhone")).toBe("false");
    expect(screen.getByText("On Android, in Chrome or Edge")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Computer" }));
    expect(screen.getByText("On a computer, in Chrome or Edge")).toBeTruthy();
  });

  it("does not offer this device's Install button on another device's tab", async () => {
    setup(desktop("chrome"), { canPrompt: true });
    const user = userEvent.setup();
    render();
    await user.click(screen.getByRole("button", { name: "Android" }));
    expect(screen.queryByRole("button", { name: "Install now" })).toBeNull();
  });

  describe("the one-tap button", () => {
    it("calls the browser prompt and shows Done when accepted", async () => {
      setup(android("chrome"), { canPrompt: true });
      prompt.mockResolvedValue("accepted");
      const user = userEvent.setup();
      render();
      await user.click(screen.getByRole("button", { name: "Install now" }));
      expect(prompt).toHaveBeenCalledTimes(1);
      expect(await screen.findByText("Done — find EEwhere on your home screen")).toBeTruthy();
      expect(screen.queryByText("Tap “Install” to confirm.")).toBeNull();
    });

    it("shows the manual steps when dismissed", async () => {
      setup(android("chrome"), { canPrompt: true });
      prompt.mockResolvedValue("dismissed");
      const user = userEvent.setup();
      render();
      await user.click(screen.getByRole("button", { name: "Install now" }));
      expect(await screen.findByText(/You can also install it from the browser menu/)).toBeTruthy();
      expect(screen.getByText("Tap “Install” to confirm.")).toBeTruthy();
    });
  });

  describe("Samsung copy link", () => {
    it("copies the page address", async () => {
      setup(android("samsung"));
      const user = userEvent.setup();
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
      render();
      await user.click(screen.getByRole("button", { name: "Copy link" }));
      expect(writeText).toHaveBeenCalledWith(window.location.href);
      expect(await screen.findByText("Link copied. Paste it into Chrome.")).toBeTruthy();
    });

    it("says so when copying fails", async () => {
      setup(android("samsung"));
      const user = userEvent.setup();
      const writeText = vi.fn().mockRejectedValue(new Error("denied"));
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
      render();
      await user.click(screen.getByRole("button", { name: "Copy link" }));
      expect(await screen.findByText(/Could not copy/)).toBeTruthy();
    });
  });

  it("says Already installed, and still offers the guide link back to the app", () => {
    setup(android("chrome"), { installed: true });
    render();
    expect(screen.getByText("Already installed on this device")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open EEwhere" }).getAttribute("href")).toBe("/");
  });

  it("does not say Already installed in a browser tab", () => {
    setup(android("chrome"));
    render();
    expect(screen.queryByText("Already installed on this device")).toBeNull();
  });

  it("draws every step with a described image", () => {
    setup(ios("safari", 26));
    render();
    const images = screen.getAllByRole("img");
    expect(images.length).toBeGreaterThanOrEqual(4);
    for (const image of images) {
      expect(image.getAttribute("aria-label")?.length ?? 0).toBeGreaterThan(10);
    }
  });

  it("works signed out, with a language switch that turns it French", async () => {
    setup(ios("safari", 26));
    const user = userEvent.setup();
    render();
    const picker = screen.getByRole("combobox", { name: "Language" });
    await user.selectOptions(picker, "fr");
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Installer EEwhere"));
    expect(screen.getByRole("button", { name: "Ordinateur" })).toBeTruthy();
    expect(screen.getByText("Laissez « Ouvrir comme app web » activé.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ouvrir EEwhere" })).toBeTruthy();
    // And no key leaks through untranslated.
    expect(within(document.body).queryByText(/installGuide\./)).toBeNull();
  });

  it("ends with the reasons to install", () => {
    setup(ios("safari", 26));
    render();
    expect(screen.getByRole("heading", { name: "Why install?" })).toBeTruthy();
  });
});
