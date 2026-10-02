import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../api/client";
import { buildPrompt, buildPromptContext } from "../../gym/prompts";
import { EMPTY_CACHE, readActive } from "../../gym/store";
import { USER_ID, mocks } from "./mockkit";
import { cacheWith, pushDay, renderGym, resetServer } from "./testkit";

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
afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "clipboard");
});

/** Give the real navigator a clipboard for one test. */
function giveClipboard(clipboard: Partial<Clipboard> | undefined) {
  Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
}

const WORKOUT = JSON.stringify({
  format: "ee-workout/1",
  weight_unit: "kg",
  routines: [
    {
      name: "Upper",
      exercises: [
        // Exists, as reps. The file says duration: the existing kind must win.
        { name: "bench PRESS", kind: "duration", sets: 4, seconds: 30, reps: 8, weight: 60, rest_seconds: 90 },
        {
          name: "Plank",
          kind: "duration",
          sets: 3,
          seconds: 45,
          rest_seconds: 60,
          rest_after_seconds: 120,
        },
        { name: "Goblet squat", kind: "reps", sets: 3, reps: 12, weight: 16 },
      ],
    },
  ],
  schedule: ["Upper", "rest", "Upper"],
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

    await userEvent.click(screen.getByRole("button", { name: "Create only" }));
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
    await userEvent.click(await screen.findByRole("button", { name: "Create only" }));
    expect(await screen.findByText(/already exists with another type/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ready to create" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Create only" }));
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
    expect(screen.getByRole("button", { name: "Create only" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Create and start" })).toBeDisabled();
    expect(screen.getByText(/Creating needs a connection/)).toBeInTheDocument();
    expect(mocks.importRoutine).not.toHaveBeenCalled();

    // A reload comes back to the same place.
    view.unmount();
    renderGym("/gym/import");
    expect(await screen.findByRole("heading", { name: "Ready to create" })).toBeInTheDocument();
  });
});

