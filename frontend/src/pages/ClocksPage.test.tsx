import { fireEvent, render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClockPlace, Preferences } from "../api/types";
import { AuthProvider } from "../auth/AuthContext";
import { ModuleGate } from "../components/ModuleOff";
import { LanguageProvider } from "../i18n";
import { DEFAULT_PREFERENCES } from "../layout/preferences";
import { ClocksPage } from "./ClocksPage";

/**
 * The Clocks page (Epic 48.2). The real time engine and the real preferences saver run; only
 * the clock is pinned. 2026-10-03 10:00 UTC is 12:00 in Paris (+2), 06:00 in New York (-4),
 * 19:00 in Tokyo (+9).
 */

const NOW = new Date("2026-10-03T10:00:00Z");

const NY: ClockPlace = { id: "ny", zone: "America/New_York", label: "Mum", hours: null };
const TOKYO: ClockPlace = { id: "tk", zone: "Asia/Tokyo", label: "Office", hours: null };

const patches: { clocks?: ClockPlace[] }[] = [];
let patchFails = false;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mount(places: ClockPlace[], overrides: Partial<Preferences> = {}) {
  window.localStorage.setItem("everything-everywhere.token", "test-token");
  patches.length = 0;
  let prefs: Preferences = { ...DEFAULT_PREFERENCES, clocks: places, ...overrides };
  const user = () => ({
    id: "u1",
    email: "sam@example.com",
    currency: "USD",
    created_at: "",
    language: "en",
    timezone: "Europe/Paris",
    preferences: prefs,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/auth/me/preferences")) {
        if (patchFails) return json({ detail: "no", code: "error" }, 500);
        const body = JSON.parse(String(init?.body));
        patches.push(body);
        prefs = { ...prefs, ...body };
        return json(user());
      }
      if (url.includes("/api/auth/me")) return json(user());
      return json({ items: [] });
    }),
  );
  return rtlRender(
    <MemoryRouter initialEntries={["/clocks"]}>
      <AuthProvider>
        <LanguageProvider>
          <ModuleGate module="clocks">
            <ClocksPage />
          </ModuleGate>
        </LanguageProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

const rowOf = (id: string) => {
  const li = document.querySelector(`[data-place="${id}"]`);
  if (!li) throw new Error(`no row ${id}`);
  return within(li as HTMLElement);
};

const lastPatch = () => patches[patches.length - 1]?.clocks;

beforeEach(() => {
  patchFails = false;
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the list", () => {
  it("shows your own zone first, then each place with time, difference and a shade word", async () => {
    mount([NY, TOKYO]);
    await screen.findByText("Mum");
    const rows = [...document.querySelectorAll("[data-place]")].map((el) => el.getAttribute("data-place"));
    expect(rows).toEqual(["home", "ny", "tk"]);

    const home = rowOf("home");
    expect(home.getByText("You")).toBeInTheDocument();
    expect(home.getByText("Paris")).toBeInTheDocument();
    expect(home.getByText("12:00")).toBeInTheDocument();
    expect(home.getByText("Working")).toBeInTheDocument();

    const ny = rowOf("ny");
    expect(ny.getByText("06:00")).toBeInTheDocument();
    expect(ny.getByText("−6h")).toBeInTheDocument();
    expect(ny.getByText("Night")).toBeInTheDocument();

    const tokyo = rowOf("tk");
    expect(tokyo.getByText("19:00")).toBeInTheDocument();
    expect(tokyo.getByText("+7h")).toBeInTheDocument();
    expect(tokyo.getByText("Free")).toBeInTheDocument();
  });

  it("says tomorrow when the place's date is ahead of yours", async () => {
    vi.setSystemTime(new Date("2026-10-03T20:00:00Z")); // Paris 22:00, Tokyo 05:00 on the 4th
    mount([TOKYO]);
    await screen.findByText("Office");
    expect(rowOf("tk").getByText("tomorrow")).toBeInTheDocument();
  });
});

describe("writes send the whole list", () => {
  it("adds a place found by search, with the label the person types", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    await user.type(screen.getByLabelText("Search time zones"), "tokyo");
    await user.click(await screen.findByRole("button", { name: "Asia/Tokyo" }));
    const label = screen.getByLabelText("Name");
    expect(label).toHaveValue("Tokyo");
    await user.clear(label);
    await user.type(label, "Sis");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(lastPatch()).toEqual([NY, { id: expect.stringMatching(/^[A-Za-z0-9_-]{1,40}$/), zone: "Asia/Tokyo", label: "Sis", hours: null }]);
    expect(await screen.findByText("Sis")).toBeInTheDocument();
  });

  it("renames a place", async () => {
    const user = userEvent.setup();
    mount([NY, TOKYO]);
    await screen.findByText("Mum");
    await user.click(screen.getByRole("button", { name: "Rename Mum" }));
    const input = screen.getByLabelText("New name for Mum");
    await user.clear(input);
    await user.type(input, "Mother");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(lastPatch()).toEqual([{ ...NY, label: "Mother" }, TOKYO]);
  });

  it("moves a place down and up", async () => {
    const user = userEvent.setup();
    mount([NY, TOKYO]);
    await screen.findByText("Mum");
    expect(screen.getByRole("button", { name: "Move Mum up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Office down" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Move Mum down" }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(lastPatch()).toEqual([TOKYO, NY]);
    await user.click(await screen.findByRole("button", { name: "Move Mum up" }));
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(lastPatch()).toEqual([NY, TOKYO]);
  });

  it("removes a place", async () => {
    const user = userEvent.setup();
    mount([NY, TOKYO]);
    await screen.findByText("Mum");
    await user.click(screen.getByRole("button", { name: "Remove Mum" }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(lastPatch()).toEqual([TOKYO]);
  });

  it("sets own hours from the selects, then goes back to the default", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    await user.click(screen.getByRole("button", { name: "Own hours for Mum" }));
    // Mum is at 06:00; moving night's end to 06:00 makes it no longer night, work to 05:00 makes it work.
    await user.selectOptions(screen.getByLabelText("Mum: Work starts"), "05:00");
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(lastPatch()).toEqual([
      { ...NY, hours: { work: ["05:00", "18:00"], night: ["23:00", "07:00"] } },
    ]);
    await user.selectOptions(screen.getByLabelText("Mum: Night ends"), "05:30");
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(lastPatch()).toEqual([
      { ...NY, hours: { work: ["05:00", "18:00"], night: ["23:00", "05:30"] } },
    ]);
    expect(rowOf("ny").getByText("Working")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Use default" }));
    await waitFor(() => expect(patches).toHaveLength(3));
    expect(lastPatch()).toEqual([{ ...NY, hours: null }]);
  });

  it("offers every quarter hour of the day", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    await user.click(screen.getByRole("button", { name: "Own hours for Mum" }));
    expect(within(screen.getByLabelText("Mum: Work ends")).getAllByRole("option")).toHaveLength(96);
  });

  it("shows the usual error when a save is refused", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    patchFails = true;
    await user.click(screen.getByRole("button", { name: "Remove Mum" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

describe("the cap", () => {
  const twelve: ClockPlace[] = Array.from({ length: 12 }, (_, i) => ({
    id: `p${i}`,
    zone: "Asia/Tokyo",
    label: `Place ${i}`,
    hours: null,
  }));

  it("disables adding at 12 places and says why", async () => {
    mount(twelve);
    await screen.findByText("Place 11");
    expect(screen.getByLabelText("Search time zones")).toBeDisabled();
    expect(screen.getByText(/the most there can be/)).toBeInTheDocument();
  });

  it("still allows adding at 11", async () => {
    mount(twelve.slice(0, 11));
    await screen.findByText("Place 10");
    expect(screen.getByLabelText("Search time zones")).toBeEnabled();
  });
});

describe("the slider", () => {
  it("runs from -12 h to +12 h in quarter hours, and says Now at rest", async () => {
    mount([NY]);
    await screen.findByText("Mum");
    const slider = screen.getByLabelText("Shift in 15-minute steps") as HTMLInputElement;
    expect([slider.min, slider.max, slider.step, slider.value]).toEqual(["-48", "48", "1", "0"]);
    expect(screen.getByTestId("clocks-readout")).toHaveTextContent("Now");
  });

  it("moves every clock and shade, and Back to now restores them", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    const slider = screen.getByLabelText("Shift in 15-minute steps");
    const back = screen.getByRole("button", { name: "Back to now" });
    expect(back).toBeDisabled();
    // +3h30: Paris 15:30, New York 09:30 (work).
    fireEvent.change(slider, { target: { value: "14" } });
    expect(screen.getByTestId("clocks-readout")).toHaveTextContent("15:30 (+3h30)");
    expect(rowOf("home").getByText("15:30")).toBeInTheDocument();
    expect(rowOf("ny").getByText("09:30")).toBeInTheDocument();
    expect(rowOf("ny").getByText("Working")).toBeInTheDocument();
    await user.click(back);
    expect(screen.getByTestId("clocks-readout")).toHaveTextContent("Now");
    expect(rowOf("ny").getByText("06:00")).toBeInTheDocument();
    expect(rowOf("ny").getByText("Night")).toBeInTheDocument();
  });

  it("is never written anywhere", async () => {
    mount([NY]);
    await screen.findByText("Mum");
    fireEvent.change(screen.getByLabelText("Shift in 15-minute steps"), { target: { value: "4" } });
    expect(patches).toHaveLength(0);
  });
});

describe("the module", () => {
  it("shows the off notice instead of the page", async () => {
    mount([NY], { modules: { ...DEFAULT_PREFERENCES.modules, clocks: false } });
    expect(await screen.findByText("Clocks is turned off")).toBeInTheDocument();
    expect(screen.queryByLabelText("Shift in 15-minute steps")).toBeNull();
  });
});
