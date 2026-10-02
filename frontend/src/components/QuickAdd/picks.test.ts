import { describe, expect, it } from "vitest";

import type { Category, Combo, Pot, VendorPick } from "../../api/types";
import { comboLabel, dayBefore, defaultPot, vendorCategory } from "./picks";

const vendors: VendorPick[] = [
  { vendor_id: "v1", vendor_name: "Lidl", kind: "expense", category_id: "c1", category_name: "Groceries" },
  { vendor_id: "v2", vendor_name: "Acme", kind: "income", category_id: "c2", category_name: "Salary" },
];

describe("vendorCategory", () => {
  it("matches case-insensitively and trimmed", () => {
    expect(vendorCategory(vendors, "  lIDL ", "expense", "")).toBe("Groceries");
  });
  it("needs the same kind", () => {
    expect(vendorCategory(vendors, "Acme", "expense", "")).toBeNull();
    expect(vendorCategory(vendors, "Acme", "income", "")).toBe("Salary");
  });
  it("never overwrites a chosen category", () => {
    expect(vendorCategory(vendors, "Lidl", "expense", "Fuel")).toBeNull();
    expect(vendorCategory(vendors, "Lidl", "expense", "   ")).toBe("Groceries");
  });
  it("is null for an unknown or empty vendor", () => {
    expect(vendorCategory(vendors, "Nope", "expense", "")).toBeNull();
    expect(vendorCategory(vendors, "", "expense", "")).toBeNull();
  });
});

const categories: Category[] = [
  { id: "c1", kind: "expense", name: "Groceries", default_savings_type_id: "p1", created_at: "" },
  { id: "c2", kind: "income", name: "Salary", default_savings_type_id: "p1", created_at: "" },
  { id: "c3", kind: "expense", name: "Fuel", default_savings_type_id: "gone", created_at: "" },
  { id: "c4", kind: "expense", name: "Rent", created_at: "" },
];
const pots = [{ savings_type_id: "p1", name: "Holiday" }] as Pot[];

describe("defaultPot", () => {
  it("returns the expense category's pot, name matched loosely", () => {
    expect(defaultPot(categories, pots, " groceries ")).toBe("p1");
  });
  it("ignores income categories", () => {
    expect(defaultPot(categories, pots, "Salary")).toBe("");
  });
  it("drops a pot that no longer exists", () => {
    expect(defaultPot(categories, pots, "Fuel")).toBe("");
  });
  it("is empty without a default or a match", () => {
    expect(defaultPot(categories, pots, "Rent")).toBe("");
    expect(defaultPot(categories, pots, "Zzz")).toBe("");
  });
});

describe("comboLabel", () => {
  const fmt = (a: string) => `€${a}`;
  const base: Combo = {
    category_id: "c1",
    category_name: "Groceries",
    vendor_id: "v1",
    vendor_name: "Lidl",
    amount: "12.50",
  };
  it("joins category, vendor and amount", () => {
    expect(comboLabel(base, fmt)).toBe("Groceries · Lidl · €12.50");
  });
  it("drops a null vendor", () => {
    expect(comboLabel({ ...base, vendor_id: null, vendor_name: null }, fmt)).toBe(
      "Groceries · €12.50",
    );
  });
});

describe("dayBefore", () => {
  it("steps back a day", () => {
    expect(dayBefore("2026-10-02")).toBe("2026-10-01");
  });
  it("crosses month and year and leap days", () => {
    expect(dayBefore("2026-10-01")).toBe("2026-09-30");
    expect(dayBefore("2026-01-01")).toBe("2025-12-31");
    expect(dayBefore("2028-03-01")).toBe("2028-02-29");
  });
});
