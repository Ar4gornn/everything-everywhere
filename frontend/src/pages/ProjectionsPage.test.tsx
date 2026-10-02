import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { onAPhone } from "../test/phone";
import { ProjectionsPage } from "./ProjectionsPage";

describe("ProjectionsPage year by year on a phone (Story 38.2)", () => {
  onAPhone();

  it("draws a row per year with its balance, and what was paid in and earned on opening", async () => {
    const user = userEvent.setup();
    render(<ProjectionsPage />);

    const rows = screen.getByRole("list", { name: "Year by year" });
    expect(screen.queryByRole("table", { name: "Year by year" })).toBeNull();
    const heads = within(rows).getAllByRole("button");
    expect(heads).toHaveLength(10);
    expect(heads[0]).toHaveTextContent(/^Year 1/);
    expect(heads[9]).toHaveTextContent(/^Year 10/);

    expect(within(rows).queryByText(/Paid in/)).toBeNull();
    await user.click(heads[0] as HTMLElement);
    expect(within(rows).getByText(/Paid in .* · Interest /)).toBeInTheDocument();
  });
});
