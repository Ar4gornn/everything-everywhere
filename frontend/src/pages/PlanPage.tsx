import { useEffect, useId, useMemo, useState } from "react";

import { api } from "../api/client";
import type { Budget, BudgetVsActual, Category, Pot } from "../api/types";
import { useOptionalAuth } from "../auth/AuthContext";
import { ProgressBar } from "../charts/ProgressBar";
import { CheckInButton } from "../components/CheckInButton";
import { ListRow, useOpenRow } from "../components/ListRow";
import { RecurringCard } from "../components/RecurringCard";
import { SavingsCard } from "../components/SavingsCard";
import { Card, Empty, ErrorBanner, TableWrap } from "../components/ui";
import { isNonNegativeMoney, normalizeMoney, progress, subtractMoney, toCents } from "../money";
import { budgetMonth, monthLabel, monthRangeLabel } from "../months";
import { useMoney } from "../useMoney";
import { useT, type Translate } from "../i18n";
import type { MessageKey } from "../i18n/catalogue";
import { errorMessage } from "../i18n/errors";
import { useLoad } from "../useLoad";
import { useLayout } from "../layout/useLayout";

const NOTHING = {
  categories: [] as Category[],
  budgets: [] as Budget[],
  spent: [] as BudgetVsActual[],
  pots: [] as Pot[],
};

