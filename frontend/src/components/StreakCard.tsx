import { useId, useState } from "react";

import { api, ApiError } from "../api/client";
import type { Streak, StreakModuleId, StreaksOverview } from "../api/types";
import { errorMessage } from "../i18n/errors";
import { useT } from "../i18n";
import { useDates } from "../useDates";
import { STREAK_NAME, usePointsName, useShownStreaks } from "../layout/modules";
import { useLoad } from "../useLoad";
import { ListRow } from "./ListRow";
import { Card, ErrorBanner } from "./ui";

const NOTHING: StreaksOverview | null = null;

/** Repair offers listed before the rest fold behind "Show N more" (11 can be open at once). */
const REPAIRS_SHOWN = 2;

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
 *
 * **The run comes first.** The number, Check in and the balance open the card; repair
 * offers follow (one sentence for one offer, a single folded list for several, since every
 * shown streak can break on the same day), then the tab streaks as chips, then the dots.
 */
export function StreakCard({ collapseKey }: { collapseKey: string }) {
  const t = useT();
  const dates = useDates();
  const { data, setData, failure, reload } = useLoad(
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
  // The repair offer (Story 41.5) works the same way: one press asks, the second spends.
  const [repairConfirming, setRepairConfirming] = useState<string | null>(null);
  const [repairing, setRepairing] = useState(false);
  const [repairFailed, setRepairFailed] = useState<string | null>(null);
  const [allRepairs, setAllRepairs] = useState(false);
  const shopId = useId();
  const repairsId = useId();

  // A tab streak is a chip only while it is shown (preference on, module on), decided at
  // render from the account as it is now: a module switched off hides its chip at once, and
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
      // A first check-in of the day earns, and /check-in answers with the streak only:
      // without this the balance (and every Buy it gates) stays a point behind until a reload.
      void reload();
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

  async function buyRepair(id: string, cost: number) {
    if (repairing) return;
    setRepairing(true);
    setRepairFailed(null);
    try {
      const bought = await api.buyStreakRepair(id, cost);
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
      setRepairFailed(errorMessage(t, caught, "streaks.couldNotRepair"));
      // The offer was stale (another tab bought it, or the day moved on): read it afresh.
      if (caught instanceof ApiError && caught.code === "repair_unavailable") void reload();
    } finally {
      setRepairConfirming(null);
      setRepairing(false);
    }
  }

  const rows = shown.flatMap((id) => {
    const found = Array.isArray(data?.streaks) ? data.streaks.find((s) => s.id === id) : undefined;
    return found ? [{ ...found, id }] : [];
  });

  // Who can buy a freeze: the overall streak and every shown tab streak. Absent prices (a
  // server older than the shop) leave the disclosure out altogether.
  const price = data?.prices?.freeze;
  // A button for something the balance cannot pay is disabled and says why, rather than
  // inviting a press that ends in `points_insufficient`. A server that sends no balance
  // (older than 41.3) leaves it enabled: nothing is known, so nothing is refused here.
  const balance = data?.points?.balance;
  const affords = (cost: number) => balance === undefined || balance >= cost;
  const maxHeld = data?.prices?.max_held ?? 2;
  const shopRows = overall ? [overall, ...rows] : [];
  const streakName = (id: string) =>
    id === "overall" ? t("streaks.shopOverall") : t(STREAK_NAME[id as StreakModuleId]);
  // A repair is offered for the overall streak and every shown tab streak, overall first.
  const offers = shopRows.flatMap((row) => (row.repair ? [{ row, repair: row.repair }] : []));
  const listedOffers = allRepairs ? offers : offers.slice(0, REPAIRS_SHOWN);
  const foldedOffers = offers.length - REPAIRS_SHOWN;

  if (!overall) {
    return failure ? (
      <Card title={t("streaks.title")} collapseKey={collapseKey}>
        <ErrorBanner message={failure} />
      </Card>
    ) : null;
  }

  /** Repair, then Confirm + Cancel: the same pair for the lone banner and for each row. */
  function repairActions(id: string, cost: number) {
    const name = streakName(id);
    if (repairConfirming === id) {
      return (
        <span className="streak-shop-actions">
          <button
            type="button"
            aria-label={t("streaks.confirmRepairFor", { price: cost, name: pointsName, streak: name })}
            disabled={repairing}
            onClick={() => void buyRepair(id, cost)}
          >
            {t("streaks.confirmBuy", { price: cost, name: pointsName })}
          </button>
          <button
            type="button"
            className="quiet"
            disabled={repairing}
            onClick={() => setRepairConfirming(null)}
          >
            {t("action.cancel")}
          </button>
        </span>
      );
    }
    return (
      <button
        type="button"
        className="secondary"
        aria-label={t("streaks.repairFor", { streak: name })}
        disabled={repairing || !affords(cost)}
        onClick={() => {
          setRepairFailed(null);
          setRepairConfirming(id);
        }}
      >
        {t("streaks.repair")}
      </button>
    );
  }

  const tooLow = (
    <span className="hint streak-repair-short">{t("streaks.repairTooLow")}</span>
  );

  return (
    <div className="streak-card">
      <Card
        title={t("streaks.title")}
        collapseKey={collapseKey}
        summary={t.n("streaks.days", overall.current)}
      >
        <div className="streak-card-head">
          <div className="streak-card-run">
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
        </div>
        <ErrorBanner message={checkInFailed} />

        {(data?.points || price !== undefined) && (
          <div className="streak-card-wallet">
            {data?.points && (
              <p className="streak-card-points">
                {/* The label (read aloud), the number and the dot stay on one line: only the
                    name, which the person chooses and may make 24 characters long, may wrap. */}
                <span className="streak-card-balance">
                  <span className="visually-hidden">{t("streaks.pointsBalance")} </span>
                  <strong>{data.points.balance}</strong> ·
                </span>{" "}
                <span>{pointsName}</span>
              </p>
            )}
            {price !== undefined && (
              <button
                type="button"
                className="secondary streak-shop-toggle"
                aria-expanded={shopOpen}
                aria-controls={shopId}
                onClick={() => setShopOpen((was) => !was)}
              >
                {t("streaks.shop")}
              </button>
            )}
          </div>
        )}

        {price !== undefined && shopOpen && (
          <div id={shopId} className="streak-shop-panel">
            <p className="hint">{t("streaks.shopHint")}</p>
            {!affords(price) && <p className="hint">{t("streaks.freezeTooLow")}</p>}
            <ul className="list-rows streak-shop-rows">
              {shopRows.map((row) => {
                const held = row.held_freezes ?? 0;
                const name = streakName(row.id);
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
                          disabled={held >= maxHeld || buying || !affords(price)}
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

        {/* Repairs, tab chips and the four weeks: under the run on a phone, the right-hand
            column on a desktop. */}
        <div className="streak-card-side">
          {offers.length === 1 && offers[0] && (
            <div className="streak-repair">
              <p className="streak-repair-text">
                {t.n("streaks.repairOffer", offers[0].repair.days, {
                  streak: streakName(offers[0].row.id),
                  cost: offers[0].repair.cost,
                  name: pointsName,
                })}
                {!affords(offers[0].repair.cost) && <> {tooLow}</>}
              </p>
              {repairActions(offers[0].row.id, offers[0].repair.cost)}
            </div>
          )}
          {offers.length > 1 && (
            <div className="streak-repair streak-repairs">
              <p className="streak-repair-text streak-repairs-heading">
                {t.n("streaks.repairsHeading", offers.length)}
              </p>
              <ul id={repairsId} className="streak-repair-rows">
                {listedOffers.map(({ row, repair }) => (
                  <li key={row.id} className="streak-repair-row">
                    <span className="streak-repair-row-text">
                      <span>{streakName(row.id)}</span>{" "}
                      <span className="hint streak-repair-row-price">
                        {t.n("streaks.repairRowPrice", repair.days, {
                          cost: repair.cost,
                          name: pointsName,
                        })}
                      </span>
                      {!affords(repair.cost) && tooLow}
                    </span>
                    {repairActions(row.id, repair.cost)}
                  </li>
                ))}
              </ul>
              {foldedOffers > 0 && (
                <button
                  type="button"
                  className="quiet streak-repairs-more"
                  aria-expanded={allRepairs}
                  aria-controls={repairsId}
                  onClick={() => setAllRepairs((was) => !was)}
                >
                  {allRepairs
                    ? t("streaks.repairsFewer")
                    : t("streaks.repairsMore", { count: foldedOffers })}
                </button>
              )}
            </div>
          )}
          <ErrorBanner message={repairFailed} />

          {rows.length > 0 && (
            <ul className="streak-chips" aria-label={t("streaks.tabs")}>
              {rows.map((row) => (
                <li
                  key={row.id}
                  className={row.current === 0 ? "streak-chip streak-chip-idle" : "streak-chip"}
                >
                  <span>{t(STREAK_NAME[row.id])}</span>{" "}
                  <strong aria-hidden="true">{row.current}</strong>
                  <span className="visually-hidden">{t.n("streaks.days", row.current)}</span>
                  {row.today_active && (
                    <>
                      {" "}
                      <span aria-hidden="true">✓</span>
                      <span className="visually-hidden"> {t("streaks.rowActiveToday")}</span>
                    </>
                  )}
                  <span className="visually-hidden"> {t("streaks.best", { count: row.best })}</span>
                </li>
              ))}
            </ul>
          )}
          <Dots
            streak={overall}
            today={data?.today}
            label={t("streaks.recent")}
            day={dates.day}
            initial={dates.weekdayInitial}
          />
        </div>
      </Card>
    </div>
  );
}

/** Monday-first weekday of an ISO date, read in UTC so no device zone can shift it. */
function weekdayOf(iso: string): number {
  return (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/**
 * Twenty-eight days, oldest first, seven to a row, under a row of weekday initials taken
 * from the first seven days themselves (the grid starts wherever four weeks ago fell, not on
 * a Monday). Six shapes — a filled disc, a cross, a dashed ring, a small speck for a day
 * before the streak began, a diamond for a day a freeze covered, a ring with a core for a
 * day a repair covered — so the state is never carried by colour alone, and each dot is a
 * list item read as "day: state". Today carries a ring of its own.
 */
function Dots({
  streak,
  today,
  label,
  day,
  initial,
}: {
  streak: Streak;
  today: string | undefined;
  label: string;
  day: (iso: string) => string;
  initial: (weekday: number) => string;
}) {
  const t = useT();
  return (
    <div className="streak-dots-grid">
      {/* The initials are a visual aid only: every dot already says its day aloud. */}
      <div className="streak-dots-head" aria-hidden="true">
        {streak.recent.slice(0, 7).map((entry) => (
          <span key={entry.day}>{initial(weekdayOf(entry.day))}</span>
        ))}
      </div>
      <ol className="streak-dots" aria-label={label}>
        {streak.recent.map((entry) => (
          <li
            key={entry.day}
            className={`streak-dot streak-dot-${entry.state}${
              entry.day === today ? " streak-dot-today" : ""
            }`}
          >
            <span className="visually-hidden">
              {t(`streaks.dot.${entry.state}` as const, { day: day(entry.day) })}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
