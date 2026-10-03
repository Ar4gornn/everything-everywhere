import { act, fireEvent, render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClockPlace, Preferences } from "../api/types";
import { AuthProvider } from "../auth/AuthContext";
import { ModuleGate } from "../components/ModuleOff";
import { LanguageProvider } from "../i18n";
import { DEFAULT_PREFERENCES } from "../layout/preferences";
import { ClocksPage } from "./ClocksPage";

// The device's own zone, which a test moves; the real one would make the suite machine-bound.
const device = vi.hoisted(() => ({ zone: "Europe/Paris" as string | null }));
vi.mock("../push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../push")>()),
  deviceZone: () => device.zone,
}));

/**
 * The Clocks page (Epic 48.2). The real time engine and the real preferences saver run; only
 * the clock is pinned. 2026-10-03 10:00 UTC is 12:00 in Paris (+2), 06:00 in New York (-4),
 * 19:00 in Tokyo (+9).
 */

const NOW = new Date("2026-10-03T10:00:00Z");

const NY: ClockPlace = { id: "ny", zone: "America/New_York", label: "Mum", hours: null };
const TOKYO: ClockPlace = { id: "tk", zone: "Asia/Tokyo", label: "Office", hours: null };

const patches: { clocks?: ClockPlace[] }[] = [];
const schedules: { timezone: string | null; digest_time: string }[] = [];
let patchFails = false;
/** The server refuses a 13th place as the schema does: 422, code "validation". */
let capRefuses = false;
/** While set, every account request waits for it: the server is slow (round 4). */
let gate: Promise<void> | null = null;
let openGate: () => void = () => undefined;
const holdServer = () => {
  gate = new Promise<void>((resolve) => {
    openGate = () => {
      gate = null;
      resolve();
    };
  });
};
/** The account cannot be read (the GET before a write fails). */
let meFails = false;
/** Another device writes to the account behind this page's back. */
let serverSet: (change: Partial<Preferences>) => void = () => undefined;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mount(places: ClockPlace[], overrides: Partial<Preferences> = {}, language = "en") {
  window.localStorage.setItem("everything-everywhere.token", "test-token");
  patches.length = 0;
  schedules.length = 0;
  let timezone = "Europe/Paris";
  let prefs: Preferences = { ...DEFAULT_PREFERENCES, clocks: places, ...overrides };
  const user = () => ({
    id: "u1",
    email: "sam@example.com",
    currency: "USD",
    created_at: "",
    language,
    timezone,
    digest_time: "07:30",
    preferences: prefs,
  });
  serverSet = (change) => {
    prefs = { ...prefs, ...change };
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (gate && url.includes("/api/auth/me")) await gate;
      if (url.includes("/api/auth/me/preferences")) {
        if (patchFails) return json({ detail: "no", code: "error" }, 500);
        const body = JSON.parse(String(init?.body));
        if (capRefuses && (body.clocks?.length ?? 0) > 12) {
          return json(
            { detail: [{ type: "too_long", msg: "List should have at most 12 items" }], code: "validation" },
            422,
          );
        }
        patches.push(body);
        prefs = { ...prefs, ...body };
        return json(user());
      }
      if (url.includes("/api/auth/me/notification-schedule")) {
        const body = JSON.parse(String(init?.body));
        schedules.push(body);
        timezone = body.timezone;
        return json(user());
      }
      if (url.includes("/api/auth/me")) {
        if (meFails) return json({ detail: "no", code: "error" }, 500);
        return json(user());
      }
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
  capRefuses = false;
  meFails = false;
  gate = null;
  device.zone = "Europe/Paris";
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
    expect(screen.queryByLabelText("Choose a time to compare")).toBeNull();
    const titles = [...document.querySelectorAll("h2")].map((h) => h.textContent);
    expect(titles.indexOf("Add a place")).toBeLessThan(titles.indexOf("Places"));
  });

  it("brings the slider in with the first place", async () => {
    mount([NY]);
    await screen.findByText("Mum");
    expect(screen.getByLabelText("Choose a time to compare")).toBeInTheDocument();
  });
});

