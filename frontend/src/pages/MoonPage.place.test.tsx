import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PHASES } from "../moon/engine";
import { writePlace } from "../moon/location";
import MoonPage from "./MoonPage";

/**
 * AD-63 §3: the place never leaves the device. Unlike MoonPage.test.tsx, the location module is
 * the real one here (storage, rounding, the hook), so a request that carried the place could
 * only come from the real code paths: saving, reading it back, and refetching the overlay.
 */

const h = vi.hoisted(() => ({ engine: null as unknown }));

vi.mock("../moon/engine", async (original) => ({
  ...(await original<typeof import("../moon/engine")>()),
  useMoonEngine: () => h.engine,
}));
vi.mock("../auth/AuthContext", async (original) => ({
  ...(await original<typeof import("../auth/AuthContext")>()),
  useOptionalAuth: () => ({ user: { id: "u-place" } }),
}));

const requests: { url: string; body: string }[] = [];

const engine = () => ({
  phaseAt: () => PHASES[0],
  stateAt: () => ({ angle: 0, illumination: 0, ageDays: 0, phase: "new" as const }),
  quartersBetween: () => [],
  riseSet: vi.fn(() => ({ rise: new Date(2026, 9, 3, 14, 5), set: null })),
});

beforeEach(() => {
  window.localStorage.clear();
  requests.length = 0;
  h.engine = engine();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url: String(url), body: String(init?.body ?? "") });
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const LABEL = "Maison Dupont-Zeta";
const everything = () => requests.map((r) => `${r.url} ${r.body}`).join("\n");

describe("the place and the network, with the real location module", () => {
  it("puts neither the coordinates nor the name in any request", async () => {
    render(
      <MemoryRouter>
        <MoonPage />
      </MemoryRouter>,
    );
    await screen.findByText("Mean mood");

    // Typed and saved through the page, then a window change refetches, then the controls
    // are opened and closed again.
    await userEvent.click(screen.getByRole("button", { name: "Enter coordinates" }));
    await userEvent.type(screen.getByLabelText("Latitude"), "48.93");
    await userEvent.type(screen.getByLabelText("Longitude"), "2.31");
    await userEvent.type(screen.getByLabelText("Name (optional)"), LABEL);
    await userEvent.click(screen.getByRole("button", { name: "Save the place" }));
    expect(await screen.findByTestId("moon-place")).toHaveTextContent(`${LABEL}, 48.9, 2.3`);
    const before = requests.length;
    await userEvent.selectOptions(screen.getByLabelText("Window"), "6");
    await screen.findByText("6 cycles · 178 days");
    await userEvent.click(screen.getByRole("button", { name: "Enter coordinates" }));
    await userEvent.click(screen.getByRole("button", { name: "Enter coordinates" }));
    // Also a place written straight through the module, as Settings or another tab would.
    writePlace("u-place", { lat: 48.9, lon: 2.3, label: LABEL });
    await userEvent.selectOptions(screen.getByLabelText("Window"), "12");
    await screen.findByText("12 cycles · 355 days");

    // The test can see the place where it is kept, and the requests really happened.
    expect(window.localStorage.getItem("everything-everywhere.moon.u-place.place")).toContain("48.9");
    expect(requests.length).toBeGreaterThan(before);
    expect(requests.length).toBeGreaterThan(0);
    const sent = everything();
    expect(sent).not.toContain("48.9");
    expect(sent).not.toContain("2.3");
    expect(sent.toLowerCase()).not.toContain(LABEL.toLowerCase());
    expect(sent.toLowerCase()).not.toContain("dupont");
  });
});
