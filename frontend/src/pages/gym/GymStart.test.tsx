import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readActive, readOutbox } from "../../gym/store";
import { todayIso } from "../../months";
import { USER_ID, mocks } from "./mockkit";
import { renderGym, resetServer, seedActive, workout } from "./testkit";

vi.mock("../../api/client", async (orig) => (await import("./mockkit")).mockClient(await orig()));
vi.mock("../../auth/AuthContext", async () => (await import("./mockkit")).authModule());
vi.mock("../../components/CheckInButton", () => ({ CheckInButton: () => null }));

beforeEach(() => resetServer());
afterEach(() => vi.restoreAllMocks());

describe("The start chooser", () => {
  it("offers three big answers: just start, build it, ask an AI", async () => {
    renderGym("/gym/start");
    expect(await screen.findByRole("heading", { name: "How do you want to start?" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Build it now/ })).toHaveAttribute("href", "/gym/build");
    expect(screen.getByRole("link", { name: /Ask an AI/ })).toHaveAttribute("href", "/gym/import");
    expect(screen.getByText("Timer on, add exercises as you go.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Just start/ }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/gym/session"));
    const active = readActive(USER_ID);
    expect(active?.routine_id).toBeNull();
    expect(active?.exercises).toEqual([]);
  });

  it("the home Start a session link comes here", async () => {
    renderGym("/gym");
    await userEvent.click(await screen.findByRole("link", { name: "Start a session" }));
    expect(await screen.findByRole("heading", { name: "How do you want to start?" })).toBeInTheDocument();
  });

  it("shows routine chips on top, and a chip starts that routine", async () => {
    renderGym("/gym/start");
    const chips = await screen.findByRole("list", { name: "Routines" });
    expect(within(chips).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Start Push day",
      "Start Cardio",
    ]);
    expect(screen.getByText("Or follow a routine:")).toBeInTheDocument();
    await userEvent.click(within(chips).getByRole("button", { name: "Start Cardio" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/gym/session"));
    expect(readActive(USER_ID)?.routine_id).toBe("r2");
  });

  it("has no chips row when there are no routines", async () => {
    resetServer({ routines: [], lastDone: {} });
    renderGym("/gym/start");
    await screen.findByRole("button", { name: /Just start/ });
    expect(screen.queryByText("Or follow a routine:")).not.toBeInTheDocument();
  });

  it("keeps the running session when a replacement is declined", async () => {
    const running = seedActive();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderGym("/gym/start");
    await userEvent.click(await screen.findByRole("button", { name: /Just start/ }));
    expect(readActive(USER_ID)?.client_ref).toBe(running.client_ref);
    expect(screen.getByTestId("where")).toHaveTextContent("/gym/start");
  });
});

describe("Rest day today", () => {
  /** The 5-second Undo window's callback, so a test need not wait five real seconds. */
  function captureUndoTimer() {
    const real = window.setTimeout.bind(window);
    const calls: { fn: () => void; ms: number }[] = [];
    vi.spyOn(window, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
      if (ms === 5000) calls.push({ fn, ms });
      return real(fn, ms);
    }) as typeof window.setTimeout);
    return calls;
  }

  it("logs a rest day through the outbox in one tap, with the day and no sets", async () => {
    renderGym("/gym/start");
    await userEvent.click(await screen.findByRole("button", { name: "Rest day today" }));
    expect(await screen.findByText(/Logged — enjoy it\./)).toBeInTheDocument();
    await waitFor(() => expect(mocks.completeWorkout).toHaveBeenCalledTimes(1));
    expect(mocks.completeWorkout.mock.calls[0]?.[0]).toMatchObject({
      performed_on: todayIso(),
      rest_day: true,
      sets: [],
    });
    expect(readOutbox(USER_ID)).toHaveLength(0);
  });

  it("works offline: it waits in the outbox, and is counted as logged", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    mocks.completeWorkout.mockRejectedValue(new TypeError("Failed to fetch"));
    renderGym("/gym/start");
    await userEvent.click(await screen.findByRole("button", { name: "Rest day today" }));
    expect(await screen.findByText(/Logged — enjoy it\./)).toBeInTheDocument();
    expect(readOutbox(USER_ID)).toHaveLength(1);
    expect(readOutbox(USER_ID)[0]?.body.rest_day).toBe(true);
  });

  it("Undo takes it back for the next 5 seconds, then the Undo goes away", async () => {
    const timers = captureUndoTimer();
    renderGym("/gym/start");
    await userEvent.click(await screen.findByRole("button", { name: "Rest day today" }));
    const undo = await screen.findByRole("button", { name: "Undo" });
    await waitFor(() => expect(mocks.completeWorkout).toHaveBeenCalled());
    expect(timers).toHaveLength(1);

    await userEvent.click(undo);
    // Already sent, so the server's copy is deleted by the id it answered.
    await waitFor(() => expect(mocks.deleteWorkout).toHaveBeenCalledWith("w9"));
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Rest day today" })).toBeEnabled();
  });

  it("the Undo expires after 5 seconds and the button reads Already logged", async () => {
    const timers = captureUndoTimer();
    renderGym("/gym/start");
    await userEvent.click(await screen.findByRole("button", { name: "Rest day today" }));
    await screen.findByRole("button", { name: "Undo" });
    expect(timers[0]?.ms).toBe(5000);
    act(() => timers[0]?.fn());
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Already logged" })).toBeDisabled();
    expect(mocks.deleteWorkout).not.toHaveBeenCalled();
  });

  it("is disabled as Already logged when today already has a rest day", async () => {
    resetServer({
      workouts: [{ ...workout, id: "w5", routine_id: null, performed_on: todayIso(), rest_day: true }],
    });
    renderGym("/gym/start");
    const button = await screen.findByRole("button", { name: "Already logged" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(mocks.completeWorkout).not.toHaveBeenCalled();
  });

  it("a rest day on another date does not count", async () => {
    resetServer({ workouts: [{ ...workout, id: "w5", routine_id: null, rest_day: true }] });
    renderGym("/gym/start");
    expect(await screen.findByRole("button", { name: "Rest day today" })).toBeEnabled();
  });
});
