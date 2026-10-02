import { newId } from "../gym/id";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useOptionalAuth } from "../auth/AuthContext";

import { useT } from "../i18n";
import { useModules } from "../layout/modules";
import { startSession } from "../gym/session";
import { hasRestDay, logRestDay, undoRestDay, useGymData } from "../gym/store";
import { todayIso } from "../months";
import { useToast } from "./Toast";
import { Card } from "./ui";

/** Routines offered as one-tap starts, most recently used first. */
const QUICK_START = 3;

/**
 * Start a gym session from the dashboard (Epic 42, §8). Reads the device's copy of the gym
 * (`useGymData`), so it draws and works with no network: a session in progress offers
 * **Resume**; otherwise **Start session** and up to three routines, one tap each. Sessions
 * finished offline show how many are still waiting to reach the server.
 *
 * Start opens the chooser (`/gym/start`, Epic 43); a routine chip starts that routine at once and
 * opens `/gym/session`; nothing is sent until Finish. "Rest day" logs a rest day in one tap
 * (outbox, so it works offline) and offers Undo for five seconds. Draws nothing when the Gym module is off (the dashboard also leaves the card out).
 */
export function GymCard({ collapseKey }: { collapseKey: string }) {
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const enabled = useModules().gym;
  const userId = useOptionalAuth()?.user?.id ?? null;
  const { cache, active, outbox, setActive } = useGymData();
  // The rest day just logged, while its Undo is on offer.
  const [undoRef, setUndoRef] = useState<string | null>(null);
  useEffect(() => {
    if (undoRef === null) return;
    const timer = window.setTimeout(() => setUndoRef(null), 5_000);
    return () => window.clearTimeout(timer);
  }, [undoRef]);
  // The elapsed minutes of a session in progress; refreshed twice a minute while one shows.
  const [now, setNow] = useState(() => Date.now());
  const running = active !== null;
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [running]);

  if (!enabled) return null;

  const begin = (routine: (typeof cache.routines)[number] | null) => {
    setActive(startSession(routine, new Date(), newId));
    navigate("/gym/session");
  };

  // Most recently done first; a routine never done sorts after every one that was.
  const routines = [...cache.routines]
    .sort((a, b) => (cache.lastDone[b.id] ?? "").localeCompare(cache.lastDone[a.id] ?? ""))
    .slice(0, QUICK_START);
  const restToday = userId !== null && hasRestDay(userId, todayIso(new Date(now)));
  const waiting = outbox.filter((entry) => entry.refused === null).length;
  const refused = outbox.length - waiting;
  const minutes = active
    ? Math.max(0, Math.floor((now - new Date(active.started_at).getTime()) / 60_000))
    : 0;

  return (
    <Card title={t("gymCore.cardTitle")} collapseKey={collapseKey}>
      {active ? (
        <>
          <p style={{ margin: "0 0 8px" }}>
            {active.routine_name ? `${active.routine_name} · ` : ""}
            {t("gymCore.card.inProgress", { minutes })}
          </p>
          <button type="button" onClick={() => navigate("/gym/session")}>
            {t("gymCore.card.resume")}
          </button>
        </>
      ) : (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button type="button" onClick={() => navigate("/gym/start")}>
              {t("gymCore.card.start")}
            </button>
            {routines.map((routine) => (
              <button
                key={routine.id}
                type="button"
                className="secondary"
                aria-label={t("gymCore.card.startRoutine", { name: routine.name })}
                onClick={() => begin(routine)}
              >
                {routine.name}
              </button>
            ))}
          </div>
          {routines.length === 0 && (
            <p className="hint" style={{ margin: "8px 0 0" }}>
              <Link to="/gym/import">{t("gymCore.card.askAi")}</Link>
            </p>
          )}
        </>
      )}
      {userId !== null && !active && (undoRef !== null || !restToday) && (
        <p style={{ margin: "8px 0 0" }}>
          {undoRef !== null ? (
            <>
              <span role="status">{t("gymCore.card.restLogged")}</span>{" "}
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  const ref = undoRef;
                  setUndoRef(null);
                  undoRestDay(userId, ref).catch(() => toast.show(t("gymCore.card.restUndoFailed")));
                }}
              >
                {t("gymCore.card.restUndo")}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="secondary"
              onClick={() => void logRestDay(userId, todayIso(new Date()), new Date()).then(setUndoRef)}
            >
              {t("gymCore.card.restDay")}
            </button>
          )}
        </p>
      )}
      {userId !== null && !active && undoRef === null && restToday && (
        <p className="hint" style={{ margin: "8px 0 0" }}>
          {t("gymCore.card.restLogged")}
        </p>
      )}
      {waiting > 0 && (
        <p className="hint" style={{ margin: "8px 0 0" }} role="status">
          {t.n("gymCore.card.waiting", waiting)}
        </p>
      )}
      {refused > 0 && (
        <p className="hint" style={{ margin: "8px 0 0" }}>
          {t.n("gymCore.card.refused", refused)}
        </p>
      )}
    </Card>
  );
}
