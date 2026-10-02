import type { Category, Combo, EntryKind, Pot, VendorPick } from "../../api/types";

/**
 * Epic 44 (AD-60): the sheet's pure rules, tested without a DOM. Spec:
 * docs/epic-44-quick-add.md §4.
 */

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The category a typed vendor implies, or null. Only a vendor whose most recent entry is of
 * `kind`, matched case-insensitively and trimmed; and only when no category is chosen yet —
 * a chosen category is never overwritten.
 */
export function vendorCategory(
  vendors: VendorPick[],
  vendorName: string,
  kind: EntryKind,
  chosenCategory: string,
): string | null {
  if (chosenCategory.trim() !== "" || vendorName.trim() === "") return null;
  const pick = vendors.find((v) => v.kind === kind && same(v.vendor_name, vendorName));
  return pick ? pick.category_name : null;
}

/**
 * The default pot of the expense category this name resolves to, or "". A pot no longer in
 * `pots` (deleted since) is not offered. Same rule as EntriesPage's `defaultPotFor`.
 */
export function defaultPot(categories: Category[], pots: Pot[], categoryName: string): string {
  const category = categories.find((c) => c.kind === "expense" && same(c.name, categoryName));
  const pot = category?.default_savings_type_id;
  return pot && pots.some((p) => p.savings_type_id === pot) ? pot : "";
}

/**
 * A repeat chip's visible label: `Category · Vendor · amount`, the vendor dropped when null.
 * `formatAmount` is the page's money formatter, so the currency follows the account.
 */
export function comboLabel(combo: Combo, formatAmount: (amount: string) => string): string {
  const parts = [combo.category_name];
  if (combo.vendor_name) parts.push(combo.vendor_name);
  parts.push(formatAmount(combo.amount));
  return parts.join(" · ");
}

/** `YYYY-MM-DD` of the day before `iso`, local calendar arithmetic (no UTC shift). */
export function dayBefore(iso: string): string {
  const [year = 0, month = 1, day = 1] = iso.split("-").map(Number);
  // Local calendar arithmetic: Date normalises day 0 to the previous month's last day.
  const date = new Date(year, month - 1, day - 1);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${mm}-${dd}`;
}
