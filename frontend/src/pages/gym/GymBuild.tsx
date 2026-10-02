import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { api } from "../../api/client";
import type {
  Exercise,
  ExerciseKind,
  RoutineDetail,
  RoutineImport,
  RoutineImportLine,
} from "../../api/types";
import { Card } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { newId } from "../../gym/id";
import { sessionFromLines, startSession, type BuilderLine } from "../../gym/session";
import { useT } from "../../i18n";
import { todayIso } from "../../months";
import { useDates } from "../../useDates";
import { KINDS } from "./ExerciseAdder";
import { useGym } from "./GymContext";
import { Stepper } from "./MeasureInput";

/** A builder line while it is being edited: any number may be blank until Start. */
interface Line {
  key: string;
  exercise_id: string | null;
  name: string;
  kind: ExerciseKind;
  sets: number | null;
  reps: number | null;
  seconds: number | null;
  distance_m: number | null;
  weight: number | null;
}

/** What a new line starts with, so Start is one tap: 3 × 10, 3 × 30 s, 1 × 1000 m. */
function fresh(exercise_id: string | null, name: string, kind: ExerciseKind): Line {
  return {
    key: newId(),
    exercise_id,
    name,
    kind,
    sets: kind === "distance" ? 1 : 3,
    reps: kind === "reps" ? 10 : null,
    seconds: kind === "duration" ? 30 : null,
    distance_m: kind === "distance" ? 1000 : null,
    weight: null,
  };
}

function toBuilder(line: Line): BuilderLine {
  return {
    exercise_id: line.exercise_id,
    name: line.name,
    kind: line.kind,
    sets: line.sets ?? 1,
    reps: line.reps,
    seconds: line.seconds,
    distance_m: line.distance_m,
    weight: line.weight !== null && line.weight > 0 ? line.weight.toFixed(2) : null,
  };
}

/** The import call's body, built the way `toImportBody` builds one from a reviewed draft. */
function toBody(name: string, lines: BuilderLine[]): RoutineImport {
  return {
    name,
    lines: lines.map((line) => {
      const out: RoutineImportLine = { exercise_name: line.name, kind: line.kind };
      out.target_sets = line.sets;
      if (line.kind === "reps" && line.reps !== null) out.target_reps = line.reps;
      if (line.kind === "duration" && line.seconds !== null) out.target_seconds = line.seconds;
      if (line.kind === "distance" && line.distance_m !== null) out.target_distance_m = line.distance_m;
      if (line.weight !== null) out.target_weight = line.weight;
      return out;
    }),
  };
}

/** Existing exercises, the ones this person actually uses first. */
function byUse(exercises: Exercise[], used: Map<string, number>): Exercise[] {
  return [...exercises].sort(
    (a, b) => (used.get(b.id) ?? 0) - (used.get(a.id) ?? 0) || a.name.localeCompare(b.name),
  );
}

const SUGGESTIONS = 8;

/**
 * `/gym/build` (Epic 43 §7.2): a workout in a few taps. Nothing is required: the name is
 * filled in, every added exercise comes with numbers, Start works with the list as it is.
 */
