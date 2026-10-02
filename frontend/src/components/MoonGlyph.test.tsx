import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PHASES } from "../moon/engine";
import { MoonGlyph, litPath } from "./MoonGlyph";

const NAMES: Record<(typeof PHASES)[number], string> = {
  new: "New moon",
  waxingCrescent: "Waxing crescent",
  firstQuarter: "First quarter",
  waxingGibbous: "Waxing gibbous",
  full: "Full moon",
  waningGibbous: "Waning gibbous",
  lastQuarter: "Last quarter",
  waningCrescent: "Waning crescent",
};

describe("MoonGlyph", () => {
  it("is an image named by the translated phase, for every phase", () => {
    PHASES.forEach((phase, index) => {
      const { unmount } = render(<MoonGlyph phase={phase} angle={index * 45} />);
      expect(screen.getByRole("img", { name: NAMES[phase] })).toBeInTheDocument();
      unmount();
    });
  });

  it("adds how much is lit to the label when it is given", () => {
    render(<MoonGlyph phase="waxingGibbous" angle={135} illumination={0.854} />);
    expect(screen.getByRole("img", { name: "Waxing gibbous, 85% lit" })).toBeInTheDocument();
  });

  it("lights the right in the north while waxing and the left while waning", () => {
    const { rerender } = render(<MoonGlyph phase="firstQuarter" angle={90} />);
    expect(screen.getByRole("img").getAttribute("data-lit-side")).toBe("right");
    rerender(<MoonGlyph phase="lastQuarter" angle={270} />);
    expect(screen.getByRole("img").getAttribute("data-lit-side")).toBe("left");
  });

  it("mirrors the drawing in the south, and the phase stays the same", () => {
    const { container, rerender } = render(
      <MoonGlyph phase="firstQuarter" angle={90} hemisphere="north" />,
    );
    const lit = () => container.querySelector("path");
    expect(lit()?.getAttribute("transform")).toBeNull();
    rerender(<MoonGlyph phase="firstQuarter" angle={90} hemisphere="south" />);
    expect(lit()?.getAttribute("transform")).toContain("scale(-1 1)");
    expect(screen.getByRole("img").getAttribute("data-lit-side")).toBe("left");
    expect(screen.getByRole("img", { name: "First quarter" })).toBeInTheDocument();
  });

  it("is hidden from assistive tech when decorative", () => {
    const { container } = render(<MoonGlyph phase="full" angle={180} decorative />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("draws the terminator at |cos| of the radius: flat at a quarter, round at new and full", () => {
    expect(litPath(90).d).toContain("A 0.00 46");
    expect(litPath(0).d).toContain("A 46.00 46");
    expect(litPath(180).d).toContain("A 46.00 46");
  });

  it("bulges the terminator toward the dark side: crescents thin, gibbous fat", () => {
    // [angle, terminator sweep flag]: right (0) for a waxing crescent and a waning gibbous.
    const sweeps: [number, string][] = [
      [45, "0"],
      [135, "1"],
      [225, "0"],
      [315, "1"],
    ];
    for (const [angle, flag] of sweeps) {
      expect(litPath(angle).d, `angle ${angle}`).toMatch(
        new RegExp(String.raw`A [\d.]+ 46 0 0 ${flag} 50 4 Z$`),
      );
    }
    expect(litPath(45).d).toContain("0 0 1 50 96 A");
    expect(litPath(225).d).toContain("0 0 0 50 96 A");
  });

  it("uses currentColor only", () => {
    const { container } = render(<MoonGlyph phase="full" angle={180} size={14} />);
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,6}|rgb\(/i);
    expect(container.querySelector("svg")?.getAttribute("width")).toBe("14");
  });
});
