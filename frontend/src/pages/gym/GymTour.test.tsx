import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../api/client";
import { logSet } from "../../gym/session";
import { finishActive, readActive, readOutbox, writeActive } from "../../gym/store";
import { translator } from "../../i18n";
import { USER_ID, mocks } from "./mockkit";
import { ids, renderGym, resetServer, seedActive } from "./testkit";

const h = vi.hoisted(() => ({ installed: false, tutorialStep: null as string | null }));

vi.mock("../../api/client", async (orig) => (await import("./mockkit")).mockClient(await orig()));
vi.mock("../../auth/AuthContext", async () => (await import("./mockkit")).authModule());
vi.mock("../../components/CheckInButton", () => ({ CheckInButton: () => null }));
vi.mock("../../pwa", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  isInstalled: () => h.installed,
}));
vi.mock("../../components/Tutorial/useTutorial", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useTutorial: () => ({ step: h.tutorialStep }),
}));

const en = translator("en");
const SEEN = `everything-everywhere.gym.${USER_ID}.tourSeen`;

beforeEach(() => {
  resetServer();
  h.installed = false;
  h.tutorialStep = null;
  // jsdom has no layout: the engine's scroll is a stub here.
  window.scrollBy = vi.fn() as unknown as typeof window.scrollBy;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "clipboard");
});

const dialog = () => screen.getByRole("dialog");
const inDialog = () => within(dialog());
const click = (name: string) => fireEvent.click(inDialog().getByRole("button", { name }));
const spot = () => document.querySelector(".gym-tour-spot");

/** From the welcome card to step `n` (1-based): Start, then Next. */
function goTo(n: number) {
  if (n > 1) click(en("gym.tour.start"));
  for (let i = 2; i < n; i++) click(en("gym.tour.next"));
}

describe("When the tour opens", () => {
  it("opens by itself on the first visit, and not again once left", () => {
    const first = renderGym("/gym");
    expect(inDialog().getByRole("heading", { name: en("gym.tour.welcome.title") })).toBeVisible();
    expect(inDialog().getByText("Step 1 of 9")).toBeInTheDocument();
    click(en("gym.tour.notNow"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(window.localStorage.getItem(SEEN)).toBe("1");
    first.unmount();

    renderGym("/gym");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not open over a session in progress", () => {
    seedActive();
    renderGym("/gym");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(window.localStorage.getItem(SEEN)).toBeNull();
  });

  it("waits while the app's first-login tour is running", () => {
    h.tutorialStep = "welcome";
    const view = renderGym("/gym");
    expect(screen.queryByRole("dialog")).toBeNull();
    h.tutorialStep = null;
    view.unmount();
    renderGym("/gym");
    expect(dialog()).toBeInTheDocument();
  });

  it("does not open on the other gym views", () => {
    renderGym("/gym/import");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the ? button replays it, even after it was seen", () => {
    window.localStorage.setItem(SEEN, "1");
    renderGym("/gym");
    expect(screen.queryByRole("dialog")).toBeNull();
    const button = screen.getByRole("button", { name: en("gym.tour.open") });
    expect(button).toHaveAttribute("title", en("gym.tour.open"));
    fireEvent.click(button);
    expect(inDialog().getByText("Step 1 of 9")).toBeInTheDocument();
  });
});

describe("Moving through it", () => {
  beforeEach(() => window.localStorage.setItem(SEEN, "1"));

  it("Next and Back change the step and the spotlight", async () => {
    renderGym("/gym");
    fireEvent.click(screen.getByRole("button", { name: en("gym.tour.open") }));
    expect(spot()).toBeNull();
    click(en("gym.tour.start"));
    expect(inDialog().getByText("Step 2 of 9")).toBeInTheDocument();
    expect(inDialog().getByRole("heading", { name: en("gym.tour.start.title") })).toBeVisible();
    expect(spot()).not.toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(inDialog().getByRole("heading", { level: 2 })),
    );
    click(en("gym.tour.next"));
    expect(inDialog().getByText("Step 3 of 9")).toBeInTheDocument();
    expect(spot()).toBeNull();
    click(en("gym.tour.back"));
    expect(inDialog().getByText("Step 2 of 9")).toBeInTheDocument();
  });

  it("the arrow keys move, Enter on the text advances, Escape skips and returns focus", async () => {
    renderGym("/gym");
    const button = screen.getByRole("button", { name: en("gym.tour.open") });
    fireEvent.click(button);
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(inDialog().getByText("Step 2 of 9")).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    expect(inDialog().getByText("Step 1 of 9")).toBeInTheDocument();
    fireEvent.keyDown(inDialog().getByRole("heading", { level: 2 }), { key: "Enter" });
    expect(inDialog().getByText("Step 2 of 9")).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(button));
  });

  it("a step whose target is gone falls back to a centred card", () => {
    renderGym("/gym");
    fireEvent.click(screen.getByRole("button", { name: en("gym.tour.open") }));
    document.querySelector('[data-tour="gym-start"]')?.removeAttribute("data-tour");
    click(en("gym.tour.start"));
    expect(inDialog().getByRole("heading", { name: en("gym.tour.start.title") })).toBeVisible();
    expect(dialog()).toHaveClass("gym-tour-centered");
    expect(spot()).toBeNull();
  });

  it("opens a collapsed card for its step and puts it back on close", () => {
    window.localStorage.setItem("everything-everywhere.collapsed.gym.routines", "1");
    renderGym("/gym");
    const toggle = () =>
      document.querySelector('[data-tour="gym-routines"] .card-toggle') as HTMLElement;
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: en("gym.tour.open") }));
    goTo(5);
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    click(en("gym.tour.skip"));
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
  });

  it("the last step starts an empty session", () => {
    renderGym("/gym");
    fireEvent.click(screen.getByRole("button", { name: en("gym.tour.open") }));
    goTo(9);
    expect(inDialog().getByText("Step 9 of 9")).toBeInTheDocument();
    click(en("gym.startSession"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("where")).toHaveTextContent("/gym/session");
  });
});

