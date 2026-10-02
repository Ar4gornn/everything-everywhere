import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoutineDetail } from "../../api/types";
import { addExercise, logSet, startRest } from "../../gym/session";
import { logRestDay, readActive, readCache, readOutbox, writeActive } from "../../gym/store";
import { USER_ID, mocks } from "./mockkit";
import { ids, pushDay, renderGym, resetServer, seedActive, workout } from "./testkit";

vi.mock("../../api/client", async (orig) => (await import("./mockkit")).mockClient(await orig()));
vi.mock("../../auth/AuthContext", async () => (await import("./mockkit")).authModule());
vi.mock("../../components/CheckInButton", () => ({ CheckInButton: () => null }));

beforeEach(() => resetServer());
afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

/** Seconds from now until the stored session's rest ends. */
function restLeft(): number {
  const until = readActive(USER_ID)?.rest_until;
  return until ? (Date.parse(until) - Date.now()) / 1000 : Number.NaN;
}

describe("Rest in the live session", () => {
  it("the header Rest button offers five presets and Custom", async () => {
    seedActive();
    renderGym("/gym/session");
    await userEvent.click(await screen.findByRole("button", { name: "Rest" }));
    const group = screen.getByRole("group", { name: "Rest for" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "30 s",
      "60 s",
      "90 s",
      "120 s",
      "180 s",
      "Custom",
    ]);
  });

  it("a preset starts a rest for that long and shows the bar", async () => {
    seedActive();
    renderGym("/gym/session");
    await userEvent.click(await screen.findByRole("button", { name: "Rest" }));
    await userEvent.click(screen.getByRole("button", { name: "120 s" }));
    const bar = await screen.findByRole("timer", { name: "Rest" });
    expect(bar).toHaveTextContent(/1:5\d|2:00/);
    expect(restLeft()).toBeGreaterThan(115);
    expect(restLeft()).toBeLessThanOrEqual(120);
    // The picker closes once it has done its job.
    expect(screen.queryByRole("group", { name: "Rest for" })).not.toBeInTheDocument();
  });

  it("Custom takes a number of seconds and starts exactly that", async () => {
    seedActive();
    renderGym("/gym/session");
    await userEvent.click(await screen.findByRole("button", { name: "Rest" }));
    await userEvent.click(screen.getByRole("button", { name: "Custom" }));
    const field = screen.getByRole("textbox", { name: "Rest (s)" });
    await userEvent.clear(field);
    await userEvent.type(field, "45");
    await userEvent.click(screen.getByRole("button", { name: "Start rest" }));
    await screen.findByRole("timer", { name: "Rest" });
    expect(restLeft()).toBeGreaterThan(40);
    expect(restLeft()).toBeLessThanOrEqual(45);
  });

  it("+15 s lengthens a running rest, and Skip ends it", async () => {
    writeActive(USER_ID, startRest(seedActive(), 60, new Date()));
    renderGym("/gym/session");
    await screen.findByRole("timer", { name: "Rest" });
    const before = restLeft();
    await userEvent.click(screen.getByRole("button", { name: "+15 s" }));
    await waitFor(() => expect(restLeft() - before).toBeGreaterThan(13));
    expect(restLeft() - before).toBeLessThan(16);

    await userEvent.click(screen.getByRole("button", { name: "Skip rest" }));
    await waitFor(() => expect(screen.queryByRole("timer", { name: "Rest" })).not.toBeInTheDocument());
    expect(readActive(USER_ID)?.rest_until).toBeNull();
  });

  it("after the last set of an exercise the bar says what the rest is before", async () => {
    const routine: RoutineDetail = {
      ...pushDay,
      lines: pushDay.lines.map((line, i) =>
        i === 0 ? { ...line, target_sets: 1, rest_after_seconds: 150 } : line,
      ),
    };
    seedActive(routine);
    renderGym("/gym/session");
    await userEvent.click(await screen.findByRole("button", { name: "Done" }));
    const bar = await screen.findByRole("timer", { name: "Rest" });
    expect(within(bar).getByText("Rest before Plank")).toBeInTheDocument();
    expect(restLeft()).toBeGreaterThan(145);
    expect(restLeft()).toBeLessThanOrEqual(150);
  });

  it("in the middle of an exercise the rest is the per-set one, with no 'before' label", async () => {
    seedActive();
    renderGym("/gym/session");
    await userEvent.click(await screen.findByRole("button", { name: "Done" }));
    const bar = await screen.findByRole("timer", { name: "Rest" });
    expect(within(bar).queryByText(/Rest before/)).not.toBeInTheDocument();
    expect(restLeft()).toBeLessThanOrEqual(90);
    expect(restLeft()).toBeGreaterThan(85);
  });

  it("a finished session offers to ask an AI only when it had no routine", async () => {
    for (const routine of [null, pushDay]) {
      window.localStorage.clear();
      resetServer();
      const base = seedActive(routine);
      const withExercise = routine ? base : addExercise(base, { exercise_id: "e1", name: "Bench press", kind: "reps" }, ids);
      const key = withExercise.exercises[0]?.key ?? "";
      writeActive(
        USER_ID,
        logSet(withExercise, key, { reps: 5, weight: null, duration_seconds: null, distance_m: null }, new Date(), ids),
      );
      vi.spyOn(window, "confirm").mockReturnValue(true);
      const view = renderGym("/gym/session");
      await userEvent.click(await screen.findByRole("button", { name: "Finish" }));
      await screen.findByRole("heading", { name: "Session complete" });
      const link = screen.queryByRole("link", { name: "Want a new one next time? Ask an AI" });
      if (routine === null) expect(link).toHaveAttribute("href", "/gym/import");
      else expect(link).not.toBeInTheDocument();
      view.unmount();
    }
  });
});

