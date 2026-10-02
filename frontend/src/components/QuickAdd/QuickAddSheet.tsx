import { useEffect, useRef, useState, type FormEvent } from "react";

import { api } from "../../api/client";
import {
  UNITS,
  type Category,
  type EntryKind,
  type Pot,
  type QuickPicks,
  type Unit,
  type Vendor,
} from "../../api/types";
import { errorMessage } from "../../i18n/errors";
import { useT } from "../../i18n";
import { isPositiveMoney, normalizeMoney } from "../../money";
import { todayIso } from "../../months";
import {
  isQuantity,
  isRate,
  recallUnit,
  rememberUnit,
  solveAmount,
  solveQuantity,
  solveRate,
  unitLabel,
} from "../../quantity";
import { useMoney } from "../../useMoney";
import { useToast } from "../Toast";
import { useTutorial } from "../Tutorial/useTutorial";
import { ErrorBanner } from "../ui";
import { comboLabel, dayBefore, defaultPot, vendorCategory } from "./picks";
import { useQuickAdd } from "./QuickAddContext";

/**
 * Epic 44 (AD-60): the phone's bottom sheet for adding an entry — a native `<dialog>` opened
 * with `showModal()`, so the top layer, the inert page, Escape and focus containment are the
 * browser's. Mounted once by `App`, phone layout only. Spec: docs/epic-44-quick-add.md §4.
 *
 * Contract for the wiring (App): render `<QuickAddSheet />` inside `QuickAddProvider`,
 * `ToastProvider` and `TutorialProvider`; it reads everything else from context.
 */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const NO_CATEGORIES: Category[] = [];
const NO_VENDORS: Vendor[] = [];
const NO_POTS: Pot[] = [];

