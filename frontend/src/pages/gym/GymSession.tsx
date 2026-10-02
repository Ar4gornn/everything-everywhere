import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import type { HistoryPoint, WeightUnit } from "../../api/types";
import { Card, Empty, ErrorBanner } from "../../components/ui";
import {
  addExercise,
  currentExercise,
  logSet,
  nextSetDraft,
  progress,
  removeExercise,
  removeSet,
  skipRest,
  updateSet,
  type ActiveSession,
  type SessionExercise,
  type SessionSet,
} from "../../gym/session";
import { finishActive, type FlushResult } from "../../gym/store";
import { useT } from "../../i18n";
import { vibrate, useNow, useWakeLock } from "./device";
import { ExerciseAdder } from "./ExerciseAdder";
import { useGym } from "./GymContext";
import {
  clock,
  formatDistance,
  formatSeconds,
  formatSet,
  formatTarget,
  formatWeight,
  newId,
  summarise,
  type SessionSummary,
} from "./measure";
import {
  SetFields,
  draftFromEntry,
  entryFromDraft,
  entryIsComplete,
  type SetEntry,
} from "./SetFields";

/** "Last time: 3 sets · top 60 kg", from the cached point of the exercise's latest session. */
function lastTimeText(
  exercise: SessionExercise,
  point: HistoryPoint | undefined,
  unit: WeightUnit,
  lang: string,
): string | null {
  if (!point) return null;
  const parts: string[] = [];
  if (exercise.kind === "duration" && point.best_seconds !== null) {
    parts.push(formatSeconds(point.best_seconds));
  } else if (exercise.kind === "distance" && point.best_distance_m !== null) {
    parts.push(formatDistance(point.best_distance_m, lang));
  } else if (exercise.kind === "reps") {
    parts.push(`${point.reps}`);
  }
  if (point.top_weight !== null) parts.push(formatWeight(point.top_weight, unit, lang));
  return parts.join(" · ") || null;
}

/** The ticking elapsed time of the session, from its start stamp. */
export function Elapsed({ startedAt }: { startedAt: string }) {
  const now = useNow(true, 1000);
  return <span className="num">{clock((now - Date.parse(startedAt)) / 1000)}</span>;
}

/** The rest countdown. Reads `until - now`, so a locked phone shows the right time on waking. */
function RestBar({ until, onSkip }: { until: string; onSkip: () => void }) {
  const t = useT();
  const now = useNow(true, 250);
  const remaining = Math.ceil((Date.parse(until) - now) / 1000);
  const over = remaining <= 0;
  // Only a rest that was seen running buzzes: one that ended while the phone slept is stale.
  const sawRunning = useRef(false);
  const skip = useRef(onSkip);
  skip.current = onSkip;
  useEffect(() => {
    if (!over) {
      sawRunning.current = true;
      return;
    }
    if (sawRunning.current) vibrate([200, 100, 200]);
    skip.current();
  }, [over]);
  if (over) return null;
  return (
    <div className="gym-rest" role="timer" aria-label={t("gym.rest")}>
      <span className="gym-rest-label">{t("gym.rest")}</span>
      <span className="gym-rest-clock num">{clock(remaining)}</span>
      <button type="button" className="quiet" onClick={onSkip}>
        {t("gym.skipRest")}
      </button>
    </div>
  );
}

