import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { LanguageProvider } from "../i18n";
import { NameSuggest, fold, suggest } from "./NameSuggest";

const NAMES = ["Café Roma", "Lidl", "Aldi", "Shell", "Super U", "Carrefour", "Casino", "Leclerc"];

function Harness({ names = NAMES }: { names?: string[] }) {
  const [value, setValue] = useState("");
  return (
    <LanguageProvider>
      <NameSuggest ariaLabel="Vendor" value={value} onChange={setValue} names={names} />
    </LanguageProvider>
  );
}

const chipNames = () =>
  within(screen.getByRole("group", { name: "Suggestions" }))
    .getAllByRole("button")
    .map((b) => b.textContent);

describe("suggest", () => {
  it("folds case and accents", () => {
    expect(fold("  CAFÉ ")).toBe("cafe");
  });

  it("matches the start of the name or of any word, accent- and case-insensitively", () => {
    expect(suggest(NAMES, "cafe")).toEqual(["Café Roma"]);
    expect(suggest(NAMES, "ROMA")).toEqual(["Café Roma"]);
    expect(suggest(NAMES, "u")).toEqual(["Super U"]);
    expect(suggest(NAMES, "ca")).toEqual(["Café Roma", "Carrefour", "Casino"]);
  });

  it("returns the first six for empty input, drops an exact match and duplicates", () => {
    expect(suggest(NAMES, "")).toHaveLength(6);
    expect(suggest(["Shell", "shell", "Shelly"], "shell")).toEqual(["Shelly"]);
    expect(suggest(["a", "A", "b"], "")).toEqual(["a", "b"]);
  });
});

describe("NameSuggest", () => {
  it("shows chips only once focused or filled, and filters as you type", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByRole("group", { name: "Suggestions" })).toBeNull();
    await user.click(screen.getByLabelText("Vendor"));
    expect(chipNames()).toEqual(["Café Roma", "Lidl", "Aldi", "Shell", "Super U", "Carrefour"]);
    await user.type(screen.getByLabelText("Vendor"), "l");
    expect(chipNames()).toEqual(["Lidl", "Leclerc"]);
  });

  it("lets a name that matches nothing be typed, with no chips", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText("Vendor"), "Zzz Bakery");
    expect(screen.getByLabelText("Vendor")).toHaveValue("Zzz Bakery");
    expect(screen.queryByRole("group", { name: "Suggestions" })).toBeNull();
  });

  it("a chip fills the input and keeps focus", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByLabelText("Vendor"));
    await user.click(screen.getByRole("button", { name: "Aldi" }));
    expect(screen.getByLabelText("Vendor")).toHaveValue("Aldi");
    expect(screen.getByLabelText("Vendor")).toHaveFocus();
  });

  it("Escape hides the chips; typing brings them back", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByLabelText("Vendor"));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "Suggestions" })).toBeNull();
    await user.keyboard("s");
    expect(chipNames()).toEqual(["Shell", "Super U"]);
  });
});

describe("maxLength", () => {
  it("is passed to the input", () => {
    render(
      <LanguageProvider>
        <NameSuggest ariaLabel="Vendor" value="" onChange={() => {}} names={NAMES} maxLength={80} />
      </LanguageProvider>,
    );
    expect(screen.getByLabelText("Vendor")).toHaveAttribute("maxlength", "80");
  });
});

describe("no native datalist on any name field", () => {
  for (const file of [
    "pages/EntriesPage.tsx",
    "components/QuickAdd/QuickAddSheet.tsx",
    "components/RecurringCard.tsx",
    "components/ShoppingList.tsx",
    "pages/BooksPage.tsx",
    "pages/gym/ExerciseAdder.tsx",
    "pages/InventoryPage.tsx",
  ]) {
    it(file, () => {
      const source = readFileSync(join(process.cwd(), "src", file), "utf8");
      expect(source).not.toMatch(/<datalist|\blist=/);
    });
  }
});
