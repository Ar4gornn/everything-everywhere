import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { onAPhone } from "../test/phone";
import { InstallOffer } from "./InstallOffer";

const pwa = vi.hoisted(() => ({ installed: false }));
const prompt = vi.hoisted(() => ({
  state: { canPrompt: false, justInstalled: false },
  prompt: vi.fn(),
}));

vi.mock("../pwa", () => ({ isInstalled: () => pwa.installed }));
vi.mock("../install/prompt", () => ({
  useInstallPrompt: () => ({ ...prompt.state, prompt: prompt.prompt }),
}));

const CONSENT = "everything-everywhere.install.consent";
const DISMISSED = "everything-everywhere.install.dismissedAt";

function show(hasUsedApp = true) {
  return render(
    <MemoryRouter>
      <InstallOffer hasUsedApp={hasUsedApp} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  pwa.installed = false;
  prompt.state = { canPrompt: false, justInstalled: false };
  prompt.prompt.mockReset();
});

describe("the install offer on a phone", () => {
  onAPhone();

  it("asks once the app has been used and nothing was answered", () => {
    show();
    expect(screen.getByText("Want help installing the app on this phone?")).toBeInTheDocument();
  });

  it("does not ask before the app has been used", () => {
    show(false);
    expect(screen.queryByTestId("install-question")).toBeNull();
    expect(screen.queryByTestId("install-card")).toBeNull();
  });

  it("does not ask an installed app", () => {
    pwa.installed = true;
    show();
    expect(screen.queryByTestId("install-question")).toBeNull();
  });

  it("Yes is remembered on the device and the card replaces the question", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "Yes, show me" }));
    expect(window.localStorage.getItem(CONSENT)).toBe("yes");
    expect(screen.queryByTestId("install-question")).toBeNull();
    expect(screen.getByTestId("install-card")).toBeInTheDocument();
  });

  it("No is remembered and nothing is shown, now or on the next visit", async () => {
    const user = userEvent.setup();
    const first = show();
    await user.click(screen.getByRole("button", { name: "No thanks" }));
    expect(window.localStorage.getItem(CONSENT)).toBe("no");
    expect(screen.queryByTestId("install-question")).toBeNull();
    expect(screen.queryByTestId("install-card")).toBeNull();
    first.unmount();
    show();
    expect(screen.queryByTestId("install-question")).toBeNull();
    expect(screen.queryByTestId("install-card")).toBeNull();
  });

  it("with Yes on file, a browser dialog makes the card one tap", async () => {
    window.localStorage.setItem(CONSENT, "yes");
    prompt.state = { canPrompt: true, justInstalled: false };
    prompt.prompt.mockResolvedValue("accepted");
    const user = userEvent.setup();
    show();
    expect(screen.queryByRole("link", { name: "Show me how" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Install" }));
    expect(prompt.prompt).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId("install-card")).toBeNull());
  });

  it("a refused browser dialog leaves the card where it was", async () => {
    window.localStorage.setItem(CONSENT, "yes");
    prompt.state = { canPrompt: true, justInstalled: false };
    prompt.prompt.mockResolvedValue("dismissed");
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "Install" }));
    await waitFor(() => expect(prompt.prompt).toHaveBeenCalled());
    expect(screen.getByTestId("install-card")).toBeInTheDocument();
  });

  it("with no browser dialog, the card links to the guide", () => {
    window.localStorage.setItem(CONSENT, "yes");
    show();
    expect(screen.getByRole("link", { name: "Show me how" })).toHaveAttribute("href", "/install");
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  });

  it("Not now hides the card and remembers it for a while", async () => {
    window.localStorage.setItem(CONSENT, "yes");
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByTestId("install-card")).toBeNull();
    expect(window.localStorage.getItem(DISMISSED)).not.toBeNull();
  });

  it("a card dismissed earlier stays hidden", () => {
    window.localStorage.setItem(CONSENT, "yes");
    window.localStorage.setItem(DISMISSED, String(Date.now()));
    show();
    expect(screen.queryByTestId("install-card")).toBeNull();
  });
});

describe("the install offer on a computer", () => {
  it("shows nothing, whatever was answered", () => {
    window.localStorage.setItem(CONSENT, "yes");
    show();
    expect(screen.queryByTestId("install-card")).toBeNull();
    expect(screen.queryByTestId("install-question")).toBeNull();
  });
});