/** One logged set: its value, with Edit (inline fields) and Remove. */
function LoggedSet({
  set,
  index,
  exercise,
  session,
  unit,
  save,
}: {
  set: SessionSet;
  index: number;
  exercise: SessionExercise;
  session: ActiveSession;
  unit: WeightUnit;
  save: (next: ActiveSession) => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [entry, setEntry] = useState<SetEntry>(() =>
    entryFromDraft({
      reps: set.reps,
      weight: set.weight,
      duration_seconds: set.duration_seconds,
      distance_m: set.distance_m,
    }),
  );
  const text = formatSet({ ...set, kind: exercise.kind }, unit, t);
  const label = t("rows.setN", { n: index + 1 });

  if (editing) {
    return (
      <li className="gym-set editing">
        <span className="gym-set-n">{label}</span>
        <SetFields kind={exercise.kind} entry={entry} onChange={setEntry} unit={unit} />
        <div className="gym-set-actions">
          <button
            type="button"
            disabled={!entryIsComplete(exercise.kind, entry)}
            onClick={() => {
              save(updateSet(session, set.key, draftFromEntry(exercise.kind, entry)));
              setEditing(false);
            }}
          >
            {t("action.save")}
          </button>
          <button type="button" className="quiet" onClick={() => setEditing(false)}>
            {t("action.cancel")}
          </button>
        </div>
      </li>
    );
  }
  return (
    <li className="gym-set">
      <span className="gym-set-n">{label}</span>
      <span className="gym-set-value num">{text}</span>
      <button
        type="button"
        className="quiet"
        aria-label={t("gym.editSet", { n: index + 1, name: exercise.name })}
        onClick={() => setEditing(true)}
      >
        {t("action.edit")}
      </button>
      <button
        type="button"
        className="quiet"
        aria-label={t("gym.removeSet", { n: index + 1, name: exercise.name })}
        onClick={() => save(removeSet(session, set.key))}
      >
        {t("action.remove")}
      </button>
    </li>
  );
}

/** The next set to do, prefilled, with its big Done. Remounts after every logged set. */
function NextSet({
  exercise,
  session,
  unit,
  number,
  save,
}: {
  exercise: SessionExercise;
  session: ActiveSession;
  unit: WeightUnit;
  number: number;
  save: (next: ActiveSession) => void;
}) {
  const t = useT();
  const [entry, setEntry] = useState<SetEntry>(() =>
    entryFromDraft(nextSetDraft(session, exercise.key)),
  );
  const [problem, setProblem] = useState<string | null>(null);

  function done() {
    if (!entryIsComplete(exercise.kind, entry)) {
      setProblem(t(`gym.need.${exercise.kind}`));
      return;
    }
    try {
      save(logSet(session, exercise.key, draftFromEntry(exercise.kind, entry), new Date(), newId));
      setProblem(null);
    } catch {
      setProblem(t(`gym.need.${exercise.kind}`));
    }
  }

  return (
    <div className="gym-next">
      <h4 className="gym-next-title">{t("rows.setN", { n: number })}</h4>
      <SetFields
        kind={exercise.kind}
        entry={entry}
        onChange={(next) => {
          setEntry(next);
          setProblem(null);
        }}
        unit={unit}
        targetSeconds={exercise.target_seconds}
        timer
      />
      {problem ? (
        <p className="error" role="alert">
          {problem}
        </p>
      ) : null}
      <button type="button" className="gym-done" onClick={done}>
        {t("gym.doneSet")}
      </button>
    </div>
  );
}

export function GymSession() {
  const t = useT();
  const navigate = useNavigate();
  const { active, cache, userId, unit, setActive } = useGym();
  const [focus, setFocus] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ stats: SessionSummary; result: FlushResult } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  useWakeLock();

  const current = useMemo(() => (active ? currentExercise(active) : null), [active]);
  const open = focus ?? current;

  if (summary) return <Summary {...summary} unit={unit} onClose={() => navigate("/gym")} />;
  if (!active) {
    return (
      <Card title={t("gym.sessionTitle")}>
        <Empty>{t("gym.noActive")}</Empty>
        <Link to="/gym" className="gym-link-button">
          {t("gym.backToGym")}
        </Link>
      </Card>
    );
  }

  const session: ActiveSession = active;
  const stats = progress(session);
  const exerciseNumber = Math.max(
    1,
    session.exercises.findIndex((e) => e.key === open) + 1,
  );

  function discard() {
    if (!window.confirm(t("gym.discardConfirm"))) return;
    setActive(null);
    navigate("/gym");
  }

  async function finish() {
    if (session.sets.length === 0) {
      // A session with nothing in it is not worth a row: offer to throw it away instead.
      discard();
      return;
    }
    const left = Math.max(0, stats.setsPlanned - stats.setsDone);
    if (left > 0 && !window.confirm(t.n("gym.finishConfirm", left))) return;
    setBusy(true);
    setError(null);
    const now = new Date();
    const figures = summarise(session, cache.lastTime, now);
    try {
      const result = await finishActive(userId, now);
      setSummary({ stats: figures, result });
    } catch {
      setError(t("gym.couldNotFinish"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="gym-session-head">
        <div className="gym-session-title">
          <h1>{session.routine_name ?? t("gym.freeSession")}</h1>
          <p className="gym-session-meta">
            <Elapsed startedAt={session.started_at} />
            <span aria-hidden="true"> · </span>
            <span>
              {t("gym.progressLine", {
                n: exerciseNumber,
                total: stats.exercisesTotal,
                done: stats.setsDone,
                planned: Math.max(stats.setsPlanned, stats.setsDone),
              })}
            </span>
          </p>
        </div>
        <div className="gym-session-actions">
          <button
            type="button"
            className="quiet"
            aria-expanded={menu}
            aria-label={t("gym.menuLabel")}
            onClick={() => setMenu((was) => !was)}
          >
            ⋯
          </button>
          <button type="button" disabled={busy} onClick={() => void finish()}>
            {t("gym.finish")}
          </button>
        </div>
      </header>

      {menu && (
        <Card>
          <label>
            {t("gym.sessionNote")}
            <textarea
              className="gym-textarea"
              rows={2}
              maxLength={500}
              value={session.note}
              onChange={(event) => setActive({ ...session, note: event.target.value })}
            />
          </label>
          <div className="row" style={{ marginTop: 8 }}>
            <button type="button" className="quiet" onClick={discard}>
              {t("gym.discard")}
            </button>
          </div>
        </Card>
      )}

      <ErrorBanner message={error} />

      {session.rest_until && (
        <RestBar until={session.rest_until} onSkip={() => setActive(skipRest(session))} />
      )}

      <div className="gym-exercises">
        {session.exercises.map((exercise) => {
          const sets = session.sets.filter((s) => s.exercise === exercise.key);
          const complete =
            exercise.target_sets !== null && sets.length >= exercise.target_sets;
          const isOpen = open === exercise.key;
          const target = formatTarget(
            {
              kind: exercise.kind,
              target_sets: exercise.target_sets,
              target_reps: exercise.target_reps,
              target_seconds: exercise.target_seconds,
              target_distance_m: exercise.target_distance_m,
              target_weight: exercise.target_weight,
              rest_seconds: exercise.rest_seconds,
            },
            unit,
            t,
          );
          const last = lastTimeText(
            exercise,
            exercise.exercise_id ? cache.lastTime[exercise.exercise_id] : undefined,
            unit,
            t.lang,
          );
          return (
            <section
              key={exercise.key}
              className={`card gym-exercise${isOpen ? " open" : ""}${complete ? " complete" : ""}`}
              aria-label={exercise.name}
            >
              <button
                type="button"
                className="gym-exercise-head"
                aria-expanded={isOpen}
                onClick={() => setFocus(isOpen ? "" : exercise.key)}
              >
                <span className="gym-exercise-name">
                  {complete && (
                    <>
                      <span aria-hidden="true">✓ </span>
                      <span className="visually-hidden">{t("gym.exerciseDone")}</span>
                    </>
                  )}
                  {exercise.name}
                </span>
                <span className="gym-exercise-sub num">
                  {target || t(`gym.kind.${exercise.kind}`)}
                  {sets.length > 0 && !isOpen ? ` · ${sets.length}` : ""}
                </span>
              </button>

              {isOpen && (
                <div className="gym-exercise-body">
                  <p className="hint gym-exercise-info">
                    {t(`gym.kind.${exercise.kind}`)}
                    {target ? ` · ${t("gym.target", { target })}` : ""}
                    {last ? ` · ${t("gym.lastTime", { last })}` : ""}
                    {exercise.video_url && (
                      <>
                        {" · "}
                        <a href={exercise.video_url} target="_blank" rel="noopener noreferrer">
                          {t("gym.video")}
                        </a>
                      </>
                    )}
                  </p>
                  {exercise.note ? <p className="hint">{exercise.note}</p> : null}

                  {sets.length > 0 && (
                    <ul className="gym-sets" aria-label={t("gym.sets")}>
                      {sets.map((set, index) => (
                        <LoggedSet
                          key={set.key}
                          set={set}
                          index={index}
                          exercise={exercise}
                          session={session}
                          unit={unit}
                          save={setActive}
                        />
                      ))}
                    </ul>
                  )}

                  <NextSet
                    key={`${exercise.key}:${sets.length}`}
                    exercise={exercise}
                    session={session}
                    unit={unit}
                    number={sets.length + 1}
                    save={setActive}
                  />

                  {sets.length === 0 && (
                    <button
                      type="button"
                      className="quiet gym-remove-exercise"
                      onClick={() => setActive(removeExercise(session, exercise.key))}
                    >
                      {t("gym.removeExercise")}
                    </button>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <Card>
        {adding ? (
          <ExerciseAdder
            exercises={cache.exercises}
            submitLabel={t("gym.addToSession")}
            onAdd={(choice) => {
              const next = addExercise(session, choice, newId);
              setActive(next);
              setFocus(next.exercises[next.exercises.length - 1]?.key ?? null);
              setAdding(false);
            }}
          />
        ) : (
          <button type="button" className="quiet" onClick={() => setAdding(true)}>
            {t("gym.addExercise")}
          </button>
        )}
      </Card>
    </>
  );
}

function Summary({
  stats,
  result,
  unit,
  onClose,
}: {
  stats: SessionSummary;
  result: FlushResult;
  unit: WeightUnit;
  onClose: () => void;
}) {
  const t = useT();
  const volume = new Intl.NumberFormat(t.lang, { maximumFractionDigits: 0 }).format(stats.volume);
  return (
    <Card title={t("gym.summaryTitle")}>
      <dl className="gym-summary">
        <div>
          <dt>{t("gym.duration")}</dt>
          <dd className="num">{clock(stats.seconds)}</dd>
        </div>
        <div>
          <dt>{t("gym.sets")}</dt>
          <dd className="num">{stats.sets}</dd>
        </div>
        {stats.volume > 0 && (
          <div>
            <dt>{t("gym.volume")}</dt>
            <dd className="num">
              {volume} {unit}
            </dd>
          </div>
        )}
      </dl>
      {stats.bests.length > 0 && (
        <p className="gym-bests">{t("gym.bests", { names: stats.bests.join(", ") })}</p>
      )}
      <p className="hint" role="status">
        {result.refused > 0
          ? t("gym.syncRefused")
          : result.pending > 0
            ? t("gym.syncQueued")
            : t("gym.syncSaved")}
      </p>
      <button type="button" onClick={onClose}>
        {t("gym.backToGym")}
      </button>
    </Card>
  );
}
