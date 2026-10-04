import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { api } from "../../api/client";
import type { LineTargets, RoutineLine, SetTarget } from "../../api/types";
import { Card, Empty, ErrorBanner } from "../../components/ui";
import { useT } from "../../i18n";
import type { MessageKey } from "../../i18n";
import { errorMessage } from "../../i18n/errors";
import { ExerciseAdder } from "./ExerciseAdder";
import { useGym } from "./GymContext";
import { Field, MeasureInput } from "./MeasureInput";
import { formatTarget, toWeight } from "./measure";
import {
  EffortFields,
  SetRows,
  SupersetToggle,
  TempoField,
  VarySwitch,
  cleanTempo,
  effortError,
  firstWorking,
  measureField,
  rowErrors,
  rowsDiffer,
  seedRows,
  tempoValid,
  type SetRow,
} from "./SetFields";

interface LineDraft {
  sets: number | null;
  reps: number | null;
  seconds: number | null;
  distance: number | null;
  weight: number | null;
  rest: number | null;
  restAfter: number | null;
  note: string;
  /** Per-set mode: `rows` are the sets. Otherwise the flat fields apply to every set. */
  varies: boolean;
  rows: SetRow[];
  rpe: number | null;
  rir: number | null;
  tempo: string;
  /** "Superset with next": this line and the one after it share a group. */
  link: boolean;
}

function draftOf(line: RoutineLine, link: boolean): LineDraft {
  return {
    sets: line.target_sets,
    reps: line.target_reps,
    seconds: line.target_seconds,
    distance: line.target_distance_m,
    weight: line.target_weight === null ? null : Number(line.target_weight),
    rest: line.rest_seconds,
    restAfter: line.rest_after_seconds,
    note: line.note ?? "",
    varies: line.set_targets != null,
    rows: (line.set_targets ?? []).map((s) => ({
      reps: s.reps,
      seconds: s.seconds,
      distance_m: s.distance_m,
      weight: s.weight === null ? null : Number(s.weight),
      warmup: s.warmup,
    })),
    rpe: line.target_rpe ?? null,
    rir: line.target_rir ?? null,
    tempo: line.tempo ?? "",
    link,
  };
}

/** The wire form of the rows: only the kind's measure, a weight of 0 is no weight. */
function targetsOf(kind: RoutineLine["kind"], rows: SetRow[]): SetTarget[] {
  const field = measureField(kind);
  return rows.map((row) => ({
    reps: field === "reps" ? row.reps : null,
    seconds: field === "seconds" ? row.seconds : null,
    distance_m: field === "distance_m" ? row.distance_m : null,
    weight: row.weight === null || row.weight === 0 ? null : toWeight(row.weight),
    warmup: row.warmup,
  }));
}

function sameTargets(a: SetTarget[], b: SetTarget[] | null | undefined): boolean {
  if (!b || a.length !== b.length) return false;
  return a.every((s, i) => {
    const o = b[i];
    return (
      o !== undefined &&
      s.reps === o.reps &&
      s.seconds === o.seconds &&
      s.distance_m === o.distance_m &&
      s.weight === o.weight &&
      s.warmup === o.warmup
    );
  });
}

/** Only what changed, explicit null for a cleared field (the API leaves absent keys alone). */
function patchOf(line: RoutineLine, draft: LineDraft): Partial<LineTargets> {
  const was = draftOf(line, draft.link);
  const patch: Partial<LineTargets> = {};
  if (draft.varies) {
    // The server derives the flat targets and the set count from the rows.
    const next = targetsOf(line.kind, draft.rows);
    if (!sameTargets(next, line.set_targets)) patch.set_targets = next;
  } else {
    if (line.set_targets != null) patch.set_targets = null;
    if (draft.sets !== was.sets) patch.target_sets = draft.sets;
    if (draft.reps !== was.reps) patch.target_reps = draft.reps;
    if (draft.seconds !== was.seconds) patch.target_seconds = draft.seconds;
    if (draft.distance !== was.distance) patch.target_distance_m = draft.distance;
    if (draft.weight !== was.weight) {
      patch.target_weight = draft.weight === null || draft.weight === 0 ? null : toWeight(draft.weight);
    }
  }
  if (draft.rest !== was.rest) patch.rest_seconds = draft.rest;
  if (draft.restAfter !== was.restAfter) patch.rest_after_seconds = draft.restAfter;
  if (draft.note.trim() !== was.note) patch.note = draft.note.trim() || null;
  if (draft.rpe !== was.rpe) patch.target_rpe = draft.rpe;
  if (draft.rir !== was.rir) patch.target_rir = draft.rir;
  if (cleanTempo(draft.tempo) !== was.tempo) patch.tempo = cleanTempo(draft.tempo) || null;
  return patch;
}