export function GymBuild() {
  const t = useT();
  const dates = useDates();
  const toast = useToast();
  const navigate = useNavigate();
  const { cache, unit, isOffline, active, setActive, refresh } = useGym();
  const [name, setName] = useState(() =>
    t("gym.build.defaultName", { date: dates.day(todayIso()) }),
  );
  const [lines, setLines] = useState<Line[]>([]);
  const [query, setQuery] = useState("");
  const [newKind, setNewKind] = useState<ExerciseKind>("reps");
  const [save, setSave] = useState(true);
  const [busy, setBusy] = useState(false);

  const used = useMemo(() => {
    const counts = new Map<string, number>();
    for (const routine of cache.routines) {
      for (const line of routine.lines) {
        counts.set(line.exercise_id, (counts.get(line.exercise_id) ?? 0) + 1);
      }
    }
    for (const id of Object.keys(cache.lastTime)) counts.set(id, (counts.get(id) ?? 0) + 1);
    return counts;
  }, [cache.routines, cache.lastTime]);

  const wanted = query.trim().toLowerCase();
  const exact = wanted ? cache.exercises.find((e) => e.name.toLowerCase() === wanted) : undefined;
  const taken = new Set(lines.map((l) => l.name.toLowerCase()));
  const suggestions = byUse(cache.exercises, used)
    .filter((e) => !taken.has(e.name.toLowerCase()))
    .filter((e) => !wanted || e.name.toLowerCase().includes(wanted))
    .slice(0, SUGGESTIONS);

  function add(line: Line) {
    setLines((was) => [...was, line]);
    setQuery("");
  }
  function addExisting(exercise: Exercise) {
    add(fresh(exercise.id, exercise.name, exercise.kind));
  }
  function addTyped(event: FormEvent) {
    event.preventDefault();
    if (!wanted) return;
    if (exact) {
      if (!taken.has(exact.name.toLowerCase())) addExisting(exact);
      return;
    }
    add(fresh(null, query.trim(), newKind));
  }
  function change(key: string, patch: Partial<Line>) {
    setLines((was) => was.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function move(index: number, by: -1 | 1) {
    setLines((was) => {
      const next = [...was];
      const a = next[index];
      const b = next[index + by];
      if (!a || !b) return was;
      next[index] = b;
      next[index + by] = a;
      return next;
    });
  }

  async function begin() {
    // One session at a time: starting another would silently drop the sets already done.
    if (active && !window.confirm(t("gym.replaceConfirm"))) return;
    setBusy(true);
    const now = new Date();
    const built = lines.map(toBuilder);
    const title = name.trim() || t("gym.build.defaultName", { date: dates.day(todayIso(now)) });
    try {
      if (save && !isOffline && built.length > 0) {
        let routine: RoutineDetail | null = null;
        try {
          routine = await api.importRoutine(toBody(title, built));
        } catch {
          // Not worth losing the workout over: start it, and say the routine did not save.
          toast.show(t("gym.build.notSaved"));
        }
        if (routine) {
          // Saved: whatever fails next (the refresh), the routine exists and is what starts.
          try {
            await refresh();
          } catch {
            /* the cache catches up on the next refresh */
          }
          setActive(startSession(routine, now, newId));
          navigate("/gym/session");
          return;
        }
      }
      setActive(sessionFromLines(title, built, now, newId));
      navigate("/gym/session");
    } finally {
      setBusy(false);
    }
  }

  const step = unit === "lb" ? 5 : 2.5;
  return (
    <>
      <p>
        <Link to="/gym">← {t("gym.title")}</Link>
      </p>
      <Card title={t("gym.build.title")}>
        <label>
          {t("field.name")}
          <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
        </label>

        <form className="gym-build-add" onSubmit={addTyped}>
          <label>
            {t("gym.build.add")}
            <input
              value={query}
              maxLength={80}
              autoComplete="off"
              placeholder={t("gym.exercisePlaceholder")}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {suggestions.length > 0 && (
            <ul className="gym-build-suggest" aria-label={t("gym.build.yours")}>
              {suggestions.map((exercise) => (
                <li key={exercise.id}>
                  <button
                    type="button"
                    className="quiet gym-chip"
                    onClick={() => addExisting(exercise)}
                  >
                    {exercise.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {wanted && !exact && (
            <>
              <div className="gym-chips" role="group" aria-label={t("gym.build.kindFor")}>
                {KINDS.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className={`quiet gym-chip${newKind === kind ? " is-on" : ""}`}
                    aria-pressed={newKind === kind}
                    onClick={() => setNewKind(kind)}
                  >
                    {t(`gym.kind.${kind}`)}
                  </button>
                ))}
              </div>
              <button type="submit">{t("gym.build.addNew", { name: query.trim() })}</button>
            </>
          )}
        </form>
      </Card>

      <Card>
        {lines.length === 0 ? (
          <p className="hint">{t("gym.build.empty")}</p>
        ) : (
          <ul className="gym-lines" aria-label={t("gym.build.lines")}>
            {lines.map((line, index) => (
              <li className="gym-line" key={line.key} aria-label={line.name}>
                <div className="gym-line-head">
                  <div>
                    <strong className="gym-line-name">{line.name}</strong>
                    <span className="gym-line-kind">{t(`gym.kind.${line.kind}`)}</span>
                  </div>
                  <div className="gym-line-move">
                    <button
                      type="button"
                      className="quiet"
                      disabled={index === 0}
                      aria-label={t("gym.moveUp", { name: line.name })}
                      onClick={() => move(index, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="quiet"
                      disabled={index === lines.length - 1}
                      aria-label={t("gym.moveDown", { name: line.name })}
                      onClick={() => move(index, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="quiet"
                      aria-label={t("gym.build.removeLine", { name: line.name })}
                      onClick={() => setLines((was) => was.filter((l) => l.key !== line.key))}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <div className="gym-line-fields">
                  <Stepper
                    label={t("gym.sets")}
                    value={line.sets}
                    min={1}
                    step={1}
                    field="sets"
                    onChange={(sets) => change(line.key, { sets })}
                  />
                  {line.kind === "reps" && (
                    <Stepper
                      label={t("gym.reps")}
                      value={line.reps}
                      min={1}
                      step={1}
                      field="reps"
                      onChange={(reps) => change(line.key, { reps })}
                    />
                  )}
                  {line.kind === "duration" && (
                    <Stepper
                      label={t("gym.seconds")}
                      value={line.seconds}
                      min={1}
                      step={5}
                      suffix="s"
                      field="seconds"
                      onChange={(seconds) => change(line.key, { seconds })}
                    />
                  )}
                  {line.kind === "distance" && (
                    <Stepper
                      label={t("gym.metres")}
                      value={line.distance_m}
                      min={1}
                      step={100}
                      suffix="m"
                      field="distance_m"
                      onChange={(distance_m) => change(line.key, { distance_m })}
                    />
                  )}
                  <Stepper
                    label={t("gym.weightIn", { unit })}
                    value={line.weight}
                    step={step}
                    decimal
                    suffix={unit}
                    field="weight"
                    onChange={(weight) => change(line.key, { weight })}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
        <p>
          <Link to="/gym/import">{t("gym.build.askAi")}</Link>
        </p>
      </Card>

      <div className="gym-build-footer">
        <label className="gym-build-save">
          <input
            type="checkbox"
            checked={save}
            onChange={(event) => setSave(event.target.checked)}
          />
          <span>{t("gym.build.save")}</span>
        </label>
        <button type="button" className="gym-build-start" disabled={busy} onClick={() => void begin()}>
          {t("gym.build.start")}
        </button>
      </div>
    </>
  );
}
