import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { Stepper } from "./MeasureInput";

function Harness({ start }: { start: number | null }) {
  const [value, setValue] = useState<number | null>(start);
  return <Stepper label="Reps" value={value} step={5} field="reps" onChange={setValue} />;
}

describe("Stepper keeps to the server's cap", () => {
  it("+ stops at 999 and typing past it holds at 999", async () => {
    render(<Harness start={998} />);
    const input = screen.getByRole("textbox", { name: "Reps" }) as HTMLInputElement;
    const more = screen.getByRole("button", { name: "Increase Reps" });
    await userEvent.click(more);
    expect(input.value).toBe("999");
    expect(more).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, "5000");
    expect(input.value).toBe("999");
  });
});
