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
  void vendors;
  void vendorName;
  void kind;
  void chosenCategory;
  void same;
  throw new Error("not built");
}

/**
 * The default pot of the expense category this name resolves to, or "". A pot no longer in
 * `pots` (deleted since) is not offered. Same rule as EntriesPage's `defaultPotFor`.
 */
export function defaultPot(categories: Category[], pots: Pot[], categoryName: string): string {
  void categories;
  void pots;
  void categoryName;
  throw new Error("not built");
}

/**
 * A repeat chip's visible label: `Category · Vendor · amount`, the vendor dropped when null.
 * `formatAmount` is the page's money formatter, so the currency follows the account.
 */
export function comboLabel(combo: Combo, formatAmount: (amount: string) => string): string {
  void combo;
  void formatAmount;
  throw new Error("not built");
}

/** `YYYY-MM-DD` of the day before `iso`, local calendar arithmetic (no UTC shift). */
export function dayBefore(iso: string): string {
  void iso;
  throw new Error("not built");
}
