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

function mount(places: ClockPlace[], overrides: Partial<Preferences> = {}, language = "en") {
  window.localStorage.setItem("everything-everywhere.token", "test-token");
  patches.length = 0;
  let prefs: Preferences = { ...DEFAULT_PREFERENCES, clocks: places, ...overrides };
  const user = () => ({
    id: "u1",
    email: "sam@example.com",
    currency: "USD",
    created_at: "",
    language,
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
    expect(tokyo.getByText("Free time")).toBeInTheDocument();
  });

  it("says tomorrow when the place's date is ahead of yours", async () => {
    vi.setSystemTime(new Date("2026-10-03T20:00:00Z")); // Paris 22:00, Tokyo 05:00 on the 4th
    mount([TOKYO]);
    await screen.findByText("Office");
    expect(rowOf("tk").getByText("tomorrow")).toBeInTheDocument();
  });
});

describe("a row's look", () => {
  it("leaves the city out when the name already says it, in any case", async () => {
    mount([{ id: "p", zone: "Asia/Tokyo", label: "tokyo", hours: null }, TOKYO]);
    await screen.findByText("tokyo");
    expect(rowOf("p").queryByText("Tokyo")).toBeNull();
    expect(rowOf("tk").getByText("Tokyo")).toBeInTheDocument();
  });

  it("tags a place that has its own hours, collapsed", async () => {
    mount([{ ...NY, hours: { work: ["08:00", "16:00"], night: ["22:00", "06:00"] } }, TOKYO]);
    await screen.findByText("Mum");
    expect(rowOf("ny").getByText("Custom hours")).toBeInTheDocument();
    expect(rowOf("tk").queryByText("Custom hours")).toBeNull();
  });

  it("carries the shade on each badge, one value per look", async () => {
    mount([NY, TOKYO]);
    await screen.findByText("Mum");
    expect(rowOf("ny").getByText("Night")).toHaveAttribute("data-shade", "night");
    expect(rowOf("tk").getByText("Free time")).toHaveAttribute("data-shade", "free");
    expect(rowOf("home").getByText("Working")).toHaveAttribute("data-shade", "work");
  });

  it("keeps only name, time, meta and an Edit toggle until Edit is pressed", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    expect(screen.queryByRole("button", { name: "Remove Mum" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Rename Mum" })).toBeNull();
    const edit = screen.getByRole("button", { name: "Edit Mum" });
    expect(edit).toHaveAttribute("aria-expanded", "false");
    await user.click(edit);
    expect(edit).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Remove Mum" })).toBeInTheDocument();
    await user.click(edit);
    expect(screen.queryByRole("button", { name: "Remove Mum" })).toBeNull();
  });
});

const edit = async (user: ReturnType<typeof userEvent.setup>, label: string) =>
  user.click(await screen.findByRole("button", { name: `Edit ${label}` }));

describe("writes send the whole list", () => {
  it("adds a place found by search, with the label the person types", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    await user.type(screen.getByLabelText("Search time zones"), "tokyo");
    // City bold, id small, then the time there and the difference from yours.
    const result = await screen.findByRole("button", { name: /Tokyo — Asia\/Tokyo/ });
    expect(result).toHaveTextContent("19:00 (+7h)");
    await user.click(result);
    const label = screen.getByLabelText("Name");
    expect(label).toHaveValue("Tokyo");
    await user.clear(label);
    await user.type(label, "Sis");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(lastPatch()).toEqual([
      NY,
      { id: expect.stringMatching(/^[A-Za-z0-9_-]{1,40}$/), zone: "Asia/Tokyo", label: "Sis", hours: null },
    ]);
    expect(await screen.findByText("Sis")).toBeInTheDocument();
  });

  it("finds a zone by its legacy name and stores the current one", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    await user.type(screen.getByLabelText("Search time zones"), "calcutta");
    await user.click(await screen.findByRole("button", { name: /Kolkata — Asia\/Kolkata/ }));
    await user.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(lastPatch()?.[1]).toMatchObject({ zone: "Asia/Kolkata", label: "Kolkata" });
  });

  it("allows two places in one zone", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    await user.type(screen.getByLabelText("Search time zones"), "new york");
    await user.click(await screen.findByRole("button", { name: /New York — America\/New_York/ }));
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Dad");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(lastPatch()).toHaveLength(2);
    expect(lastPatch()?.map((p) => p.zone)).toEqual(["America/New_York", "America/New_York"]);
  });

  it("refuses a name with a control or direction character, with the reason", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    await user.type(screen.getByLabelText("Search time zones"), "tokyo");
    await user.click(await screen.findByRole("button", { name: /Tokyo — Asia\/Tokyo/ }));
    for (const bad of ["a\u0007b", "a\u202eb", "a\u2066b", "a\u2028b"]) {
      fireEvent.change(screen.getByLabelText("Name"), { target: { value: bad } });
      expect(screen.getByRole("alert")).toHaveTextContent(/control or text-direction/);
      expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    }
    // A zero-width joiner (emoji) is fine.
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "\u{1F468}\u200d\u{1F469}" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Add" })).toBeEnabled();
  });

  it("shows a refused add inside the Add card and keeps the form", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    await user.type(screen.getByLabelText("Search time zones"), "tokyo");
    await user.click(await screen.findByRole("button", { name: /Tokyo — Asia\/Tokyo/ }));
    patchFails = true;
    await user.click(screen.getByRole("button", { name: "Add" }));
    const alert = await screen.findByRole("alert");
    expect(alert.closest(".card")).toContainElement(screen.getByLabelText("Name"));
    expect(screen.getByLabelText("Name")).toHaveValue("Tokyo");
  });

  it("renames a place, focus on the name selected, then back on Edit", async () => {
    const user = userEvent.setup();
    mount([NY, TOKYO]);
    await screen.findByText("Mum");
    await edit(user, "Mum");
    await user.click(screen.getByRole("button", { name: "Rename Mum" }));
    const input = screen.getByLabelText("New name for Mum") as HTMLInputElement;
    await waitFor(() => expect(input).toHaveFocus());
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 3]);
    await user.keyboard("Mother");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(lastPatch()).toEqual([{ ...NY, label: "Mother" }, TOKYO]);
    // The row is still open, so its toggle now reads Done.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Done editing Mother" })).toHaveFocus(),
    );
  });

  it("cancels a rename with Escape and puts focus back on Edit", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    await edit(user, "Mum");
    await user.click(screen.getByRole("button", { name: "Rename Mum" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByLabelText("New name for Mum")).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Done editing Mum" })).toHaveFocus(),
    );
    expect(patches).toHaveLength(0);
  });

  it("keeps the rename form and the typed name when the save is refused", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    await edit(user, "Mum");
    await user.click(screen.getByRole("button", { name: "Rename Mum" }));
    patchFails = true;
    await user.keyboard("Mother");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await rowOf("ny").findByRole("alert")).toBeInTheDocument();
    expect(screen.getByLabelText("New name for Mum")).toHaveValue("Mother");
  });

  it("refuses a rename with a direction override", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    await edit(user, "Mum");
    await user.click(screen.getByRole("button", { name: "Rename Mum" }));
    fireEvent.change(screen.getByLabelText("New name for Mum"), { target: { value: "x\u202ey" } });
    expect(screen.getByRole("alert")).toHaveTextContent(/control or text-direction/);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("moves a place down and up, focus staying on the arrow it used", async () => {
    const user = userEvent.setup();
    mount([NY, TOKYO]);
    await screen.findByText("Mum");
    await edit(user, "Mum");
    expect(screen.getByRole("button", { name: "Move Mum up" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Move Mum down" }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(lastPatch()).toEqual([TOKYO, NY]);
    // Mum is last now, so "down" ran out: focus goes to the other arrow.
    await waitFor(() => expect(screen.getByRole("button", { name: "Move Mum up" })).toHaveFocus());
    await user.click(screen.getByRole("button", { name: "Move Mum up" }));
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(lastPatch()).toEqual([NY, TOKYO]);
  });

  it("keeps focus on the same arrow when it is still usable", async () => {
    const user = userEvent.setup();
    const c: ClockPlace = { id: "c", zone: "Europe/London", label: "Gran", hours: null };
    mount([NY, TOKYO, c]);
    await screen.findByText("Mum");
    await edit(user, "Mum");
    await user.click(screen.getByRole("button", { name: "Move Mum down" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Move Mum down" })).toHaveFocus());
  });

  it("removes a place, from the expanded row only", async () => {
    const user = userEvent.setup();
    mount([NY, TOKYO]);
    await screen.findByText("Mum");
    await edit(user, "Mum");
    await user.click(screen.getByRole("button", { name: "Remove Mum" }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(lastPatch()).toEqual([TOKYO]);
  });

  it("edits own hours as a draft and saves them in one write", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    await edit(user, "Mum");
    await user.click(screen.getByRole("button", { name: "Custom hours for Mum" }));
    await user.selectOptions(screen.getByLabelText("Mum: Work starts"), "05:00");
    await user.selectOptions(screen.getByLabelText("Mum: Night ends"), "05:30");
    // Nothing is written while the draft is open.
    expect(patches).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(lastPatch()).toEqual([
      { ...NY, hours: { work: ["05:00", "18:00"], night: ["23:00", "05:30"] } },
    ]);
    // Mum is at 06:00, no longer night, and inside the new working hours.
    expect(rowOf("ny").getByText("Working")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Custom hours for Mum" }));
    await user.click(screen.getByRole("button", { name: "Use default" }));
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(lastPatch()).toEqual([{ ...NY, hours: null }]);
  });

  it("drops the own-hours draft on Cancel without a write", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    await edit(user, "Mum");
    await user.click(screen.getByRole("button", { name: "Custom hours for Mum" }));
    await user.selectOptions(screen.getByLabelText("Mum: Work starts"), "05:00");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Mum: Work starts")).toBeNull();
    expect(patches).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Custom hours for Mum" }));
    expect(screen.getByLabelText("Mum: Work starts")).toHaveValue("09:00");
  });

  it("offers every quarter hour of the day", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    await edit(user, "Mum");
    await user.click(screen.getByRole("button", { name: "Custom hours for Mum" }));
    expect(within(screen.getByLabelText("Mum: Work ends")).getAllByRole("option")).toHaveLength(96);
  });

  it("shows a refused remove inside the place's row", async () => {
    const user = userEvent.setup();
    mount([NY, TOKYO]);
    await screen.findByText("Mum");
    await edit(user, "Mum");
    patchFails = true;
    await user.click(screen.getByRole("button", { name: "Remove Mum" }));
    const alert = await screen.findByRole("alert");
    expect(alert.closest('[data-place="ny"]')).not.toBeNull();
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1);
  });
});

describe("the cap", () => {
  const twelve: ClockPlace[] = Array.from({ length: 12 }, (_, i) => ({
    id: `p${i}`,
    zone: "Asia/Tokyo",
    label: `Place ${i}`,
    hours: null,
  }));

  it("hides the search at 12 places and says why", async () => {
    mount(twelve);
    await screen.findByText("Place 11");
    expect(screen.queryByLabelText("Search time zones")).toBeNull();
    expect(screen.getByText(/the most there can be/)).toBeInTheDocument();
  });

  it("still allows adding at 11", async () => {
    mount(twelve.slice(0, 11));
    await screen.findByText("Place 10");
    expect(screen.getByLabelText("Search time zones")).toBeEnabled();
  });
});

describe("an account with no places", () => {
  it("shows the Add card first and no slider", async () => {
    mount([]);
    await screen.findByText("Add a place");
    expect(screen.queryByLabelText("Shift in 15-minute steps")).toBeNull();
    const titles = [...document.querySelectorAll("h2")].map((h) => h.textContent);
    expect(titles.indexOf("Add a place")).toBeLessThan(titles.indexOf("Places"));
  });

  it("brings the slider in with the first place", async () => {
    mount([NY]);
    await screen.findByText("Mum");
    expect(screen.getByLabelText("Shift in 15-minute steps")).toBeInTheDocument();
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

  it("says minutes under an hour", async () => {
    mount([NY]);
    await screen.findByText("Mum");
    fireEvent.change(screen.getByLabelText("Shift in 15-minute steps"), { target: { value: "-2" } });
    expect(screen.getByTestId("clocks-readout")).toHaveTextContent("11:30 (−30 min)");
  });

  it("counts day words from the real today, so +12 h reads tomorrow only where it is", async () => {
    mount([NY, TOKYO]);
    await screen.findByText("Mum");
    // Real now 10:00 UTC; +12 h is 22:00 UTC: Paris 00:00 and Tokyo 07:00 on the 4th, New York 18:00 on the 3rd.
    fireEvent.change(screen.getByLabelText("Shift in 15-minute steps"), { target: { value: "48" } });
    expect(screen.getByTestId("clocks-readout")).toHaveTextContent("tomorrow 00:00 (+12h)");
    expect(rowOf("tk").getByText("tomorrow")).toBeInTheDocument();
    expect(rowOf("ny").queryByText("yesterday")).toBeNull();
    expect(rowOf("ny").queryByText("tomorrow")).toBeNull();
    // -12 h: New York is still the 2nd, which is yesterday for you today.
    fireEvent.change(screen.getByLabelText("Shift in 15-minute steps"), { target: { value: "-48" } });
    expect(rowOf("ny").getByText("yesterday")).toBeInTheDocument();
    expect(rowOf("tk").queryByText("tomorrow")).toBeNull();
  });

  it("says demain in French", async () => {
    mount([NY], {}, "fr");
    await screen.findByText("Mum");
    fireEvent.change(screen.getByLabelText(/Décalage/), { target: { value: "48" } });
    expect(screen.getByTestId("clocks-readout")).toHaveTextContent("demain 00:00 (+12h)");
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

const LONDON: ClockPlace = { id: "ld", zone: "Europe/London", label: "Gran", hours: null };

describe("focus", () => {
  it("returns to the row's toggle after custom hours are saved, cancelled or reset", async () => {
    const user = userEvent.setup();
    mount([{ ...NY, hours: { work: ["08:00", "16:00"], night: ["22:00", "06:00"] } }]);
    await screen.findByText("Mum");
    await edit(user, "Mum");
    const toggle = screen.getByRole("button", { name: "Done editing Mum" });
    for (const action of ["Save", "Cancel", "Use default"]) {
      await user.click(screen.getByRole("button", { name: "Custom hours for Mum" }));
      await user.click(screen.getByRole("button", { name: action }));
      await waitFor(() => expect(toggle).toHaveFocus());
      expect(screen.queryByLabelText("Mum: Work starts")).toBeNull();
    }
  });

  it("goes to the Name field when a search result is picked", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    await user.type(screen.getByLabelText("Search time zones"), "tokyo");
    await user.click(await screen.findByRole("button", { name: /Tokyo — Asia\/Tokyo/ }));
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveFocus());
  });

  it("goes to the new row's Edit after a successful add", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    await user.type(screen.getByLabelText("Search time zones"), "tokyo");
    await user.click(await screen.findByRole("button", { name: /Tokyo — Asia\/Tokyo/ }));
    await user.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit Tokyo" })).toHaveFocus());
  });

  it("goes to the next row's Edit after a remove, else the previous, else the search", async () => {
    const user = userEvent.setup();
    mount([NY, TOKYO, LONDON]);
    await screen.findByText("Mum");
    await edit(user, "Office");
    await user.click(screen.getByRole("button", { name: "Remove Office" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit Gran" })).toHaveFocus());
    await edit(user, "Gran");
    await user.click(screen.getByRole("button", { name: "Remove Gran" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit Mum" })).toHaveFocus());
    await edit(user, "Mum");
    await user.click(screen.getByRole("button", { name: "Remove Mum" }));
    await waitFor(() => expect(screen.getByLabelText("Search time zones")).toHaveFocus());
  });

  it("goes to the slider after Back to now, which disables itself", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    const slider = screen.getByLabelText("Shift in 15-minute steps");
    fireEvent.change(slider, { target: { value: "4" } });
    await user.click(screen.getByRole("button", { name: "Back to now" }));
    expect(slider).toHaveFocus();
  });
});

describe("a failed add at eleven places", () => {
  const eleven: ClockPlace[] = Array.from({ length: 11 }, (_, i) => ({
    id: `p${i}`,
    zone: "Asia/Tokyo",
    label: `Place ${i}`,
    hours: null,
  }));

  it("keeps the same form, its text, the error and the focus", async () => {
    const user = userEvent.setup();
    mount(eleven);
    await screen.findByText("Place 10");
    await user.type(screen.getByLabelText("Search time zones"), "paris");
    await user.click(await screen.findByRole("button", { name: /Paris — Europe\/Paris/ }));
    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Aunt");
    patchFails = true;
    const addButton = screen.getByRole("button", { name: "Add" });
    await user.click(addButton);
    const alert = await screen.findByRole("alert");
    // Never unmounted: the very same input and button, with the text and the focus.
    expect(screen.getByLabelText("Name")).toBe(name);
    expect(name).toHaveValue("Aunt");
    expect(screen.getByRole("button", { name: "Add" })).toBe(addButton);
    expect(addButton).toHaveFocus();
    expect(alert.closest(".card")).toContainElement(name);
    expect(screen.queryByText(/the most there can be/)).toBeNull();
  });
});

describe("row errors", () => {
  /** A refused rename: the row stays open, with the form and the error in it. */
  const failRename = async (user: ReturnType<typeof userEvent.setup>) => {
    patchFails = true;
    await user.click(screen.getByRole("button", { name: "Rename Mum" }));
    await user.keyboard("Mother");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await rowOf("ny").findByRole("alert")).toBeInTheDocument();
    patchFails = false;
  };

  it("clear when the row is collapsed", async () => {
    const user = userEvent.setup();
    mount([NY, TOKYO]);
    await screen.findByText("Mum");
    await edit(user, "Mum");
    await failRename(user);
    await user.click(screen.getByRole("button", { name: "Done editing Mum" }));
    expect(rowOf("ny").queryByRole("alert")).toBeNull();
  });

  it("clear on a rename's Cancel", async () => {
    const user = userEvent.setup();
    mount([NY, TOKYO]);
    await screen.findByText("Mum");
    await edit(user, "Mum");
    await failRename(user);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(rowOf("ny").queryByRole("alert")).toBeNull();
  });

  it("clear on a rename's Escape", async () => {
    const user = userEvent.setup();
    mount([NY, TOKYO]);
    await screen.findByText("Mum");
    await edit(user, "Mum");
    await failRename(user);
    await user.click(screen.getByLabelText("New name for Mum"));
    await user.keyboard("{Escape}");
    expect(rowOf("ny").queryByRole("alert")).toBeNull();
  });
});

describe("names", () => {
  it("refuses a name with nothing visible in it, with the reason", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    await user.type(screen.getByLabelText("Search time zones"), "tokyo");
    await user.click(await screen.findByRole("button", { name: /Tokyo — Asia\/Tokyo/ }));
    for (const blank of ["ㅤ", "​", "⠀", "‎"]) {
      fireEvent.change(screen.getByLabelText("Name"), { target: { value: blank } });
      expect(screen.getByRole("alert")).toHaveTextContent(/visible|control or text-direction/);
      expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    }
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "ㅤ" } });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "A name needs at least one visible character.",
    );
  });
});

describe("the Add form", () => {
  it("starts over on Escape, back in the search", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    const search = screen.getByLabelText("Search time zones");
    await user.type(search, "tokyo");
    await user.click(await screen.findByRole("button", { name: /Tokyo — Asia\/Tokyo/ }));
    await user.keyboard("{Escape}");
    expect(search).toHaveValue("");
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(search).toHaveFocus();
  });

  it("keeps the chosen zone and name while the search is edited, until another is picked", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    const search = screen.getByLabelText("Search time zones");
    await user.type(search, "tokyo");
    await user.click(await screen.findByRole("button", { name: /Tokyo — Asia\/Tokyo/ }));
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Sis");
    await user.clear(search);
    await user.type(search, "seoul");
    expect(screen.getByText("Chosen zone: Asia/Tokyo")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Sis");
    await user.click(await screen.findByRole("button", { name: /Seoul — Asia\/Seoul/ }));
    expect(screen.getByText("Chosen zone: Asia/Seoul")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Seoul");
  });

  it("finds a city by its alias, says so, and names the place after it", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    await user.type(screen.getByLabelText("Search time zones"), "delhi");
    const result = await screen.findByRole("button", {
      name: /^Delhi → Kolkata — Asia\/Kolkata · /,
    });
    await user.click(result);
    expect(screen.getByLabelText("Name")).toHaveValue("Delhi");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(lastPatch()?.[1]).toMatchObject({ zone: "Asia/Kolkata", label: "Delhi" });
  });

  it("says how many matches there are when it shows only some", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    await user.type(screen.getByLabelText("Search time zones"), "a");
    expect(
      await screen.findByText(/^Showing 20 of \d+\. Type more to narrow the list\.$/),
    ).toBeInTheDocument();
    const results = screen.getByRole("list", { name: "Matching zones" });
    expect(within(results).getAllByRole("listitem")).toHaveLength(20);
  });

  it("suggests a nearer city or a region when nothing matches", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    await user.type(screen.getByLabelText("Search time zones"), "qqqq");
    expect(
      await screen.findByText("No match. Try the nearest big city, or a region like Asia/Kolkata."),
    ).toBeInTheDocument();
  });
});

describe("words", () => {
  it("does not point below on an empty account, where the Add card is above", async () => {
    mount([]);
    expect(
      await screen.findByText("No places yet. Add one to see its time next to yours."),
    ).toBeInTheDocument();
  });

  it("labels the toggle Edit, then Done, in French too", async () => {
    const user = userEvent.setup();
    mount([NY], {}, "fr");
    await screen.findByText("Mum");
    const toggle = screen.getByRole("button", { name: "Modifier Mum" });
    expect(toggle).toHaveTextContent("Modifier");
    await user.click(toggle);
    expect(toggle).toHaveAccessibleName("Fermer les réglages de Mum");
    expect(toggle).toHaveTextContent("Fermer");
  });

  it("puts a space before the French colon of the readout", async () => {
    mount([NY], {}, "fr");
    await screen.findByText("Mum");
    expect(screen.getByTestId("clocks-readout").parentElement).toHaveTextContent(
      /^Votre heure : Maintenant$/,
    );
  });
});

describe("undo a remove", () => {
  it("puts the place back where it was, with its hours, in one write", async () => {
    const user = userEvent.setup();
    const own: ClockPlace = {
      ...TOKYO,
      hours: { work: ["08:00", "16:00"], night: ["22:00", "06:00"] },
    };
    mount([NY, own, LONDON]);
    await screen.findByText("Mum");
    await edit(user, "Office");
    await user.click(screen.getByRole("button", { name: "Remove Office" }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(await screen.findByText("Removed Office.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo removing Office" }));
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(lastPatch()).toEqual([NY, own, LONDON]);
    expect(screen.queryByText("Removed Office.")).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit Office" })).toHaveFocus());
  });

  it("goes away with the next write", async () => {
    const user = userEvent.setup();
    mount([NY, TOKYO, LONDON]);
    await screen.findByText("Mum");
    await edit(user, "Office");
    await user.click(screen.getByRole("button", { name: "Remove Office" }));
    expect(await screen.findByText("Removed Office.")).toBeInTheDocument();
    await edit(user, "Gran");
    await user.click(screen.getByRole("button", { name: "Move Gran up" }));
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(screen.queryByText("Removed Office.")).toBeNull();
  });
});
