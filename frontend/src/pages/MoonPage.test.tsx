import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PHASES } from "../moon/engine";
import { onAPhone } from "../test/phone";
import MoonPage from "./MoonPage";

/**
 * The Moon page (Epic 47). The engine, the location store and the hemisphere are other
 * builders' modules and are replaced here by deterministic stand-ins: the engine says the
 * phase of a local day is `PHASES[dayOfMonth % 8]`, so a test can name a "full moon day"
 * (the 4th, 12th, 20th, 28th) without any astronomy.
 */

const h = vi.hoisted(() => ({
  engine: null as unknown,
  place: null as unknown,
  hemisphere: "north" as "north" | "south",
  modules: { mood: true, habits: true, gym: true } as Record<string, boolean>,
  locate: vi.fn(),
  write: vi.fn(),
  clear: vi.fn(),
  riseSet: vi.fn(),
  auth: { user: { id: "u1" } } as { user: { id: string } | null },
}));

vi.mock("../auth/AuthContext", async (original) => ({
  ...(await original<typeof import("../auth/AuthContext")>()),
  useOptionalAuth: () => h.auth,
}));

vi.mock("../moon/engine", async (original) => ({
  ...(await original<typeof import("../moon/engine")>()),
  useMoonEngine: () => h.engine,
}));
vi.mock("../moon/hemisphere", () => ({ resolveHemisphere: () => h.hemisphere }));
vi.mock("../moon/location", async () => {
  const { useState } = await import("react");
  return {
    usePlace: () => useState(h.place),
    locateOnce: h.locate,
    writePlace: h.write,
    clearPlace: h.clear,
  };
});
vi.mock("../layout/modules", async (original) => ({
  ...(await original<typeof import("../layout/modules")>()),
  useModules: () => h.modules,
}));

const NOW = new Date(2026, 9, 3, 10, 0);

const fakeEngine = () => ({
  phaseAt: vi.fn((when: Date) => PHASES[when.getDate() % 8] ?? "new"),
  stateAt: vi.fn((when: Date) => {
    const index = when.getDate() % 8;
    const angle = index * 45;
    return {
      angle,
      illumination: (1 - Math.cos((angle * Math.PI) / 180)) / 2,
      ageDays: 10.4,
      phase: PHASES[index] ?? "new",
    };
  }),
  quartersBetween: (start: Date, end: Date) =>
    [
      { kind: "new" as const, at: new Date(2026, 9, 10, 6, 5) },
      { kind: "firstQuarter" as const, at: new Date(2026, 9, 18, 4, 12) },
      { kind: "full" as const, at: new Date(2026, 9, 26, 18, 47) },
      { kind: "lastQuarter" as const, at: new Date(2026, 10, 2, 9, 30) },
    ].filter((q) => q.at >= start && q.at < end),
  riseSet: h.riseSet,
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const requests: { url: string; body: string }[] = [];

function stubFetch() {
  requests.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, body: String(init?.body ?? "") });
      // The server answers for the month asked: all fixture rows are September's.
      if (new URL(url, "http://x").searchParams.get("month") !== "2026-09") {
        return json({ items: [] });
      }
      if (url.includes("/api/mood/days")) {
        return json({
          items: [{ on: "2026-09-12", mood: 5, day_ok: true, note: null }],
        });
      }
      if (url.includes("/api/habits/checkins")) {
        return json({
          items: [
            { id: "h1", habit_id: "a", habit_name: "Run", done_on: "2026-09-12", done_at: null, note: null },
            { id: "h2", habit_id: "b", habit_name: "Read", done_on: "2026-09-12", done_at: null, note: null },
          ],
        });
      }
      if (url.includes("/api/entries")) {
        return json({
          items: [
            { id: "e1", kind: "expense", amount: "12.50", occurred_on: "2026-09-12" },
            { id: "e2", kind: "income", amount: "900.00", occurred_on: "2026-09-12" },
          ],
        });
      }
      if (url.includes("/api/gym/workouts")) {
        return json({
          items: [
            { id: "w1", performed_on: "2026-09-12", rest_day: false },
            { id: "w2", performed_on: "2026-09-12", rest_day: true },
          ],
        });
      }
      return json({ items: [] });
    }),
  );
}

