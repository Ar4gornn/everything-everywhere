import { useId, useState } from "react";

import { api } from "../api/client";
import type { Streak, StreakModuleId, StreaksOverview } from "../api/types";
import { errorMessage } from "../i18n/errors";
import { useT } from "../i18n";
import { useDates } from "../useDates";
import { STREAK_NAME, usePointsName, useShownStreaks } from "../layout/modules";
import { useLoad } from "../useLoad";
import { ListRow } from "./ListRow";
import { Card, ErrorBanner } from "./ui";

const NOTHING: StreaksOverview | null = null;

/**
 * The overall streak (Epic 41, AD-57): how many days in a row something was done, the best
 * run, a Check in for a day when nothing else was written, and the last four weeks.
 *
 * **The server owns the day.** Nothing here sends one, so the account's own midnight (its
 * time zone, AD-52) decides what "today" is and a device with the wrong clock cannot
 * backdate anything. Today is *pending* until that midnight, so a streak is not lost while
 * the day is still going.
 *
 * **Absent rather than broken.** A server older than this card answers something without a
 * `streaks` list; the card then draws nothing rather than crashing the dashboard.
 */
export function StreakCard({ collapseKey }: { collapseKey: string }) {
  const t = useT();
  const dates = useDates();
  const { data, setData, failure } = useLoad(
    () => api.getStreaks(),
    NOTHING,
    [],
    "streaks.couldNotLoad",
  );
  const [checkInFailed, setCheckInFailed] = useState<string | null>(null);
  const [pressing, setPressing] = useState(false);
  // The shop is a disclosure, not a modal (house rule since Epic 24). `confirming` is the
  // streak whose Buy has been pressed once: spending asks for a second press.
  const [shopOpen, setShopOpen] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  const [buyFailed, setBuyFailed] = useState<string | null>(null);
  const shopId = useId();

  // A tab streak is a row only while it is shown (preference on, module on), decided at
  // render from the account as it is now: a module switched off hides its row at once, and
  // the server keeps counting for it either way.
  const shown = useShownStreaks();
  // The person's word for points, verbatim; the default label when none is chosen.
  const pointsName = usePointsName() ?? t("streaks.pointsDefault");
  const overall = Array.isArray(data?.streaks)
    ? data.streaks.find((streak) => streak.id === "overall")
    : undefined;

  async function checkIn() {
    if (pressing) return;
    setPressing(true);
    setCheckInFailed(null);
    try {
      const updated = await api.streakCheckIn("overall");
      setData((was) =>
        was
          ? {
              ...was,
              streaks: was.streaks.map((s) => (s.id === updated.id ? updated : s)),
            }
          : was,
      );
    } catch (caught) {
      setCheckInFailed(errorMessage(t, caught, "streaks.couldNotCheckIn"));
    } finally {
      setPressing(false);
    }
  }

  async function buyFreeze(id: string) {
    if (buying) return;
    setBuying(true);
    setBuyFailed(null);
    try {
      const bought = await api.buyStreakFreeze(id);
      setData((was) =>
        was
          ? {
              ...was,
              points: bought.points,
              streaks: was.streaks.map((s) => (s.id === bought.streak.id ? bought.streak : s)),
            }
          : was,
      );
    } catch (caught) {
      setBuyFailed(errorMessage(t, caught, "streaks.couldNotBuy"));
    } finally {
      setConfirming(null);
      setBuying(false);
    }
  }

  const rows = shown.flatMap((id) => {
    const found = Array.isArray(data?.streaks) ? data.streaks.find((s) => s.id === id) : undefined;
    return found ? [{ ...found, id }] : [];
  });

  // Who can buy a freeze: the overall streak and every shown tab streak. Absent prices (a
  // server older than the shop) leave the disclosure out altogether.
  const price = data?.prices?.freeze;
  const maxHeld = data?.prices?.max_held ?? 2;
  const shopRows = overall ? [overall, ...rows] : [];

  if (!overall) {
    return failure ? (
      <Card title={t("streaks.title")} collapseKey={collapseKey}>
        <ErrorBanner message={failure} />
      </Card>
    ) : null;
  }

  return (
    <div className="streak-card">
      <Card
        title={t("streaks.title")}
        collapseKey={collapseKey}
        summary={t.n("streaks.days", overall.current)}
      >
        <div className="streak-card-head">
          <p className="streak-card-figure" data-stat="Streak">
            <strong className="streak-card-number">{overall.current}</strong>{" "}
            <span>{t.n("streaks.dayUnit", overall.current)}</span>
          </p>
          <p className="hint streak-card-best">{t("streaks.best", { count: overall.best })}</p>
        </div>

        <button
          type="button"
          className="streak-card-checkin"
          onClick={() => void checkIn()}
          disabled={overall.today_active || pressing}
        >
          {overall.today_active ? t("streaks.checkedIn") : t("streaks.checkIn")}
        </button>
        <ErrorBanner message={checkInFailed} />

        {rows.length > 0 && (
          <ul className="list-rows streak-tab-rows" aria-label={t("streaks.tabs")}>
            {rows.map((row) => (
              <ListRow
                key={row.id}
                title={
                  <>
                    {t(STREAK_NAME[row.id])}
                    {row.today_active && (
                      <>
                        {" "}
                        <span aria-hidden="true">✓</span>
                        <span className="visually-hidden">{t("streaks.rowActiveToday")}</span>
                      </>
                    )}
                  </>
                }
                meta={t("streaks.best", { count: row.best })}
                amount={t.n("streaks.days", row.current)}
              />
            ))}
          </ul>
        )}

        <Dots streak={overall} label={t("streaks.recent")} day={dates.day} />

        {price !== undefined && (
          <div className="streak-shop">
            <button
              type="button"
              className="secondary streak-shop-toggle"
              aria-expanded={shopOpen}
              aria-controls={shopId}
              onClick={() => setShopOpen((was) => !was)}
            >
              {t("streaks.shop")}
            </button>
            {shopOpen && (
              <div id={shopId} className="streak-shop-panel">
                <p className="hint">{t("streaks.shopHint")}</p>
                <ul className="list-rows streak-shop-rows">
                  {shopRows.map((row) => {
                    const held = row.held_freezes ?? 0;
                    const name =
                      row.id === "overall"
                        ? t("streaks.shopOverall")
                        : t(STREAK_NAME[row.id as StreakModuleId]);
                    const asking = confirming === row.id;
                    return (
                      <ListRow
                        key={row.id}
                        title={name}
                        meta={t("streaks.freezeLine", {
                          price,
                          name: pointsName,
                          held,
                          max: maxHeld,
                        })}
                        trailing={
                          asking ? (
                            <span className="streak-shop-actions">
                              <button
                                type="button"
                                aria-label={t("streaks.confirmBuyFor", {
                                  price,
                                  name: pointsName,
                                  streak: name,
                                })}
                                disabled={buying}
                                onClick={() => void buyFreeze(row.id)}
                              >
                                {t("streaks.confirmBuy", { price, name: pointsName })}
                              </button>
                              <button
                                type="button"
                                className="quiet"
                                disabled={buying}
                                onClick={() => setConfirming(null)}
                              >
                                {t("action.cancel")}
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="secondary"
                              aria-label={t("streaks.buyFor", { streak: name })}
                              disabled={held >= maxHeld || buying}
                              onClick={() => {
                                setBuyFailed(null);
                                setConfirming(row.id);
                              }}
                            >
                              {t("streaks.buy")}
                            </button>
                          )
                        }
                      />
                    );
                  })}
                </ul>
                <ErrorBanner message={buyFailed} />
              </div>
            )}
          </div>
        )}

        {data?.points && (
          <p className="streak-card-points">
            <span className="visually-hidden">{t("streaks.pointsBalance")} </span>
            <strong>{data.points.balance}</strong> · <span>{pointsName}</span>
          </p>
        )}
      </Card>
    </div>
  );
}

/**
 * Twenty-eight days, oldest first, seven to a row. Five shapes — a filled disc, an empty
 * ring, a dashed ring, a small speck for a day before the streak began, and a diamond for a
 * day a freeze covered — so the state is never carried by colour alone, and each dot is a
 * list item read as "day: state".
 */
function Dots({
  streak,
  label,
  day,
}: {
  streak: Streak;
  label: string;
  day: (iso: string) => string;
}) {
  const t = useT();
  return (
    <ol className="streak-dots" aria-label={label}>
      {streak.recent.map((entry) => (
        <li key={entry.day} className={`streak-dot streak-dot-${entry.state}`}>
          <span className="visually-hidden">
            {t(`streaks.dot.${entry.state}` as const, { day: day(entry.day) })}
          </span>
        </li>
      ))}
    </ol>
  );
}
