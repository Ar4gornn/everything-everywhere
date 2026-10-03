import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ModuleId } from "../../api/types";
import { LanguageProvider } from "../../i18n";
import { DEFAULT_PREFERENCES } from "../../layout/preferences";
import { navModel } from "../../nav/model";
import { BottomBar } from "./BottomBar";
import { NavDrawer } from "./NavDrawer";

const hints = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
  options: [] as unknown[],
}));
vi.mock("../../nav/hints", () => ({
  useNavHints: (options?: unknown) => {
    hints.options.push(options);
    return hints.value;
  },
}));

const ALL_ON = new Proxy({}, { get: () => true }) as Record<ModuleId, boolean>;

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function Shell({ modules }: { modules: Record<ModuleId, boolean> }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const model = navModel(DEFAULT_PREFERENCES.phone, modules);
  return (
    <>
      <Where />
      <BottomBar model={model} pathname={pathname} moreOpen={open} onMore={() => setOpen(true)} />
      <NavDrawer model={model} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function renderShell(path = "/", modules: Record<ModuleId, boolean> = ALL_ON) {
  return render(
    <LanguageProvider>
      <MemoryRouter initialEntries={[path]}>
        <Shell modules={modules} />
      </MemoryRouter>
    </LanguageProvider>,
  );
}

const more = () => screen.getByRole("button", { name: "More" });
const drawer = () => screen.getByRole("dialog", { name: "All places" });
const openDrawer = () => fireEvent.click(more());

describe("NavDrawer", () => {
  beforeEach(() => {
    hints.value = {};
    hints.options.length = 0;
  });

  it("is closed until More is pressed, and More says it opens a dialog", () => {
    renderShell();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(more().getAttribute("aria-haspopup")).toBe("dialog");
    expect(more().getAttribute("aria-expanded")).toBe("false");
    openDrawer();
    expect(more().getAttribute("aria-expanded")).toBe("true");
    expect(drawer().hasAttribute("open")).toBe(true);
  });

  it("lists every place not in the bar under its group, then Settings last", () => {
    renderShell();
    openDrawer();
    const groups = within(drawer())
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);
    expect(groups).toEqual(["Daily", "Money", "Home & body", "Tools"]);
    const daily = within(drawer()).getByRole("region", { name: "Daily" });
    expect(within(daily).getAllByRole("link").map((a) => a.textContent)).toEqual([
      "▦Calendar",
      "▥Books",
      "✎Notes",
    ]);
    // Pinned places are in the bar, not repeated here.
    expect(within(drawer()).queryByRole("link", { name: /Dashboard/ })).toBeNull();
    // Settings is the last tile; "Change what's in the bar" follows it as a plain link.
    const links = within(drawer()).getAllByRole("link");
    expect(links[links.length - 2]?.getAttribute("href")).toBe("/settings");
    expect(links[links.length - 2]).toHaveTextContent("Settings");
    expect(links[links.length - 1]?.getAttribute("href")).toBe("/settings#layout");
  });

  it("shows each tile's hint and asks for the moon only while open", () => {
    hints.value = { clocks: { text: "Mum 06:00" }, plan: { text: "9 days left" } };
    renderShell();
    expect(hints.options).toEqual([]);
    openDrawer();
    expect(within(drawer()).getByRole("link", { name: /Clocks/ })).toHaveTextContent("Mum 06:00");
    expect(within(drawer()).getByRole("link", { name: /Grow/ })).not.toHaveTextContent("left");
    expect(hints.options.at(-1)).toEqual({ moon: true });
  });

  it("goes to the place and closes when a tile is tapped", () => {
    renderShell();
    openDrawer();
    fireEvent.click(within(drawer()).getByRole("link", { name: /Clocks/ }));
    expect(screen.getByTestId("where").textContent).toBe("/clocks");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(more().getAttribute("aria-expanded")).toBe("false");
  });

  it("closes on Escape and gives focus back to More", () => {
    renderShell();
    openDrawer();
    fireEvent(drawer(), new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(more());
  });

  it("closes from the close button and from a tap on the backdrop, not on the sheet", () => {
    renderShell();
    openDrawer();
    fireEvent.click(within(drawer()).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(more());

    openDrawer();
    fireEvent.click(within(drawer()).getByRole("heading", { name: "All places" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(drawer());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("marks the current place, including a path under it", () => {
    renderShell("/projections");
    openDrawer();
    expect(within(drawer()).getByRole("link", { name: /Grow/ }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(
      within(drawer()).getByRole("link", { name: /Calendar/ }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("marks Settings when the page is Settings", () => {
    renderShell("/settings");
    openDrawer();
    expect(
      within(drawer()).getByRole("link", { name: /Settings/ }).getAttribute("aria-current"),
    ).toBe("page");
  });

  it("leaves out a place whose module is off, and a group left empty", () => {
    const off = new Proxy({}, { get: (_t, k) => k !== "clocks" && k !== "moon" }) as Record<
      ModuleId,
      boolean
    >;
    renderShell("/", off);
    openDrawer();
    expect(within(drawer()).queryByRole("link", { name: /Clocks/ })).toBeNull();
    expect(within(drawer()).queryByRole("heading", { name: "Tools" })).toBeNull();
    expect(within(drawer()).getByRole("link", { name: /Recipes/ })).toBeTruthy();
  });

  it("reads in French", () => {
    window.localStorage.setItem("everything-everywhere.language", "fr");
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Plus" }));
    const sheet = screen.getByRole("dialog", { name: "Toutes les rubriques" });
    expect(within(sheet).getByRole("heading", { name: "Maison et forme" })).toBeTruthy();
    expect(within(sheet).getByRole("link", { name: /Réglages/ })).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: "Fermer" })).toBeTruthy();
    expect(within(sheet).getByRole("link", { name: "Modifier la barre" })).toBeTruthy();
  });

  it("ends with a link to the bar's editor, which closes the drawer", () => {
    renderShell();
    openDrawer();
    const link = within(drawer()).getByRole("link", { name: "Change what's in the bar" });
    expect(link.getAttribute("href")).toBe("/settings#layout");
    const all = within(drawer()).getAllByRole("link");
    expect(all[all.length - 1]).toBe(link);
    fireEvent.click(link);
    expect(screen.getByTestId("where").textContent).toBe("/settings");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("draws the moon's hint with the app's glyph", () => {
    hints.value = {
      moon: {
        text: "54% lit",
        moon: { phase: "waxingGibbous", angle: 120, illumination: 0.54, hemisphere: "north" },
      },
    };
    renderShell();
    openDrawer();
    const tile = within(drawer()).getByRole("link", { name: /Moon/ });
    expect(tile.querySelector("svg.moon-glyph")?.getAttribute("data-hemisphere")).toBe("north");
    expect(tile).toHaveTextContent("54% lit");
  });
});
