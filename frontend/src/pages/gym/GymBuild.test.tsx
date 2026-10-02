import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../api/client";
import { readActive } from "../../gym/store";
import { USER_ID, mocks } from "./mockkit";
import { pushDay, renderGym, resetServer, seedActive } from "./testkit";

vi.mock("../../api/client", async (orig) => (await import("./mockkit")).mockClient(await orig()));
vi.mock("../../auth/AuthContext", async () => (await import("./mockkit")).authModule());
vi.mock("../../components/CheckInButton", () => ({ CheckInButton: () => null }));

beforeEach(() => resetServer());
afterEach(() => vi.restoreAllMocks());

const suggestions = () => screen.getByRole("list", { name: "Your exercises" });
const lineOf = (name: string) =>
  within(screen.getByRole("list", { name: "Exercises in this workout" })).getByRole("listitem", {
    name,
  });
const value = (scope: HTMLElement, name: string) =>
  (within(scope).getByRole("textbox", { name }) as HTMLInputElement).value;

async function openBuilder() {
  renderGym("/gym/build");
  await screen.findByRole("heading", { name: "Build a workout" });
}

describe("The quick builder", () => {
  it("is ready before anything is typed: a name, suggestions, no required field", async () => {
    await openBuilder();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toMatch(/^Workout · /);
    expect(within(suggestions()).getAllByRole("button")).toHaveLength(3);
    expect(screen.getByText("Nothing yet. Tap an exercise above.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Rather ask an AI?" })).toHaveAttribute("href", "/gym/import");
    expect(screen.getByRole("checkbox", { name: "Save as a routine" })).toBeChecked();
  });

  it("adds an existing exercise with numbers already filled in for its kind", async () => {
    await openBuilder();
    await userEvent.click(within(suggestions()).getByRole("button", { name: "Bench press" }));
    await userEvent.click(within(suggestions()).getByRole("button", { name: "Plank" }));
    await userEvent.click(within(suggestions()).getByRole("button", { name: "Rowing" }));

    const bench = lineOf("Bench press");
    expect(value(bench, "Sets")).toBe("3");
    expect(value(bench, "Reps")).toBe("10");
    const plank = lineOf("Plank");
    expect(value(plank, "Sets")).toBe("3");
    expect(value(plank, "Seconds")).toBe("30");
    const rowing = lineOf("Rowing");
    expect(value(rowing, "Sets")).toBe("1");
    expect(value(rowing, "Metres")).toBe("1000");
    // An added exercise leaves the suggestions.
    expect(screen.queryByRole("list", { name: "Your exercises" })).not.toBeInTheDocument();
  });

  it("offers Add “text” for a new exercise, with the kind chosen by chip", async () => {
    await openBuilder();
    await userEvent.type(screen.getByLabelText("Add an exercise"), "Pull-up");
    // The existing ones are filtered by the text.
    expect(screen.queryByRole("list", { name: "Your exercises" })).not.toBeInTheDocument();
    const kinds = screen.getByRole("group", { name: "New exercise counts in" });
    expect(within(kinds).getByRole("button", { name: "Reps" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(within(kinds).getByRole("button", { name: "Time" }));
    await userEvent.click(screen.getByRole("button", { name: "Add “Pull-up”" }));

    const line = lineOf("Pull-up");
    expect(value(line, "Seconds")).toBe("30");
    expect((screen.getByLabelText("Add an exercise") as HTMLInputElement).value).toBe("");
  });

  it("a typed name that is an existing exercise is that exercise, not a new one", async () => {
    await openBuilder();
    await userEvent.type(screen.getByLabelText("Add an exercise"), "bench PRESS");
    expect(screen.queryByRole("button", { name: /^Add “/ })).not.toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    const line = lineOf("Bench press");
    expect(value(line, "Reps")).toBe("10");
  });

  it("changes sets with the steppers, never below 1, and reorders and removes lines", async () => {
    await openBuilder();
    await userEvent.click(within(suggestions()).getByRole("button", { name: "Bench press" }));
    await userEvent.click(within(suggestions()).getByRole("button", { name: "Plank" }));
    const bench = lineOf("Bench press");
    await userEvent.click(within(bench).getByRole("button", { name: "Increase Sets" }));
    expect(value(bench, "Sets")).toBe("4");
    for (let i = 0; i < 5; i++) {
      await userEvent.click(within(bench).getByRole("button", { name: "Decrease Sets" }));
    }
    expect(value(bench, "Sets")).toBe("1");
    expect(within(bench).getByRole("button", { name: "Decrease Sets" })).toBeDisabled();

    await userEvent.click(within(bench).getByRole("button", { name: "Move Bench press down" }));
    const names = within(screen.getByRole("list", { name: "Exercises in this workout" }))
      .getAllByRole("listitem")
      .map((li) => li.getAttribute("aria-label"));
    expect(names).toEqual(["Plank", "Bench press"]);

    await userEvent.click(screen.getByRole("button", { name: "Remove Plank" }));
    expect(screen.queryByRole("listitem", { name: "Plank" })).not.toBeInTheDocument();
  });

  it("Start with Save on: online, saves the routine, then starts that routine", async () => {
    mocks.importRoutine.mockResolvedValue({ ...pushDay, id: "r8", name: "Mine" });
    await openBuilder();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Mine" } });
    await userEvent.click(within(suggestions()).getByRole("button", { name: "Bench press" }));
    await userEvent.click(within(suggestions()).getByRole("button", { name: "Plank" }));
    await userEvent.click(within(lineOf("Bench press")).getByRole("button", { name: "Increase Sets" }));
    await userEvent.type(within(lineOf("Bench press")).getByRole("textbox", { name: "Weight (kg)" }), "62.5");
    await userEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/gym/session"));
    expect(mocks.importRoutine).toHaveBeenCalledTimes(1);
    expect(mocks.importRoutine).toHaveBeenCalledWith({
      name: "Mine",
      lines: [
        { exercise_name: "Bench press", kind: "reps", target_sets: 4, target_reps: 10, target_weight: "62.50" },
        { exercise_name: "Plank", kind: "duration", target_sets: 3, target_seconds: 30 },
      ],
    });
    // It started from the routine the server returned, not from a copy.
    expect(readActive(USER_ID)?.routine_id).toBe("r8");
  });

  it("offline: starts a session straight from the lines and calls no API", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await openBuilder();
    await userEvent.click(within(suggestions()).getByRole("button", { name: "Plank" }));
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/gym/session"));
    expect(mocks.importRoutine).not.toHaveBeenCalled();
    const active = readActive(USER_ID);
    expect(active?.routine_id).toBeNull();
    expect(active?.exercises.map((e) => [e.name, e.target_sets, e.target_seconds])).toEqual([
      ["Plank", 3, 30],
    ]);
  });

  it("with Save as a routine off: no API call, a session from the lines", async () => {
    await openBuilder();
    await userEvent.click(screen.getByRole("checkbox", { name: "Save as a routine" }));
    await userEvent.click(within(suggestions()).getByRole("button", { name: "Bench press" }));
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/gym/session"));
    expect(mocks.importRoutine).not.toHaveBeenCalled();
    expect(readActive(USER_ID)?.routine_id).toBeNull();
    expect(readActive(USER_ID)?.exercises[0]?.exercise_id).toBe("e1");
  });

  it("if saving the routine fails the workout still starts, and says so", async () => {
    mocks.importRoutine.mockRejectedValue(new ApiError(409, "exists", "conflict"));
    await openBuilder();
    await userEvent.click(within(suggestions()).getByRole("button", { name: "Plank" }));
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/gym/session"));
    expect(readActive(USER_ID)?.exercises.map((e) => e.name)).toEqual(["Plank"]);
    expect(await screen.findByText("Started, but the routine was not saved.")).toBeInTheDocument();
  });

  it("starting with nothing added is allowed: an empty session, nothing saved", async () => {
    await openBuilder();
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/gym/session"));
    expect(mocks.importRoutine).not.toHaveBeenCalled();
    expect(readActive(USER_ID)?.exercises).toEqual([]);
  });

  it("asks before replacing a session in progress, and builds nothing if declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const running = seedActive();
    renderGym("/gym/build");
    await userEvent.click(await screen.findByRole("button", { name: "Start" }));
    expect(mocks.importRoutine).not.toHaveBeenCalled();
    expect(readActive(USER_ID)?.client_ref).toBe(running.client_ref);
  });
});