describe("The set demo", () => {
  beforeEach(() => {
    window.localStorage.setItem(SEEN, "1");
    vi.useFakeTimers();
  });

  function open() {
    renderGym("/gym");
    fireEvent.click(screen.getByRole("button", { name: en("gym.tour.open") }));
    goTo(3);
  }

  it("Done adds a line and a rest that Skip rest clears", () => {
    open();
    expect(inDialog().queryByRole("timer")).toBeNull();
    click(en("gym.doneSet"));
    expect(inDialog().getByText("Set 1 · 8 × 60 kg")).toBeInTheDocument();
    expect(inDialog().getByText(en("gym.tour.set.done"))).toBeInTheDocument();
    expect(inDialog().getByRole("timer", { name: en("gym.rest") })).toHaveTextContent("5");
    click(en("gym.skipRest"));
    expect(inDialog().queryByRole("timer")).toBeNull();
    click(en("gym.doneSet"));
    expect(inDialog().getByText("Set 2 · 8 × 60 kg")).toBeInTheDocument();
  });

  it("the rest ends by itself after five seconds", () => {
    open();
    click(en("gym.doneSet"));
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(inDialog().getByRole("timer")).toHaveTextContent("2");
    act(() => {
      vi.advanceTimersByTime(2200);
    });
    expect(inDialog().queryByRole("timer")).toBeNull();
  });

  it("the steppers change what the line says", () => {
    open();
    fireEvent.click(inDialog().getByRole("button", { name: "Increase Reps" }));
    click(en("gym.doneSet"));
    expect(inDialog().getByText("Set 1 · 9 × 60 kg")).toBeInTheDocument();
  });
});

describe("The timer demo", () => {
  beforeEach(() => {
    window.localStorage.setItem(SEEN, "1");
    vi.useFakeTimers();
  });

  it("Stop writes the seconds held into the field", () => {
    renderGym("/gym");
    fireEvent.click(screen.getByRole("button", { name: en("gym.tour.open") }));
    goTo(4);
    click(en("gym.startTimer"));
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    click(en("gym.stopTimer"));
    expect(inDialog().getByRole("textbox", { name: "Seconds" })).toHaveValue("3");
    expect(inDialog().getByText("Held 3 s")).toBeInTheDocument();
  });

  it("counting down to zero writes the target by itself", () => {
    renderGym("/gym");
    fireEvent.click(screen.getByRole("button", { name: en("gym.tour.open") }));
    goTo(4);
    click(en("gym.startTimer"));
    act(() => {
      vi.advanceTimersByTime(5400);
    });
    expect(inDialog().getByRole("textbox", { name: "Seconds" })).toHaveValue("5");
  });
});

