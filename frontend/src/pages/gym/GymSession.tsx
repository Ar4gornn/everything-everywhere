import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import type { HistoryPoint, WeightUnit } from "../../api/types";
import { Card, Empty, ErrorBanner } from "../../components/ui";
import { VideoLink } from "../../components/VideoLink";
import {
  addExercise,
  currentExercise,
  extendRest,
  logSet,
  nextSetDraft,
  progress,
  removeExercise,
  removeSet,
  restAfterSet,
  skipRest,
  startRest,
  supersetMembers,
  targetForNext,
  updateSet,
  type ActiveSession,
  type SessionExercise,
  type SessionSet,
} from "../../gym/session";
import { newId } from "../../gym/id";
import { finishActive, type FlushResult } from "../../gym/store";
import { useT } from "../../i18n";
import { vibrate, useNow, useWakeLock } from "./device";
import { ExerciseAdder } from "./ExerciseAdder";
import { useGym } from "./GymContext";
import { MeasureInput } from "./MeasureInput";
import {
  clock,
  formatDistance,
  formatSeconds,
  formatSet,
  formatTarget,
  formatWeight,
  rpeText,
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

/** Seconds a rest button adds, and the presets the header's Rest offers. */
const EXTEND_SECONDS = 15;
const REST_PRESETS = [30, 60, 90, 120, 180];

/** The rest countdown. Reads `until - now`, so a locked phone shows the right time on waking. */
function RestBar({
  until,
  before,
  onExtend,
  onSkip,
}: {
  until: string;
  /** The exercise the rest is before, when it is the rest between two exercises. */
  before: string | null;
  onExtend: () => void;
  onSkip: () => void;
}) {
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
      <span className="gym-rest-label">
        {before ? t("gym.restBefore", { name: before }) : t("gym.rest")}
      </span>
      <span className="gym-rest-clock num">{clock(remaining)}</span>
      <span className="gym-rest-buttons">
        <button type="button" className="quiet" onClick={onExtend}>
          {t("gym.restPlus", { n: EXTEND_SECONDS })}
        </button>
        <button type="button" className="quiet" onClick={onSkip}>
          {t("gym.skipRest")}
        </button>
      </span>
    </div>
  );
}

