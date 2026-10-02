import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../api/client";
import { translator } from "../../i18n/catalogue";
import { USER_ID, mocks } from "./mockkit";
import { renderGym, resetServer } from "./testkit";

const shared = vi.hoisted(() => ({ take: vi.fn() }));

vi.mock("../../api/client", async (orig) => (await import("./mockkit")).mockClient(await orig()));
vi.mock("../../auth/AuthContext", async () => (await import("./mockkit")).authModule());
vi.mock("../../components/CheckInButton", () => ({ CheckInButton: () => null }));
vi.mock("../../gym/share", () => ({ takeSharedWorkout: shared.take }));

beforeEach(() => {
  resetServer();
  window.sessionStorage.clear();
  shared.take.mockReset();
  shared.take.mockResolvedValue(null);
});
afterEach(() => vi.restoreAllMocks());

const WORKOUT = JSON.stringify({
  format: "ee-workout/1",
  weight_unit: "kg",
  routines: [
    {
      name: "Upper",
      exercises: [
        // Exists, as reps. The file says duration: the existing kind must win.
        { name: "bench PRESS", kind: "duration", sets: 4, seconds: 30, reps: 8, weight: 60, rest_seconds: 90 },
        { name: "Plank", kind: "duration", sets: 3, seconds: 45, rest_seconds: 60 },
        { name: "Goblet squat", kind: "reps", sets: 3, reps: 12, weight: 16 },
      ],
    },
  ],
});

const READ = "Read workout";

async function paste(text: string) {
  const box = await screen.findByLabelText("Or paste the workout");
  fireEvent.change(box, { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: READ }));
}

const numeric = (name: string) => screen.getByRole("textbox", { name }) as HTMLInputElement;

describe("Import: getting a workout in", () => {
  it("reads pasted text and opens the review at exercise 1", async () => {
    renderGym("/gym/import");
    await paste(WORKOUT);
    expect(await screen.findByRole("heading", { name: "Exercise 1 of 3" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("bench PRESS")).toBeInTheDocument();
  });

  it("reads a picked file", async () => {
    renderGym("/gym/import");
    const file = new File([WORKOUT], "workout.json", { type: "application/json" });
    await userEvent.upload(await screen.findByLabelText("Choose a file"), file);
    expect(await screen.findByRole("heading", { name: "Exercise 1 of 3" })).toBeInTheDocument();
  });

  it("refuses a file that is too big to be a workout", async () => {
    renderGym("/gym/import");
    const big = new File(["x".repeat(300 * 1024)], "big.json", { type: "application/json" });
    await userEvent.upload(await screen.findByLabelText("Choose a file"), big);
    expect(await screen.findByRole("alert")).toHaveTextContent("too big");
  });

  it("says so when the text is not a workout", async () => {
    renderGym("/gym/import");
    await paste("just some words");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/Exercise 1 of/)).not.toBeInTheDocument();
  });

  it("takes what the share target left behind, once", async () => {
    shared.take.mockResolvedValue(WORKOUT);
    renderGym("/gym/import?shared=1");
    expect(await screen.findByRole("heading", { name: "Exercise 1 of 3" })).toBeInTheDocument();
    expect(shared.take).toHaveBeenCalledTimes(1);
  });

  it("says the file is too large when the worker refused it", async () => {
    renderGym("/gym/import?shared=1&refused=1");
    expect(await screen.findByText(/too big to be a workout/)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing was shared/)).not.toBeInTheDocument();
  });

  it("explains when a share left nothing", async () => {
    renderGym("/gym/import?shared=1");
    expect(await screen.findByText(/Nothing was shared/)).toBeInTheDocument();
  });
});