/** Which lines are joined to the next one (same group, adjacent). */
function linksOf(groups: (number | null)[]): boolean[] {
  return groups.map((g, i) => g != null && g === groups[i + 1]);
}

/** Runs of linked lines become groups 1, 2, … in order; a line linked to nobody has none. */
function groupsFromLinks(links: boolean[]): (number | null)[] {
  let n = 0;
  return links.map((_, i) => {
    const inRun = links[i] === true || (i > 0 && links[i - 1] === true);
    if (!inRun) return null;
    if (!(i > 0 && links[i - 1] === true)) n += 1;
    return n;
  });
}

/** One routine line: its kind-aware targets, saved with one PATCH. */
function LineEditor({
  line,
  index,
  count,
  linked,
  place,
  group,
  disabled,
  onSave,
  onMove,
  onRemove,
}: {
  line: RoutineLine;
  index: number;
  count: number;
  /** Joined to the next line by a superset, as saved. */
  linked: boolean;
  place: "start" | "mid" | "end" | undefined;
  group: number | null;
  disabled: boolean;
  onSave: (line: RoutineLine, patch: Partial<LineTargets>, link: boolean) => void;
  onMove: (index: number, by: -1 | 1) => void;
  onRemove: (line: RoutineLine) => void;
}) {
  const t = useT();
  const { unit } = useGym();
  const [draft, setDraft] = useState<LineDraft>(() => draftOf(line, linked));
  const patch = patchOf(line, draft);
  const dirty = Object.keys(patch).length > 0 || draft.link !== linked;
  const set = (change: Partial<LineDraft>) => setDraft((was) => ({ ...was, ...change }));
  const name = line.exercise_name;
  const rows = draft.rows.map((row) => ({ ...row, errors: rowErrors(line.kind, row) }));
  const effort = effortError(draft.rpe, draft.rir);
  const valid =
    tempoValid(draft.tempo) && effort === undefined && rows.every((row) => row.errors === undefined);

  function vary(on: boolean) {
    if (on) {
      set({
        varies: true,
        rows: seedRows(line.kind, draft.sets, {
          reps: draft.reps,
          seconds: draft.seconds,
          distance_m: draft.distance,
          weight: draft.weight,
        }),
      });
      return;
    }
    if (rowsDiffer(line.kind, draft.rows) && !window.confirm(t("gymPlans.sets.confirmSame"))) return;
    const first = firstWorking(draft.rows);
    set({
      varies: false,
      sets: draft.rows.length,
      reps: first?.reps ?? null,
      seconds: first?.seconds ?? null,
      distance: first?.distance_m ?? null,
      weight: first?.weight ?? null,
      rows: [],
    });
  }

  return (
    <li className="gym-line" data-superset={place}>
      {place && (
        <span className="gym-super-badge">{t("gymPlans.superset.badge", { n: group ?? 0 })}</span>
      )}
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

      <VarySwitch name={name} varies={draft.varies} onChange={vary} />
      {draft.varies && (
        <SetRows
          kind={line.kind}
          rows={rows}
          unit={unit}
          name={name}
          disabled={disabled}
          onChange={(next) => set({ rows: next })}
        />
      )}

      <div className="gym-line-fields">
        {!draft.varies && (
          <>
            <Field label={t("gym.sets")}>
              <MeasureInput
                label={t("gym.targetSetsOf", { name })}
                value={draft.sets}
                field="sets"
                onChange={(sets) => set({ sets })}
              />
            </Field>
            {line.kind === "reps" && (
              <Field label={t("gym.reps")}>
                <MeasureInput
                  label={t("gym.targetRepsOf", { name })}
                  value={draft.reps}
                  field="reps"
                  onChange={(reps) => set({ reps })}
                />
              </Field>
            )}
            {line.kind === "duration" && (
              <Field label={t("gym.seconds")}>
                <MeasureInput
                  label={t("gym.targetSecondsOf", { name })}
                  value={draft.seconds}
                  field="seconds"
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
                  field="distance_m"
                  suffix="m"
                  onChange={(distance) => set({ distance })}
                />
              </Field>
            )}
            <Field label={t("gym.weightIn", { unit })}>
              <MeasureInput
                label={t("gym.targetWeightOf", { name })}
                value={draft.weight}
                field="weight"
                decimal
                suffix={unit}
                onChange={(weight) => set({ weight })}
              />
            </Field>
          </>
        )}
        <Field label={t("gym.restSeconds")}>
          <MeasureInput
            label={t("gym.restOf", { name })}
            value={draft.rest}
            field="rest_seconds"
            suffix="s"
            onChange={(rest) => set({ rest })}
          />
        </Field>
        <Field label={t("gym.restAfterSeconds")}>
          <MeasureInput
            label={t("gym.restAfterOf", { name })}
            value={draft.restAfter}
            field="rest_seconds"
            suffix="s"
            onChange={(restAfter) => set({ restAfter })}
          />
        </Field>
        <EffortFields
          name={name}
          rpe={draft.rpe}
          rir={draft.rir}
          error={effort}
          onChange={(next) => set(next)}
        />
        <TempoField name={name} value={draft.tempo} onChange={(tempo) => set({ tempo })} />
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

      <SupersetToggle
        name={name}
        checked={draft.link}
        disabled={disabled || index === count - 1}
        onChange={(link) => set({ link })}
      />

      <div className="row">
        <button
          type="button"
          disabled={disabled || !dirty || !valid}
          aria-label={t("gym.saveLine", { name })}
          onClick={() => onSave(line, patch, draft.link)}
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
  const links = linksOf(routine.lines.map((l) => l.superset_group ?? null));
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
    void run(async () => {
      await api.reorderRoutine(routine.id, ids);
      // A moved line can leave a group split: renumber what is still adjacent.
      const order = ids.map((lineId) => routine.lines.find((l) => l.id === lineId));
      const groups = groupsFromLinks(linksOf(order.map((l) => l?.superset_group ?? null)));
      for (const [i, l] of order.entries()) {
        const group = groups[i] ?? null;
        if (l && (l.superset_group ?? null) !== group) {
          await api.updateRoutineLine(l.id, { superset_group: group });
        }
      }
    }, "gym.couldNotReorder");
  }

  /** Save one line, and renumber the supersets so each group is a run of adjacent lines. */
  function save(line: RoutineLine, patch: Partial<LineTargets>, link: boolean) {
    if (!routine) return;
    const links = linksOf(routine.lines.map((l) => l.superset_group ?? null));
    const at = routine.lines.findIndex((l) => l.id === line.id);
    links[at] = link;
    const groups = groupsFromLinks(links);
    void run(async () => {
      const own = groups[at] ?? null;
      const body = (line.superset_group ?? null) !== own ? { ...patch, superset_group: own } : patch;
      if (Object.keys(body).length > 0) await api.updateRoutineLine(line.id, body);
      for (const [i, other] of routine.lines.entries()) {
        const group = groups[i] ?? null;
        if (i !== at && (other.superset_group ?? null) !== group) {
          await api.updateRoutineLine(other.id, { superset_group: group });
        }
      }
    }, "gym.couldNotSaveLine");
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
                key={`${line.id}:${JSON.stringify(draftOf(line, links[index] === true))}`}
                line={line}
                index={index}
                count={routine.lines.length}
                linked={links[index] === true}
                place={
                  links[index] === true
                    ? links[index - 1] === true
                      ? "mid"
                      : "start"
                    : links[index - 1] === true
                      ? "end"
                      : undefined
                }
                group={line.superset_group ?? null}
                disabled={disabled}
                onSave={save}
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
