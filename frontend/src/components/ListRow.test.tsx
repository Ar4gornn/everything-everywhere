import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ListRow, useOpenRow } from "./ListRow";

function List() {
  const [open, toggle] = useOpenRow();
  return (
    <ul>
      {["a", "b"].map((id) => (
        <ListRow
          key={id}
          title={`Row ${id}`}
          amount="1.00"
          open={open === id}
          onToggle={() => toggle(id)}
          details={<p>Details {id}</p>}
        />
      ))}
    </ul>
  );
}

describe("ListRow (AD-53)", () => {
  it("is not a button when it has nothing to open", () => {
    render(
      <ul>
        <ListRow title="Holidays" amount="400.00" />
      </ul>,
    );
    expect(screen.getByText("Holidays")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("opens in place, says so, and points at what it opened", async () => {
    const user = userEvent.setup();
    render(<List />);

    const head = screen.getByRole("button", { name: /Row a/ });
    expect(head).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Details a")).toBeNull();

    await user.click(head);
    expect(head).toHaveAttribute("aria-expanded", "true");
    const details = screen.getByText("Details a").parentElement as HTMLElement;
    expect(head).toHaveAttribute("aria-controls", details.id);
  });

  it("keeps one row open per list, and closes the open one on a second tap", async () => {
    const user = userEvent.setup();
    render(<List />);

    await user.click(screen.getByRole("button", { name: /Row a/ }));
    await user.click(screen.getByRole("button", { name: /Row b/ }));
    expect(screen.queryByText("Details a")).toBeNull();
    expect(screen.getByText("Details b")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Row b/ }));
    expect(screen.queryByText("Details b")).toBeNull();
  });

  it("opens from the keyboard", async () => {
    const user = userEvent.setup();
    render(<List />);

    await user.tab();
    expect(screen.getByRole("button", { name: /Row a/ })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByText("Details a")).toBeInTheDocument();
    await user.tab();
    await user.keyboard(" ");
    expect(screen.getByText("Details b")).toBeInTheDocument();
  });
});

describe("ListRow trailing action (Story 38.2)", () => {
  it("sits beside the head, not inside it, and works without opening the row", async () => {
    const user = userEvent.setup();
    const bought: string[] = [];
    render(
      <ul>
        <ListRow
          title="Milk"
          details={<p>Inputs</p>}
          trailing={
            <button type="button" onClick={() => bought.push("milk")}>
              Bought
            </button>
          }
        />
      </ul>,
    );

    const head = screen.getByRole("button", { name: /Milk/ });
    const action = screen.getByRole("button", { name: "Bought" });
    expect(head.contains(action)).toBe(false);
    await user.click(action);
    expect(bought).toEqual(["milk"]);
    expect(head).toHaveAttribute("aria-expanded", "false");
  });
});
