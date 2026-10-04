import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mocks } from "./mockkit";
import { renderGym, resetServer } from "./testkit";

vi.mock("../../api/client", async (orig) => (await import("./mockkit")).mockClient(await orig()));
vi.mock("../../auth/AuthContext", async () => (await import("./mockkit")).authModule());
vi.mock("../../components/CheckInButton", () => ({ CheckInButton: () => null }));

beforeEach(() => {
  resetServer();
  window.sessionStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

const line = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  kind: "reps",
  sets: 3,
  reps: 10,
  ...extra,
});

const file = (exercises: unknown[]) =>
  JSON.stringify({ format: "ee-workout/2", weight_unit: "kg", routines: [{ name: "Day", exercises }] });

async function open(exercises: unknown[]) {
  renderGym("/gym/import");
  const box = await screen.findByLabelText("Or paste the workout");
  fireEvent.change(box, { target: { value: file(exercises) } });
  fireEvent.click(screen.getByRole("button", { name: "Read workout" }));
  await screen.findByRole("heading", { name: /Exercise 1 of/ });
}

describe("Import review (Epic 54)", () => {
  it("Leave superset clears the label of a split last line and unblocks Confirm", async () => {
    await open([
      line("A1", { superset: "A" }),
      line("A2", { superset: "A" }),
      line("B1", { superset: "B" }),
      line("A3", { superset: "A" }),
    ]);
    for (let i = 0; i < 3; i++) {
      await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
      await screen.findByRole("heading", { name: `Exercise ${i + 2} of 4` });
    }
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
    expect(
      screen.getByRole("checkbox", { name: "Superset A3 with the next exercise" }),
    ).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Leave superset" }));
    expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Leave superset" })).not.toBeInTheDocument();
  });

  it("the summary shows a superset label only when two exercises share it", async () => {
    await open([line("Solo", { superset: "B" }), line("P1", { superset: "A" }), line("P2", { superset: "A" })]);
    for (let i = 0; i < 3; i++) {
      await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    }
    await screen.findByRole("heading", { name: "Ready to create" });
    const items = document.querySelectorAll(".gym-import-summary li");
    expect(items[0]?.textContent).not.toMatch(/superset/);
    expect(items[1]?.textContent).toMatch(/superset A/);
    expect(items[2]?.textContent).toMatch(/superset A/);
  });

  it("shows RPE with a decimal comma in French", async () => {
    window.localStorage.setItem("everything-everywhere.language", "fr");
    renderGym("/gym/import");
    const box = await screen.findByLabelText(/collez/);
    fireEvent.change(box, { target: { value: file([line("Squat", { rpe: 7.5 })]) } });
    fireEvent.click(screen.getByRole("button", { name: /Lire/ }));
    await screen.findByRole("heading", { name: /Exercice 1 sur 1/ });
    await userEvent.click(screen.getByRole("button", { name: /Confirmer/ }));
    await screen.findByRole("heading", { name: /Prêt/ });
    expect(document.querySelector(".gym-import-summary")?.textContent).toContain("RPE 7,5");
    expect(mocks.importRoutine).not.toHaveBeenCalled();
  });
});
