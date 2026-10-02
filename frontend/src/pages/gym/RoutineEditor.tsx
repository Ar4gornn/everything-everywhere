import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { api } from "../../api/client";
import type { LineTargets, RoutineLine } from "../../api/types";
import { Card, Empty, ErrorBanner } from "../../components/ui";
import { useT } from "../../i18n";
import type { MessageKey } from "../../i18n";
import { errorMessage } from "../../i18n/errors";
import { ExerciseAdder } from "./ExerciseAdder";
import { useGym } from "./GymContext";
import { Field, MeasureInput } from "./MeasureInput";
import { formatTarget, toWeight } from "./measure";

interface LineDraft {
  sets: number | null;
  reps: number | null;
  seconds: number | null;
  distance: number | null;
  weight: number | null;
  rest: number | null;
  note: string;
}

function draftOf(line: RoutineLine): LineDraft {
  return {
    sets: line.target_sets,
    reps: line.target_reps,
    seconds: line.target_seconds,
    distance: line.target_distance_m,
    weight: line.target_weight === null ? null : Number(line.target_weight),
    rest: line.rest_seconds,
    note: line.note ?? "",
  };
}

/** Only what changed, explicit null for a cleared field (the API leaves absent keys alone). */
function patchOf(line: RoutineLine, draft: LineDraft): Partial<LineTargets> {
  const was = draftOf(line);
  const patch: Partial<LineTargets> = {};
  if (draft.sets !== was.sets) patch.target_sets = draft.sets;
  if (draft.reps !== was.reps) patch.target_reps = draft.reps;
  if (draft.seconds !== was.seconds) patch.target_seconds = draft.seconds;
  if (draft.distance !== was.distance) patch.target_distance_m = draft.distance;
  if (draft.weight !== was.weight) {
    patch.target_weight = draft.weight === null || draft.weight === 0 ? null : toWeight(draft.weight);
  }
  if (draft.rest !== was.rest) patch.rest_seconds = draft.rest;
  if (draft.note.trim() !== was.note) patch.note = draft.note.trim() || null;
  return patch;
}

/** One routine line: its kind-aware targets, saved with one PATCH. */
function LineEditor({
  line,
  index,
  count,
  disabled,
  onSave,
  onMove,
  onRemove,
}: {
  line: RoutineLine;
  index: number;
  count: number;
  disabled: boolean;
  onSave: (line: RoutineLine, patch: Partial<LineTargets>) => void;
  onMove: (index: number, by: -1 | 1) => void;
  onRemove: (line: RoutineLine) => void;
}) {
  const t = useT();
  const { unit } = useGym();
  const [draft, setDraft] = useState<LineDraft>(() => draftOf(line));
  const patch = patchOf(line, draft);
  const dirty = Object.keys(patch).length > 0;
  const set = (change: Partial<LineDraft>) => setDraft((was) => ({ ...was, ...change }));
  const name = line.exercise_name;

  return (
    <li className="gym-line">
      <div className="gym-line-head">
        <div>
          <strong className="gym-line-name">{name}</strong>
          <span className="gym-line-kind">{t(`gym.kind.${line.kind}`)}</span>
          <p className="hint gym-line-target">
            {formatTarget(line, unit, t) || t("gym.noTarget")}
          </p>
        </div>
        <div className="gym-line-move">
          <button
            type="button"
            className="quiet"
            disabled={disabled || index === 0}
            aria-label={t("gym.moveUp", { name })}
            onClick={() => onMove(index, -1)}
          >
            ↑
          </button>
          <button
            type="button"
            className="quiet"
            disabled={disabled || index === count - 1}
            aria-label={t("gym.moveDown", { name })}
            onClick={() => onMove(index, 1)}
          >
            ↓
          </button>
        </div>
      </div>

      <div className="gym-line-fields">
        <Field label={t("gym.sets")}>
          <MeasureInput
            label={t("gym.targetSetsOf", { name })}
            value={draft.sets}
            onChange={(sets) => set({ sets })}
          />
        </Field>
        {line.kind === "reps" && (
          <Field label={t("gym.reps")}>
            <MeasureInput
              label={t("gym.targetRepsOf", { name })}
              value={draft.reps}
              onChange={(reps) => set({ reps })}
            />
          </Field>
        )}
        {line.kind === "duration" && (
          <Field label={t("gym.seconds")}>
            <MeasureInput
              label={t("gym.targetSecondsOf", { name })}
              value={draft.seconds}
              suffix="s"
              onChange={(seconds) => set({ seconds })}
            />
          </Field>
        )}
        {line.kind === "distance" && (
          <Field label={t("gym.metres")}>
            <MeasureInput
              label={t("gym.targetMetresOf", { name })}
              value={draft.distance}
              suffix="m"
              onChange={(distance) => set({ distance })}
            />
          </Field>
        )}
        <Field label={t("gym.weightIn", { unit })}>
          <MeasureInput
            label={t("gym.targetWeightOf", { name })}
            value={draft.weight}
            decimal
            suffix={unit}
            onChange={(weight) => set({ weight })}
          />
        </Field>
        <Field label={t("gym.restSeconds")}>
          <MeasureInput
            label={t("gym.restOf", { name })}
            value={draft.rest}
            suffix="s"
            onChange={(rest) => set({ rest })}
          />
        </Field>
        <label className="gym-line-note">
          {t("field.note")}
          <input
            value={draft.note}
            maxLength={200}
            aria-label={t("gym.noteOf", { name })}
            onChange={(event) => set({ note: event.target.value })}
          />
        </label>
      </div>

      <div className="row">
        <button
          type="button"
          disabled={disabled || !dirty}
          aria-label={t("gym.saveLine", { name })}
          onClick={() => onSave(line, patch)}
        >
          {t("action.save")}
        </button>
        <button
          type="button"
          className="quiet"
          disabled={disabled}
          aria-label={t("gym.removeLine", { name })}
          onClick={() => onRemove(line)}
        >
          {t("action.remove")}
        </button>
      </div>
    </li>
  );
}