describe("Import: getting a prompt (the AI half)", () => {
  const card = (name: RegExp) => screen.getByRole("button", { name });

  it("lists the six kinds of workout, each collapsed until tapped", async () => {
    renderGym("/gym/import");
    const list = await screen.findByRole("list", { name: "Kinds of workout" });
    const heads = within(list).getAllByRole("button");
    expect(heads).toHaveLength(6);
    expect(heads.every((b) => b.getAttribute("aria-expanded") === "false")).toBe(true);
    expect(screen.queryByRole("button", { name: "Copy & open Claude" })).not.toBeInTheDocument();

    await userEvent.click(card(/Build me one/));
    expect(card(/Build me one/)).toHaveAttribute("aria-expanded", "true");
    for (const name of ["Copy & open Claude", "Copy & open ChatGPT", "Copy only"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(
      screen.getByText("Chat, confirm each exercise, then come back here and tap Paste."),
    ).toBeInTheDocument();
    // The old single prompt block is gone.
    expect(
      screen.queryByRole("button", { name: "Prompt for Claude / ChatGPT" }),
    ).not.toBeInTheDocument();
  });

  it("copies first and only then opens the AI app, in a new tab without an opener", async () => {
    const order: string[] = [];
    giveClipboard({
      writeText: vi.fn(async () => {
        order.push("copy");
      }),
    });
    const open = vi.spyOn(window, "open").mockImplementation(() => {
      order.push("open");
      return null;
    });
    renderGym("/gym/import");
    await userEvent.click(await screen.findByRole("button", { name: /Build me one/ }));

    await userEvent.click(screen.getByRole("button", { name: "Copy & open Claude" }));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(order).toEqual(["copy", "open"]);
    expect(open).toHaveBeenCalledWith("https://claude.ai/new", "_blank", "noopener");

    await userEvent.click(screen.getByRole("button", { name: "Copy & open ChatGPT" }));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(2));
    expect(open).toHaveBeenLastCalledWith("https://chatgpt.com/", "_blank", "noopener");
  });

  it("opens the tab inside the tap, without waiting for the copy, and keeps a visible link", async () => {
    // A copy that never answers: an await before window.open would never get there.
    giveClipboard({ writeText: vi.fn(() => new Promise<void>(() => undefined)) });
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderGym("/gym/import");
    await userEvent.click(await screen.findByRole("button", { name: /Build me one/ }));
    await userEvent.click(screen.getByRole("button", { name: "Copy & open ChatGPT" }));
    expect(open).toHaveBeenCalledWith("https://chatgpt.com/", "_blank", "noopener");
    expect(screen.queryByRole("link", { name: "Open ChatGPT" })).not.toBeInTheDocument();
  });

  it("after the copy, a link opens the AI app for a blocked popup", async () => {
    giveClipboard({ writeText: vi.fn(async () => undefined) });
    vi.spyOn(window, "open").mockReturnValue(null);
    renderGym("/gym/import");
    await userEvent.click(await screen.findByRole("button", { name: /Build me one/ }));
    await userEvent.click(screen.getByRole("button", { name: "Copy & open ChatGPT" }));
    const link = await screen.findByRole("link", { name: "Open ChatGPT" });
    expect(link).toHaveAttribute("href", "https://chatgpt.com/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("writes the context labels in the app's language", async () => {
    window.localStorage.setItem("everything-everywhere.language", "fr");
    const writeText = vi.fn(async () => undefined);
    giveClipboard({ writeText });
    mocks.listRecentWorkouts.mockResolvedValue([
      { ...pushDay, id: "a", routine_id: null, rest_day: false, performed_on: "2026-10-01", sets: [] },
      { ...pushDay, id: "b", routine_id: null, rest_day: true, performed_on: "2026-09-30", sets: [] },
    ]);
    renderGym("/gym/import");
    await screen.findByRole("list");
    const heads = document.querySelectorAll<HTMLElement>(".gym-profile-head");
    await userEvent.click(heads[1] as HTMLElement);
    await userEvent.click(screen.getByRole("button", { name: "Copier seulement" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    await waitFor(() => {
      const text = String((writeText.mock.calls.at(-1) as unknown[])[0]);
      expect(text).toContain("séance libre");
      expect(text).toContain("jour de repos");
      expect(text).not.toMatch(/free session|rest day/);
    });
    window.localStorage.removeItem("everything-everywhere.language");
  });

  it("copies the profile's prompt built from this person's own context", async () => {
    const writeText = vi.fn(async () => undefined);
    giveClipboard({ writeText });
    renderGym("/gym/import");
    await userEvent.click(await screen.findByRole("button", { name: /Build me one/ }));
    await userEvent.click(screen.getByRole("button", { name: "Copy only" }));
    const expected = buildPrompt("build", buildPromptContext(cacheWith(), [], "kg"), "en", "");
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expected));
    expect(expected).toContain("Bench press");
    expect(await screen.findByText("Prompt copied")).toBeInTheDocument();
  });

  it("Copy only never opens another app", async () => {
    giveClipboard({ writeText: vi.fn(async () => undefined) });
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderGym("/gym/import");
    await userEvent.click(await screen.findByRole("button", { name: /Build me one/ }));
    await userEvent.click(screen.getByRole("button", { name: "Copy only" }));
    await screen.findByText("Prompt copied");
    expect(open).not.toHaveBeenCalled();
  });

  it("writes the notes of 'I know what I want' into the prompt, and shows the prompt on request", async () => {
    const writeText = vi.fn(async () => undefined);
    giveClipboard({ writeText });
    renderGym("/gym/import");
    await userEvent.click(await screen.findByRole("button", { name: /I know what I want/ }));
    fireEvent.change(screen.getByLabelText("Your notes"), { target: { value: "bench 4x8, plank" } });
    await userEvent.click(screen.getByRole("button", { name: "Show prompt" }));
    expect(screen.getByRole("button", { name: "Hide prompt" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(document.querySelector(".gym-prompt-text")?.textContent).toContain("bench 4x8, plank");

    await userEvent.click(screen.getByRole("button", { name: "Copy only" }));
    const expected = buildPrompt(
      "notes",
      buildPromptContext(cacheWith(), [], "kg"),
      "en",
      "bench 4x8, plank",
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expected));

    // Only the notes profile has a notes box.
    await userEvent.click(screen.getByRole("button", { name: /Short on time/ }));
    expect(screen.queryByLabelText("Your notes")).not.toBeInTheDocument();
  });

  it("when the clipboard is refused, shows the prompt and does not leave the page", async () => {
    giveClipboard({
      writeText: vi.fn(async () => {
        throw new Error("denied");
      }),
    });
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderGym("/gym/import");
    await userEvent.click(await screen.findByRole("button", { name: /Build me one/ }));
    await userEvent.click(screen.getByRole("button", { name: "Copy & open Claude" }));
    expect(await screen.findByText(/Prompt selected/)).toBeInTheDocument();
    expect(document.querySelector(".gym-prompt-text")).not.toBeNull();
    // The tab opens from the tap itself, before the copy is known; the link stays on offer.
    expect(open).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Open Claude" })).toHaveAttribute(
      "href",
      "https://claude.ai/new",
    );
  });

  it("without a Clipboard API at all, the prompt is shown for a long-press", async () => {
    giveClipboard(undefined);
    renderGym("/gym/import");
    await userEvent.click(await screen.findByRole("button", { name: /Build me one/ }));
    await userEvent.click(screen.getByRole("button", { name: "Copy only" }));
    expect(await screen.findByText(/Prompt selected/)).toBeInTheDocument();
  });

  it("is the very text in docs/gym-import.md, and French keeps the JSON keys", () => {
    const doc = readFileSync(resolve(process.cwd(), "../docs/gym-import.md"), "utf-8");
    const empty = buildPromptContext(EMPTY_CACHE, [], "kg");
    const english = buildPrompt("build", empty, "en");
    expect(doc).toContain(english);
    const french = buildPrompt("build", empty, "fr");
    expect(french).not.toBe(english);
    for (const key of [
      '"format": "ee-workout/1"',
      '"distance_m": 2000',
      '"rest_seconds": 60',
      '"schedule"',
    ]) {
      expect(french).toContain(key);
    }
  });
});

describe("Import: bringing it back", () => {
  it("Paste from clipboard reads the clipboard and opens the review", async () => {
    giveClipboard({ readText: vi.fn(async () => WORKOUT) });
    renderGym("/gym/import");
    await userEvent.click(await screen.findByRole("button", { name: "Paste from clipboard" }));
    expect(await screen.findByRole("heading", { name: "Exercise 1 of 3" })).toBeInTheDocument();
  });

  it("when reading is refused, focuses the paste box and says to long-press", async () => {
    giveClipboard({
      readText: vi.fn(async () => {
        throw new Error("denied");
      }),
    });
    renderGym("/gym/import");
    await userEvent.click(await screen.findByRole("button", { name: "Paste from clipboard" }));
    expect(await screen.findByText("Long-press and paste here.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Or paste the workout")).toHaveFocus());
    expect(screen.queryByText(/Exercise 1 of/)).not.toBeInTheDocument();
  });

  it("an empty clipboard is the same as a refused one", async () => {
    giveClipboard({ readText: vi.fn(async () => "  ") });
    renderGym("/gym/import");
    await userEvent.click(await screen.findByRole("button", { name: "Paste from clipboard" }));
    expect(await screen.findByText("Long-press and paste here.")).toBeInTheDocument();
  });

  it("offers Paste again when the tab is shown after a profile was opened and nothing is pasted", async () => {
    renderGym("/gym/import");
    await screen.findByRole("list", { name: "Kinds of workout" });
    // No profile open yet: coming back to the tab says nothing.
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(screen.queryByText("Got your workout? Paste it here.")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Build me one/ }));
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(await screen.findByText("Got your workout? Paste it here.")).toBeInTheDocument();

    // Something in the box: the banner goes.
    fireEvent.change(screen.getByLabelText("Or paste the workout"), { target: { value: "x" } });
    await waitFor(() =>
      expect(screen.queryByText("Got your workout? Paste it here.")).not.toBeInTheDocument(),
    );
  });
});

describe("Import: rest and the last step", () => {
  async function toSummary() {
    renderGym("/gym/import");
    await paste(WORKOUT);
    for (let i = 0; i < 3; i++) {
      await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    }
    await screen.findByRole("heading", { name: "Ready to create" });
  }

  it("shows the week plan, with the rest day marked, on the first step and the summary", async () => {
    renderGym("/gym/import");
    await paste(WORKOUT);
    await screen.findByRole("heading", { name: "Exercise 1 of 3" });
    expect(screen.getByRole("heading", { name: "The week in this plan" })).toBeInTheDocument();
    const days = document.querySelectorAll(".gym-week-strip li");
    expect(Array.from(days).map((li) => li.textContent)).toEqual(["MonUpper", "Tuerest", "WedUpper"]);
    expect(document.querySelector(".gym-week-strip li.is-rest")?.textContent).toBe("Tuerest");
    // Later steps do not repeat it.
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await screen.findByRole("heading", { name: "Exercise 2 of 3" });
    expect(screen.queryByRole("heading", { name: "The week in this plan" })).not.toBeInTheDocument();
  });

  it("carries rest_after_seconds from the file through the review to the server", async () => {
    mocks.importRoutine.mockResolvedValue({ ...pushDay, id: "r7", name: "Upper" });
    renderGym("/gym/import");
    await paste(WORKOUT);
    await screen.findByRole("heading", { name: "Exercise 1 of 3" });
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await screen.findByRole("heading", { name: "Exercise 2 of 3" });
    expect(numeric("Rest after (s)").value).toBe("120");
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    await userEvent.click(await screen.findByRole("button", { name: "Create only" }));
    await waitFor(() => expect(mocks.importRoutine).toHaveBeenCalledTimes(1));
    const body = mocks.importRoutine.mock.calls[0]?.[0] as {
      lines: { exercise_name: string; rest_after_seconds?: number }[];
    };
    expect(body.lines.find((l) => l.exercise_name === "Plank")?.rest_after_seconds).toBe(120);
    expect(body.lines.find((l) => l.exercise_name === "Goblet squat")).not.toHaveProperty(
      "rest_after_seconds",
    );
  });

  it("Create and start makes the routine, starts it, and opens the session", async () => {
    mocks.importRoutine.mockResolvedValue({ ...pushDay, id: "r7", name: "Upper" });
    await toSummary();
    await userEvent.click(screen.getByRole("button", { name: "Create and start" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/gym/session"));
    expect(mocks.importRoutine).toHaveBeenCalledTimes(1);
    expect(readActive(USER_ID)?.routine_id).toBe("r7");
    expect(window.sessionStorage.getItem(`everything-everywhere.gym.import.${USER_ID}`)).toBeNull();
  });

  it("with several routines made, asks which to start, today's first, and starts that one", async () => {
    const TWO = JSON.stringify({
      format: "ee-workout/1",
      weight_unit: "kg",
      schedule: ["Upper", "rest", "Lower"],
      routines: [
        { name: "Upper", exercises: [{ name: "Goblet squat", kind: "reps", sets: 3, reps: 12 }] },
        { name: "Lower", exercises: [{ name: "Plank", kind: "duration", sets: 3, seconds: 30 }] },
      ],
    });
    mocks.importRoutine.mockImplementation(async (body: { name: string }) => ({
      ...pushDay,
      id: `id-${body.name}`,
      name: body.name,
    }));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2031, 2, 5, 12, 0, 0)); // a Wednesday: the third day of the plan
    try {
      renderGym("/gym/import");
      await paste(TWO);
      await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
      await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
      await userEvent.click(await screen.findByRole("button", { name: "Create and start" }));
      const list = await screen.findByRole("list", { name: "Which one do you start?" });
      const names = within(list).getAllByRole("button").map((b) => b.textContent);
      expect(names).toEqual(["Lower", "Upper"]);
      expect(readActive(USER_ID)).toBeNull();
      await userEvent.click(within(list).getByRole("button", { name: "Upper" }));
      await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/gym/session"));
      expect(readActive(USER_ID)?.routine_id).toBe("id-Upper");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a draft kept by an older build, lines without rest_after_seconds, still reviews and creates", async () => {
    mocks.importRoutine.mockResolvedValue({ ...pushDay, id: "r7", name: "Upper" });
    const view = renderGym("/gym/import");
    await paste(WORKOUT);
    await screen.findByRole("heading", { name: "Exercise 1 of 3" });
    const key = `everything-everywhere.gym.import.${USER_ID}`;
    const draft = JSON.parse(window.sessionStorage.getItem(key) as string);
    for (const routine of draft.routines) for (const line of routine.lines) delete line.rest_after_seconds;
    window.sessionStorage.setItem(key, JSON.stringify(draft));
    view.unmount();
    renderGym("/gym/import");
    await screen.findByRole("heading", { name: "Exercise 1 of 3" });
    for (let i = 0; i < 3; i++) {
      await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    }
    await userEvent.click(await screen.findByRole("button", { name: "Create only" }));
    await waitFor(() => expect(mocks.importRoutine).toHaveBeenCalledTimes(1));
    const body = mocks.importRoutine.mock.calls[0]?.[0] as { lines: Record<string, unknown>[] };
    expect(body.lines.every((l) => l.rest_after_seconds === undefined || typeof l.rest_after_seconds === "number")).toBe(true);
    expect(Object.values(body.lines).some((l) => "rest_after_seconds" in l && l.rest_after_seconds === undefined)).toBe(false);
  });

  it("Create only stays out of the session", async () => {
    mocks.importRoutine.mockResolvedValue({ ...pushDay, id: "r7", name: "Upper" });
    await toSummary();
    await userEvent.click(screen.getByRole("button", { name: "Create only" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/gym$/));
    expect(readActive(USER_ID)).toBeNull();
  });
});