describe("Rest days in the history", () => {
  const restDay = {
    ...workout,
    id: "wr",
    routine_id: null,
    performed_on: "2026-10-01",
    started_at: null,
    ended_at: null,
    rest_day: true,
  };

  it("shows a rest day as 'Rest day' with the moon, not as a workout, and loads no sets", async () => {
    resetServer({ workouts: [restDay, workout] });
    renderGym("/gym");
    const history = await screen.findByRole("list", { name: "History" });
    const rows = within(history).getAllByRole("button");
    expect(rows[0]).toHaveTextContent("Rest day");
    expect(rows[0]?.querySelector('[aria-hidden="true"]')?.textContent).toContain("☾");
    expect(rows[1]).toHaveTextContent("Push day");

    await userEvent.click(rows[0] as HTMLElement);
    expect(await screen.findByText("Logged as a rest day.")).toBeInTheDocument();
    expect(mocks.readWorkout).not.toHaveBeenCalled();
    expect(screen.queryByText("No sets yet.")).not.toBeInTheDocument();
  });

  it("a rest day can be deleted like a session", async () => {
    resetServer({ workouts: [restDay] });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderGym("/gym");
    const history = await screen.findByRole("list", { name: "History" });
    await userEvent.click(within(history).getByRole("button", { name: /Rest day/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete session of 2026-10-01" }));
    await waitFor(() => expect(mocks.deleteWorkout).toHaveBeenCalledWith("wr"));
  });

  it("a rest day still pending is discarded from the outbox, never deleted on the server by its stub id", async () => {
    resetServer({ workouts: [] });
    mocks.completeWorkout.mockRejectedValue(new TypeError("Failed to fetch"));
    const ref = await logRestDay(USER_ID, "2026-10-01", new Date());
    mocks.listWorkouts.mockResolvedValue(readCache(USER_ID).workouts);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderGym("/gym");
    const history = await screen.findByRole("list", { name: "History" });
    await userEvent.click(within(history).getByRole("button", { name: /Rest day/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete session of 2026-10-01" }));
    await waitFor(() => expect(readOutbox(USER_ID).some((e) => e.body.client_ref === ref)).toBe(false));
    expect(mocks.deleteWorkout).not.toHaveBeenCalled();
  });

  it("is not counted as a session in the collapsed History summary", async () => {
    resetServer({ workouts: [restDay, workout] });
    window.localStorage.setItem("everything-everywhere.collapsed.gym.history", "1");
    renderGym("/gym");
    const heading = await screen.findByRole("heading", { name: "History" });
    expect(heading.parentElement?.textContent).toMatch(/History\s*1$/);
  });
});
