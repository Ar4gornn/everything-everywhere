import { useState, type FormEvent } from "react";

import { api } from "../../api/client";
import type { Exercise, ExerciseHistory, ExerciseKind, WorkoutDetail } from "../../api/types";
import { StrengthChart } from "../../charts/StrengthChart";
import { ListRow, useOpenRow } from "../../components/ListRow";
import { VideoLink } from "../../components/VideoLink";
import { Card, Empty, ErrorBanner } from "../../components/ui";
import { errorMessage } from "../../i18n/errors";
import { useT } from "../../i18n";
import { useDates } from "../../useDates";
import { KINDS } from "./ExerciseAdder";
import { pendingRefOf, undoRestDay } from "../../gym/store";
import { useGym } from "./GymContext";
import { formatDistance, formatSeconds, formatSet, workoutMinutes } from "./measure";

type WorkoutSet = WorkoutDetail["sets"][number];

/** A session's sets, one group per run of the same exercise, in the order they were done. */
function byExercise(sets: WorkoutSet[]): { name: string; sets: WorkoutSet[] }[] {
  const groups: { name: string; sets: WorkoutSet[] }[] = [];
  for (const set of sets) {
    const last = groups[groups.length - 1];
    if (last && last.name === set.exercise_name) last.sets.push(set);
    else groups.push({ name: set.exercise_name, sets: [set] });
  }
  return groups;
}