describe("the slider", () => {
  it("runs from -12 h to +12 h in quarter hours, and says Now at rest", async () => {
    mount([NY]);
    await screen.findByText("Mum");
    const slider = screen.getByLabelText("Choose a time to compare") as HTMLInputElement;
    expect([slider.min, slider.max, slider.step, slider.value]).toEqual(["-48", "48", "1", "0"]);
    expect(screen.getByTestId("clocks-readout")).toHaveTextContent("Now");
  });

  it("moves every clock and shade, and Back to now restores them", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    const slider = screen.getByLabelText("Choose a time to compare");
    const back = screen.getByRole("button", { name: "Back to now" });
    expect(back).toBeDisabled();
    // +3h30: Paris 15:30, New York 09:30 (work).
    fireEvent.change(slider, { target: { value: "14" } });
    // The planned time alone: no offset from a base that was rounded down (round 4).
    expect(screen.getByTestId("clocks-readout")).toHaveTextContent(/^15:30$/);
    expect(slider).toHaveAttribute("aria-valuetext", "15:30");
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
    fireEvent.change(screen.getByLabelText("Choose a time to compare"), { target: { value: "-2" } });
    expect(screen.getByTestId("clocks-readout")).toHaveTextContent(/^11:30$/);
  });

  it("counts day words from the real today, so +12 h reads tomorrow only where it is", async () => {
    mount([NY, TOKYO]);
    await screen.findByText("Mum");
    // Real now 10:00 UTC; +12 h is 22:00 UTC: Paris 00:00 and Tokyo 07:00 on the 4th, New York 18:00 on the 3rd.
    fireEvent.change(screen.getByLabelText("Choose a time to compare"), { target: { value: "48" } });
    expect(screen.getByTestId("clocks-readout")).toHaveTextContent(/^tomorrow 00:00$/);
    expect(rowOf("tk").getByText("tomorrow")).toBeInTheDocument();
    expect(rowOf("ny").queryByText("yesterday")).toBeNull();
    expect(rowOf("ny").queryByText("tomorrow")).toBeNull();
    // -12 h: New York is still the 2nd, which is yesterday for you today.
    fireEvent.change(screen.getByLabelText("Choose a time to compare"), { target: { value: "-48" } });
    expect(rowOf("ny").getByText("yesterday")).toBeInTheDocument();
    expect(rowOf("tk").queryByText("tomorrow")).toBeNull();
  });

  it("says demain in French", async () => {
    mount([NY], {}, "fr");
    await screen.findByText("Mum");
    fireEvent.change(screen.getByLabelText("Choisir une heure à comparer"), { target: { value: "48" } });
    expect(screen.getByTestId("clocks-readout")).toHaveTextContent(/^demain 00:00$/);
  });

  it("is never written anywhere", async () => {
    mount([NY]);
    await screen.findByText("Mum");
    fireEvent.change(screen.getByLabelText("Choose a time to compare"), { target: { value: "4" } });
    expect(patches).toHaveLength(0);
  });
});