const open = () =>
  render(
    <MemoryRouter>
      <MoonPage />
    </MemoryRouter>,
  );

/** The cells of one phase row in one module's table. */
function row(module: string, phase: string): string[] {
  const tr = document.querySelector(`[data-module="${module}"] tr[data-phase="${phase}"]`);
  if (!tr) throw new Error(`no row ${module}/${phase}`);
  return [...tr.querySelectorAll("td")].map((td) => td.textContent ?? "");
}

const valueAfter = (term: string) => screen.getByText(term).nextElementSibling?.textContent;

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  h.engine = fakeEngine();
  h.auth = { user: { id: "u1" } };
  h.place = null;
  h.hemisphere = "north";
  h.modules = { mood: true, habits: true, gym: true };
  h.locate.mockReset();
  h.write.mockReset();
  h.write.mockImplementation((_id: string, p: { lat: number; lon: number; label: string | null }) => ({
    lat: Math.round(p.lat * 10) / 10,
    lon: Math.round(p.lon * 10) / 10,
    label: p.label,
  }));
  h.clear.mockReset();
  h.riseSet.mockReset();
  h.riseSet.mockReturnValue({ rise: new Date(2026, 9, 3, 14, 5), set: null });
  stubFetch();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the today block", () => {
  it("says nothing but a loading line while the engine has not arrived", () => {
    h.engine = null;
    open();
    expect(screen.getByText("Loading the moon…")).toBeInTheDocument();
    expect(screen.queryByTestId("moon-phase")).toBeNull();
    expect(screen.queryByText("Your days against the moon")).toBeNull();
  });

  it("shows the phase, how much is lit and the age", () => {
    open();
    expect(screen.getByTestId("moon-phase")).toHaveTextContent("Waxing gibbous");
    expect(screen.getByText("85% lit")).toBeInTheDocument();
    expect(screen.getByText("Age: 10.4 days")).toBeInTheDocument();
  });

  it("draws the glyph mirrored when the hemisphere is south", () => {
    h.hemisphere = "south";
    open();
    expect(document.querySelector(".moon-today svg")?.getAttribute("data-hemisphere")).toBe("south");
  });

  it("gives the next new and full moon with a local date and time", () => {
    open();
    expect(valueAfter("Next new moon")).toBe("Sat 10 October, 06:05");
    expect(valueAfter("Next full moon")).toBe("Mon 26 October, 18:47");
  });

  it("lists this month's quarters and no other month's", () => {
    open();
    const card = screen.getByRole("heading", { name: "This month’s quarters" }).closest("section");
    const items = within(card as HTMLElement).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      "New moonSat 10 October, 06:05",
      "First quarterSun 18 October, 04:12",
      "Full moonMon 26 October, 18:47",
    ]);
  });
});

describe("moonrise and moonset", () => {
  it("are not shown without a place, and the page says why", () => {
    open();
    expect(screen.queryByText("Moonrise")).toBeNull();
    expect(h.riseSet).not.toHaveBeenCalled();
    expect(screen.getByText(/No place set/)).toBeInTheDocument();
  });

  it("are shown for today at the place, 'none today' when the moon does not set", () => {
    h.place = { lat: 48.9, lon: 2.3, label: "Home" };
    open();
    expect(valueAfter("Moonrise")).toBe("14:05");
    expect(valueAfter("Moonset")).toBe("none today");
    expect(h.riseSet).toHaveBeenCalledWith(new Date(2026, 9, 3), 48.9, 2.3);
    expect(screen.queryByText(/No place set/)).toBeNull();
  });
});

