import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../api/client";
import { logSet } from "../../gym/session";
import { finishActive, readOutbox, writeActive } from "../../gym/store";
import { USER_ID, mocks } from "./mockkit";
import { ids, renderGym, resetServer, seedActive } from "./testkit";

vi.mock("../../api/client", async (orig) => (await import("./mockkit")).mockClient(await orig()));
vi.mock("../../auth/AuthContext", async () => (await import("./mockkit")).authModule());
vi.mock("../../components/CheckInButton", () => ({ CheckInButton: () => null }));

beforeEach(async () => {
  resetServer();
  const base = seedActive();
  const withSet = logSet(
    base,
    base.exercises[0]?.key ?? "",
    { reps: 5, weight: null, duration_seconds: null, distance_m: null },
    new Date(),
    ids,
  );
  writeActive(USER_ID, withSet);
  mocks.completeWorkout.mockRejectedValueOnce(new ApiError(422, "no", "bad"));
  await finishActive(USER_ID, new Date());
  expect(readOutbox(USER_ID)[0]?.refused).toBe("bad");
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("A refused session on the gym home", () => {
  it("Retry sends it again and the entry goes away", async () => {
    renderGym("/gym");
    await userEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await waitFor(() => expect(readOutbox(USER_ID)).toHaveLength(0));
    expect(mocks.completeWorkout).toHaveBeenCalledTimes(2);
  });

  it("Copy data puts the session's JSON on the clipboard", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderGym("/gym");
    await userEvent.click(await screen.findByRole("button", { name: "Copy data" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const [text] = writeText.mock.calls[0] as unknown as [string];
    expect(JSON.parse(text)).toMatchObject({ client_ref: readOutbox(USER_ID)[0]?.body.client_ref });
  });

  it("Discard asks first, and only then drops it", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderGym("/gym");
    const button = await screen.findByRole("button", { name: "Discard" });
    await userEvent.click(button);
    expect(readOutbox(USER_ID)).toHaveLength(1);
    await userEvent.click(button);
    expect(confirm).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(readOutbox(USER_ID)).toHaveLength(0));
  });
});
