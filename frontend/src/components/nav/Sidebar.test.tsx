import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ModuleId } from "../../api/types";
import { DEFAULT_PREFERENCES } from "../../layout/preferences";
import { navModel } from "../../nav/model";
import { ThemeProvider } from "../../theme";
import { Sidebar } from "./Sidebar";

const hints = vi.hoisted(() => ({ value: {} as Record<string, string> }));
vi.mock("../../nav/hints", () => ({ useNavHints: () => hints.value }));

const ALL_ON = new Proxy({}, { get: () => true }) as Record<ModuleId, boolean>;

function renderSidebar(pathname: string, modules: Record<ModuleId, boolean> = ALL_ON) {
  const model = navModel(DEFAULT_PREFERENCES.desktop, modules);
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[pathname]}>
        <Sidebar model={model} pathname={pathname} />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

const sidebar = () => screen.getByRole("navigation", { name: "All places" });
const labels = () => within(sidebar()).getAllByRole("link").map((a) => a.textContent ?? "");

describe("Sidebar", () => {
  beforeEach(() => {
    hints.value = {};
  });

  it("draws the groups in order with their places", () => {
    renderSidebar("/");
    const headings = within(sidebar())
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    expect(headings).toEqual(["Daily", "Money", "Home & body", "Tools"]);
    const text = labels().join("|");
    expect(text.indexOf("Dashboard")).toBeLessThan(text.indexOf("Entries"));
    expect(text.indexOf("Entries")).toBeLessThan(text.indexOf("Stock"));
    expect(text.indexOf("Stock")).toBeLessThan(text.indexOf("Clocks"));
  });

  it("hides a place whose module is off, and its empty group", () => {
    const off = new Proxy({}, { get: (_t, k) => k !== "clocks" && k !== "moon" }) as Record<
      ModuleId,
      boolean
    >;
    renderSidebar("/", off);
    expect(within(sidebar()).queryByRole("link", { name: /Clocks/ })).toBeNull();
    expect(within(sidebar()).queryByRole("heading", { name: "Tools" })).toBeNull();
    expect(within(sidebar()).getByRole("link", { name: /Dashboard/ })).toBeTruthy();
  });

  it("marks only the current place, including a path under it", () => {
    renderSidebar("/categories/abc");
    const current = within(sidebar())
      .getAllByRole("link")
      .filter((a) => a.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toContain("Entries");
    expect(current[0]?.className).toContain("on");
  });

  it("puts Settings last, marked on /settings", () => {
    renderSidebar("/settings");
    const links = within(sidebar()).getAllByRole("link");
    const last = links[links.length - 1];
    expect(last?.textContent).toContain("Settings");
    expect(last?.getAttribute("aria-current")).toBe("page");
    expect(within(sidebar()).getByRole("button", { name: /theme/ })).toBeTruthy();
  });

  it("shows a hint next to its place, and none for the others", () => {
    hints.value = { clocks: "Paris 14:05" };
    renderSidebar("/");
    expect(within(sidebar()).getByRole("link", { name: /Clocks/ }).textContent).toContain(
      "Paris 14:05",
    );
    expect(within(sidebar()).getByRole("link", { name: /Dashboard/ }).textContent).toBe(
      "◪Dashboard",
    );
  });
});