describe("Import: the step-by-step review", () => {
  it("locks the kind to an existing exercise, matched by name without regard to case", async () => {
    renderGym("/gym/import");
    await paste(WORKOUT);
    await screen.findByRole("heading", { name: "Exercise 1 of 3" });
    expect(screen.getByText("Uses your existing Bench press")).toBeInTheDocument();
    const kind = screen.getByRole("combobox", { name: "Counts in" });
    expect(kind).toBeDisabled();
    expect(kind).toHaveValue("reps");
    // The kind the file said (duration) is gone: reps are asked for, seconds are not.
    expect(numeric("Reps").value).toBe("8");
    expect(screen.queryByRole("textbox", { name: "Seconds" })).not.toBeInTheDocument();
  });

  it("lets a renamed exercise choose its own kind again", async () => {
    renderGym("/gym/import");
    await paste(WORKOUT);
    const name = await screen.findByLabelText("Exercise name");
    await userEvent.clear(name);
    await userEvent.type(name, "Dumbbell press");
    expect(screen.getByText("New exercise")).toBeInTheDocument();
    const kind = screen.getByRole("combobox", { name: "Counts in" });
    expect(kind).toBeEnabled();
    await userEvent.selectOptions(kind, "duration");
    expect(numeric("Seconds")).toBeInTheDocument();
  });

  it("flags a bad value inline and holds Confirm back until it is fixed", async () => {
    renderGym("/gym/import");
    await paste(WORKOUT);
    await screen.findByRole("heading", { name: "Exercise 1 of 3" });
    const sets = screen.getAllByRole("textbox", { name: "Sets" })[0] as HTMLInputElement;
    await userEvent.clear(sets);
    await userEvent.type(sets, "0");
    expect(await screen.findAllByRole("alert")).not.toHaveLength(0);
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
    await userEvent.clear(sets);
    await userEvent.type(sets, "5");
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled());
  });

  it("walks confirm, skip and back, then creates only what was kept, as edited", async () => {
    renderGym("/gym/import");
    await paste(WORKOUT);
    // 1 of 3: edit the sets, confirm.
    await screen.findByRole("heading", { name: "Exercise 1 of 3" });
    const sets = screen.getAllByRole("textbox", { name: "Sets" })[0] as HTMLInputElement;
    await userEvent.clear(sets);
    await userEvent.type(sets, "5");
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

    // 2 of 3: skip it, step back to it, then skip again.
    expect(await screen.findByRole("heading", { name: "Exercise 2 of 3" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(await screen.findByRole("heading", { name: "Exercise 3 of 3" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "Exercise 2 of 3" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Plank")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Skip" }));

    // 3 of 3: confirm, then the summary.
    await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("heading", { name: "Ready to create" })).toBeInTheDocument();
    expect(screen.getByText("Goblet squat")).toBeInTheDocument();
    expect(screen.getByText("Bench press", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText("Plank")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Create 1 routine" }));
    await waitFor(() => expect(mocks.importRoutine).toHaveBeenCalledTimes(1));
    expect(mocks.importRoutine).toHaveBeenCalledWith({
      name: "Upper",
      lines: [
        {
          exercise_name: "bench PRESS",
          kind: "reps",
          target_sets: 5,
          target_reps: 8,
          target_weight: "60.00",
          rest_seconds: 90,
        },
        { exercise_name: "Goblet squat", kind: "reps", target_sets: 3, target_reps: 12, target_weight: "16.00" },
      ],
    });
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/gym$/));
    expect(window.sessionStorage.getItem(`everything-everywhere.gym.import.${USER_ID}`)).toBeNull();
  });

  it("keeps the review and says why when the server refuses it, and retries without repeating", async () => {
    mocks.importRoutine.mockRejectedValueOnce(
      new ApiError(422, "kind differs", "exercise_kind_mismatch"),
    );
    renderGym("/gym/import");
    await paste(WORKOUT);
    for (let i = 0; i < 3; i++) {
      await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    }
    await userEvent.click(await screen.findByRole("button", { name: "Create 1 routine" }));
    expect(await screen.findByText(/already exists with another type/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ready to create" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Create 1 routine" }));
    await waitFor(() => expect(mocks.importRoutine).toHaveBeenCalledTimes(2));
  });

  it("will not create while offline, and keeps the draft in the tab", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const view = renderGym("/gym/import");
    await paste(WORKOUT);
    for (let i = 0; i < 3; i++) {
      await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    }
    expect(await screen.findByRole("heading", { name: "Ready to create" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create 1 routine" })).toBeDisabled();
    expect(screen.getByText(/Creating needs a connection/)).toBeInTheDocument();
    expect(mocks.importRoutine).not.toHaveBeenCalled();

    // A reload comes back to the same place.
    view.unmount();
    renderGym("/gym/import");
    expect(await screen.findByRole("heading", { name: "Ready to create" })).toBeInTheDocument();
  });
});

describe("Import: the prompt", () => {
  const prompt = translator("en")("gym.prompt");

  it("is hidden until asked for, then copied to the clipboard", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderGym("/gym/import");
    const toggle = await screen.findByRole("button", { name: "Prompt for Claude / ChatGPT" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Copy prompt" })).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByText(/You are helping me build a gym workout/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(prompt));
    expect(await screen.findByText("Prompt copied")).toBeInTheDocument();
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("selects the text when the Clipboard API is not there", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    renderGym("/gym/import");
    fireEvent.click(await screen.findByRole("button", { name: "Prompt for Claude / ChatGPT" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
    expect(await screen.findByText(/Prompt selected/)).toBeInTheDocument();
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("is the very text in docs/gym-import.md, and French keeps the JSON keys", () => {
    const doc = readFileSync(resolve(process.cwd(), "../docs/gym-import.md"), "utf-8");
    expect(doc).toContain(prompt);
    const french = translator("fr")("gym.prompt");
    expect(french).not.toBe(prompt);
    for (const key of ['"format": "ee-workout/1"', '"distance_m": 2000', '"rest_seconds": 60']) {
      expect(french).toContain(key);
    }
  });
});
