import { useLayoutEffect, useRef, useState, type FormEvent } from "react";

import { ApiError, api, type EntryInput } from "../../api/client";
import {
  UNITS,
  type Category,
  type EntryKind,
  type Pot,
  type QuickPicks,
  type Unit,
  type Vendor,
} from "../../api/types";
import { useOptionalAuth } from "../../auth/AuthContext";
import {
  flushEntries,
  readPicksCache,
  saveEntry,
  undoEntry,
  writePicksCache,
  type QueueOutcome,
} from "../../entries/outbox";
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

/**
 * The row inside the dialog that follows "Save & add another". The global toast renders under
 * a modal dialog's top layer and is inert there, so its Undo would be unreachable.
 */
type Inline =
  | { phase: "saved"; target: UndoTarget; queued: boolean }
  | { phase: "undone" }
  | { phase: "error"; target: UndoTarget; message: string };

/** What an Undo needs to take back one save. */
interface UndoTarget {
  ref: string;
  serverId?: string;
}

export function QuickAddSheet() {
  const { isOpen, options, close, bump } = useQuickAdd();
  const t = useT();
  const money = useMoney();
  const toast = useToast();
  const tour = useTutorial();
  const userId = useOptionalAuth()?.user?.id ?? null;
  const dialogRef = useRef<HTMLDialogElement>(null);
  // The refused queue item this sheet is fixing (opened from one, or refused a moment ago):
  // its Save replaces that item instead of queueing a second entry.
  const replaceRef = useRef<string | undefined>(undefined);
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
  const [inline, setInline] = useState<Inline | null>(null);

  const [picks, setPicks] = useState<QuickPicks | null>(null);
  const [categories, setCategories] = useState<Category[]>(NO_CATEGORIES);
  const [vendors, setVendors] = useState<Vendor[]>(NO_VENDORS);
  const [pots, setPots] = useState<Pot[]>(NO_POTS);
  const [picksFailed, setPicksFailed] = useState(false);
  const [cachedNote, setCachedNote] = useState(false);

  // A layout effect, so the reset below lands before the first paint of a reopened sheet.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!isOpen) {
      if (dialog?.open) dialog.close();
      return;
    }
    const mine = ++generation.current;
    if (dialog && !dialog.open) dialog.showModal();

    const draft = options.draft;
    const draftBody = draft?.body;
    const draftDate = draftBody && ISO_DAY.test(draftBody.occurred_on) ? draftBody.occurred_on : null;
    const start =
      draftDate ?? (options.date && ISO_DAY.test(options.date) ? options.date : todayIso());
    const draftCategory = draft ? (draft.category_name || draftBody?.category_name || "") : "";
    const draftQuantity = draftBody?.quantity ?? "";
    const draftPot = draftBody?.savings_type_id ?? "";
    replaceRef.current = draft?.client_ref;
    setKind(draftBody?.kind ?? "expense");
    setAmount(draftBody?.amount ?? "");
    setCategoryName(draftCategory);
    // The chips are not here yet: show the typed field, and fall back to a chip if one matches.
    setOtherOpen(draftCategory !== "");
    setDate(start);
    setDateOpen(start !== todayIso() && start !== dayBefore(todayIso()));
    setVendorName(draftBody?.vendor_name ?? "");
    setNote(draftBody?.note ?? "");
    setMoreOpen(
      Boolean(draftBody?.vendor_name || draftBody?.note || draftQuantity || draftPot),
    );
    setPotId(draftPot);
    setPotChosen(draftPot !== "");
    setQuantity(draftQuantity);
    setUnit(draftBody?.unit ?? "");
    setRate(
      draftBody?.amount && draftQuantity && isPositiveMoney(draftBody.amount) && isQuantity(draftQuantity)
        ? solveRate(normalizeMoney(draftBody.amount), draftQuantity.trim())
        : "",
    );
    setShowQuantity(draftQuantity !== "");
    setUnitDismissed(false);
    setSaving(false);
    setError(null);
    setInline(null);
    setPicks(null);
    setCategories(NO_CATEGORIES);
    setVendors(NO_VENDORS);
    setPots(NO_POTS);
    setPicksFailed(false);
    setCachedNote(false);
    amountRef.current?.focus();

    const apply = (
      nextPicks: QuickPicks | null | undefined,
      nextCategories: Category[],
      nextVendors: Vendor[],
      nextPots: Pot[],
    ): QuickPicks | null => {
      // A server (or a test stub) answering with another shape leaves the plain form.
      const valid = nextPicks?.expense && nextPicks.income ? nextPicks : null;
      setPicks(valid);
      setCategories(nextCategories);
      setVendors(nextVendors);
      setPots(nextPots);
      const wanted = draftCategory.trim().toLowerCase();
      if (
        valid &&
        wanted &&
        valid[draftBody?.kind ?? "expense"].categories.some(
          (chip) => chip.name.trim().toLowerCase() === wanted,
        )
      ) {
        setOtherOpen(false);
      }
      return valid;
    };

    // The last good copy first, so the chips are there at once and offline.
    const cached = userId ? readPicksCache(userId) : null;
    const shownFromCache = cached?.picks ? cached : null;
    if (shownFromCache) {
      apply(shownFromCache.picks, shownFromCache.categories, shownFromCache.vendors, shownFromCache.pots);
    }
    // Anything left over from an earlier session or connection is tried now.
    if (userId) {
      void flushEntries(userId)
        .then((result) => {
          if (result.sent > 0) bump();
        })
        .catch(() => undefined);
    }

    Promise.all([
      api.quickPicks(),
      api.listCategories(),
      api.listVendors(),
      api.savingsOverview().then((overview) => overview.pots ?? NO_POTS),
    ]).then(
      ([nextPicks, nextCategories, nextVendors, nextPots]) => {
        if (mine !== generation.current) return;
        const valid = apply(nextPicks, nextCategories, nextVendors, nextPots);
        setCachedNote(false);
        if (userId && valid) {
          writePicksCache(userId, {
            picks: valid,
            categories: nextCategories,
            vendors: nextVendors,
            pots: nextPots,
          });
        }
      },
      (caught: unknown) => {
        if (mine !== generation.current) return;
        // With a copy on screen and no network this is the expected offline state: a quiet
        // note. A server that answered badly is not "offline": the banner, chips kept.
        const unreachable = !(caught instanceof ApiError) || !navigator.onLine;
        if (shownFromCache && unreachable) setCachedNote(true);
        else setPicksFailed(true);
      },
    );
    return () => {
      generation.current++;
    };
  }, [isOpen, options, userId, bump]);

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
    // The sheet this save started on; a close (or a reopen) before the answer lands moves it.
    const mine = generation.current;
    const owner = userId;
    try {
      const entryBody: EntryInput = {
        kind,
        amount: normalizeMoney(amount),
        occurred_on: date,
        category_name: categoryName.trim(),
        ...(vendorName.trim() ? { vendor_name: vendorName.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(quantified && unit ? { quantity: quantity.trim(), unit } : {}),
        ...(kind === "expense" && potId ? { savings_type_id: potId } : {}),
      };
      // Signed in: the entry is written on the device first and sent at once (AD-61). No
      // account to key a queue by (a bare render): sent directly, as before Epic 45.
      const outcome: QueueOutcome = owner
        ? await saveEntry(owner, entryBody, categoryName.trim(), replaceRef.current)
        : await api.createEntry(entryBody).then((entry) => ({
            status: "sent" as const,
            entry,
            client_ref: entry.id,
          }));

      if (outcome.status === "refused") {
        // The server said no to this entry: it stays on the device, marked, and the next Save
        // from this sheet replaces it rather than queueing a second one.
        if (mine === generation.current) {
          replaceRef.current = outcome.client_ref;
          setError(errorMessage(t, new ApiError(422, "", outcome.code), "entries.couldNotSave"));
        }
        return;
      }

      const sent = outcome.status === "sent";
      const target: UndoTarget = sent
        ? { ref: outcome.client_ref, serverId: outcome.entry.id }
        : { ref: outcome.client_ref };
      if (quantified && unit) rememberUnit(categoryName, unit);
      if (sent) bump();
      // The tour's entry step waits on exactly this; a no-op when it is not running.
      tour.notify("entry-created");
      if (!another) {
        toast.show(t(sent ? "quickAdd.saved" : "offline.savedQueued"), {
          onUndo: async () => {
            try {
              await undo(owner, target);
              bump();
              toast.show(t("quickAdd.undone"));
            } catch (caught) {
              toast.show(errorMessage(t, caught, "entries.couldNotDelete"), { tone: "error" });
            }
          },
        });
      }
      // The sheet was closed (and maybe reopened) while this was in flight: the entry is
      // saved, but nothing of the old form may touch the current one.
      if (mine !== generation.current) return;
      replaceRef.current = undefined;
      if (another) {
        setInline({ phase: "saved", target, queued: !sent });
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
      if (mine === generation.current) setError(errorMessage(t, caught, "entries.couldNotSave"));
    } finally {
      if (mine === generation.current) setSaving(false);
    }
  }

  /** Take back one save: off the queue, or off the server. */
  async function undo(owner: string | null, target: UndoTarget) {
    if (owner) await undoEntry(owner, target.ref, target.serverId);
    else if (target.serverId) await api.deleteEntry(target.serverId);
  }

  /** Undo for the inline row: takes back exactly the entry that row was made for. */
  async function undoInline(target: UndoTarget) {
    const mine = generation.current;
    try {
      await undo(userId, target);
      bump();
      if (mine !== generation.current) return;
      setInline((current) =>
        current && "target" in current && current.target.ref === target.ref
          ? { phase: "undone" }
          : current,
      );
    } catch (caught) {
      if (mine !== generation.current) return;
      const message = errorMessage(t, caught, "entries.couldNotDelete");
      setInline((current) =>
        current && "target" in current && current.target.ref === target.ref
          ? { phase: "error", target, message }
          : current,
      );
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

          {inline && (
            <div className="qa-status" role="status" aria-live="polite">
              <span>
                {inline.phase === "saved"
                  ? t(inline.queued ? "offline.savedQueued" : "quickAdd.saved")
                  : inline.phase === "undone"
                    ? t("quickAdd.undone")
                    : inline.message}
              </span>
              {inline.phase !== "undone" && (
                <button type="button" className="quiet" onClick={() => void undoInline(inline.target)}>
                  {t("toast.undo")}
                </button>
              )}
            </div>
          )}

          <ErrorBanner message={error} />
          <ErrorBanner message={picksFailed ? t("quickAdd.picksFailed") : null} />
          {cachedNote && (
            <p className="hint" role="status">
              {t("offline.cachedChips")}
            </p>
          )}

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
