import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { ModuleId } from "../../api/types";
import { LanguageProvider } from "../../i18n";
import { DEFAULT_PREFERENCES } from "../../layout/preferences";
import { navModel } from "../../nav/model";
import { BottomBar } from "./BottomBar";

const ALL_ON = new Proxy({}, { get: () => true }) as Record<ModuleId, boolean>;

function renderBar(pathname: string, onMore = vi.fn(), moreOpen = false) {
  const model = navModel(DEFAULT_PREFERENCES.phone, ALL_ON);
  render(
    <LanguageProvider>
      <MemoryRouter initialEntries={[pathname]}>
        <BottomBar model={model} pathname={pathname} moreOpen={moreOpen} onMore={onMore} />
      </MemoryRouter>
    </LanguageProvider>,
  );
  return { onMore };
}

const bar = () => screen.getByRole("navigation", { name: "Sections" });
const more = () => within(bar()).getByRole("button", { name: "More" });

describe("BottomBar", () => {
  it("is the four pinned places then More, named Sections", () => {
    renderBar("/");
    expect(within(bar()).getAllByRole("link").map((a) => a.textContent)).toEqual([
      "◪Dashboard",
      "≡Entries",
      "✓Habits",
      "◫Plan",
    ]);
    expect(more()).toBeTruthy();
  });

  it("lights the pinned place the page is in, and not More", () => {
    renderBar("/entries");
    expect(within(bar()).getByRole("link", { name: /Entries/ }).classList.contains("on")).toBe(true);
    expect(more().classList.contains("on")).toBe(false);
  });

  it("lights More when the page is a drawer place, including a path under it", () => {
    renderBar("/notes/abc");
    expect(more().classList.contains("on")).toBe(true);
    expect(within(bar()).getByRole("link", { name: /Dashboard/ }).classList.contains("on")).toBe(false);
  });

  it("lights More on Settings too: the drawer holds it", () => {
    renderBar("/settings");
    expect(more().classList.contains("on")).toBe(true);
    expect(more().getAttribute("aria-current")).toBe("true");
  });

  it("says aria-current=page on a tab lit by a path under its place, not only on an exact match", () => {
    renderBar("/categories/abc");
    const entries = within(bar()).getByRole("link", { name: /Entries/ });
    expect(entries.classList.contains("on")).toBe(true);
    expect(entries.getAttribute("aria-current")).toBe("page");
    expect(within(bar()).getByRole("link", { name: /Dashboard/ }).getAttribute("aria-current")).toBeNull();
    expect(more().getAttribute("aria-current")).toBeNull();
  });

  it("gives More aria-current when the page is a drawer place", () => {
    renderBar("/notes/abc");
    expect(more().getAttribute("aria-current")).toBe("true");
  });

  it("opens the drawer and reports whether it is open", () => {
    const { onMore } = renderBar("/");
    fireEvent.click(more());
    expect(onMore).toHaveBeenCalledTimes(1);
    expect(more().getAttribute("aria-haspopup")).toBe("dialog");
  });
});
