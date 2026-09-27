/**
 * What the last closed budget month left over (Epic 35, Story 35.4, AD-51).
 *
 * `income − expenses − net savings`, proposed as a deposit into a pot the person picks —
 * never recorded on its own, and never into a pot picked for them. The deposit is dated on
 * the month's last day, so it lowers the very figure it answers: taking all of it makes
 * the card go away, taking part leaves the rest proposed. "Not this time" is remembered
 * by the server, per month, so another device does not ask again.
 *
 * Drawn only when there is something left and it was not dismissed; the dashboard decides.
 */

import { type FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../api/client";
import type { Leftover, SavingsType } from "../api/types";
import { errorMessage } from "../i18n/errors";
import { type MessageKey, useT } from "../i18n";
import { isPositiveMoney, normalizeMoney } from "../money";
import { useDates } from "../useDates";
import { useMoney } from "../useMoney";
import { useToast } from "./Toast";
import { Card, ErrorBanner } from "./ui";

export function LeftoverCard({
  leftover,
  onChange,
}: {
  leftover: Leftover;
  /** After a deposit or a dismissal: the dashboard reads the leftover again. */
  onChange: () => void;
}) {
  const t = useT();
  const money = useMoney();
  const dates = useDates();
  const toast = useToast();
  // Null while unknown: the picker is not drawn until the pots are.
  const [pots, setPots] = useState<SavingsType[] | null>(null);
  const [pot, setPot] = useState("");
  // What was typed, and against which leftover it was typed.
  const [draft, setDraft] = useState<{ against: string; value: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.listSavingsTypes().then(
      (rows) => {
        if (!cancelled) setPots(rows);
      },
      // Unknown, not empty: the figure still shows, and "create a pot" would be wrong.
      () => {
        if (!cancelled) setPots(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // A partial deposit leaves a new, smaller leftover: propose that, not the old draft.
  const amount = draft?.against === leftover.leftover ? draft.value : leftover.leftover;

  async function run(action: () => Promise<unknown>, fallback: MessageKey) {
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (caught) {
      setError(errorMessage(t, caught, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function putAside(event: FormEvent) {
    event.preventDefault();
    if (!pot) return;
    if (!isPositiveMoney(amount)) {
      setError(t("entries.badAmount"));
      return;
    }
    const value = normalizeMoney(amount);
    const done = await run(
      () =>
        api.createContribution({
          savings_type_id: pot,
          amount: value,
          occurred_on: leftover.end,
        }),
      "plan.couldNotRecordContribution",
    );
    if (done) {
      toast.show(t("pots.putAside", { amount: money.amount(value) }));
      onChange();
    }
  }

  async function dismiss() {
    if (await run(() => api.dismissLeftover(leftover.month), "leftover.couldNotDismiss")) {
      onChange();
    }
  }

  return (
    <Card
      title={t("leftover.title")}
      collapseKey="dashboard.leftover"
      summary={money.amount(leftover.leftover)}
      // In the header, so it is there whether or not a pot exists to put it in.
      actions={
        <button type="button" className="quiet" disabled={busy} onClick={dismiss}>
          {t("leftover.dismiss")}
        </button>
      }
    >
      <p style={{ margin: "0 0 4px" }} data-stat="Left over">
        {t("leftover.lead", {
          month: dates.month(leftover.month),
          amount: money.amount(leftover.leftover),
        })}
      </p>
      <p className="hint" style={{ margin: "0 0 8px" }}>
        {t("leftover.breakdown", {
          income: money.amount(leftover.income),
          expense: money.amount(leftover.expense),
          saved: money.amount(leftover.saved),
        })}
      </p>

      <ErrorBanner message={error} />

      {pots !== null && pots.length === 0 ? (
        <p className="hint" style={{ margin: 0 }}>
          <Link to="/plan">{t("leftover.noPots")}</Link>
        </p>
      ) : (
        pots !== null && (
          <form className="row" onSubmit={putAside}>
            <label style={{ flex: "1 1 140px" }}>
              {t("leftover.pot")}
              <select value={pot} onChange={(event) => setPot(event.target.value)}>
                <option value="">{t("leftover.choosePot")}</option>
                {pots.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ flex: "0 1 110px" }}>
              {t("leftover.amount")}
              <input
                className="num"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setDraft({ against: leftover.leftover, value: event.target.value })}
              />
            </label>
            <button type="submit" disabled={busy || !pot}>
              {t("pots.confirm")}
            </button>
          </form>
        )
      )}
    </Card>
  );
}
