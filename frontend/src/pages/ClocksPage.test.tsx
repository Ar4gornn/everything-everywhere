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
    expect(tokyo.getByText("Free")).toBeInTheDocument();
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
    expect(rowOf("ny").getByText("Own hours")).toBeInTheDocument();
    expect(rowOf("tk").queryByText("Own hours")).toBeNull();
  });

  it("carries the shade on each badge, one value per look", async () => {
    mount([NY, TOKYO]);
    await screen.findByText("Mum");
    expect(rowOf("ny").getByText("Night")).toHaveAttribute("data-shade", "night");
    expect(rowOf("tk").getByText("Free")).toHaveAttribute("data-shade", "free");
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
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit Mother" })).toHaveFocus());
  });

  it("cancels a rename with Escape and puts focus back on Edit", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    await edit(user, "Mum");
    await user.click(screen.getByRole("button", { name: "Rename Mum" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByLabelText("New name for Mum")).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit Mum" })).toHaveFocus());
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
    await user.click(screen.getByRole("button", { name: "Own hours for Mum" }));
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
    await user.click(screen.getByRole("button", { name: "Own hours for Mum" }));
    await user.click(screen.getByRole("button", { name: "Use default" }));
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(lastPatch()).toEqual([{ ...NY, hours: null }]);
  });

  it("drops the own-hours draft on Cancel without a write", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    await edit(user, "Mum");
    await user.click(screen.getByRole("button", { name: "Own hours for Mum" }));
    await user.selectOptions(screen.getByLabelText("Mum: Work starts"), "05:00");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Mum: Work starts")).toBeNull();
    expect(patches).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Own hours for Mum" }));
    expect(screen.getByLabelText("Mum: Work starts")).toHaveValue("09:00");
  });

  it("offers every quarter hour of the day", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    await edit(user, "Mum");
    await user.click(screen.getByRole("button", { name: "Own hours for Mum" }));
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
