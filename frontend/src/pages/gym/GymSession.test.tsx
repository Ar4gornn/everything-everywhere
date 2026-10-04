import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logSet, skipRest, type ActiveSession } from "../../gym/session";
import { readActive, readOutbox, writeActive } from "../../gym/store";
import { USER_ID, mocks } from "./mockkit";
import { ids, pushDay, renderGym, resetServer, seedActive } from "./testkit";

vi.mock("../../api/client", async (orig) => (await import("./mockkit")).mockClient(await orig()));
vi.mock("../../auth/AuthContext", async () => (await import("./mockkit")).authModule());
vi.mock("../../components/CheckInButton", () => ({ CheckInButton: () => null }));

beforeEach(() => resetServer());
/** jsdom has neither `vibrate` nor `wakeLock`; add one to the real navigator for a test. */
function giveNavigator(name: string, value: unknown) {
  Object.defineProperty(navigator, name, { value, configurable: true });
}

afterEach(() => {
  for (const name of ["vibrate", "wakeLock"]) Reflect.deleteProperty(navigator, name);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Log `reps` at `weight` on exercise number `index` straight through the real model. */
function logged(
  session: ActiveSession,
  index: number,
  draft: { reps?: number; weight?: string; seconds?: number },
): ActiveSession {
  const exercise = session.exercises[index];
  return logSet(
    session,
    exercise?.key ?? "",
    {
      reps: draft.reps ?? null,
      weight: draft.weight ?? null,
      duration_seconds: draft.seconds ?? null,
      distance_m: null,
    },
    new Date(),
    ids,
  );
}

const field = (name: string) => screen.getByRole("textbox", { name }) as HTMLInputElement;

describe("Live session", () => {
  it("says so when there is no session in progress", async () => {
    renderGym("/gym/session");
    expect(await screen.findByText("No session in progress.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the gym" })).toHaveAttribute("href", "/gym");
  });

  it("opens the first exercise with the next set prefilled from its target", async () => {
    seedActive();
    renderGym("/gym/session");
    expect(await screen.findByRole("heading", { name: "Push day" })).toBeInTheDocument();
    expect(field("Reps").value).toBe("8");
    expect(field("Weight (kg)").value).toBe("60");
    expect(screen.getByText(/Last time: 32 · 57\.5 kg/)).toBeInTheDocument();
    expect(screen.getByText(/Exercise 1\/2 · 0\/7 sets/)).toBeInTheDocument();
    // The other exercise is collapsed, and has no fields on screen.
    expect(screen.getByRole("button", { name: /Plank/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("logs a set with Done, saves it at once, and starts the rest countdown", async () => {
    seedActive();
    renderGym("/gym/session");
    await userEvent.click(await screen.findByRole("button", { name: "Increase Reps" }));
    expect(field("Reps").value).toBe("9");
    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    const saved = readActive(USER_ID);
    expect(saved?.sets).toHaveLength(1);
    expect(saved?.sets[0]).toMatchObject({ reps: 9, weight: "60.00" });
    const rest = await screen.findByRole("timer", { name: "Rest" });
    expect(rest).toHaveTextContent(/1:(29|30)/);
    // The row of the set just done, and a fresh next set prefilled from it.
    expect(screen.getByText("9 × 60 kg")).toBeInTheDocument();
    expect(field("Reps").value).toBe("9");

    await userEvent.click(screen.getByRole("button", { name: "Skip rest" }));
    expect(readActive(USER_ID)?.rest_until).toBeNull();
    await waitFor(() => expect(screen.queryByRole("timer", { name: "Rest" })).not.toBeInTheDocument());
  });

  it("refuses a set with nothing counted", async () => {
    seedActive();
    renderGym("/gym/session");
    const reps = await screen.findByRole("textbox", { name: "Reps" });
    await userEvent.clear(reps);
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByText(/Enter the reps for this set/)).toBeInTheDocument();
    expect(readActive(USER_ID)?.sets).toHaveLength(0);
  });

  it("edits a logged set", async () => {
    const session = logged(seedActive(), 0, { reps: 8, weight: "60.00" });
    writeActive(USER_ID, skipRest(session));
    renderGym("/gym/session");
    await userEvent.click(await screen.findByRole("button", { name: "Edit set 1 of Bench press" }));
    const row = screen.getByRole("list", { name: "Sets" });
    await userEvent.click(within(row).getByRole("button", { name: "Increase Reps" }));
    await userEvent.click(within(row).getByRole("button", { name: "Save" }));
    expect(readActive(USER_ID)?.sets[0]).toMatchObject({ reps: 9, weight: "60.00" });
  });

  it("removes a logged set", async () => {
    const session = logged(seedActive(), 0, { reps: 8, weight: "60.00" });
    writeActive(USER_ID, skipRest(session));
    renderGym("/gym/session");
    await userEvent.click(await screen.findByRole("button", { name: "Remove set 1 of Bench press" }));
    expect(readActive(USER_ID)?.sets).toHaveLength(0);
  });

  it("shows a rest from its end time, so a phone that slept shows the right number", async () => {
    const session = seedActive();
    writeActive(USER_ID, { ...session, rest_until: new Date(Date.now() + 42_000).toISOString() });
    renderGym("/gym/session");
    expect(await screen.findByRole("timer", { name: "Rest" })).toHaveTextContent(/0:4[012]/);
  });

  it("drops a rest that ended while the page was away, without a buzz", async () => {
    const vibrate = vi.fn();
    giveNavigator("vibrate", vibrate);
    const session = seedActive();
    writeActive(USER_ID, { ...session, rest_until: new Date(Date.now() - 60_000).toISOString() });
    renderGym("/gym/session");
    await screen.findByRole("heading", { name: "Push day" });
    await waitFor(() => expect(readActive(USER_ID)?.rest_until).toBeNull());
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("counts a duration up or down from a timestamp, and stops into the seconds field", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const vibrate = vi.fn();
    giveNavigator("vibrate", vibrate);
    seedActive();
    renderGym("/gym/session");
    fireEvent.click(await screen.findByRole("button", { name: /Plank/ }));
    expect(field("Seconds").value).toBe("45");

    fireEvent.click(screen.getByRole("button", { name: "Start timer" }));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    // Counting down from the 45 s target.
    expect(screen.getByRole("timer", { name: "Timer" })).toHaveTextContent(/0:3[45]/);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(Number(field("Seconds").value)).toBeGreaterThanOrEqual(10);
    expect(Number(field("Seconds").value)).toBeLessThanOrEqual(11);

    // Run it to zero: it stops itself on the target and buzzes.
    fireEvent.click(screen.getByRole("button", { name: "Start timer" }));
    act(() => {
      vi.advanceTimersByTime(46_000);
    });
    expect(field("Seconds").value).toBe("45");
    expect(vibrate).toHaveBeenCalled();
    expect(screen.queryByRole("timer", { name: "Timer" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(readActive(USER_ID)?.sets[0]).toMatchObject({ duration_seconds: 45, reps: null });
  });

  it("adds an exercise mid-session, reusing an existing one by name", async () => {
    seedActive();
    renderGym("/gym/session");
    await userEvent.click(await screen.findByRole("button", { name: "Add exercise" }));
    await userEvent.type(screen.getByLabelText("Exercise name"), "rowing");
    expect(screen.getByText("Uses your existing Rowing")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Counts in" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Add to session" }));

    const added = readActive(USER_ID)?.exercises.at(-1);
    expect(added).toMatchObject({ name: "Rowing", exercise_id: "e3", kind: "distance" });
    // The new card is the open one, asking for metres.
    expect(await screen.findByRole("textbox", { name: "Metres" })).toBeInTheDocument();
  });

  it("coins a new exercise with the chosen kind", async () => {
    seedActive();
    renderGym("/gym/session");
    await userEvent.click(await screen.findByRole("button", { name: "Add exercise" }));
    await userEvent.type(screen.getByLabelText("Exercise name"), "Farmer carry");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Counts in" }), "distance");
    await userEvent.click(screen.getByRole("button", { name: "Add to session" }));
    expect(readActive(USER_ID)?.exercises.at(-1)).toMatchObject({
      name: "Farmer carry",
      exercise_id: null,
      kind: "distance",
    });
  });

  it("holds the screen awake while open, and lets go on leaving", async () => {
    const release = vi.fn(async () => undefined);
    const request = vi.fn(async () => ({ release }));
    giveNavigator("wakeLock", { request });
    seedActive();
    const view = renderGym("/gym/session");
    await screen.findByRole("heading", { name: "Push day" });
    await waitFor(() => expect(request).toHaveBeenCalledWith("screen"));
    view.unmount();
    await waitFor(() => expect(release).toHaveBeenCalled());
  });

  it("finishes: sends the whole session once, shows the summary, and returns to the gym", async () => {
    let session = seedActive();
    session = logged(session, 0, { reps: 8, weight: "62.50" });
    session = logged(session, 0, { reps: 8, weight: "62.50" });
    writeActive(USER_ID, skipRest(session));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderGym("/gym/session");
    await userEvent.click(await screen.findByRole("button", { name: "Finish" }));

    // Five planned sets are not done: it asks first.
    expect(confirm).toHaveBeenCalledWith("5 planned sets are not done. Finish anyway?");
    expect(await screen.findByText("Session complete")).toBeInTheDocument();
    expect(mocks.completeWorkout).toHaveBeenCalledTimes(1);
    const body = mocks.completeWorkout.mock.calls[0]?.[0];
    expect(body).toMatchObject({ client_ref: session.client_ref, routine_id: "r1" });
    expect(body.sets).toHaveLength(2);
    expect(body.sets[0]).toMatchObject({ exercise_id: "e1", reps: 8, weight: "62.50" });
    // 2 sets, 1000 kg of volume, and 62.5 is above last time's 57.5.
    expect(screen.getByText("1,000 kg")).toBeInTheDocument();
    expect(screen.getByText("Up on last time: Bench press.")).toBeInTheDocument();
    expect(screen.getByText("Saved.")).toBeInTheDocument();
    expect(readActive(USER_ID)).toBeNull();
    expect(readOutbox(USER_ID)).toHaveLength(0);

    await userEvent.click(screen.getByRole("button", { name: "Back to the gym" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/gym");
    expect(screen.getByTestId("where")).not.toHaveTextContent("/gym/session");
  });

  it("keeps a finished session on the phone when the server cannot be reached", async () => {
    mocks.completeWorkout.mockRejectedValue(new TypeError("Failed to fetch"));
    const session = logged(seedActive(), 0, { reps: 8, weight: "60.00" });
    writeActive(USER_ID, skipRest(session));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderGym("/gym/session");
    await userEvent.click(await screen.findByRole("button", { name: "Finish" }));
    expect(await screen.findByText(/Saved on this phone\. It will be sent/)).toBeInTheDocument();
    expect(readOutbox(USER_ID)).toHaveLength(1);
    expect(readActive(USER_ID)).toBeNull();
  });

  it("says it is saving, not that there is no session, while Finish waits", async () => {
    let release: (value: unknown) => void = () => undefined;
    mocks.completeWorkout.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const session = logged(seedActive(), 0, { reps: 8, weight: "60.00" });
    writeActive(USER_ID, skipRest(session));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderGym("/gym/session");
    await userEvent.click(await screen.findByRole("button", { name: "Finish" }));
    expect(await screen.findByText("Saving…")).toBeInTheDocument();
    expect(screen.queryByText("No session in progress.")).not.toBeInTheDocument();
    release({ id: "w9", sets: [] });
    expect(await screen.findByText("Session complete")).toBeInTheDocument();
  });

  it("does not finish when the confirmation is declined", async () => {
    const session = logged(seedActive(), 0, { reps: 8, weight: "60.00" });
    writeActive(USER_ID, skipRest(session));
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderGym("/gym/session");
    await userEvent.click(await screen.findByRole("button", { name: "Finish" }));
    expect(mocks.completeWorkout).not.toHaveBeenCalled();
    expect(readActive(USER_ID)).not.toBeNull();
  });

  it("offers to throw away a session with nothing in it instead of sending it", async () => {
    seedActive();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderGym("/gym/session");
    await userEvent.click(await screen.findByRole("button", { name: "Finish" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Discard this session?"));
    expect(mocks.completeWorkout).not.toHaveBeenCalled();
    expect(readActive(USER_ID)).toBeNull();
    expect(screen.getByTestId("where")).not.toHaveTextContent("/gym/session");
  });
});

describe("Format v2 in the live session (Epic 54.4)", () => {
  const bench = pushDay.lines[0]!;
  const v2: typeof pushDay = {
    ...pushDay,
    lines: [
      {
        ...bench,
        target_sets: 2,
        target_rpe: 8,
        tempo: "3-1-1-0",
        set_targets: [
          { reps: 10, seconds: null, distance_m: null, weight: "40.00", warmup: true },
          { reps: 5, seconds: null, distance_m: null, weight: "100.00", warmup: false },
        ],
      },
      {
        ...bench,
        id: "l2",
        exercise_id: "e2",
        exercise_name: "Dips",
        video_url: null,
        position: 1,
        target_sets: 2,
        target_rir: 2,
        superset_group: 1,
      },
      { ...bench, id: "l3", exercise_id: "e3", exercise_name: "Pull-up", video_url: null, position: 2, target_sets: 2, superset_group: 1 },
    ],
  };

  it("badges the warm-up set, shows the effort and tempo hints, then the working set", async () => {
    seedActive(v2);
    renderGym("/gym/session");
    expect(await screen.findByText("Warm-up")).toBeInTheDocument();
    expect(screen.getByText("Effort: RPE 8")).toBeInTheDocument();
    expect(screen.getByText("Tempo 3-1-1-0")).toBeInTheDocument();
    expect(screen.getByText(/lowering, pause at the bottom/)).toBeInTheDocument();
    expect(field("Reps").value).toBe("10");
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    // the logged warm-up keeps its badge; the next set is a working one with no badge on it
    await waitFor(() => expect(readActive(USER_ID)?.sets[0]?.is_warmup).toBe(true));
    expect(screen.getAllByText("Warm-up")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Set 2" })).not.toHaveTextContent("Warm-up");
    expect(field("Reps").value).toBe("5");
  });

  it("words reps in reserve for a person and names the superset and who is next", async () => {
    seedActive({ ...v2, lines: v2.lines.slice(1) });
    renderGym("/gym/session");
    expect(await screen.findByText("Stop with 2 reps in reserve")).toBeInTheDocument();
    expect(screen.getByText(/Superset: Dips ↔ Pull-up/)).toBeInTheDocument();
    expect(screen.getByText(/Next in the superset: Pull-up/)).toBeInTheDocument();
  });

  it("opens a session stored before the epic without crashing", async () => {
    const old = JSON.parse(JSON.stringify(seedActive())) as ActiveSession;
    for (const e of old.exercises) {
      for (const k of ["set_targets", "target_rpe", "target_rir", "tempo", "superset_group"]) {
        Reflect.deleteProperty(e, k);
      }
    }
    window.localStorage.setItem(`everything-everywhere.gym.${USER_ID}.active`, JSON.stringify(old));
    renderGym("/gym/session");
    expect(await screen.findByRole("heading", { name: "Push day" })).toBeInTheDocument();
    expect(screen.queryByText("Warm-up")).toBeNull();
  });
});

describe("RPE in French", () => {
  it("uses the decimal comma", async () => {
    window.localStorage.setItem("everything-everywhere.language", "fr");
    const bench = pushDay.lines[0]!;
    seedActive({ ...pushDay, lines: [{ ...bench, target_rpe: 7.5 }] });
    renderGym("/gym/session");
    expect(await screen.findByText("Effort : RPE 7,5")).toBeInTheDocument();
  });
});