describe("the place controls", () => {
  it("states the privacy promise", () => {
    open();
    expect(screen.getByText(/Stays on this device, rounded to about 10 km/)).toBeInTheDocument();
  });

  it("uses the device location and stores the rounded place", async () => {
    h.locate.mockResolvedValue({ lat: 48.9, lon: 2.4 });
    open();
    await userEvent.click(screen.getByRole("button", { name: "Use my location" }));
    expect(await screen.findByTestId("moon-place")).toHaveTextContent("Place: 48.9, 2.4");
    expect(h.write).toHaveBeenCalledWith(expect.any(String), { lat: 48.9, lon: 2.4, label: null });
    expect(valueAfter("Moonrise")).toBe("14:05");
  });

  it("explains a refused location and offers coordinates", async () => {
    h.locate.mockRejectedValue(new Error("denied"));
    open();
    await userEvent.click(screen.getByRole("button", { name: "Use my location" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Location was refused");
    expect(h.write).not.toHaveBeenCalled();
    expect(screen.queryByTestId("moon-place")).toBeNull();
  });

  it("saves typed coordinates with a label", async () => {
    open();
    await userEvent.click(screen.getByRole("button", { name: "Enter coordinates" }));
    await userEvent.type(screen.getByLabelText("Latitude"), "-33,87");
    await userEvent.type(screen.getByLabelText("Longitude"), "151.2");
    await userEvent.type(screen.getByLabelText("Name (optional)"), "Sydney");
    await userEvent.click(screen.getByRole("button", { name: "Save the place" }));
    expect(h.write).toHaveBeenCalledWith(expect.any(String), {
      lat: -33.87,
      lon: 151.2,
      label: "Sydney",
    });
    expect(await screen.findByTestId("moon-place")).toHaveTextContent("Place: Sydney, -33.9, 151.2");
  });

  it.each([
    ["91", "10"],
    ["10", "181"],
    ["abc", "10"],
    ["", "10"],
  ])("refuses latitude %j / longitude %j", async (la, lo) => {
    open();
    await userEvent.click(screen.getByRole("button", { name: "Enter coordinates" }));
    if (la) await userEvent.type(screen.getByLabelText("Latitude"), la);
    await userEvent.type(screen.getByLabelText("Longitude"), lo);
    await userEvent.click(screen.getByRole("button", { name: "Save the place" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Latitude must be between -90 and 90");
    expect(h.write).not.toHaveBeenCalled();
  });

  it("removes the place", async () => {
    h.place = { lat: 48.9, lon: 2.3, label: null };
    open();
    await userEvent.click(screen.getByRole("button", { name: "Remove the place" }));
    expect(h.clear).toHaveBeenCalled();
    expect(screen.queryByTestId("moon-place")).toBeNull();
    expect(screen.getByText(/No place set/)).toBeInTheDocument();
    expect(screen.queryByText("Moonrise")).toBeNull();
  });

  it("never puts the place in a request", async () => {
    h.locate.mockResolvedValue({ lat: 48.9, lon: 2.4 });
    open();
    await userEvent.click(screen.getByRole("button", { name: "Use my location" }));
    await userEvent.click(screen.getByRole("button", { name: "Enter coordinates" }));
    await userEvent.type(screen.getByLabelText("Latitude"), "48.8566");
    await userEvent.type(screen.getByLabelText("Longitude"), "2.3522");
    await userEvent.click(screen.getByRole("button", { name: "Save the place" }));
    await screen.findByText("Mean mood");
    expect(requests.length).toBeGreaterThan(0);
    for (const { url, body } of requests) {
      expect(url + body).not.toMatch(/48\.[89]|2\.[34]|lat|lon/i);
    }
  });
});

describe("your days against the moon", () => {
  it("says how many cycles and days the figures cover", async () => {
    open();
    expect(await screen.findByText("3 cycles · 89 days")).toBeInTheDocument();
  });

  it("asks only for the modules that are switched on", async () => {
    h.modules = { mood: false, habits: true, gym: false };
    open();
    await screen.findByText("Check-ins per day");
    const urls = requests.map((r) => r.url);
    expect(urls.some((u) => u.includes("/api/mood/days"))).toBe(false);
    expect(urls.some((u) => u.includes("/api/gym/workouts"))).toBe(false);
    expect(urls.some((u) => u.includes("/api/habits/checkins"))).toBe(true);
    expect(urls.some((u) => u.includes("/api/entries"))).toBe(true);
    expect(document.querySelector('[data-module="mood"]')).toBeNull();
    expect(document.querySelector('[data-module="gym"]')).toBeNull();
  });

  it("puts each day in the phase of its local noon, per module", async () => {
    open();
    await screen.findByText("Mean mood");
    // The 12th is a full-moon day; so are the 4th, 20th and 28th. 11 of them in 5 Jul - 2 Oct.
    expect(row("mood", "full")).toEqual(["Full moon", "11", "5.0"]);
    expect(row("mood", "waningGibbous")).toEqual(["Waning gibbous", "11", "–"]);
    expect(row("habits", "full")).toEqual(["Full moon", "11", (2 / 11).toFixed(2)]);
    // Expenses only (the income of the same day is not spent), in whole cents then money.
    expect(row("spending", "full")).toEqual(["Full moon", "11", "1.14"]);
    // A rest day is not a session.
    expect(row("gym", "full")).toEqual(["Full moon", "11", (1 / 11).toFixed(2)]);
    expect(row("gym", "new")[2]).toBe("0.00");
    expect(document.querySelectorAll('[data-module="mood"] tbody tr')).toHaveLength(8);
  });

  it("draws one chart per module with the phases behind it", async () => {
    open();
    await screen.findByText("Mean mood");
    expect(screen.getAllByRole("img", { name: /by day, with the moon phases behind/ })).toHaveLength(4);
    expect(document.querySelectorAll('.moon-lines [data-phase="full"]').length).toBeGreaterThan(0);
  });

  it("refetches over a longer window when the cycles are switched", async () => {
    open();
    await screen.findByText("3 cycles · 89 days");
    const before = requests.length;
    await userEvent.selectOptions(screen.getByLabelText("Window"), "6");
    expect(await screen.findByText("6 cycles · 178 days")).toBeInTheDocument();
    await waitFor(() => expect(requests.length).toBeGreaterThan(before));
    expect(requests.slice(before).some((r) => r.url.includes("month=2026-04"))).toBe(true);
    expect(requests.slice(0, before).some((r) => r.url.includes("month=2026-04"))).toBe(false);
  });

  it("uses no word that ranks or judges a difference", async () => {
    open();
    await screen.findByText("Mean mood");
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(
      /\b(higher|lower|better|worse|best|worst|more than|less than|significant|correlat|affects?|influence)/i,
    );
  });

  it("shows a load failure as the page's own sentence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500, headers: { "Content-Type": "application/json" } })),
    );
    open();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("Mean mood")).toBeNull();
  });
});

describe("one pass over the window", () => {
  it("asks the engine for each day's phase once, not once per module", async () => {
    open();
    await screen.findByText("Mean mood");
    const engine = h.engine as ReturnType<typeof fakeEngine>;
    expect(engine.phaseAt).toHaveBeenCalledTimes(89);
    const stamps = engine.phaseAt.mock.calls.map(([when]) => when.getTime());
    expect(new Set(stamps).size).toBe(89);
    // stateAt (with the age search) is only for today, never for a window day.
    for (const [when] of engine.stateAt.mock.calls) expect(when.getTime()).toBe(NOW.getTime());
  });
});

describe("a day is bucketed by its local noon", () => {
  const hourly = () => ({
    ...(fakeEngine() as object),
    // Only noon is "the day's phase"; any other hour of the day lands in "new".
    phaseAt: vi.fn((when: Date) => (when.getHours() === 12 ? (PHASES[when.getDate() % 8] ?? "new") : "new")),
  });

  it("asks at 12:00 local, so the full-moon days are the ones the noon phase names", async () => {
    h.engine = hourly();
    open();
    await screen.findByText("Mean mood");
    expect(row("mood", "full")[1]).toBe("11");
  });

  it("asks at 12:00 local on a 25-hour DST day too (Paris, 2025-10-26)", async () => {
    const zone = process.env.TZ;
    process.env.TZ = "Europe/Paris";
    try {
      vi.setSystemTime(new Date(2025, 9, 27, 10, 0));
      const engine = hourly();
      h.engine = engine;
      open();
      await screen.findByText("Mean mood");
      const dst = engine.phaseAt.mock.calls
        .map(([when]) => when)
        .filter((when) => when.getMonth() === 9 && when.getDate() === 26);
      expect(dst).toHaveLength(1);
      expect(dst[0]?.getHours()).toBe(12);
      expect(engine.phaseAt.mock.calls.every(([when]) => when.getHours() === 12)).toBe(true);
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });
});

describe("the age and the numbers, in the account's language", () => {
  const ageOf = (days: number) => {
    h.engine = {
      ...(fakeEngine() as object),
      stateAt: () => ({ angle: 90, illumination: 0.5, ageDays: days, phase: "firstQuarter" }),
    };
  };

  it("takes the singular at exactly one day in English", () => {
    ageOf(1.02);
    open();
    expect(screen.getByText("Age: 1 day")).toBeInTheDocument();
  });

  it("uses a decimal comma and the singular below two days in French", async () => {
    window.localStorage.setItem("everything-everywhere.language", "fr");
    ageOf(21.84);
    open();
    expect(screen.getByText("Âge : 21,8 jours")).toBeInTheDocument();
    cleanup();
    ageOf(1.02);
    open();
    expect(screen.getByText("Âge : 1 jour")).toBeInTheDocument();
  });

  it("formats the overlay figures and the place with the language's separator", async () => {
    window.localStorage.setItem("everything-everywhere.language", "fr");
    h.place = { lat: 48.9, lon: 2.3, label: null };
    open();
    expect(screen.getByTestId("moon-place")).toHaveTextContent("Lieu : 48,9, 2,3");
    await screen.findByText("Humeur moyenne");
    expect(row("mood", "full")[2]).toBe("5,0");
    expect(row("habits", "full")[2]).toBe((2 / 11).toFixed(2).replace(".", ","));
  });
});

describe("on a phone", () => {
  onAPhone();

  it("draws each module's phases as rows, not a table", async () => {
    open();
    await screen.findByText("Mean mood");
    expect(document.querySelector("[data-module] table")).toBeNull();
    const rows = document.querySelectorAll('[data-module="mood"] li[data-phase]');
    expect(rows).toHaveLength(8);
    const full = document.querySelector('[data-module="habits"] li[data-phase="full"]');
    expect(full).toHaveTextContent("Full moon");
    expect(full).toHaveTextContent("11 days");
    expect(full).toHaveTextContent((2 / 11).toFixed(2));
    expect(document.querySelector('[data-module="mood"] li[data-phase="waningGibbous"]')).toHaveTextContent("–");
  });
});

describe("with nobody signed in", () => {
  it("never reads or writes a place, and never asks the device for one", async () => {
    h.auth = { user: null };
    h.place = { lat: 48.9, lon: 2.3, label: null };
    open();
    await userEvent.click(screen.getByRole("button", { name: "Use my location" }));
    await userEvent.click(screen.getByRole("button", { name: "Enter coordinates" }));
    await userEvent.type(screen.getByLabelText("Latitude"), "10");
    await userEvent.type(screen.getByLabelText("Longitude"), "10");
    await userEvent.click(screen.getByRole("button", { name: "Save the place" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove the place" }));
    expect(h.locate).not.toHaveBeenCalled();
    expect(h.write).not.toHaveBeenCalled();
    expect(h.clear).not.toHaveBeenCalled();
  });
});

describe("the device location", () => {
  it("is asked for only when the button is pressed, never on mount", async () => {
    h.locate.mockResolvedValue({ lat: 48.9, lon: 2.4 });
    open();
    await screen.findByText("Mean mood");
    expect(h.locate).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Use my location" }));
    expect(h.locate).toHaveBeenCalledTimes(1);
  });
});

describe("in French", () => {
  it("renders the page in French", async () => {
    window.localStorage.setItem("everything-everywhere.language", "fr");
    open();
    expect(screen.getByRole("heading", { name: "Lune" })).toBeInTheDocument();
    expect(screen.getByTestId("moon-phase")).toHaveTextContent("Gibbeuse croissante");
    expect(screen.getByText("85 % éclairée")).toBeInTheDocument();
    expect(screen.getByText("Prochaine pleine lune")).toBeInTheDocument();
    expect(await screen.findByText("3 cycles · 89 jours")).toBeInTheDocument();
    expect(screen.getByText("Humeur moyenne")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Utiliser ma position" })).toBeInTheDocument();
    expect(screen.queryByText("Waxing gibbous")).toBeNull();
  });
});