/** The header's Rest: five presets and a custom number of seconds, one tap to start. */
function RestPicker({ onStart }: { onStart: (seconds: number) => void }) {
  const t = useT();
  const [custom, setCustom] = useState(false);
  const [seconds, setSeconds] = useState<number | null>(60);
  return (
    <Card>
      <div className="gym-rest-picker" role="group" aria-label={t("gym.restPresets")}>
        {REST_PRESETS.map((n) => (
          <button key={n} type="button" className="quiet gym-chip" onClick={() => onStart(n)}>
            {t("gym.restPreset", { n })}
          </button>
        ))}
        <button
          type="button"
          className="quiet gym-chip"
          aria-expanded={custom}
          onClick={() => setCustom((was) => !was)}
        >
          {t("gym.restCustom")}
        </button>
      </div>
      {custom && (
        <div className="gym-rest-custom">
          <MeasureInput
            label={t("gym.restSeconds")}
            value={seconds}
            field="rest_seconds"
            suffix="s"
            onChange={setSeconds}
          />
          <button
            type="button"
            disabled={seconds === null || seconds <= 0}
            onClick={() => seconds && onStart(seconds)}
          >
            {t("gym.restStart")}
          </button>
        </div>
      )}
    </Card>
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
    <li className={`gym-set${set.is_warmup ? " is-warmup" : ""}`}>
      <span className="gym-set-n">{label}</span>
      <span className="gym-set-value num">
        {text}
        {set.is_warmup ? <span className="gym-warmup-badge">{t("gymSessionV2.warmup")}</span> : null}
      </span>
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
  onLogged,
}: {
  exercise: SessionExercise;
  session: ActiveSession;
  unit: WeightUnit;
  number: number;
  save: (next: ActiveSession) => void;
  /** Called with the exercise the coming rest is before, as the set is saved. */
  onLogged: (beforeNext: string | null) => void;
}) {
  const t = useT();
  const [entry, setEntry] = useState<SetEntry>(() =>
    entryFromDraft(nextSetDraft(session, exercise.key)),
  );
  const [problem, setProblem] = useState<string | null>(null);
  const planned = targetForNext(session, exercise.key);

  function done() {
    if (!entryIsComplete(exercise.kind, entry)) {
      setProblem(t(`gym.need.${exercise.kind}`));
      return;
    }
    try {
      // Asked before the set is saved: it answers "the rest this set will start".
      const rest = restAfterSet(session, exercise.key);
      save(logSet(session, exercise.key, draftFromEntry(exercise.kind, entry), new Date(), newId));
      onLogged(rest.beforeNext);
      setProblem(null);
    } catch (caught) {
      setProblem(
        caught instanceof Error && caught.message === "too_many_sets"
          ? t("gym.tooManySets")
          : t(`gym.need.${exercise.kind}`),
      );
    }
  }

  return (
    <div className="gym-next">
      <h4 className="gym-next-title">
        {t("rows.setN", { n: number })}
        {planned?.warmup ? (
          <span className="gym-warmup-badge" title={t("gymSessionV2.warmupHelp")}>
            {t("gymSessionV2.warmup")}
          </span>
        ) : null}
      </h4>
      <SetFields
        kind={exercise.kind}
        entry={entry}
        onChange={(next) => {
          setEntry(next);
          setProblem(null);
        }}
        unit={unit}
        targetSeconds={planned?.seconds ?? exercise.target_seconds}
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

/** Effort, tempo and superset hints under an exercise (Epic 54.4). Renders nothing without any. */
function Hints({
  exercise,
  session,
  current,
}: {
  exercise: SessionExercise;
  session: ActiveSession;
  current: string | null;
}) {
  const t = useT();
  const members = supersetMembers(session, exercise.key);
  const grouped = members.length > 1;
  let next: string | undefined;
  if (grouped) {
    const left = members.filter(
      (m) => session.sets.filter((s) => s.exercise === m.key).length < (m.target_sets ?? 1),
    );
    const now = left.find((m) => m.key === current);
    // Doing this one now: the other side of the pair comes next. Otherwise the current one does.
    const after = now && now.key !== exercise.key ? now : left.find((m) => m.key !== exercise.key);
    next = after?.name;
  }
  const hasEffort = exercise.target_rpe != null || exercise.target_rir != null;
  if (!hasEffort && !exercise.tempo && !grouped) return null;
  return (
    <>
      {(hasEffort || exercise.tempo) && (
        <ul className="hint gym-hints">
          {exercise.target_rpe != null && (
            <li title={t("gymSessionV2.rpeHelp")}>{t("gymSessionV2.rpe", { n: rpeText(exercise.target_rpe, t.lang) })}</li>
          )}
          {exercise.target_rir != null && (
            <li title={t("gymSessionV2.rirHelp")}>{t.n("gymSessionV2.rir", exercise.target_rir)}</li>
          )}
          {exercise.tempo ? (
            <li>
              <details>
                <summary>{t("gymSessionV2.tempo", { value: exercise.tempo })}</summary>
                {t("gymSessionV2.tempoHelp")}
              </details>
            </li>
          ) : null}
        </ul>
      )}
      {grouped && (
        <p className="hint gym-superset">
          {t("gymSessionV2.superset", { names: members.map((m) => m.name).join(" ↔ ") })}
          {next ? ` · ${t("gymSessionV2.supersetNext", { name: next })}` : ""}
        </p>
      )}
    </>
  );
}

export function GymSession() {
  const t = useT();
  const navigate = useNavigate();
  const { active, cache, userId, unit, setActive } = useGym();
  const [focus, setFocus] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [adding, setAdding] = useState(false);
  const [resting, setResting] = useState(false);
  const [restBefore, setRestBefore] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{
    stats: SessionSummary;
    result: FlushResult;
    hadRoutine: boolean;
  } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  useWakeLock();

  const current = useMemo(() => (active ? currentExercise(active) : null), [active]);
  const open = focus ?? current;

  if (summary) return <Summary {...summary} unit={unit} onClose={() => navigate("/gym")} />;
  if (!active && busy) {
    // Finish has already moved the session to the outbox: say so, not "no session".
    return (
      <Card title={t("gym.sessionTitle")}>
        <p role="status">{t("gym.finishing")}</p>
      </Card>
    );
  }
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
      setSummary({ stats: figures, result, hadRoutine: session.routine_id !== null });
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
            aria-expanded={resting}
            onClick={() => setResting((was) => !was)}
          >
            {t("gym.rest")}
          </button>
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

      {resting && (
        <RestPicker
          onStart={(seconds) => {
            setRestBefore(null);
            setResting(false);
            setActive(startRest(session, seconds, new Date()));
          }}
        />
      )}

      <ErrorBanner message={error} />

      {session.rest_until && (
        <RestBar
          until={session.rest_until}
          before={restBefore}
          onExtend={() => setActive(extendRest(session, EXTEND_SECONDS, new Date()))}
          onSkip={() => {
            setRestBefore(null);
            setActive(skipRest(session));
          }}
        />
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
                        <VideoLink url={exercise.video_url} label={t("gym.video")} />
                      </>
                    )}
                  </p>
                  {exercise.note ? <p className="hint">{exercise.note}</p> : null}
                  <Hints exercise={exercise} session={session} current={current} />

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
                    onLogged={setRestBefore}
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
  hadRoutine,
  unit,
  onClose,
}: {
  stats: SessionSummary;
  result: FlushResult;
  hadRoutine: boolean;
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
      {!hadRoutine && (
        <p>
          <Link to="/gym/import">{t("gym.summaryAskAi")}</Link>
        </p>
      )}
      <button type="button" onClick={onClose}>
        {t("gym.backToGym")}
      </button>
    </Card>
  );
}
