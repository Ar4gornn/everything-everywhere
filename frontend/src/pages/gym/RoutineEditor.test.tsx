import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../api/client";
import { readActive } from "../../gym/store";
import { USER_ID, mocks } from "./mockkit";
import { renderGym, resetServer } from "./testkit";

vi.mock("../../api/client", async (orig) => (await import("./mockkit")).mockClient(await orig()));
vi.mock("../../auth/AuthContext", async () => (await import("./mockkit")).authModule());
vi.mock("../../components/CheckInButton", () => ({ CheckInButton: () => null }));

beforeEach(() => resetServer());
afterEach(() => vi.restoreAllMocks());

const box = (name: string) => screen.getByRole("textbox", { name }) as HTMLInputElement;

describe("Routine editor", () => {
  it("lists the lines with their targets in the kind's own measure", async () => {
    renderGym("/gym/routines/r1");
    const lines = await screen.findByRole("list", { name: "Push day exercises" });
    expect(within(lines).getByText("4 × 8 · 60 kg")).toBeInTheDocument();
    expect(within(lines).getByText("3 × 45 s")).toBeInTheDocument();
    expect(box("Target reps of Bench press").value).toBe("8");
    expect(box("Target seconds of Plank").value).toBe("45");
    // A reps line has no seconds field and a duration line has no reps field.
    expect(screen.queryByRole("textbox", { name: "Target seconds of Bench press" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Target reps of Plank" })).toBeNull();
  });

  it("saves a changed line with one PATCH holding only what changed", async () => {
    renderGym("/gym/routines/r1");
    const save = await screen.findByRole("button", { name: "Save Bench press" });
    expect(save).toBeDisabled();
    await userEvent.clear(box("Target reps of Bench press"));
    await userEvent.type(box("Target reps of Bench press"), "10");
    await userEvent.clear(box("Target weight of Bench press"));
    await userEvent.type(box("Rest between sets of Bench press"), "0");
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() =>
      expect(mocks.updateRoutineLine).toHaveBeenCalledWith("l1", {
        target_reps: 10,
        // Cleared means an explicit null; untouched fields are absent.
        target_weight: null,
        rest_seconds: 900,
      }),
    );
  });

  it("takes a decimal comma in a weight", async () => {
    renderGym("/gym/routines/r1");
    const weight = await screen.findByRole("textbox", { name: "Target weight of Bench press" });
    await userEvent.clear(weight);
    await userEvent.type(weight, "62,5");
    expect(weight).toHaveValue("62,5");
    await userEvent.click(screen.getByRole("button", { name: "Save Bench press" }));
    await waitFor(() =>
      expect(mocks.updateRoutineLine).toHaveBeenCalledWith("l1", { target_weight: "62.50" }),
    );
  });

  it("reorders with the arrows and sends the whole order", async () => {
    renderGym("/gym/routines/r1");
    expect(await screen.findByRole("button", { name: "Move Bench press up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Plank down" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Move Plank up" }));
    await waitFor(() => expect(mocks.reorderRoutine).toHaveBeenCalledWith("r1", ["l2", "l1"]));
  });

  it("removes a line", async () => {
    renderGym("/gym/routines/r1");
    await userEvent.click(await screen.findByRole("button", { name: "Remove Plank from the routine" }));
    await waitFor(() => expect(mocks.removeRoutineLine).toHaveBeenCalledWith("l2"));
  });

  it("adds an existing exercise by id, and a new one by name with its kind", async () => {
    renderGym("/gym/routines/r1");
    const name = await screen.findByLabelText("Exercise name");
    await userEvent.type(name, "rowing");
    await userEvent.click(screen.getByRole("button", { name: "Add to routine" }));
    await waitFor(() => expect(mocks.addRoutineLine).toHaveBeenCalledWith("r1", { exercise_id: "e3" }));

    await userEvent.type(await screen.findByLabelText("Exercise name"), "Farmer carry");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Counts in" }), "distance");
    await userEvent.click(screen.getByRole("button", { name: "Add to routine" }));
    await waitFor(() =>
      expect(mocks.addRoutineLine).toHaveBeenLastCalledWith("r1", {
        exercise_name: "Farmer carry",
        kind: "distance",
      }),
    );
  });

  it("an exercise chip fills the name, so it is added by id and its kind is locked", async () => {
    renderGym("/gym/routines/r1");
    await userEvent.type(await screen.findByLabelText("Exercise name"), "row");
    await userEvent.click(screen.getByRole("button", { name: "Rowing" }));
    expect(screen.getByLabelText("Exercise name")).toHaveValue("Rowing");
    expect(screen.getByText("Uses your existing Rowing")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Counts in" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Add to routine" }));
    await waitFor(() => expect(mocks.addRoutineLine).toHaveBeenCalledWith("r1", { exercise_id: "e3" }));
  });

  it("renames the routine", async () => {
    renderGym("/gym/routines/r1");
    const save = await screen.findByRole("button", { name: "Save details" });
    expect(save).toBeDisabled();
    const name = screen.getByLabelText("Routine name");
    await userEvent.clear(name);
    await userEvent.type(name, "Heavy push");
    await userEvent.click(save);
    await waitFor(() =>
      expect(mocks.updateRoutine).toHaveBeenCalledWith("r1", { name: "Heavy push", note: null }),
    );
  });

  it("deletes the routine after a confirmation and goes back to the gym", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderGym("/gym/routines/r1");
    await userEvent.click(await screen.findByRole("button", { name: "Delete routine" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Push day"));
    await waitFor(() => expect(mocks.deleteRoutine).toHaveBeenCalledWith("r1"));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/gym$/));
  });

  it("does not delete when the confirmation is declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderGym("/gym/routines/r1");
    await userEvent.click(await screen.findByRole("button", { name: "Delete routine" }));
    expect(mocks.deleteRoutine).not.toHaveBeenCalled();
  });

  it("starts a session from the routine", async () => {
    renderGym("/gym/routines/r1");
    await userEvent.click(await screen.findByRole("button", { name: "Start this routine" }));
    expect(readActive(USER_ID)?.routine_id).toBe("r1");
    expect(screen.getByTestId("where")).toHaveTextContent("/gym/session");
  });

  it("is read-only offline, but a session can still start", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    renderGym("/gym/routines/r1");
    expect(await screen.findByRole("button", { name: "Save Bench press" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete routine" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Plank up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove Plank from the routine" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Start this routine" })).toBeEnabled();
    expect(screen.getByText(/Editing routines needs a connection/)).toBeInTheDocument();
  });

  it("shows the server's words when a write is refused", async () => {
    mocks.removeRoutineLine.mockRejectedValue(new ApiError(409, "x", "order_mismatch"));
    renderGym("/gym/routines/r1");
    await userEvent.click(await screen.findByRole("button", { name: "Remove Plank from the routine" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("changed elsewhere");
  });

  it("says so for a routine that does not exist", async () => {
    renderGym("/gym/routines/nope");
    expect(await screen.findByText("That routine does not exist.")).toBeInTheDocument();
  });
});

describe("Routine editor: rest after an exercise", () => {
  it("patches rest_after_seconds alone", async () => {
    renderGym("/gym/routines/r1");
    const save = await screen.findByRole("button", { name: "Save Bench press" });
    await userEvent.type(box("Rest after Bench press"), "120");
    await userEvent.click(save);
    await waitFor(() =>
      expect(mocks.updateRoutineLine).toHaveBeenCalledWith("l1", { rest_after_seconds: 120 }),
    );
  });
});

describe("Routine editor: format v2 (Epic 54.3)", () => {
  const openVary = async () => {
    renderGym("/gym/routines/r1");
    await userEvent.click(
      within(await screen.findByRole("group", { name: "Targets for Bench press" })).getByRole("button", {
        name: "Vary per set",
      }),
    );
  };

  it("switching to Vary per set seeds one row per set from the flat values", async () => {
    await openVary();
    const sets = screen.getByRole("list", { name: "Sets of Bench press" });
    expect(within(sets).getAllByRole("listitem")).toHaveLength(4);
    expect(box("Set 4 reps of Bench press").value).toBe("8");
    expect(box("Set 1 weight of Bench press").value).toBe("60");
    // The flat fields give way to the rows.
    expect(screen.queryByRole("textbox", { name: "Target reps of Bench press" })).toBeNull();
    // Adding and removing a set.
    await userEvent.click(screen.getByRole("button", { name: "Add a set to Bench press" }));
    expect(within(sets).getAllByRole("listitem")).toHaveLength(5);
    await userEvent.click(screen.getByRole("button", { name: "Remove set 5 of Bench press" }));
    expect(within(sets).getAllByRole("listitem")).toHaveLength(4);
  });

  it("a warm-up set goes into the PATCH body", async () => {
    await openVary();
    await userEvent.click(screen.getByRole("checkbox", { name: "Warm-up, set 1 of Bench press" }));
    await userEvent.click(screen.getByRole("button", { name: "Save Bench press" }));
    await waitFor(() => expect(mocks.updateRoutineLine).toHaveBeenCalled());
    const [id, body] = mocks.updateRoutineLine.mock.calls[0] as [string, { set_targets: unknown[] }];
    expect(id).toBe("l1");
    expect(body.set_targets).toHaveLength(4);
    expect(body.set_targets[0]).toEqual({
      reps: 8,
      seconds: null,
      distance_m: null,
      weight: "60.00",
      warmup: true,
    });
    expect(body.set_targets[1]).toMatchObject({ warmup: false });
  });

  it("RPE and RIR are exclusive: picking the other scale drops the number", async () => {
    renderGym("/gym/routines/r1");
    const scale = await screen.findByRole("combobox", { name: "Effort scale of Bench press" });
    await userEvent.selectOptions(scale, "rpe");
    await userEvent.type(box("Effort of Bench press"), "8");
    await userEvent.selectOptions(scale, "rir");
    expect(box("Effort of Bench press").value).toBe("");
    // Nothing is left of the RPE, so the line is back to what was saved.
    expect(screen.getByRole("button", { name: "Save Bench press" })).toBeDisabled();
    await userEvent.type(box("Effort of Bench press"), "2");
    await userEvent.click(screen.getByRole("button", { name: "Save Bench press" }));
    await waitFor(() =>
      expect(mocks.updateRoutineLine).toHaveBeenCalledWith("l1", { target_rir: 2 }),
    );
  });

  it("an RPE off the half-steps blocks Save", async () => {
    renderGym("/gym/routines/r1");
    await userEvent.selectOptions(
      await screen.findByRole("combobox", { name: "Effort scale of Bench press" }),
      "rpe",
    );
    await userEvent.type(box("Effort of Bench press"), "8.3");
    expect(await screen.findByText("RPE is 1 to 10, in steps of 0.5.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Bench press" })).toBeDisabled();
  });

  it("a bad tempo shows its hint and blocks Save; a good one is sent upper-cased", async () => {
    renderGym("/gym/routines/r1");
    const tempo = await screen.findByRole("textbox", { name: "Tempo of Bench press" });
    const save = screen.getByRole("button", { name: "Save Bench press" });
    await userEvent.type(tempo, "3-1-1");
    expect(screen.getByRole("alert")).toHaveTextContent("four digits or X");
    expect(save).toBeDisabled();
    await userEvent.type(tempo, "-x");
    expect(screen.queryByRole("alert")).toBeNull();
    await userEvent.click(save);
    await waitFor(() =>
      expect(mocks.updateRoutineLine).toHaveBeenCalledWith("l1", { tempo: "3-1-1-X" }),
    );
  });

  it("Superset with next joins two lines into one consecutive group", async () => {
    renderGym("/gym/routines/r1");
    // The last line has nothing to pair with.
    expect(
      await screen.findByRole("checkbox", { name: "Superset Plank with the next exercise" }),
    ).toBeDisabled();
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Superset Bench press with the next exercise" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Save Bench press" }));
    await waitFor(() => {
      expect(mocks.updateRoutineLine).toHaveBeenCalledWith("l1", { superset_group: 1 });
      expect(mocks.updateRoutineLine).toHaveBeenCalledWith("l2", { superset_group: 1 });
    });
  });
});