describe("The import demo", () => {
  beforeEach(() => window.localStorage.setItem(SEEN, "1"));

  function open() {
    renderGym("/gym");
    fireEvent.click(screen.getByRole("button", { name: en("gym.tour.open") }));
    goTo(6);
  }

  it("lists four steps and copies the real prompt, then says Copied for two seconds", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    open();
    expect(inDialog().getAllByRole("listitem")).toHaveLength(4);
    await act(async () => {
      click(en("gym.copyPrompt"));
    });
    expect(writeText).toHaveBeenCalledWith(en("gym.prompt"));
    expect(inDialog().getByRole("button", { name: "Copied" })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    expect(inDialog().getByRole("button", { name: en("gym.copyPrompt") })).toBeInTheDocument();
  });

  it("falls back to selectable text when the clipboard is refused", async () => {
    const writeText = vi.fn(async () => {
      throw new Error("denied");
    });
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    open();
    await act(async () => {
      click(en("gym.copyPrompt"));
    });
    const field = inDialog().getByRole("textbox", { name: en("gym.tour.import.promptField") });
    expect(field).toHaveValue(en("gym.prompt"));
  });

  it("spotlights the real import link", () => {
    open();
    expect(document.querySelector('[data-tour="gym-import"]')).not.toBeNull();
    expect(spot()).not.toBeNull();
  });
});

describe("The offline status", () => {
  beforeEach(() => window.localStorage.setItem(SEEN, "1"));

  async function queueOne() {
    const base = seedActive();
    writeActive(
      USER_ID,
      logSet(
        base,
        base.exercises[0]?.key ?? "",
        { reps: 5, weight: null, duration_seconds: null, distance_m: null },
        new Date(),
        ids,
      ),
    );
    mocks.completeWorkout.mockRejectedValue(new TypeError("network"));
    await finishActive(USER_ID, new Date());
  }

  it("shows installed, connection and the sessions still waiting", async () => {
    await queueOne();
    // A second one the server refused: it is not "waiting".
    mocks.completeWorkout.mockRejectedValueOnce(new ApiError(422, "no", "bad"));
    expect(readOutbox(USER_ID).filter((entry) => !entry.refused)).toHaveLength(1);
    h.installed = true;
    renderGym("/gym");
    fireEvent.click(screen.getByRole("button", { name: en("gym.tour.open") }));
    goTo(8);
    const status = inDialog();
    expect(status.getByText(en("gym.tour.offline.installed")).nextSibling).toHaveTextContent("Yes");
    expect(status.getByText(en("gym.tour.offline.waiting")).nextSibling).toHaveTextContent("1");
    expect(status.getByText(en("gym.tour.offline.connection")).nextSibling).toHaveTextContent(
      "Online",
    );
    expect(status.queryByText(en("gym.tour.offline.installHow"))).toBeNull();
  });

  it("says how to install when it is not, and follows the connection", () => {
    renderGym("/gym");
    fireEvent.click(screen.getByRole("button", { name: en("gym.tour.open") }));
    goTo(8);
    expect(inDialog().getByText(en("gym.tour.offline.installHow"))).toBeInTheDocument();
    expect(inDialog().getByText(en("gym.tour.offline.installed")).nextSibling).toHaveTextContent(
      "No",
    );
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(inDialog().getByText(en("gym.tour.offline.connection")).nextSibling).toHaveTextContent(
      "Offline",
    );
  });
});

describe("The sandbox", () => {
  it("no demo touches the api, the session or the store", async () => {
    window.localStorage.setItem(SEEN, "1");
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderGym("/gym");
    await waitFor(() => expect(mocks.listRoutinesFull).toHaveBeenCalled());
    const calls = () => Object.values(mocks).map((fn) => fn.mock.calls.length);
    const storage = () =>
      JSON.stringify(Object.keys(window.localStorage).sort().map((k) => [k, window.localStorage.getItem(k)]));
    const before = { calls: calls(), storage: storage() };

    fireEvent.click(screen.getByRole("button", { name: en("gym.tour.open") }));
    goTo(3);
    click(en("gym.doneSet"));
    click(en("gym.skipRest"));
    click(en("gym.tour.next"));
    click(en("gym.startTimer"));
    click(en("gym.stopTimer"));
    click(en("gym.tour.next"));
    click(en("gym.tour.next"));
    await act(async () => {
      click(en("gym.copyPrompt"));
    });

    expect(calls()).toEqual(before.calls);
    expect(storage()).toBe(before.storage);
    expect(readActive(USER_ID)).toBeNull();
  });
});

describe("Its strings", () => {
  it("are in both languages", () => {
    const fr = translator("fr");
    for (const key of ["gym.tour.open", "gym.tour.welcome.title", "gym.tour.done.body"] as const) {
      expect(fr(key)).not.toBe(en(key));
    }
  });
});
