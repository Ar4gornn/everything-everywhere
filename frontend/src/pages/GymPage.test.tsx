import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../api/client";
import { logSet } from "../gym/session";
import { finishActive, readActive, readOutbox, writeActive } from "../gym/store";
import { USER_ID, mocks } from "./gym/mockkit";
import { ids, renderGym, resetServer, seedActive } from "./gym/testkit";

vi.mock("../api/client", async (orig) => (await import("./gym/mockkit")).mockClient(await orig()));
vi.mock("../auth/AuthContext", async () => (await import("./gym/mockkit")).authModule());
vi.mock("../components/CheckInButton", () => ({ CheckInButton: () => null }));

beforeEach(() => resetServer());
afterEach(() => vi.restoreAllMocks());

describe("Gym home", () => {
  it("offers an empty session and explains routines when there are none", async () => {
    resetServer({ routines: [], workouts: [], exercises: [], lastDone: {}, lastTime: {} });
    renderGym();
    expect(await screen.findByRole("button", { name: "Start empty session" })).toBeInTheDocument();
    expect(screen.getByText(/No routines yet\. A routine is a named list/)).toBeInTheDocument();
    expect(screen.queryByText("Session in progress")).not.toBeInTheDocument();
  });

  it("starts a session from a routine card and opens it", async () => {
    renderGym();
    const card = await screen.findByRole("button", { name: "Start Push day" });
    expect(within(card).getByText("2 exercises · about 13 min")).toBeInTheDocument();
    await userEvent.click(card);

    expect(await screen.findByRole("heading", { name: "Push day" })).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent("/gym/session");
    const active = readActive(USER_ID);
    expect(active?.routine_id).toBe("r1");
    expect(active?.exercises.map((e) => e.name)).toEqual(["Bench press", "Plank"]);
  });

  it("puts the most recently done routine first", async () => {
    renderGym();
    await screen.findByRole("button", { name: "Start Push day" });
    const starts = screen
      .getAllByRole("button", { name: /^Start (Push day|Cardio)$/ })
      .map((b) => b.getAttribute("aria-label"));
    expect(starts).toEqual(["Start Push day", "Start Cardio"]);
  });

  it("shows a banner for a session in progress, with Resume and a confirmed Discard", async () => {
    seedActive();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderGym();
    expect(await screen.findByText("Session in progress")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Resume" })).toHaveAttribute("href", "/gym/session");

    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(confirm).toHaveBeenCalled();
    expect(readActive(USER_ID)).toBeNull();
    await waitFor(() => expect(screen.queryByText("Session in progress")).not.toBeInTheDocument());
  });

  it("keeps the running session when a replacement is declined", async () => {
    const running = seedActive();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderGym();
    await userEvent.click(await screen.findByRole("button", { name: "Start Cardio" }));
    expect(readActive(USER_ID)?.client_ref).toBe(running.client_ref);
    expect(screen.getByTestId("where")).toHaveTextContent("/gym");
    expect(screen.getByTestId("where")).not.toHaveTextContent("/gym/session");
  });

  it("disables everything that needs the server while offline, and says why", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    renderGym();
    expect(await screen.findByText("Offline. Sessions are saved on this phone.")).toBeInTheDocument();
    // Starting a session needs no network.
    expect(screen.getByRole("button", { name: "Start Push day" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Create routine" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Import from file" })).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "Edit" }).every((b) => b.hasAttribute("disabled"))).toBe(
      true,
    );
    expect(screen.getByText(/Editing routines needs a connection/)).toBeInTheDocument();
  });

  it("links to the editor and the importer while online", async () => {
    renderGym();
    const edit = await screen.findAllByRole("link", { name: "Edit" });
    expect(edit[0]).toHaveAttribute("href", "/gym/routines/r1");
    expect(screen.getByRole("link", { name: "Import from file" })).toHaveAttribute(
      "href",
      "/gym/import",
    );
  });

  it("creates a routine and opens its editor", async () => {
    renderGym();
    await userEvent.type(await screen.findByLabelText("New routine"), "Pull day");
    await userEvent.click(screen.getByRole("button", { name: "Create routine" }));
    await waitFor(() => expect(mocks.createRoutine).toHaveBeenCalledWith("Pull day"));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/gym/routines/r9"));
  });

  it("counts sessions waiting to sync, and lists a refused one with Discard", async () => {
    const first = seedActive();
    mocks.completeWorkout.mockRejectedValue(new TypeError("Failed to fetch"));
    // Log a set so the session is worth sending, then finish it with no network.
    const set = logSet(
      first,
      first.exercises[0]?.key ?? "",
      { reps: 8, weight: "60.00", duration_seconds: null, distance_m: null },
      new Date(),
      ids,
    );
    writeActive(USER_ID, set);
    await finishActive(USER_ID, new Date());
    expect(readOutbox(USER_ID)).toHaveLength(1);

    renderGym();
    expect(await screen.findByText("1 session waiting to sync")).toBeInTheDocument();
  });

  it("opens a past session to read its sets and deletes it after a confirmation", async () => {
    mocks.readWorkout.mockResolvedValue({
      id: "w1",
      routine_id: "r1",
      performed_on: "2026-09-30",
      started_at: null,
      ended_at: null,
      note: null,
      sets: [
        { id: "s1", exercise_id: "e1", exercise_name: "Bench press", kind: "reps", position: 0, reps: 8, weight: "60.00", duration_seconds: null, distance_m: null },
        { id: "s2", exercise_id: "e1", exercise_name: "Bench press", kind: "reps", position: 1, reps: 6, weight: "60.00", duration_seconds: null, distance_m: null },
        { id: "s3", exercise_id: "e2", exercise_name: "Plank", kind: "duration", position: 2, reps: null, weight: null, duration_seconds: 45, distance_m: null },
      ],
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderGym();
    const history = await screen.findByRole("list", { name: "History" });
    await userEvent.click(within(history).getByRole("button", { name: /Push day/ }));
    expect(await screen.findByText("8 × 60 kg · 6 × 60 kg")).toBeInTheDocument();
    expect(screen.getByText("45 s")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Delete session of/ }));
    await waitFor(() => expect(mocks.deleteWorkout).toHaveBeenCalledWith("w1"));
  });

  it("shows the server's refusal when a past session cannot be opened", async () => {
    mocks.readWorkout.mockRejectedValue(new ApiError(404, "Not Found", "not_found"));
    renderGym();
    const history = await screen.findByRole("list", { name: "History" });
    await userEvent.click(within(history).getByRole("button", { name: /Push day/ }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("edits an exercise's kind and note", async () => {
    renderGym();
    const list = await screen.findByRole("list", { name: "Exercises" });
    await userEvent.click(within(list).getByRole("button", { name: /Plank/ }));
    await userEvent.click(within(list).getByRole("button", { name: "Edit Plank" }));
    await userEvent.type(screen.getByLabelText("Note"), "Elbows under shoulders");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocks.updateExercise).toHaveBeenCalledWith("e2", {
        name: "Plank",
        video_url: null,
        note: "Elbows under shoulders",
      }),
    );
  });

  it("reads exercises offline but cannot change them", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    renderGym();
    const list = await screen.findByRole("list", { name: "Exercises" });
    expect(within(list).getByText("Bench press")).toBeInTheDocument();
    expect(screen.getByText(/Offline: exercises can be read/)).toBeInTheDocument();
    await userEvent.click(within(list).getByRole("button", { name: /Bench press/ }));
    expect(within(list).getByRole("button", { name: "Edit Bench press" })).toBeDisabled();
  });

  it("has nothing to show for history that never happened", async () => {
    resetServer({ workouts: [] });
    renderGym();
    expect(await screen.findByText("Nothing logged yet.")).toBeInTheDocument();
  });
});
