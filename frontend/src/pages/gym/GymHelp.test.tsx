import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { translator } from "../../i18n";
import { GymHelp } from "./GymHelp";

const en = translator("en");

afterEach(() => vi.restoreAllMocks());

describe("GymHelp", () => {
  it("is closed until asked, then shows every section", () => {
    render(<GymHelp />);
    expect(screen.queryByRole("heading", { name: en("gym.help.title") })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: en("gym.help.open") }));

    const dialog = screen.getByRole("dialog", { name: en("gym.help.title") });
    expect(dialog).toHaveAttribute("open");
    for (const key of [
      "gym.help.startTitle",
      "gym.help.sessionTitle",
      "gym.help.kindsTitle",
      "gym.help.routinesTitle",
      "gym.help.importTitle",
      "gym.help.offlineTitle",
    ] as const) {
      expect(screen.getByRole("heading", { name: en(key) })).toBeInTheDocument();
    }
    expect(screen.getByText(en("gym.help.import2"))).toBeInTheDocument();
  });

  it("closes from its button and from the backdrop, not from a tap on its content", () => {
    render(<GymHelp />);
    const open = screen.getByRole("button", { name: en("gym.help.open") });

    fireEvent.click(open);
    fireEvent.click(screen.getByText(en("gym.help.session2")));
    expect(screen.getByRole("dialog")).toHaveAttribute("open");

    fireEvent.click(screen.getByRole("button", { name: en("gym.help.close") }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(open);
    // The backdrop is the dialog element itself.
    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("uses the browser's modal dialog when there is one", () => {
    const showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: showModal,
    });
    try {
      render(<GymHelp />);
      fireEvent.click(screen.getByRole("button", { name: en("gym.help.open") }));
      expect(showModal).toHaveBeenCalledTimes(1);
    } finally {
      delete (HTMLDialogElement.prototype as { showModal?: unknown }).showModal;
    }
  });
});
