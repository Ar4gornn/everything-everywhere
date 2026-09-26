import { useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import type { Budget, BudgetVsActual, Category } from "../api/types";
import { useOptionalAuth } from "../auth/AuthContext";
import { ProgressBar } from "../charts/ProgressBar";
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

const NOTHING = {
  categories: [] as Category[],
  budgets: [] as Budget[],
  spent: [] as BudgetVsActual[],
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

  const {
    data: { categories, budgets, spent },
    loading,
    failure,
    reload: load,
  } = useLoad(
    () =>
      Promise.all([api.listCategories("expense"), api.listBudgets(), api.summary(month)]).then(
        ([categories, budgets, summary]) => ({ categories, budgets, spent: summary.budgets }),
      ),
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

  return (
    <>
      <ErrorBanner message={failure} />

      <RecurringCard />

      <div className="columns">
        <div>
          <SavingsCard />
        </div>

        <Card title={t("plan.budgets")} tour="budgets">
          <ErrorBanner message={error} />
          <p className="hint" style={{ marginTop: 0 }}>
            {t("plan.budgetsHint")}
          </p>
          <p className="hint">
            {t("plan.spentThisMonth", {
              range: monthRangeLabel(month, startDay, t) || monthLabel(month, t),
            })}
          </p>
          {categories.length === 0 ? (
            <Empty>{t("plan.noCategories")}</Empty>
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
                    <AmountRow
                      key={category.id}
                      name={category.name}
                      t={t}
                      initial={budgetFor(category.id)}
                      spent={spentFor(category.id)}
                      onSave={(value) => saveBudget(category.id, value)}
                      onDelete={() =>
                        guard(
                          () => api.deleteCategory(category.id),
                          "plan.couldNotDeleteCategory",
                        )
                      }
                    />
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      </div>
    </>
  );
}

function AmountRow({
  name,
  t,
  initial,
  spent,
  onSave,
  onDelete,
}: {
  name: string;
  // Passed in rather than looked up: this row is rendered once per category and per
  // savings type, and a hook call per row buys nothing the parent has not already got.
  t: Translate;
  initial: string;
  /** What the current budget month has spent in this category, "0.00" if nothing. */
  spent: string;
  onSave: (value: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setValue(initial);
    setDirty(false);
  }, [initial]);

  const money = useMoney();
  // Measured against the saved budget, not the draft in the box: the bar moves on Save.
  const budget = initial === "" ? null : initial;
  const over = budget !== null && toCents(spent) > toCents(budget);

  return (
    <tr>
      <td data-label={t("field.name")}>{name}</td>
      <td className="num" data-label={t("plan.colMonthly")}>
        <input
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
      </td>
      <td className="num" data-label={t("dash.colSpentShort")}>
        <span style={over ? { color: "var(--spend-ink)" } : undefined}>
          {money.plain(spent)}
        </span>
        {budget !== null && (
          <span className="hint">
            {" "}
            {over
              ? t("plan.overBy", { amount: money.plain(subtractMoney(spent, budget)) })
              : t("plan.leftOf", { amount: money.plain(subtractMoney(budget, spent)) })}
          </span>
        )}
        <ProgressBar
          percent={progress(spent, budget)}
          over={over}
          label={t("dash.budgetUsed", { name })}
        />
      </td>
      <td>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <button type="button" disabled={!dirty} onClick={() => void onSave(value)}>
            {t("action.save")}
          </button>
          <button
            type="button"
            className="quiet"
            onClick={() => void onDelete()}
            aria-label={t("plan.deleteNamed", { name })}
          >
            {t("action.delete")}
          </button>
        </div>
      </td>
    </tr>
  );
}