/** Savings and budgets: what the user intends, and what they have actually put aside. */
export function PlanPage() {
  const money = useMoney();
  const t = useT();
  const startDay = useOptionalAuth()?.user?.budget_start_day ?? 1;
  // Epic 35.1: the plan shows what the current budget month has actually spent against
  // each budget. The figures are the dashboard's own (AD-22), not a second computation.
  const month = budgetMonth(startDay);
  // Failures of the budget card's own actions, shown inside it: at the top of the page
  // they landed above the fold, and a refused amount looked like a dead button. The
  // savings card keeps its own (SavingsCard). The load's failure is `failure`.
  const [error, setError] = useState<string | null>(null);
  const phone = useLayout() === "phone";
  const [openRow, toggleRow] = useOpenRow();

  const {
    data: { categories, budgets, spent, pots },
    loading,
    failure,
    reload: load,
  } = useLoad(
    () =>
      Promise.all([
        api.listCategories("expense"),
        api.listBudgets(),
        api.summary(month),
        // Epic 35.3: for each category's default pot.
        api.savingsOverview().then((overview) => overview.pots),
      ]).then(([categories, budgets, summary, pots]) => ({
        categories,
        budgets,
        spent: summary.budgets,
        pots,
      })),
    NOTHING,
    [month],
    "plan.couldNotLoad",
  );

  const budgetFor = useMemo(() => {
    const lookup = new Map(budgets.map((b) => [b.category_id, b.monthly_amount]));
    return (id: string) => lookup.get(id) ?? "";
  }, [budgets]);

  const spentFor = useMemo(() => {
    const lookup = new Map(spent.map((row) => [row.category_id, row.actual]));
    return (id: string) => lookup.get(id) ?? "0.00";
  }, [spent]);

  async function guard(action: () => Promise<unknown>, fallback: MessageKey) {
    setError(null);
    try {
      await action();
      await load();
    } catch (caught) {
      setError(errorMessage(t, caught, fallback));
    }
  }

  /** AD-11: PUT, so saving twice updates the standing amount rather than adding a second. */
  async function saveBudget(id: string, raw: string) {
    const value = normalizeMoney(raw);
    if (!isNonNegativeMoney(value)) {
      setError(t("plan.badAmountZeroOrMore"));
      return;
    }
    await guard(() => api.setBudget(id, value), "plan.couldNotSaveAmount");
  }

  if (loading) return <p className="empty">{t("state.loading")}</p>;

  /** What a category's row needs, the same on a phone and a desktop. */
  const rowProps = (category: Category) => ({
    name: category.name,
    t,
    initial: budgetFor(category.id),
    spent: spentFor(category.id),
    pots,
    potId: category.default_savings_type_id ?? "",
    onPot: (potId: string) =>
      guard(() => api.setCategoryPot(category.id, potId || null), "plan.couldNotSavePot"),
    onSave: (value: string) => saveBudget(category.id, value),
    onDelete: () =>
      guard(() => api.deleteCategory(category.id), "plan.couldNotDeleteCategory"),
  });

  return (
    <>
      <CheckInButton streak="plan" bar />
      <ErrorBanner message={failure} />

      <RecurringCard />

      <SavingsCard />

      <Card title={t("plan.budgets")} tour="budgets">
        <ErrorBanner message={error} />
        <p className="hint" style={{ marginTop: 0 }}>
          {t("plan.budgetsHint")}
        </p>
        {pots.length > 0 && <p className="hint">{t("plan.defaultPotHint")}</p>}
        <p className="hint">
          {t("plan.spentThisMonth", {
            range: monthRangeLabel(month, startDay, t) || monthLabel(month, t),
          })}
        </p>
        {categories.length === 0 ? (
          <Empty>{t("plan.noCategories")}</Empty>
        ) : phone ? (
          <ul className="list-rows" aria-label={t("plan.budgets")}>
            {categories.map((category) => (
              <AmountRow
                key={category.id}
                phone
                open={openRow === category.id}
                onToggle={() => toggleRow(category.id)}
                {...rowProps(category)}
              />
            ))}
          </ul>
        ) : (
          <TableWrap>
            <table className="stacked">
              <thead>
                <tr>
                  <th>{t("dash.colCategory")}</th>
                  <th className="num">
                    {t("plan.colMonthlyBudget", { symbol: money.symbol })}
                  </th>
                  <th className="num">{t("dash.colSpent", { symbol: money.symbol })}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {categories.map((category) => (
                  <AmountRow key={category.id} {...rowProps(category)} />
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}

function AmountRow({
  name,
  t,
  initial,
  spent,
  pots,
  potId,
  onPot,
  onSave,
  onDelete,
  phone = false,
  open = false,
  onToggle,
}: {
  name: string;
  // Passed in rather than looked up: this row is rendered once per category and per
  // savings type, and a hook call per row buys nothing the parent has not already got.
  t: Translate;
  initial: string;
  /** What the current budget month has spent in this category, "0.00" if nothing. */
  spent: string;
  pots: Pot[];
  /** Epic 35.3: the category's default pot, "" for none. Saved as soon as it changes. */
  potId: string;
  onPot: (potId: string) => Promise<void>;
  onSave: (value: string) => Promise<void>;
  onDelete: () => Promise<void>;
  /** AD-53: a list row rather than a table row, with the inputs inside it. */
  phone?: boolean;
  open?: boolean;
  onToggle?: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setValue(initial);
    setDirty(false);
  }, [initial]);

  const money = useMoney();
  const inputId = useId();
  // Measured against the saved budget, not the draft in the box: the bar moves on Save.
  const budget = initial === "" ? null : initial;
  const over = budget !== null && toCents(spent) > toCents(budget);

  // One of each control, placed in table cells on a desktop and in the open row on a phone.
  const potSelect = (pots.length > 0 || potId) && (
    <select
      aria-label={t("plan.defaultPotFor", { name })}
      // A bare select in the name column shrank to "No…"; a floor keeps its words.
      style={{ display: "block", marginTop: 6, minWidth: "7rem" }}
      value={potId}
      onChange={(event) => void onPot(event.target.value)}
    >
      <option value="">{t("plan.noDefaultPot")}</option>
      {pots.map((pot) => (
        <option key={pot.savings_type_id} value={pot.savings_type_id}>
          {pot.name}
        </option>
      ))}
    </select>
  );
  const amountInput = (
    <input
      id={phone ? inputId : undefined}
      className="num"
      inputMode="decimal"
      placeholder={t("plan.notSetPlaceholder")}
      aria-label={t("plan.monthlyAmountFor", { name })}
      value={value}
      onChange={(event) => {
        setValue(event.target.value);
        setDirty(true);
      }}
    />
  );
  const leftOrOver =
    budget !== null &&
    (over
      ? t("plan.overBy", { amount: money.plain(subtractMoney(spent, budget)) })
      : t("plan.leftOf", { amount: money.plain(subtractMoney(budget, spent)) }));
  const bar = (
    <ProgressBar
      percent={progress(spent, budget)}
      over={over}
      label={t("dash.budgetUsed", { name })}
    />
  );
  const saveButton = (
    <button type="button" disabled={!dirty} onClick={() => void onSave(value)}>
      {t("action.save")}
    </button>
  );
  const deleteButton = (
    <button
      type="button"
      className="quiet"
      onClick={() => void onDelete()}
      aria-label={t("plan.deleteNamed", { name })}
    >
      {t("action.delete")}
    </button>
  );

  if (phone) {
    // A typed amount lives on in this row after it closes; say so, or it is invisible
    // until the row is reopened (the desktop always shows its input).
    const draft = value.trim();
    const unsaved =
      dirty && value !== initial
        ? t("rows.unsaved", {
            amount: !draft
              ? "—"
              : isNonNegativeMoney(draft)
                ? money.plain(normalizeMoney(draft))
                : draft,
          })
        : undefined;
    return (
      <ListRow
        title={name}
        meta={unsaved}
        amount={money.plain(spent)}
        amountTone={over ? "over" : undefined}
        bar={
          budget === null ? (
            <span className="hint">{t("rows.noBudget")}</span>
          ) : (
            <>
              {bar}
              <span className="hint">{t("rows.of", { amount: money.plain(budget) })}</span>
            </>
          )
        }
        open={open}
        onToggle={onToggle}
        details={
          <>
            {leftOrOver && (
              <p className="hint" style={{ margin: 0 }}>
                {leftOrOver}
              </p>
            )}
            <div className="list-row-fields">
              <label htmlFor={inputId}>
                {t("plan.colMonthly")}
                {amountInput}
              </label>
              {saveButton}
            </div>
            {potSelect}
            <div className="row">{deleteButton}</div>
          </>
        }
      />
    );
  }

  return (
    <tr>
      <td data-label={t("field.name")}>
        {name}
        {potSelect}
      </td>
      <td className="num" data-label={t("plan.colMonthly")}>
        {amountInput}
      </td>
      <td className="num" data-label={t("dash.colSpentShort")}>
        <span style={over ? { color: "var(--spend-ink)" } : undefined}>
          {money.plain(spent)}
        </span>
        {leftOrOver && <span className="hint"> {leftOrOver}</span>}
        {bar}
      </td>
      <td>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          {saveButton}
          {deleteButton}
        </div>
      </td>
    </tr>
  );
}