/** Recent sessions from the cache; the sets of one load when it is opened (online only). */
export function HistoryCard({ tour }: { tour?: string }) {
  const t = useT();
  const dates = useDates();
  const { cache, unit, isOffline, refresh, userId } = useGym();
  const [openId, toggle] = useOpenRow();
  const [details, setDetails] = useState<Record<string, WorkoutDetail>>({});
  const [error, setError] = useState<string | null>(null);
  const names = new Map(cache.routines.map((r) => [r.id, r.name]));

  async function open(id: string) {
    toggle(id);
    if (details[id] || isOffline || pendingRefOf(id)) return;
    try {
      const detail = await api.readWorkout(id);
      setDetails((was) => ({ ...was, [id]: detail }));
    } catch (caught) {
      setError(errorMessage(t, caught, "gym.couldNotOpenSession"));
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t("gym.deleteSessionConfirm"))) return;
    try {
      const pendingRef = pendingRefOf(id);
      // A stub the server has not answered for yet has no server row: discard, never delete.
      if (pendingRef) await undoRestDay(userId, pendingRef);
      else await api.deleteWorkout(id);
      await refresh();
    } catch (caught) {
      setError(errorMessage(t, caught, "gym.couldNotDeleteSession"));
    }
  }

  return (
    <Card
      title={t("gym.history")}
      collapseKey="gym.history"
      summary={`${cache.workouts.filter((w) => !w.rest_day).length}`}
      tour={tour}
    >
      <ErrorBanner message={error} />
      {cache.workouts.length === 0 ? (
        <Empty>{t("gym.nothingLogged")}</Empty>
      ) : (
        <ul className="list-rows" aria-label={t("gym.history")}>
          {cache.workouts.map((entry) => {
            const detail = details[entry.id];
            if (entry.rest_day) {
              // A rest day is not a session: no routine, no minutes, no sets to load.
              return (
                <ListRow
                  key={entry.id}
                  title={
                    <>
                      <span aria-hidden="true">☾ </span>
                      {t("gym.restDay")}
                    </>
                  }
                  meta={dates.day(entry.performed_on)}
                  open={openId === entry.id}
                  onToggle={() => toggle(entry.id)}
                  details={
                    <div className="gym-history-detail">
                      <p className="hint">{t("gym.restDayRow")}</p>
                      <button
                        type="button"
                        className="quiet"
                        disabled={isOffline}
                        aria-label={t("gym.deleteSession", { date: entry.performed_on })}
                        onClick={() => void remove(entry.id)}
                      >
                        {t("action.delete")}
                      </button>
                    </div>
                  }
                />
              );
            }
            const minutes = workoutMinutes(entry);
            const routine = entry.routine_id ? names.get(entry.routine_id) : undefined;
            const meta = [
              routine,
              minutes === null ? null : t("gym.minutes", { n: minutes }),
              detail
                ? t.n("gym.setsCount", detail.sets.length)
                : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <ListRow
                key={entry.id}
                title={dates.day(entry.performed_on)}
                meta={meta || undefined}
                open={openId === entry.id}
                onToggle={() => void open(entry.id)}
                details={
                  <div className="gym-history-detail">
                    {isOffline && !detail ? (
                      <p className="hint">{t("gym.offlineDetail")}</p>
                    ) : !detail ? (
                      <p className="hint">{t("state.loading")}</p>
                    ) : detail.sets.length === 0 ? (
                      <p className="hint">{t("gym.noSets")}</p>
                    ) : (
                      byExercise(detail.sets).map((group) => (
                        <div key={`${group.name}:${group.sets[0]?.id}`}>
                          <h4 className="gym-history-exercise">{group.name}</h4>
                          <p className="num">
                            {group.sets.map((s) => formatSet(s, unit, t)).join(" · ")}
                          </p>
                        </div>
                      ))
                    )}
                    <button
                      type="button"
                      className="quiet"
                      disabled={isOffline}
                      aria-label={t("gym.deleteSession", { date: entry.performed_on })}
                      onClick={() => void remove(entry.id)}
                    >
                      {t("action.delete")}
                    </button>
                  </div>
                }
              />
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** Seconds or metres per session as plain bars: the weight chart has nothing to say for these. */
function MeasureBars({ history, kind }: { history: ExerciseHistory; kind: ExerciseKind }) {
  const t = useT();
  const dates = useDates();
  const points = history.points.slice(-12).map((p) => ({
    date: p.performed_on,
    value: (kind === "duration" ? p.best_seconds : p.best_distance_m) ?? 0,
  }));
  const peak = Math.max(1, ...points.map((p) => p.value));
  return (
    <ul className="gym-bars" aria-label={t("gym.progressOf", { name: history.exercise_name })}>
      {points.map((p) => (
        <li key={p.date}>
          <span className="gym-bar-date">{dates.day(p.date)}</span>
          <span className="gym-bar-track">
            <span className="gym-bar-fill" style={{ width: `${(p.value / peak) * 100}%` }} />
          </span>
          <span className="gym-bar-value num">
            {kind === "duration" ? formatSeconds(p.value) : formatDistance(p.value, t.lang)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ExerciseEditor({
  exercise,
  onDone,
}: {
  exercise: Exercise;
  onDone: (saved: boolean) => void;
}) {
  const t = useT();
  const [name, setName] = useState(exercise.name);
  const [kind, setKind] = useState<ExerciseKind>(exercise.kind);
  const [video, setVideo] = useState(exercise.video_url ?? "");
  const [note, setNote] = useState(exercise.note ?? "");
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api.updateExercise(exercise.id, {
        name: name.trim(),
        ...(kind !== exercise.kind ? { kind } : {}),
        video_url: video.trim() || null,
        note: note.trim() || null,
      });
      onDone(true);
    } catch (caught) {
      setError(errorMessage(t, caught, "gym.couldNotSaveExercise"));
    }
  }

  return (
    <form className="gym-exercise-edit" onSubmit={(event) => void save(event)}>
      <ErrorBanner message={error} />
      <label>
        {t("field.name")}
        <input value={name} maxLength={80} required onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        {t("gym.kind")}
        <select value={kind} onChange={(e) => setKind(e.target.value as ExerciseKind)}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`gym.kind.${k}`)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("gym.videoLink")}
        <input
          value={video}
          inputMode="url"
          placeholder="https://"
          onChange={(e) => setVideo(e.target.value)}
        />
      </label>
      <label>
        {t("field.note")}
        <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="row">
        <button type="submit">{t("action.save")}</button>
        <button type="button" className="quiet" onClick={() => onDone(false)}>
          {t("action.cancel")}
        </button>
      </div>
    </form>
  );
}

/** The exercises: read from the cache (so readable offline), edited and charted online. */
export function ExercisesCard() {
  const t = useT();
  const { cache, unit, isOffline, refresh } = useGym();
  const [openId, toggle] = useOpenRow();
  const [editing, setEditing] = useState<string | null>(null);
  const [history, setHistory] = useState<ExerciseHistory | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function showHistory(exercise: Exercise) {
    setError(null);
    if (history?.exercise_id === exercise.id) {
      setHistory(null);
      return;
    }
    try {
      setHistory(await api.exerciseHistory(exercise.id));
    } catch (caught) {
      setError(errorMessage(t, caught, "gym.couldNotLoadHistory"));
    }
  }

  const shownKind = history ? cache.exercises.find((e) => e.id === history.exercise_id)?.kind : null;

  return (
    <Card
      title={t("gym.exercises")}
      collapseKey="gym.exercises"
      summary={t.n("gym.exercisesCount", cache.exercises.length)}
    >
      <ErrorBanner message={error} />
      {cache.exercises.length === 0 ? (
        <Empty>{t("gym.logToSee")}</Empty>
      ) : (
        <ul className="list-rows" aria-label={t("gym.exercises")}>
          {cache.exercises.map((exercise) => (
            <ListRow
              key={exercise.id}
              title={exercise.name}
              meta={[t(`gym.kind.${exercise.kind}`), exercise.note].filter(Boolean).join(" · ")}
              open={openId === exercise.id}
              onToggle={() => toggle(exercise.id)}
              details={
                editing === exercise.id ? (
                  <ExerciseEditor
                    exercise={exercise}
                    onDone={(saved) => {
                      setEditing(null);
                      if (saved) void refresh();
                    }}
                  />
                ) : (
                  <div className="row">
                    {exercise.video_url && (
                      <VideoLink url={exercise.video_url} label={t("gym.video")} />
                    )}
                    <button
                      type="button"
                      className="quiet"
                      disabled={isOffline}
                      aria-label={t("gym.progressOf", { name: exercise.name })}
                      onClick={() => void showHistory(exercise)}
                    >
                      {t("gym.progress")}
                    </button>
                    <button
                      type="button"
                      className="quiet"
                      disabled={isOffline}
                      aria-label={t("gym.editNamed", { name: exercise.name })}
                      onClick={() => setEditing(exercise.id)}
                    >
                      {t("action.edit")}
                    </button>
                  </div>
                )
              }
            />
          ))}
        </ul>
      )}
      {isOffline && cache.exercises.length > 0 && (
        <p className="hint">{t("gym.offlineReadOnly")}</p>
      )}
      {history &&
        (history.points.length === 0 ? (
          <Empty>{t("gym.nothingLoggedFor", { name: history.exercise_name })}</Empty>
        ) : (
          <div className="gym-chart">
            {shownKind === "reps" || !shownKind ? (
              <StrengthChart points={history.points} label={history.exercise_name} unit={unit} />
            ) : (
              <MeasureBars history={history} kind={shownKind} />
            )}
          </div>
        ))}
    </Card>
  );
}
