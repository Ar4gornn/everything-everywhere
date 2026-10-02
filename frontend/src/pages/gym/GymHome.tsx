import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";

import { api } from "../../api/client";
import { CheckInButton } from "../../components/CheckInButton";
import { Card, Empty, ErrorBanner } from "../../components/ui";
import { discardOutboxEntry, retryOutboxEntry } from "../../gym/store";
import { useToast } from "../../components/Toast";
import { useT } from "../../i18n";
import { errorMessage } from "../../i18n/errors";
import { useDates } from "../../useDates";
import { ExercisesCard, HistoryCard } from "./GymHistory";
import { GymTour } from "./GymTour";
import { useGym } from "./GymContext";
import { Elapsed } from "./GymSession";
import { byLastDone, estimateMinutes } from "./measure";

/** A link that is a disabled button while the server is out of reach, with its reason beside it. */
function OnlineLink({
  to,
  disabled,
  children,
  tour,
}: {
  to: string;
  disabled: boolean;
  children: ReactNode;
  /** Names this control as a stop on the gym tour (`data-tour`). */
  tour?: string;
}) {
  return disabled ? (
    <button type="button" className="quiet" data-tour={tour} disabled>
      {children}
    </button>
  ) : (
    <Link to={to} className="gym-link-button quiet" data-tour={tour}>
      {children}
    </Link>
  );
}

/** `/gym`: resume, start, routines, history, exercises. */
export function GymHome() {
  const t = useT();
  const dates = useDates();
  const navigate = useNavigate();
  const { cache, active, outbox, isOffline, refresh, setActive, start, userId } = useGym();
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const pending = outbox.filter((entry) => entry.refused === null).length;
  const refused = outbox.filter((entry) => entry.refused !== null);
  const routines = byLastDone(cache.routines, cache.lastDone);

  async function createRoutine(event: FormEvent) {
    event.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.createRoutine(newName.trim());
      setNewName("");
      await refresh();
      navigate(`/gym/routines/${created.id}`);
    } catch (caught) {
      setError(errorMessage(t, caught, "gym.couldNotCreateRoutine"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="gym-title-row">
        <h1>{t("gym.title")}</h1>
        <CheckInButton streak="gym" />
        <GymTour />
      </div>

      {isOffline && (
        <p className="gym-pill" role="status">
          {t("gym.offlinePill")}
        </p>
      )}
      {pending > 0 && (
        <p className="gym-pill" role="status">
          {t.n("gym.waiting", pending)}
        </p>
      )}
      {refused.map((entry) => (
        <div className="error gym-refused" role="alert" key={entry.body.client_ref}>
          <span>
            {t("gym.refused", {
              name: entry.routine_name ?? t("gym.freeSession"),
              date: dates.day(entry.body.performed_on),
            })}
          </span>
          <button
            type="button"
            className="quiet"
            onClick={() => {
              void retryOutboxEntry(userId, entry.body.client_ref).then(() => refresh());
            }}
          >
            {t("gym.retry")}
          </button>
          <button
            type="button"
            className="quiet"
            onClick={() => {
              // Nothing is ever lost silently: the whole body goes to the clipboard on request.
              void (async () => {
                try {
                  await navigator.clipboard.writeText(JSON.stringify(entry.body, null, 2));
                  toast.show(t("gym.dataCopied"));
                } catch {
                  /* no clipboard: the entry stays on the phone either way */
                }
              })();
            }}
          >
            {t("gym.copyData")}
          </button>
          <button
            type="button"
            className="quiet"
            onClick={() => {
              if (!window.confirm(t("gym.discardEntryConfirm"))) return;
              discardOutboxEntry(userId, entry.body.client_ref);
              void refresh();
            }}
          >
            {t("gym.discard")}
          </button>
        </div>
      ))}
      <ErrorBanner message={error} />

      {active && (
        <Card title={t("gym.inProgress")}>
          <p className="gym-resume-line">
            <strong>{active.routine_name ?? t("gym.freeSession")}</strong>
            <span aria-hidden="true"> · </span>
            <Elapsed startedAt={active.started_at} />
          </p>
          <div className="row">
            <Link to="/gym/session" className="gym-link-button">
              {t("gym.resume")}
            </Link>
            <button
              type="button"
              className="quiet"
              onClick={() => {
                if (window.confirm(t("gym.discardConfirm"))) setActive(null);
              }}
            >
              {t("gym.discard")}
            </button>
          </div>
        </Card>
      )}

      <Card title={t("gym.startSession")} tour="gym-start">
        <button type="button" className="gym-start-empty" onClick={() => start(null)}>
          {t("gym.startEmpty")}
        </button>
        {routines.length > 0 && (
          <ul className="gym-routine-cards" aria-label={t("gym.routines")}>
            {routines.map((routine) => {
              const last = cache.lastDone[routine.id];
              return (
                <li key={routine.id}>
                  <button
                    type="button"
                    className="quiet gym-routine-start"
                    aria-label={t("gym.startNamed", { name: routine.name })}
                    onClick={() => start(routine)}
                  >
                    <span className="gym-routine-name">{routine.name}</span>
                    <span className="gym-routine-meta">
                      {t.n("gym.exercisesCount", routine.lines.length)}
                      {routine.lines.length > 0 &&
                        ` · ${t("gym.about", { n: estimateMinutes(routine) })}`}
                    </span>
                    <span className="gym-routine-meta">
                      {last ? t("gym.lastDone", { date: dates.day(last) }) : t("gym.neverDone")}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {routines.length === 0 && <p className="hint">{t("gym.noRoutinesHint")}</p>}
      </Card>

      <Card
        title={t("gym.routines")}
        collapseKey="gym.routines"
        summary={`${routines.length}`}
        tour="gym-routines"
      >
        {routines.length > 0 && (
          <ul className="gym-routine-list" aria-label={t("gym.routines")}>
            {routines.map((routine) => (
              <li key={routine.id} className="gym-routine-row">
                <span className="gym-routine-name">{routine.name}</span>
                <OnlineLink to={`/gym/routines/${routine.id}`} disabled={isOffline}>
                  {t("action.edit")}
                </OnlineLink>
              </li>
            ))}
          </ul>
        )}
        {routines.length === 0 && <Empty>{t("gym.noRoutines")}</Empty>}
        <form className="gym-new-routine" onSubmit={(event) => void createRoutine(event)}>
          <label>
            {t("gym.newRoutine")}
            <input
              value={newName}
              maxLength={80}
              placeholder={t("gym.routinePlaceholder")}
              disabled={isOffline}
              onChange={(event) => setNewName(event.target.value)}
            />
          </label>
          <button type="submit" disabled={isOffline || busy || !newName.trim()}>
            {t("gym.createRoutine")}
          </button>
        </form>
        <div className="row gym-import-row">
          <OnlineLink to="/gym/import" disabled={isOffline} tour="gym-import">
            {t("gym.importFromFile")}
          </OnlineLink>
        </div>
        {isOffline && <p className="hint">{t("gym.needsConnection")}</p>}
      </Card>

      <HistoryCard tour="gym-history" />
      <ExercisesCard />
    </>
  );
}