/** `/gym/routines/:id`: rename, targets, order, add and remove, delete, start. */
export function RoutineEditor() {
  const t = useT();
  const navigate = useNavigate();
  const { id = "" } = useParams();
  const { cache, isOffline, refresh, refreshing, start } = useGym();
  const routine = cache.routines.find((r) => r.id === id);
  const [name, setName] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, fallback: MessageKey) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (caught) {
      setError(errorMessage(t, caught, fallback));
    } finally {
      setBusy(false);
    }
  }

  if (!routine) {
    return (
      <Card title={t("gym.routines")}>
        {refreshing ? <Empty>{t("state.loading")}</Empty> : <Empty>{t("gym.routineNotFound")}</Empty>}
        <Link to="/gym" className="gym-link-button quiet">
          {t("gym.backToGym")}
        </Link>
      </Card>
    );
  }

  const disabled = isOffline || busy;
  const shownName = name ?? routine.name;
  const shownNote = note ?? routine.note ?? "";
  const detailsDirty = shownName.trim() !== routine.name || shownNote.trim() !== (routine.note ?? "");

  function move(index: number, by: -1 | 1) {
    if (!routine) return;
    const ids = routine.lines.map((line) => line.id);
    const other = index + by;
    const a = ids[index];
    const b = ids[other];
    if (a === undefined || b === undefined) return;
    ids[index] = b;
    ids[other] = a;
    void run(() => api.reorderRoutine(routine.id, ids), "gym.couldNotReorder");
  }

  return (
    <>
      <p>
        <Link to="/gym">← {t("gym.title")}</Link>
      </p>
      <ErrorBanner message={error} />

      <Card title={shownName || t("gym.routines")}>
        <form
          className="gym-routine-edit"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () =>
                api.updateRoutine(routine.id, {
                  name: shownName.trim(),
                  note: shownNote.trim() || null,
                }),
              "gym.couldNotSaveRoutine",
            );
          }}
        >
          <label>
            {t("gym.routineName")}
            <input
              value={shownName}
              maxLength={80}
              required
              disabled={isOffline}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            {t("field.note")}
            <input
              value={shownNote}
              maxLength={500}
              disabled={isOffline}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <button type="submit" disabled={disabled || !detailsDirty || !shownName.trim()}>
            {t("gym.saveDetails")}
          </button>
        </form>
        {isOffline && <p className="hint">{t("gym.needsConnection")}</p>}
        <div className="row gym-routine-actions">
          <button type="button" onClick={() => start(routine)}>
            {t("gym.startThis")}
          </button>
          <button
            type="button"
            className="quiet"
            disabled={disabled}
            onClick={() => {
              if (!window.confirm(t("gym.deleteRoutineConfirm", { name: routine.name }))) return;
              void (async () => {
                setBusy(true);
                try {
                  await api.deleteRoutine(routine.id);
                  await refresh();
                  navigate("/gym");
                } catch (caught) {
                  setError(errorMessage(t, caught, "gym.couldNotDeleteRoutine"));
                  setBusy(false);
                }
              })();
            }}
          >
            {t("gym.deleteRoutine")}
          </button>
        </div>
      </Card>

      <Card title={t("gym.exercisesOf", { name: routine.name })}>
        {routine.lines.length === 0 ? (
          <Empty>{t("gym.emptyRoutine", { name: routine.name })}</Empty>
        ) : (
          <ul className="gym-lines" aria-label={t("gym.exercisesOf", { name: routine.name })}>
            {routine.lines.map((line, index) => (
              <LineEditor
                // The draft is keyed by what it was made from: a saved line is a new draft.
                key={`${line.id}:${JSON.stringify(draftOf(line))}`}
                line={line}
                index={index}
                count={routine.lines.length}
                disabled={disabled}
                onSave={(target, patch) =>
                  void run(() => api.updateRoutineLine(target.id, patch), "gym.couldNotSaveLine")
                }
                onMove={move}
                onRemove={(target) =>
                  void run(() => api.removeRoutineLine(target.id), "gym.couldNotRemove")
                }
              />
            ))}
          </ul>
        )}
      </Card>

      <Card title={t("gym.addExercise")}>
        <ExerciseAdder
          exercises={cache.exercises}
          disabled={disabled}
          submitLabel={t("gym.addToRoutine")}
          onAdd={(choice) =>
            run(
              () =>
                api.addRoutineLine(
                  routine.id,
                  choice.exercise_id
                    ? { exercise_id: choice.exercise_id }
                    : { exercise_name: choice.name, kind: choice.kind },
                ),
              "gym.couldNotAddExercise",
            )
          }
        />
      </Card>
    </>
  );
}
