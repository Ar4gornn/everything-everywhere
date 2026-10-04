import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LanguageProvider } from "../i18n";
import { VideoLink } from "./VideoLink";

const YT = "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s";

function show(url: string, label?: string) {
  return render(
    <LanguageProvider>
      <VideoLink url={url} label={label} />
    </LanguageProvider>,
  );
}

describe("VideoLink", () => {
  it("loads no iframe before the tap", () => {
    const { container } = show(YT);
    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.getByRole("button", { name: /watch|regarder/i })).toBeTruthy();
  });

  it("opens the nocookie player with the start offset", () => {
    const { container } = show(YT);
    fireEvent.click(screen.getByRole("button", { name: /watch|regarder/i }));
    const frame = container.querySelector("iframe");
    expect(frame?.getAttribute("src")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?playsinline=1&rel=0&start=90",
    );
    expect(frame?.getAttribute("title")).toBeTruthy();
    expect(frame?.getAttribute("allow")).toBe("encrypted-media; picture-in-picture; fullscreen");
    expect(frame?.getAttribute("referrerpolicy")).toBe("strict-origin-when-cross-origin");
    expect(frame?.getAttribute("loading")).toBe("lazy");
    const ext = screen.getByRole("link", { name: /youtube/i });
    expect(ext.getAttribute("href")).toBe(YT);
    expect(ext.getAttribute("rel")).toBe("noopener noreferrer");
    expect(ext.getAttribute("target")).toBe("_blank");
  });

  it("omits start when the link has none", () => {
    const { container } = show("https://youtu.be/dQw4w9WgXcQ");
    fireEvent.click(screen.getByRole("button", { name: /watch|regarder/i }));
    expect(container.querySelector("iframe")?.getAttribute("src")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?playsinline=1&rel=0",
    );
  });

  it("closes and returns focus to Watch", async () => {
    const { container } = show(YT);
    fireEvent.click(screen.getByRole("button", { name: /watch|regarder/i }));
    fireEvent.click(screen.getByRole("button", { name: /close|fermer/i }));
    expect(container.querySelector("iframe")).toBeNull();
    const watch = screen.getByRole("button", { name: /watch|regarder/i });
    await waitFor(() => expect(document.activeElement).toBe(watch));
  });

  it("renders a non-YouTube https link as a plain external link", () => {
    const { container } = show("https://example.com/squat", "video");
    const a = screen.getByRole("link", { name: "video" });
    expect(a.getAttribute("href")).toBe("https://example.com/squat");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("does not treat a lookalike host as YouTube", () => {
    const { container } = show("https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ");
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("a")).not.toBeNull();
  });

  it.each(["javascript:alert(1)", "http://example.com/x", "not a url", ""])(
    "renders nothing for %s",
    (url) => {
      const { container } = show(url);
      expect(container.innerHTML).toBe("");
    },
  );
});
