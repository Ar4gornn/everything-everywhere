import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { Card, ErrorBanner } from "../../components/ui";
import { hasRestDay, logRestDay, undoRestDay } from "../../gym/store";
import { useT } from "../../i18n";
import { todayIso } from "../../months";
import { useGym } from "./GymContext";
import { byLastDone } from "./measure";

/** How long the Undo stays after a rest day is logged. */
const UNDO_MS = 5000;

/**
 * `/gym/start` (Epic 43 §7.1): the one question between "I'm here" and the first set, with
 * three big answers and nothing to type. A rest day is one tap on the line below them.
 */
export function GymStart() {
  const t = useT();
  const { cache, userId, start } = useGym();
  const [loggedRef, setLoggedRef] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const today = todayIso();
  const already = hasRestDay(userId, today);
  const chips = byLastDone(cache.routines, cache.lastDone).slice(0, 3);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  async function logRest() {
    setError(null);
    try {
      const ref = await logRestDay(userId, today, new Date());
      setLoggedRef(ref);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setLoggedRef(null), UNDO_MS);
    } catch {
      setError(t("gym.start.couldNotLogRest"));
    }
  }

  async function undo() {
    const ref = loggedRef;
    if (timer.current !== null) window.clearTimeout(timer.current);
    setLoggedRef(null);
    if (!ref) return;
    try {
      await undoRestDay(userId, ref);
    } catch {
      setError(t("gym.start.couldNotLogRest"));
    }
  }

  return (
    <>
      <p>
        <Link to="/gym">← {t("gym.title")}</Link>
      </p>
      <Card title={t("gym.start.title")}>
        {chips.length > 0 && (
          <div className="gym-chips">
            <span className="gym-chips-label">{t("gym.start.follow")}</span>
            <ul className="gym-chip-list" aria-label={t("gym.routines")}>
              {chips.map((routine) => (
                <li key={routine.id}>
                  <button
                    type="button"
                    className="quiet gym-chip"
                    aria-label={t("gym.startNamed", { name: routine.name })}
                    onClick={() => start(routine)}
                  >
                    {routine.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="gym-choices">
          <button type="button" className="gym-choice" onClick={() => start(null)}>
            <span className="gym-choice-title">{t("gym.start.justStart")}</span>
            <span className="gym-choice-desc">{t("gym.start.justStartDesc")}</span>
          </button>
          <Link to="/gym/build" className="gym-choice">
            <span className="gym-choice-title">{t("gym.start.build")}</span>
            <span className="gym-choice-desc">{t("gym.start.buildDesc")}</span>
          </Link>
          <Link to="/gym/import" className="gym-choice">
            <span className="gym-choice-title">{t("gym.start.ai")}</span>
            <span className="gym-choice-desc">{t("gym.start.aiDesc")}</span>
          </Link>
        </div>

        <ErrorBanner message={error} />
        <div className="gym-rest-day">
          {loggedRef ? (
            <p className="gym-rest-logged" role="status">
              <span>
                <span aria-hidden="true">☾ </span>
                {t("gym.start.restLogged")}
              </span>
              <button type="button" className="quiet" onClick={() => void undo()}>
                {t("gym.start.undo")}
              </button>
            </p>
          ) : (
            <button
              type="button"
              className="quiet gym-rest-day-button"
              disabled={already}
              onClick={() => void logRest()}
            >
              <span aria-hidden="true">☾ </span>
              {already ? t("gym.start.restAlready") : t("gym.start.restDay")}
            </button>
          )}
        </div>
      </Card>
    </>
  );
}