export function QuickAddSheet() {
  const { isOpen, options, close, bump } = useQuickAdd();
  const t = useT();
  const money = useMoney();
  const toast = useToast();
  const tour = useTutorial();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  // Bumped on every open and every close, so an answer that lands after the sheet moved on
  // (closed, or opened again) is dropped rather than painted over the new one.
  const generation = useRef(0);

  const [kind, setKind] = useState<EntryKind>("expense");
  const [amount, setAmount] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [otherOpen, setOtherOpen] = useState(false);
  const [date, setDate] = useState(todayIso);
  const [dateOpen, setDateOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [vendorName, setVendorName] = useState("");
  const [note, setNote] = useState("");
  const [potId, setPotId] = useState("");
  const [potChosen, setPotChosen] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState<Unit | "">("");
  const [rate, setRate] = useState("");
  const [showQuantity, setShowQuantity] = useState(false);
  const [unitDismissed, setUnitDismissed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [picks, setPicks] = useState<QuickPicks | null>(null);
  const [categories, setCategories] = useState<Category[]>(NO_CATEGORIES);
  const [vendors, setVendors] = useState<Vendor[]>(NO_VENDORS);
  const [pots, setPots] = useState<Pot[]>(NO_POTS);
  const [picksFailed, setPicksFailed] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!isOpen) {
      if (dialog?.open) dialog.close();
      return;
    }
    const mine = ++generation.current;
    if (dialog && !dialog.open) dialog.showModal();

    const start =
      options.date && ISO_DAY.test(options.date) ? options.date : todayIso();
    setKind("expense");
    setAmount("");
    setCategoryName("");
    setOtherOpen(false);
    setDate(start);
    setDateOpen(start !== todayIso() && start !== dayBefore(todayIso()));
    setMoreOpen(false);
    setVendorName("");
    setNote("");
    setPotId("");
    setPotChosen(false);
    setQuantity("");
    setUnit("");
    setRate("");
    setShowQuantity(false);
    setUnitDismissed(false);
    setSaving(false);
    setError(null);
    setPicks(null);
    setCategories(NO_CATEGORIES);
    setVendors(NO_VENDORS);
    setPots(NO_POTS);
    setPicksFailed(false);
    amountRef.current?.focus();

    Promise.all([
      api.quickPicks(),
      api.listCategories(),
      api.listVendors(),
      api.savingsOverview().then((overview) => overview.pots ?? NO_POTS),
    ]).then(
      ([nextPicks, nextCategories, nextVendors, nextPots]) => {
        if (mine !== generation.current) return;
        // A server (or a test stub) answering with another shape leaves the plain form.
        setPicks(nextPicks?.expense && nextPicks.income ? nextPicks : null);
        setCategories(nextCategories);
        setVendors(nextVendors);
        setPots(nextPots);
      },
      () => {
        if (mine !== generation.current) return;
        setPicksFailed(true);
      },
    );
    return () => {
      generation.current++;
    };
  }, [isOpen, options]);

  const kindPicks = picks?.[kind];
  const chips = kindPicks?.categories ?? [];
  const combos = kindPicks?.combos ?? [];
  const today = todayIso();
  const yesterday = dayBefore(today);
  const potName = pots.find((pot) => pot.savings_type_id === potId)?.name;
  const quantitySectionOpen = kind === "expense" && (showQuantity || quantity !== "" || unit !== "");
  const chosenChip = chips.find(
    (chip) => chip.name.trim().toLowerCase() === categoryName.trim().toLowerCase(),
  );

  /** The category's default pot: from the full list when it loaded, else from the chip. */
  function potFor(name: string): string {
    const fromList = defaultPot(categories, pots, name);
    if (fromList) return fromList;
    const pick = picks?.expense.categories.find(
      (chip) => chip.name.trim().toLowerCase() === name.trim().toLowerCase(),
    );
    const id = pick?.default_savings_type_id;
    return id && pots.some((pot) => pot.savings_type_id === id) ? id : "";
  }

  function chooseCategory(name: string) {
    setCategoryName(name);
    if (kind === "expense" && !potChosen) setPotId(potFor(name));
    // The unit this category was last quantified in comes back, as on the Entries page.
    if (kind === "expense" && !unitDismissed && !unit && !quantity) {
      const remembered = recallUnit(name);
      if (remembered) {
        setUnit(remembered);
        setShowQuantity(true);
        setMoreOpen(true);
      }
    }
  }

  function switchKind(next: EntryKind) {
    if (next === kind) return;
    setKind(next);
    setCategoryName("");
    setOtherOpen(false);
    setPotId("");
    setPotChosen(false);
    setError(null);
    if (next === "income") {
      clearQuantity();
      setShowQuantity(false);
    }
  }

  function clearQuantity() {
    setQuantity("");
    setUnit("");
    setRate("");
  }

  function onVendorChange(value: string) {
    setVendorName(value);
    const implied = vendorCategory(picks?.vendors ?? [], value, kind, categoryName);
    if (implied === null) return;
    chooseCategory(implied);
    if (!kindPicks?.categories.some((chip) => chip.name === implied)) setOtherOpen(true);
  }

  function repeat(index: number) {
    const combo = combos[index];
    if (!combo) return;
    chooseCategory(combo.category_name);
    if (!chips.some((chip) => chip.name === combo.category_name)) setOtherOpen(true);
    else setOtherOpen(false);
    setVendorName(combo.vendor_name ?? "");
    if (combo.vendor_name) setMoreOpen(true);
    onAmountChange(combo.amount);
  }

  // --- the three-way solve (as on the Entries page) -------------------------------

  function onAmountChange(value: string) {
    setAmount(value);
    if (!isPositiveMoney(value)) return;
    if (isQuantity(quantity)) setRate(solveRate(normalizeMoney(value), quantity.trim()));
    else if (isRate(rate) && !quantity) {
      setQuantity(solveQuantity(normalizeMoney(value), rate.trim()));
    }
  }

  function onQuantityChange(value: string) {
    setQuantity(value);
    if (!isQuantity(value)) return;
    if (isPositiveMoney(amount)) setRate(solveRate(normalizeMoney(amount), value.trim()));
    else if (isRate(rate) && !amount) setAmount(solveAmount(value.trim(), rate.trim()));
  }

  function onRateChange(value: string) {
    setRate(value);
    if (!isRate(value)) return;
    if (isQuantity(quantity)) setAmount(solveAmount(quantity.trim(), value.trim()));
    else if (isPositiveMoney(amount) && !quantity) {
      setQuantity(solveQuantity(normalizeMoney(amount), value.trim()));
    }
  }

  async function save(another: boolean) {
    if (!isPositiveMoney(amount)) {
      setError(t("entries.badAmount"));
      return;
    }
    if (!categoryName.trim()) {
      setError(t("quickAdd.needCategory"));
      return;
    }
    const quantified = kind === "expense" && quantity.trim() !== "";
    if (quantified && !isQuantity(quantity)) {
      setError(t("entries.badQuantity"));
      return;
    }
    if (quantified && !unit) {
      setError(t("entries.needUnit"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await api.createEntry({
        kind,
        amount: normalizeMoney(amount),
        occurred_on: date,
        category_name: categoryName.trim(),
        ...(vendorName.trim() ? { vendor_name: vendorName.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(quantified && unit ? { quantity: quantity.trim(), unit } : {}),
        ...(kind === "expense" && potId ? { savings_type_id: potId } : {}),
      });
      if (quantified && unit) rememberUnit(categoryName, unit);
      bump();
      // The tour's entry step waits on exactly this; a no-op when it is not running.
      tour.notify("entry-created");
      toast.show(t("quickAdd.saved"), {
        onUndo: async () => {
          try {
            await api.deleteEntry(created.id);
            bump();
            toast.show(t("quickAdd.undone"));
          } catch (caught) {
            toast.show(errorMessage(t, caught, "entries.couldNotDelete"), { tone: "error" });
          }
        },
      });
      if (another) {
        // Kind and date stay: the next receipt of the same trip is usually the same day.
        setAmount("");
        setCategoryName("");
        setOtherOpen(false);
        setVendorName("");
        setNote("");
        setPotId("");
        setPotChosen(false);
        clearQuantity();
        setShowQuantity(false);
        setUnitDismissed(false);
        amountRef.current?.focus();
      } else {
        close();
      }
    } catch (caught) {
      setError(errorMessage(t, caught, "entries.couldNotSave"));
    } finally {
      setSaving(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void save(false);
  }

  return (
    <dialog
      ref={dialogRef}
      className="sheet"
      data-tour="record-form"
      aria-labelledby="qa-title"
      onClose={() => {
        if (isOpen) close();
      }}
      onCancel={() => {
        if (isOpen) close();
      }}
    >
      {isOpen && (
        <form onSubmit={onSubmit} noValidate aria-labelledby="qa-title">
          <div className="qa-head">
            <h2 id="qa-title">{t("nav.addEntry")}</h2>
            <button
              type="button"
              className="quiet"
              aria-label={t("quickAdd.close")}
              onClick={close}
            >
              ✕
            </button>
          </div>

          <ErrorBanner message={error} />
          <ErrorBanner message={picksFailed ? t("quickAdd.picksFailed") : null} />

          <div className="chips qa-kind" role="group" aria-label={t("quickAdd.kind")}>
            {(["expense", "income"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={`chip${kind === value ? " on" : ""}`}
                aria-pressed={kind === value}
                onClick={() => switchKind(value)}
              >
                {t(value === "expense" ? "kind.expense" : "kind.income")}
              </button>
            ))}
          </div>

          <input
            ref={amountRef}
            className="num qa-amount"
            inputMode="decimal"
            placeholder="0.00"
            aria-label={t("entries.amountAria", { currency: money.currency })}
            value={amount}
            onChange={(event) => onAmountChange(event.target.value)}
          />

          {combos.length > 0 && (
            <div className="qa-group">
              <span className="qa-label">{t("quickAdd.repeat")}</span>
              <div className="chips">
                {combos.map((combo, index) => (
                  <button
                    key={`${combo.category_id}|${combo.vendor_id ?? ""}|${combo.amount}`}
                    type="button"
                    className="chip"
                    aria-label={t("quickAdd.repeatAria", {
                      category: combo.category_name,
                      amount: money.amount(combo.amount),
                    })}
                    onClick={() => repeat(index)}
                  >
                    {comboLabel(combo, money.amount)}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="qa-group">
            <span className="qa-label">{t("quickAdd.categories")}</span>
            <div className="chips">
              {chips.map((chip) => {
                const on = !otherOpen && chosenChip?.id === chip.id;
                return (
                  <button
                    key={chip.id}
                    type="button"
                    className={`chip${on ? " on" : ""}`}
                    aria-pressed={on}
                    onClick={() => {
                      setOtherOpen(false);
                      if (on) {
                        setCategoryName("");
                        if (kind === "expense" && !potChosen) setPotId("");
                      } else {
                        chooseCategory(chip.name);
                      }
                    }}
                  >
                    {chip.name}
                  </button>
                );
              })}
              <button
                type="button"
                className={`chip${otherOpen ? " on" : ""}`}
                aria-pressed={otherOpen}
                onClick={() => setOtherOpen(true)}
              >
                {t("quickAdd.other")}
              </button>
            </div>
            {otherOpen && (
              <>
                <input
                  list="qa-category-names"
                  aria-label={t("field.category")}
                  placeholder={t("entries.categoryPlaceholder")}
                  value={categoryName}
                  onChange={(event) => chooseCategory(event.target.value)}
                />
                <datalist id="qa-category-names">
                  {categories
                    .filter((category) => category.kind === kind)
                    .map((category) => (
                      <option key={category.id} value={category.name} />
                    ))}
                </datalist>
              </>
            )}
          </div>

          <div className="qa-group">
            <span className="qa-label">{t("field.date")}</span>
            <div className="chips">
              <button
                type="button"
                className={`chip${!dateOpen && date === today ? " on" : ""}`}
                aria-pressed={!dateOpen && date === today}
                onClick={() => {
                  setDate(today);
                  setDateOpen(false);
                }}
              >
                {t("quickAdd.today")}
              </button>
              <button
                type="button"
                className={`chip${!dateOpen && date === yesterday ? " on" : ""}`}
                aria-pressed={!dateOpen && date === yesterday}
                onClick={() => {
                  setDate(yesterday);
                  setDateOpen(false);
                }}
              >
                {t("quickAdd.yesterday")}
              </button>
              <button
                type="button"
                className={`chip${dateOpen ? " on" : ""}`}
                aria-pressed={dateOpen}
                onClick={() => setDateOpen(true)}
              >
                {date !== today && date !== yesterday ? date : t("quickAdd.pickDate")}
              </button>
            </div>
            {dateOpen && (
              <input
                type="date"
                aria-label={t("field.date")}
                value={date}
                onChange={(event) => {
                  // A cleared date input is not a date; keep the last good one.
                  if (event.target.value) setDate(event.target.value);
                }}
              />
            )}
          </div>

          {kind === "expense" && potId && potName && (
            <p className="qa-pot">{t("quickAdd.paidFromLine", { pot: potName })}</p>
          )}

          <button
            type="button"
            className="quiet qa-more-toggle"
            aria-expanded={moreOpen}
            aria-controls="qa-more"
            onClick={() => setMoreOpen((open) => !open)}
          >
            {moreOpen ? t("quickAdd.less") : t("quickAdd.more")}
          </button>

          {moreOpen && (
            <div id="qa-more" className="qa-more">
              <label>
                {t("entries.vendor")}
                <input
                  list="qa-vendor-names"
                  aria-label={t("entries.vendor")}
                  placeholder={t("entries.vendorPlaceholder")}
                  value={vendorName}
                  onChange={(event) => onVendorChange(event.target.value)}
                />
              </label>
              <datalist id="qa-vendor-names">
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.name} />
                ))}
              </datalist>

              <label>
                {t("field.note")}
                <input
                  aria-label={t("field.note")}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </label>

              {kind === "expense" && pots.length > 0 && (
                <label>
                  {t("entries.paidFrom")}
                  <select
                    aria-label={t("entries.paidFrom")}
                    value={potId}
                    onChange={(event) => {
                      setPotId(event.target.value);
                      setPotChosen(true);
                    }}
                  >
                    <option value="">{t("entries.paidFromNone")}</option>
                    {pots.map((pot) => (
                      <option key={pot.savings_type_id} value={pot.savings_type_id}>
                        {pot.name} · {money.plain(pot.balance)}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {kind === "expense" && !quantitySectionOpen && (
                <button
                  type="button"
                  className="quiet"
                  onClick={() => setShowQuantity(true)}
                  aria-expanded={false}
                >
                  {t("entries.addQuantity")}
                </button>
              )}

              {quantitySectionOpen && (
                <div className="qa-quantity" role="group" aria-label={t("entries.quantityDetails")}>
                  <label>
                    {t("field.quantity")}
                    <input
                      className="num"
                      inputMode="decimal"
                      placeholder={t("entries.quantityPlaceholder")}
                      aria-label={t("field.quantity")}
                      value={quantity}
                      onChange={(event) => onQuantityChange(event.target.value)}
                    />
                  </label>
                  <label>
                    {t("entries.unit")}
                    <select
                      aria-label={t("entries.unit")}
                      value={unit}
                      onChange={(event) => setUnit(event.target.value as Unit | "")}
                    >
                      <option value="">—</option>
                      {UNITS.map((u) => (
                        <option key={u} value={u}>
                          {unitLabel(u, t)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t("entries.unitPrice")}
                    <input
                      className="num"
                      inputMode="decimal"
                      placeholder="1.4990"
                      aria-label={t("entries.unitPriceAria", { currency: money.currency })}
                      value={rate}
                      onChange={(event) => onRateChange(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="quiet"
                    aria-label={t("entries.removeQuantity")}
                    onClick={() => {
                      clearQuantity();
                      setShowQuantity(false);
                      setUnitDismissed(true);
                    }}
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="qa-actions">
            <button type="submit" disabled={saving}>
              {saving ? t("entries.saving") : t("quickAdd.save")}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={saving}
              onClick={() => void save(true)}
            >
              {t("quickAdd.saveAnother")}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
