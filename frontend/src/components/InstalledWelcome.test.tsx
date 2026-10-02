import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InstalledWelcome } from "./InstalledWelcome";

const pwa = vi.hoisted(() => ({ installed: true }));
const push = vi.hoisted(() => ({
  supported: true,
  enable: vi.fn(),
}));

vi.mock("../pwa", () => ({ isInstalled: () => pwa.installed }));
vi.mock("../push", () => ({
  pushSupported: () => push.supported,
  enablePush: push.enable,
}));

const WELCOMED = "everything-everywhere.install.welcomed";

function stubServer(enabled: boolean) {
  const fetchMock = vi.fn(async (url: string) => {
    const body = String(url).includes("/api/push/status")
      ? { enabled, devices: 0 }
      : { items: [] };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

beforeEach(() => {
  window.localStorage.clear();
  pwa.installed = true;
  push.supported = true;
  push.enable.mockReset();
  stubServer(true);
});

describe("the installed welcome", () => {
  it("greets the first installed launch and marks it seen at once", async () => {
    render(<InstalledWelcome />);
    expect(screen.getByText("EEwhere is installed")).toBeInTheDocument();
    await waitFor(() => expect(window.localStorage.getItem(WELCOMED)).not.toBeNull());
  });

  it("shows once: the next mount on this device draws nothing", async () => {
    const first = render(<InstalledWelcome />);
    await waitFor(() => expect(window.localStorage.getItem(WELCOMED)).not.toBeNull());
    first.unmount();
    render(<InstalledWelcome />);
    expect(screen.queryByTestId("install-welcome")).toBeNull();
  });

  it("stays on screen through re-renders after it marked itself seen", async () => {
    const view = render(<InstalledWelcome />);
    await waitFor(() => expect(window.localStorage.getItem(WELCOMED)).not.toBeNull());
    view.rerender(<InstalledWelcome />);
    expect(screen.getByTestId("install-welcome")).toBeInTheDocument();
  });

  it("is not shown in a browser tab", async () => {
    pwa.installed = false;
    render(<InstalledWelcome />);
    await settle();
    expect(screen.queryByTestId("install-welcome")).toBeNull();
    expect(window.localStorage.getItem(WELCOMED)).toBeNull();
  });

  it("Done hides it", async () => {
    const user = userEvent.setup();
    render(<InstalledWelcome />);
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByTestId("install-welcome")).toBeNull();
  });

  it("offers notifications when the browser can and the server offers them", async () => {
    push.enable.mockResolvedValue("subscribed");
    const user = userEvent.setup();
    render(<InstalledWelcome />);
    const button = await screen.findByRole("button", { name: "Turn on notifications" });
    await user.click(button);
    expect(push.enable).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Turn on notifications" })).toBeNull(),
    );
  });

  it("asks about reminders only when the notifications button is there", async () => {
    render(<InstalledWelcome />);
    await screen.findByRole("button", { name: "Turn on notifications" });
    expect(screen.getByText(/Want a reminder/)).toBeInTheDocument();
  });

  it("does not ask about reminders when push is unsupported", async () => {
    push.supported = false;
    render(<InstalledWelcome />);
    await settle();
    expect(screen.queryByRole("button", { name: "Turn on notifications" })).toBeNull();
    expect(screen.queryByText(/Want a reminder/)).toBeNull();
    expect(screen.getByText("Open it from your home screen from now on.")).toBeInTheDocument();
  });

  it("does not ask about reminders when the server does not offer push", async () => {
    stubServer(false);
    render(<InstalledWelcome />);
    await settle();
    expect(screen.queryByText(/Want a reminder/)).toBeNull();
    expect(screen.getByText("Open it from your home screen from now on.")).toBeInTheDocument();
  });

  it("says why when notifications were refused", async () => {
    push.enable.mockResolvedValue("denied");
    const user = userEvent.setup();
    render(<InstalledWelcome />);
    await user.click(await screen.findByRole("button", { name: "Turn on notifications" }));
    await waitFor(() => expect(push.enable).toHaveBeenCalled());
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("has no notifications button when the browser cannot push", async () => {
    push.supported = false;
    const fetchMock = stubServer(true);
    render(<InstalledWelcome />);
    expect(screen.getByTestId("install-welcome")).toBeInTheDocument();
    await settle();
    expect(screen.queryByRole("button", { name: "Turn on notifications" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("has no notifications button when the server does not offer push", async () => {
    const fetchMock = stubServer(false);
    render(<InstalledWelcome />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await settle();
    expect(screen.queryByRole("button", { name: "Turn on notifications" })).toBeNull();
  });
});