describe("the module", () => {
  it("shows the off notice instead of the page", async () => {
    mount([NY], { modules: { ...DEFAULT_PREFERENCES.modules, clocks: false } });
    expect(await screen.findByText("Clocks is turned off")).toBeInTheDocument();
    expect(screen.queryByLabelText("Choose a time to compare")).toBeNull();
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

  it("goes to the Undo button after a remove, whichever row it was (round 5)", async () => {
    const user = userEvent.setup();
    mount([NY, TOKYO, LONDON]);
    await screen.findByText("Mum");
    await edit(user, "Office");
    await user.click(screen.getByRole("button", { name: "Remove Office" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Undo removing Office" })).toHaveFocus(),
    );
    await edit(user, "Gran");
    await user.click(screen.getByRole("button", { name: "Remove Gran" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Undo removing Office and Gran" })).toHaveFocus(),
    );
    await edit(user, "Mum");
    await user.click(screen.getByRole("button", { name: "Remove Mum" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Undo removing Office, Gran and Mum" }),
      ).toHaveFocus(),
    );
  });

  it("goes to the slider after Back to now, which disables itself", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    const slider = screen.getByLabelText("Choose a time to compare");
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
    await user.type(screen.getByLabelText("Search time zones"), "am");
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

describe("writes are operations on the account as it is now (round 3)", () => {
  it("renames on top of what another device changed, not over it", async () => {
    const user = userEvent.setup();
    mount([NY, TOKYO]);
    await screen.findByText("Mum");
    // Meanwhile, elsewhere: Office became HQ and Gran was added.
    serverSet({ clocks: [NY, { ...TOKYO, label: "HQ" }, LONDON] });
    await edit(user, "Mum");
    await user.click(screen.getByRole("button", { name: "Rename Mum" }));
    await user.keyboard("Mother");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(lastPatch()).toEqual([{ ...NY, label: "Mother" }, { ...TOKYO, label: "HQ" }, LONDON]);
    expect(await screen.findByText("HQ")).toBeInTheDocument();
  });

  it("does nothing, and says so, when the place was removed on another device", async () => {
    const user = userEvent.setup();
    mount([NY, TOKYO]);
    await screen.findByText("Mum");
    serverSet({ clocks: [TOKYO] });
    await edit(user, "Mum");
    await user.click(screen.getByRole("button", { name: "Move Mum down" }));
    expect(await screen.findByText("This place was changed on another device.")).toBeInTheDocument();
    expect(patches).toHaveLength(0);
    // The page now shows what the account has.
    await waitFor(() => expect(screen.queryByText("Mum")).toBeNull());
    expect(screen.getByText("Office")).toBeInTheDocument();
  });

  it("applies two quick edits in order: the second reads what the first wrote", async () => {
    const user = userEvent.setup();
    mount([NY, TOKYO, LONDON]);
    await screen.findByText("Mum");
    await edit(user, "Mum");
    const down = screen.getByRole("button", { name: "Move Mum down" });
    fireEvent.click(down);
    fireEvent.click(down);
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(patches[0]?.clocks).toEqual([TOKYO, NY, LONDON]);
    expect(lastPatch()).toEqual([TOKYO, LONDON, NY]);
  });

  it("re-reads the account when the page becomes visible again", async () => {
    mount([NY]);
    await screen.findByText("Mum");
    serverSet({ clocks: [NY, LONDON] });
    expect(screen.queryByText("Gran")).toBeNull();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(await screen.findByText("Gran")).toBeInTheDocument();
  });
});

describe("custom hours equal to the defaults (round 3)", () => {
  it("saves them as no custom hours at all", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    await edit(user, "Mum");
    await user.click(screen.getByRole("button", { name: "Custom hours for Mum" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(lastPatch()).toEqual([{ ...NY, hours: null }]);
    expect(document.querySelector('[data-place="ny"] .clocks-tag')).toBeNull();
  });

  it("drops custom hours that were edited back to the defaults", async () => {
    const user = userEvent.setup();
    mount([{ ...NY, hours: { work: ["08:00", "16:00"], night: ["22:00", "06:00"] } }]);
    await screen.findByText("Mum");
    await edit(user, "Mum");
    await user.click(screen.getByRole("button", { name: "Custom hours for Mum" }));
    await user.selectOptions(screen.getByLabelText("Mum: Work starts"), "09:00");
    await user.selectOptions(screen.getByLabelText("Mum: Work ends"), "18:00");
    await user.selectOptions(screen.getByLabelText("Mum: Night starts"), "23:00");
    await user.selectOptions(screen.getByLabelText("Mum: Night ends"), "07:00");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(lastPatch()).toEqual([{ ...NY, hours: null }]);
  });
});

describe("your time zone (round 3)", () => {
  it("says nothing while the device is on the account's zone", async () => {
    mount([NY]);
    await screen.findByText("Mum");
    expect(screen.queryByText(/This device is on/)).toBeNull();
  });

  it("offers the device's zone when the account is on another, and saves it with the digest hour kept", async () => {
    device.zone = "Asia/Tokyo";
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    expect(rowOf("home").getByText("Paris")).toBeInTheDocument();
    expect(rowOf("home").getByText("This device is on Tokyo time.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Use Tokyo as your time zone" }));
    await waitFor(() => expect(schedules).toEqual([{ timezone: "Asia/Tokyo", digest_time: "07:30" }]));
    // The profile was re-read: your own row is Tokyo now, and the hint is gone.
    await waitFor(() => expect(rowOf("home").getByText("Tokyo")).toBeInTheDocument());
    expect(screen.queryByText(/This device is on/)).toBeNull();
  });
});

describe("keys and focus (round 3)", () => {
  it("collapses an open row on Escape and puts focus back on its Edit toggle", async () => {
    const user = userEvent.setup();
    mount([NY, TOKYO]);
    await screen.findByText("Mum");
    await edit(user, "Mum");
    screen.getByRole("button", { name: "Move Mum down" }).focus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("button", { name: "Remove Mum" })).toBeNull();
    const toggle = screen.getByRole("button", { name: "Edit Mum" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
  });

  it("leaves a rename's own Escape alone: it closes the form, not the row", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    await edit(user, "Mum");
    await user.click(screen.getByRole("button", { name: "Rename Mum" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Remove Mum" })).toBeInTheDocument();
  });

  it("puts focus on the restored row's Edit toggle when a remove is refused", async () => {
    const user = userEvent.setup();
    mount([NY, TOKYO]);
    await screen.findByText("Mum");
    await edit(user, "Mum");
    patchFails = true;
    await user.click(screen.getByRole("button", { name: "Remove Mum" }));
    await rowOf("ny").findByRole("alert");
    await waitFor(() =>
      expect(document.querySelector('[data-place="ny"] .clocks-edit')).toHaveFocus(),
    );
  });
});

describe("the slider starts from the quarter hour (round 3)", () => {
  it("lands on :00 :15 :30 :45 once shifted, and is the real now at rest", async () => {
    vi.setSystemTime(new Date("2026-10-03T10:07:30Z")); // Paris 12:07
    mount([NY]);
    await screen.findByText("Mum");
    expect(rowOf("home").getByText("12:07")).toBeInTheDocument();
    const slider = screen.getByLabelText("Choose a time to compare");
    fireEvent.change(slider, { target: { value: "1" } });
    expect(rowOf("home").getByText("12:15")).toBeInTheDocument();
    fireEvent.change(slider, { target: { value: "-1" } });
    expect(rowOf("home").getByText("11:45")).toBeInTheDocument();
    fireEvent.change(slider, { target: { value: "0" } });
    expect(rowOf("home").getByText("12:07")).toBeInTheDocument();
  });

  it("is named for what it does, with the step as its description", async () => {
    mount([NY]);
    await screen.findByText("Mum");
    const slider = screen.getByRole("slider", { name: "Choose a time to compare" });
    expect(slider).toHaveAccessibleDescription("Shift in 15-minute steps");
  });
});

describe("the undo line (round 3)", () => {
  it("is a live region, in a neutral French sentence", async () => {
    const user = userEvent.setup();
    mount([NY, TOKYO], {}, "fr");
    await screen.findByText("Mum");
    await user.click(screen.getByRole("button", { name: "Modifier Office" }));
    await user.click(screen.getByRole("button", { name: "Retirer Office" }));
    const line = await screen.findByText("Retiré de la liste : Office");
    expect(line.closest('[role="status"]')).not.toBeNull();
  });

  // Testing Library's own waiting waits on a real setTimeout, so with the timer faked these
  // tests use vi.waitFor and plain events instead.
  describe("with the timer on", () => {
    beforeEach(() => {
      vi.useRealTimers();
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], now: NOW });
    });
    const until = (check: () => void) => vi.waitFor(check);
    const wait = (ms: number) =>
      act(() => {
        vi.advanceTimersByTime(ms);
      });
    const removeOfficeNow = async () => {
      mount([NY, TOKYO]);
      await until(() => expect(screen.getByText("Mum")).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "Edit Office" }));
      fireEvent.click(screen.getByRole("button", { name: "Remove Office" }));
      await until(() => expect(screen.getByText("Removed Office.")).toBeInTheDocument());
      // A remove hands focus to the next row, inside the card, which holds the timer too:
      // let go of it, so each test says which of hover and focus it is about.
      act(() => (document.activeElement as HTMLElement | null)?.blur());
    };

    it("goes away after 8 seconds", async () => {
      await removeOfficeNow();
      wait(6000);
      expect(screen.getByText("Removed Office.")).toBeInTheDocument();
      wait(3000);
      expect(screen.queryByText("Removed Office.")).toBeNull();
    });

    it("waits while the pointer is over the list, and starts again when it leaves", async () => {
      await removeOfficeNow();
      const list = screen.getByRole("list", { name: "Places" });
      fireEvent.mouseEnter(list);
      wait(30000);
      expect(screen.getByText("Removed Office.")).toBeInTheDocument();
      fireEvent.mouseLeave(list);
      wait(6000);
      expect(screen.getByText("Removed Office.")).toBeInTheDocument();
      wait(3000);
      expect(screen.queryByText("Removed Office.")).toBeNull();
    });

    it("waits while focus is inside the list card, and starts again when it leaves", async () => {
      await removeOfficeNow();
      const undoButton = screen.getByRole("button", { name: "Undo removing Office" });
      act(() => undoButton.focus());
      wait(30000);
      expect(screen.getByText("Removed Office.")).toBeInTheDocument();
      act(() => undoButton.blur());
      wait(6000);
      expect(screen.getByText("Removed Office.")).toBeInTheDocument();
      wait(3000);
      expect(screen.queryByText("Removed Office.")).toBeNull();
    });
  });
});

const order = () =>
  [...document.querySelectorAll("[data-place]")]
    .map((el) => el.getAttribute("data-place"))
    .filter((id) => id !== "home");

describe("a slow server: changes show at once (round 4)", () => {
  it("shows a rename before the server answers, with Save saying so", async () => {
    const user = userEvent.setup();
    mount([NY, TOKYO]);
    await screen.findByText("Mum");
    await edit(user, "Mum");
    await user.click(screen.getByRole("button", { name: "Rename Mum" }));
    await user.keyboard("Mother");
    holdServer();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(rowOf("ny").getByText("Mother")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Saving…" })).toBeInTheDocument();
    expect(patches).toHaveLength(0);
    openGate();
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(lastPatch()).toEqual([{ ...NY, label: "Mother" }, TOKYO]);
    await waitFor(() => expect(screen.queryByLabelText(/New name for/)).toBeNull());
  });

  it("applies two quick moves at once, in order, focus following the arrow", async () => {
    const user = userEvent.setup();
    mount([NY, TOKYO, LONDON]);
    await screen.findByText("Mum");
    await edit(user, "Mum");
    holdServer();
    const down = screen.getByRole("button", { name: "Move Mum down" });
    await user.click(down);
    expect(order()).toEqual(["tk", "ny", "ld"]);
    expect(down).toHaveFocus();
    await user.click(down);
    expect(order()).toEqual(["tk", "ld", "ny"]);
    // Down ran out: the other arrow.
    expect(screen.getByRole("button", { name: "Move Mum up" })).toHaveFocus();
    expect(patches).toHaveLength(0);
    openGate();
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(patches[0]?.clocks).toEqual([TOKYO, NY, LONDON]);
    expect(lastPatch()).toEqual([TOKYO, LONDON, NY]);
    expect(order()).toEqual(["tk", "ld", "ny"]);
  });

  it("rolls a refused move back, with the error in the row", async () => {
    const user = userEvent.setup();
    mount([NY, TOKYO]);
    await screen.findByText("Mum");
    await edit(user, "Mum");
    holdServer();
    patchFails = true;
    await user.click(screen.getByRole("button", { name: "Move Mum down" }));
    expect(order()).toEqual(["tk", "ny"]);
    openGate();
    expect(await rowOf("ny").findByRole("alert")).toBeInTheDocument();
    expect(order()).toEqual(["ny", "tk"]);
  });

  it("rolls back when the account cannot be read before the write", async () => {
    const user = userEvent.setup();
    mount([NY, TOKYO]);
    await screen.findByText("Mum");
    await edit(user, "Mum");
    holdServer();
    meFails = true;
    await user.click(screen.getByRole("button", { name: "Move Mum down" }));
    expect(order()).toEqual(["tk", "ny"]);
    openGate();
    expect(await rowOf("ny").findByRole("alert")).toBeInTheDocument();
    expect(order()).toEqual(["ny", "tk"]);
    expect(patches).toHaveLength(0);
  });

  it("removes at once: the row goes, Undo shows and has focus", async () => {
    const user = userEvent.setup();
    mount([NY, TOKYO, LONDON]);
    await screen.findByText("Mum");
    await edit(user, "Office");
    holdServer();
    await user.click(screen.getByRole("button", { name: "Remove Office" }));
    expect(order()).toEqual(["ny", "ld"]);
    expect(screen.getByText("Removed Office.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo removing Office" })).toHaveFocus();
    expect(patches).toHaveLength(0);
    openGate();
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(lastPatch()).toEqual([NY, LONDON]);
  });

  it("undoes at once, focus on the restored row's Edit", async () => {
    const user = userEvent.setup();
    mount([NY, TOKYO, LONDON]);
    await screen.findByText("Mum");
    await edit(user, "Office");
    await user.click(screen.getByRole("button", { name: "Remove Office" }));
    await waitFor(() => expect(patches).toHaveLength(1));
    holdServer();
    await user.click(screen.getByRole("button", { name: "Undo removing Office" }));
    expect(order()).toEqual(["ny", "tk", "ld"]);
    expect(screen.getByRole("button", { name: "Edit Office" })).toHaveFocus();
    expect(patches).toHaveLength(1);
    openGate();
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(lastPatch()).toEqual([NY, TOKYO, LONDON]);
  });

  it("shows an add at once, with the button saying Adding", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    await user.type(screen.getByLabelText("Search time zones"), "tokyo");
    await user.click(await screen.findByRole("button", { name: /Tokyo — Asia\/Tokyo/ }));
    holdServer();
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("button", { name: "Adding…" })).toBeInTheDocument();
    expect(order()).toHaveLength(2);
    expect(patches).toHaveLength(0);
    openGate();
    await waitFor(() => expect(patches).toHaveLength(1));
  });
});

/** Let every queued write finish, so a second one would have been sent by now. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  });

describe("double submits (round 4)", () => {
  it("adds one place for two quick presses and an Enter", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    await user.type(screen.getByLabelText("Search time zones"), "tokyo");
    await user.click(await screen.findByRole("button", { name: /Tokyo — Asia\/Tokyo/ }));
    holdServer();
    const add = screen.getByRole("button", { name: "Add" });
    fireEvent.click(add);
    fireEvent.click(add);
    fireEvent.submit(screen.getByLabelText("Name").closest("form") as HTMLFormElement);
    openGate();
    await waitFor(() => expect(patches.length).toBeGreaterThan(0));
    await settle();
    expect(patches).toHaveLength(1);
    expect(lastPatch()).toHaveLength(2);
  });

  it("renames once for two quick Saves", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    await edit(user, "Mum");
    await user.click(screen.getByRole("button", { name: "Rename Mum" }));
    await user.keyboard("Mother");
    holdServer();
    const save = screen.getByRole("button", { name: "Save" });
    fireEvent.click(save);
    fireEvent.click(save);
    // The second press did nothing: the form is still there, saying it is saving.
    expect(screen.getByRole("button", { name: "Saving…" })).toBeInTheDocument();
    openGate();
    await waitFor(() => expect(patches.length).toBeGreaterThan(0));
    await settle();
    expect(patches).toHaveLength(1);
  });
});

describe("refused writes re-read the account (round 4)", () => {
  it("shows what the account really has after a refusal", async () => {
    const user = userEvent.setup();
    mount([NY, TOKYO]);
    await screen.findByText("Mum");
    await edit(user, "Mum");
    patchFails = true;
    // Gran was added elsewhere just as this move is refused.
    serverSet({ clocks: [NY, TOKYO, LONDON] });
    await user.click(screen.getByRole("button", { name: "Move Mum down" }));
    expect(await rowOf("ny").findByRole("alert")).toBeInTheDocument();
    expect(await screen.findByText("Gran")).toBeInTheDocument();
  });

  it("says the twelve places were filled elsewhere when the cap refuses an add", async () => {
    const user = userEvent.setup();
    const eleven: ClockPlace[] = Array.from({ length: 11 }, (_, i) => ({
      id: `p${i}`,
      zone: "Asia/Tokyo",
      label: `Place ${i}`,
      hours: null,
    }));
    mount(eleven);
    await screen.findByText("Place 10");
    capRefuses = true;
    serverSet({ clocks: [...eleven, LONDON] });
    await user.type(screen.getByLabelText("Search time zones"), "paris");
    await user.click(await screen.findByRole("button", { name: /Paris — Europe\/Paris/ }));
    await user.click(screen.getByRole("button", { name: "Add" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("You already have 12 places (changed on another device).");
    expect(alert.closest(".card")).toHaveTextContent("Add a place");
    // The tab re-read the account: Gran is there.
    expect(await screen.findByText("Gran")).toBeInTheDocument();
    // One message, not two: the standing "you have 12" sentence stays out while it shows.
    expect(screen.getByRole("alert")).toHaveTextContent("changed on another device");
    expect(screen.queryByText(/the most there can be/)).toBeNull();
  });

  it("keeps the plain message for any other refusal of an add", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    await user.type(screen.getByLabelText("Search time zones"), "tokyo");
    await user.click(await screen.findByRole("button", { name: /Tokyo — Asia\/Tokyo/ }));
    patchFails = true;
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("alert")).not.toHaveTextContent(/already have/);
  });
});

describe("focus and notices (round 4)", () => {
  it("collapses an open row on Escape on its own toggle", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    await edit(user, "Mum");
    const toggle = screen.getByRole("button", { name: "Done editing Mum" });
    expect(toggle).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Remove Mum" })).toBeNull();
  });

  it("puts focus on your own row after Use it, not on the page", async () => {
    device.zone = "Asia/Tokyo";
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    await user.click(screen.getByRole("button", { name: "Use Tokyo as your time zone" }));
    await waitFor(() => expect(screen.queryByText(/This device is on/)).toBeNull());
    await waitFor(() =>
      expect(document.querySelector('[data-place="home"] .clocks-label')).toHaveFocus(),
    );
  });

  it("shows 'changed on another device' above the list, until the next good write", async () => {
    const user = userEvent.setup();
    mount([NY, TOKYO]);
    await screen.findByText("Mum");
    serverSet({ clocks: [TOKYO] });
    await edit(user, "Mum");
    await user.click(screen.getByRole("button", { name: "Move Mum down" }));
    const notice = await screen.findByText("This place was changed on another device.");
    expect(notice).toHaveAttribute("role", "status");
    const list = screen.getByRole("list", { name: "Places" });
    expect(notice.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await edit(user, "Office");
    await user.click(screen.getByRole("button", { name: "Rename Office" }));
    await user.keyboard("HQ");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patches).toHaveLength(1));
    await waitFor(() =>
      expect(screen.queryByText("This place was changed on another device.")).toBeNull(),
    );
  });

  it("puts the Undo line where the removed row was, so it shows under the finger (round 5)", async () => {
    const user = userEvent.setup();
    mount([NY, TOKYO, LONDON]);
    await screen.findByText("Mum");
    await edit(user, "Office");
    await user.click(screen.getByRole("button", { name: "Remove Office" }));
    const status = (await screen.findByText("Removed Office.")).closest('[role="status"]');
    const items = Array.from(
      screen.getByRole("list", { name: "Places" }).children,
    ) as HTMLElement[];
    // You, Mum, the Undo line (Office's index), Gran.
    expect(items).toHaveLength(4);
    expect(items[2]?.contains(status)).toBe(true);
    expect(items[2]?.getAttribute("data-place")).toBeNull();
    expect(items[3]?.getAttribute("data-place")).toBe("ld");
    // A second remove moves the line to that row's place: one line, one Undo.
    await edit(user, "Mum");
    await user.click(screen.getByRole("button", { name: "Remove Mum" }));
    const after = Array.from(
      screen.getByRole("list", { name: "Places" }).children,
    ) as HTMLElement[];
    expect(after[1]?.textContent).toContain("Removed Office and Mum.");
    expect(screen.getAllByRole("button", { name: /^Undo removing/ })).toHaveLength(1);
  });

  it("offers one Undo for two removes, and puts both back in one write", async () => {
    const user = userEvent.setup();
    mount([NY, TOKYO, LONDON]);
    await screen.findByText("Mum");
    await edit(user, "Office");
    await user.click(screen.getByRole("button", { name: "Remove Office" }));
    await edit(user, "Mum");
    await user.click(screen.getByRole("button", { name: "Remove Mum" }));
    expect(await screen.findByText("Removed Office and Mum.")).toBeInTheDocument();
    await waitFor(() => expect(patches).toHaveLength(2));
    await user.click(screen.getByRole("button", { name: "Undo removing Office and Mum" }));
    await waitFor(() => expect(patches).toHaveLength(3));
    expect(lastPatch()).toEqual([NY, TOKYO, LONDON]);
    expect(order()).toEqual(["ny", "tk", "ld"]);
  });

  it("says nothing for a one-letter search", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    await user.type(screen.getByLabelText("Search time zones"), "a");
    expect(screen.queryByText(/No match/)).toBeNull();
    expect(screen.queryByRole("list", { name: "Matching zones" })).toBeNull();
  });

  describe("with the timer on", () => {
    beforeEach(() => {
      vi.useRealTimers();
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], now: NOW });
    });

    it("lets 'changed on another device' go after 8 seconds", async () => {
      mount([NY, TOKYO]);
      await vi.waitFor(() => expect(screen.getByText("Mum")).toBeInTheDocument());
      serverSet({ clocks: [TOKYO] });
      fireEvent.click(screen.getByRole("button", { name: "Edit Mum" }));
      fireEvent.click(screen.getByRole("button", { name: "Move Mum down" }));
      await vi.waitFor(() =>
        expect(screen.getByText("This place was changed on another device.")).toBeInTheDocument(),
      );
      act(() => {
        vi.advanceTimersByTime(9000);
      });
      expect(screen.queryByText("This place was changed on another device.")).toBeNull();
    });
  });
});

describe("round 5 (phone fixes)", () => {
  it("does not pull focus out of the search when a slow rename finishes", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    await edit(user, "Mum");
    await user.click(screen.getByRole("button", { name: "Rename Mum" }));
    await user.keyboard("Mother");
    holdServer();
    await user.click(screen.getByRole("button", { name: "Save" }));
    const search = screen.getByLabelText("Search time zones");
    search.focus();
    openGate();
    await waitFor(() => expect(patches).toHaveLength(1));
    await settle();
    expect(screen.queryByRole("button", { name: "Saving…" })).toBeNull();
    expect(search).toHaveFocus();
  });

  it("does not pull focus out of the search when slow custom hours finish", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    await edit(user, "Mum");
    await user.click(screen.getByRole("button", { name: "Custom hours for Mum" }));
    await user.selectOptions(screen.getByLabelText("Mum: Work starts"), "05:00");
    holdServer();
    await user.click(screen.getByRole("button", { name: "Save" }));
    const search = screen.getByLabelText("Search time zones");
    search.focus();
    openGate();
    await waitFor(() => expect(patches).toHaveLength(1));
    await settle();
    expect(screen.queryByRole("group", { name: "Custom hours for Mum" })).toBeNull();
    expect(search).toHaveFocus();
  });

  it("still returns focus to Edit when it is left where the save was pressed", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    await edit(user, "Mum");
    await user.click(screen.getByRole("button", { name: "Custom hours for Mum" }));
    await user.selectOptions(screen.getByLabelText("Mum: Work starts"), "05:00");
    holdServer();
    await user.click(screen.getByRole("button", { name: "Save" }));
    openGate();
    await waitFor(() => expect(screen.getByRole("button", { name: "Done editing Mum" })).toHaveFocus());
  });

  it("saves custom hours once for three quick presses, saying Saving…", async () => {
    const user = userEvent.setup();
    mount([NY]);
    await screen.findByText("Mum");
    await edit(user, "Mum");
    await user.click(screen.getByRole("button", { name: "Custom hours for Mum" }));
    await user.selectOptions(screen.getByLabelText("Mum: Work starts"), "05:00");
    holdServer();
    const save = screen.getByRole("button", { name: "Save" });
    fireEvent.click(save);
    fireEvent.click(save);
    fireEvent.click(save);
    expect(screen.getByRole("button", { name: "Saving…" })).toBeInTheDocument();
    openGate();
    await waitFor(() => expect(patches.length).toBeGreaterThan(0));
    await settle();
    expect(patches).toHaveLength(1);
  });

  it("resets to the default once for three quick presses", async () => {
    const user = userEvent.setup();
    const own: ClockPlace = { ...NY, hours: { work: ["05:00", "18:00"], night: ["23:00", "05:30"] } };
    mount([own]);
    await screen.findByText("Mum");
    await edit(user, "Mum");
    await user.click(screen.getByRole("button", { name: "Custom hours for Mum" }));
    holdServer();
    const reset = screen.getByRole("button", { name: "Use default" });
    // Three presses before a render (the row drops the button as soon as the change shows).
    act(() => {
      reset.click();
      reset.click();
      reset.click();
    });
    openGate();
    await waitFor(() => expect(patches.length).toBeGreaterThan(0));
    await settle();
    expect(patches).toHaveLength(1);
    expect(lastPatch()).toEqual([{ ...NY, hours: null }]);
  });
});
