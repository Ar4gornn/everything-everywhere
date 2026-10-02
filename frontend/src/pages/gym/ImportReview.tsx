import type { ExerciseKind } from "../../api/types";
import { Card, ErrorBanner } from "../../components/ui";
import { hasDroppedMeasure, validateLine, type DraftLine, type DraftRoutine, type LineField } from "../../gym/format";
import { useT } from "../../i18n";
import { KINDS } from "./ExerciseAdder";
import { useGym } from "./GymContext";
import { Field, MeasureInput } from "./MeasureInput";
import { formatTarget, toWeight } from "./measure";

/** The review's state: the drafts, what was decided about each line, and where the person is. */
export type Decision = "pending" | "confirmed" | "skipped";

export interface Wizard {
  routines: DraftRoutine[];
  decisions: Decision[][];
  /** Index into the flat list of lines; equal to the line count on the final summary. */
  step: number;
  /** The file's week plan ("Push day", "rest", …), shown read-only. Absent in an older draft. */
  schedule?: string[] | null;
}

export function stepsOf(routines: DraftRoutine[]): [number, number][] {
  return routines.flatMap((r, ri) => r.lines.map((_, li): [number, number] => [ri, li]));
}

export function wizardFor(routines: DraftRoutine[], schedule: string[] | null = null): Wizard {
  return {
    routines,
    decisions: routines.map((r) => r.lines.map(() => "pending")),
    step: 0,
    schedule,
  };
}

/** The plan's week as written: "Mon Push day · Tue rest · …". Nothing here schedules anything. */
function WeekStrip({ schedule }: { schedule: string[] }) {
  const t = useT();
  if (schedule.length === 0) return null;
  // A Monday, so the first label is "Mon"; the language is the account's, not the machine's.
  const day = (i: number) =>
    new Intl.DateTimeFormat(t.lang, { weekday: "short" }).format(new Date(2024, 0, 1 + (i % 7)));
  return (
    <div className="gym-week">
      <h3>{t("gym.schedule.title")}</h3>
      <ol className="gym-week-strip">
        {schedule.map((label, i) => {
          const rest = ["rest", "repos"].includes(label.trim().toLowerCase());
          return (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list, labels may repeat
              key={i}
              className={rest ? "is-rest" : undefined}
            >
              <span className="gym-week-day">{day(i)}</span>
              <span className="gym-week-label">{rest ? t("gym.schedule.rest") : label}</span>
            </li>
          );
        })}
      </ol>
      <p className="hint">{t("gym.schedule.note")}</p>
    </div>
  );
}

/** A draft line in the shape `formatTarget` reads. */
export function targetsOf(line: DraftLine) {
  return {
    kind: line.kind,
    target_sets: line.sets,
    target_reps: line.reps,
    target_seconds: line.seconds,
    target_distance_m: line.distance_m,
    target_weight: line.weight === null ? null : toWeight(line.weight),
    rest_seconds: line.rest_seconds,
  };
}

function FieldError({ line, field }: { line: DraftLine; field: LineField }) {
  const t = useT();
  const key = line.errors[field];
  return key ? (
    <p className="gym-field-error" role="alert">
      {t(key)}
    </p>
  ) : null;
}

/** One exercise per step: every field editable, matched against the person's exercises. */
export function ImportReview({
  wizard,
  onChange,
  onCreate,
  creating,
  error,
  created,
  onStartOver,
}: {
  wizard: Wizard;
  onChange: (next: Wizard) => void;
  /** `start`: begin the first routine as soon as it exists. */
  onCreate: (start: boolean) => void;
  creating: boolean;
  error: string | null;
  /** Routine indexes already made on the server (a retry skips them). */
  created: number[];
  onStartOver: () => void;
}) {
  const t = useT();
  const { cache, unit, isOffline } = useGym();
  const steps = stepsOf(wizard.routines);
  const total = steps.length;
  const at = steps[wizard.step];

  // ------------------------------------------------------------------ summary
  if (!at) {
    const kept = wizard.routines.map((routine, ri) =>
      routine.lines.filter((_, li) => wizard.decisions[ri]?.[li] !== "skipped"),
    );
    const makeable = kept.filter((lines, ri) => lines.length > 0 && !created.includes(ri)).length;
    const known = new Set(cache.exercises.map((e) => e.name.toLowerCase()));
    return (
      <Card title={t("gym.reviewSummary")}>
        <ErrorBanner message={error} />
        {wizard.schedule && <WeekStrip schedule={wizard.schedule} />}
        {wizard.routines.map((routine, ri) => (
          <section
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list; names may repeat
            key={`${routine.name}:${ri}`}
            className="gym-import-summary"
          >
            <h3>
              {routine.name}
              {created.includes(ri) ? ` ✓` : ""}
            </h3>
            {kept[ri]?.length === 0 ? (
              <p className="hint">{t("gym.routineSkipped")}</p>
            ) : (
              <ul>
                {kept[ri]?.map((line, i) => (
                  <li
                    // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list, never reordered
                    key={i}
                  >
                    <strong>{line.name}</strong>
                    <span className="hint">
                      {" "}
                      · {formatTarget(targetsOf(line), unit, t) || t("gym.noTarget")} ·{" "}
                      {known.has(line.name.trim().toLowerCase())
                        ? t("gym.existingExercise")
                        : t("gym.newExercise")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
        {isOffline && <p className="hint">{t("gym.createNeedsConnection")}</p>}
        <div className="row">
          <button
            type="button"
            className="quiet"
            disabled={total === 0}
            onClick={() => onChange({ ...wizard, step: total - 1 })}
          >
            {t("gym.back")}
          </button>
          <button
            type="button"
            className="gym-create-start"
            disabled={isOffline || creating || makeable === 0}
            onClick={() => onCreate(true)}
          >
            {t("gym.createAndStart")}
          </button>
          <button
            type="button"
            className="quiet"
            disabled={isOffline || creating || makeable === 0}
            onClick={() => onCreate(false)}
          >
            {t("gym.createOnly")}
          </button>
          <button type="button" className="quiet" onClick={onStartOver}>
            {t("gym.startOver")}
          </button>
        </div>
      </Card>
    );
  }

  // --------------------------------------------------------------------- step
  const [ri, li] = at;
  const routine = wizard.routines[ri];
  const line = routine?.lines[li];
  if (!routine || !line) return null;
  const match = cache.exercises.find((e) => e.name.toLowerCase() === line.name.trim().toLowerCase());
  const valid = Object.keys(line.errors).length === 0 && (li > 0 || routine.name.trim() !== "");

  function setLine(next: DraftLine) {
    onChange({
      ...wizard,
      routines: wizard.routines.map((r, i) =>
        i === ri ? { ...r, lines: r.lines.map((l, j) => (j === li ? next : l)) } : r,
      ),
    });
  }
  /** Apply an edit; an existing exercise keeps its own kind, unless the name no longer matches. */
  function edit(patch: Partial<DraftLine>) {
    if (!line) return;
    let next = validateLine({ ...line, ...patch });
    const now = cache.exercises.find((e) => e.name.toLowerCase() === next.name.trim().toLowerCase());
    if (now && now.kind !== next.kind) next = validateLine({ ...next, kind: now.kind });
    setLine(next);
  }
  function decide(decision: Decision) {
    onChange({
      ...wizard,
      step: wizard.step + 1,
      decisions: wizard.decisions.map((row, i) =>
        i === ri ? row.map((d, j) => (j === li ? decision : d)) : row,
      ),
    });
  }

  return (
    <Card title={t("gym.reviewTitle", { n: wizard.step + 1, total })}>
      <p className="hint gym-review-routine">
        {t("gym.inRoutine", { name: routine.name })} · {li + 1}/{routine.lines.length}
      </p>
      {wizard.step === 0 && wizard.schedule && <WeekStrip schedule={wizard.schedule} />}
      <form
        className="gym-review"
        key={wizard.step}
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) decide("confirmed");
        }}
      >
        {li === 0 && (
          <label>
            {t("gym.routineName")}
            <input
              value={routine.name}
              maxLength={80}
              onChange={(event) =>
                onChange({
                  ...wizard,
                  routines: wizard.routines.map((r, i) =>
                    i === ri ? { ...r, name: event.target.value } : r,
                  ),
                })
              }
            />
          </label>
        )}
        <label>
          {t("gym.exerciseName")}
          <input
            value={line.name}
            maxLength={80}
            onChange={(event) => edit({ name: event.target.value })}
          />
        </label>
        <FieldError line={line} field="name" />
        <p className="hint gym-match" data-match={match ? "existing" : "new"}>
          {match ? t("gym.usesExisting", { name: match.name }) : t("gym.newExerciseHint")}
        </p>

        <label>
          {t("gym.kind")}
          <select
            value={line.kind}
            disabled={match !== undefined}
            onChange={(event) => edit({ kind: event.target.value as ExerciseKind })}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`gym.kind.${k}`)}
              </option>
            ))}
          </select>
        </label>
        {match && <p className="hint">{t("gym.kindLocked")}</p>}
        <FieldError line={line} field="kind" />

        <div className="gym-review-numbers">
          <Field label={t("gym.sets")}>
            <MeasureInput
              label={t("gym.sets")}
              value={line.sets}
              field="sets"
              onChange={(sets) => edit({ sets })}
            />
            <FieldError line={line} field="sets" />
          </Field>
          {line.kind === "reps" && (
            <Field label={t("gym.reps")}>
              <MeasureInput
                label={t("gym.reps")}
                value={line.reps}
                field="reps"
                onChange={(reps) => edit({ reps })}
              />
              <FieldError line={line} field="reps" />
            </Field>
          )}
          {line.kind === "duration" && (
            <Field label={t("gym.seconds")}>
              <MeasureInput
                label={t("gym.seconds")}
                value={line.seconds}
                field="seconds"
                suffix="s"
                onChange={(seconds) => edit({ seconds })}
              />
              <FieldError line={line} field="seconds" />
            </Field>
          )}
          {line.kind === "distance" && (
            <Field label={t("gym.metres")}>
              <MeasureInput
                label={t("gym.metres")}
                value={line.distance_m}
                field="distance_m"
                suffix="m"
                onChange={(distance_m) => edit({ distance_m })}
              />
              <FieldError line={line} field="distance_m" />
            </Field>
          )}
          <Field label={t("gym.weightIn", { unit })}>
            <MeasureInput
              label={t("gym.weightIn", { unit })}
              value={line.weight}
              field="weight"
              decimal
              suffix={unit}
              onChange={(weight) => edit({ weight, converted: false })}
            />
            <FieldError line={line} field="weight" />
          </Field>
          <Field label={t("gym.restSeconds")}>
            <MeasureInput
              label={t("gym.restSeconds")}
              value={line.rest_seconds}
              field="rest_seconds"
              suffix="s"
              onChange={(rest_seconds) => edit({ rest_seconds })}
            />
            <FieldError line={line} field="rest_seconds" />
          </Field>
          <Field label={t("gym.restAfterSeconds")}>
            <MeasureInput
              label={t("gym.restAfterSeconds")}
              value={line.rest_after_seconds}
              field="rest_seconds"
              suffix="s"
              onChange={(rest_after_seconds) => edit({ rest_after_seconds })}
            />
            <FieldError line={line} field="rest_after_seconds" />
          </Field>
        </div>
        {line.converted && <p className="hint">{t("gym.weightConverted", { unit })}</p>}
        {hasDroppedMeasure(line) && (
          <p className="hint" role="note">
            {t("gymCore.warn.droppedMeasure")}
          </p>
        )}

        <label>
          {t("field.note")}
          <input
            value={line.note}
            maxLength={200}
            onChange={(event) => edit({ note: event.target.value })}
          />
        </label>
        <FieldError line={line} field="note" />
        <label>
          {t("gym.videoLink")}
          <input
            value={line.video_url}
            inputMode="url"
            placeholder="https://"
            onChange={(event) => edit({ video_url: event.target.value })}
          />
        </label>
        <FieldError line={line} field="video_url" />

        <div className="gym-review-actions">
          <button type="submit" disabled={!valid}>
            {t("gym.confirm")}
          </button>
          <button type="button" className="quiet" onClick={() => decide("skipped")}>
            {t("gym.skip")}
          </button>
          <button
            type="button"
            className="quiet"
            disabled={wizard.step === 0}
            onClick={() => onChange({ ...wizard, step: wizard.step - 1 })}
          >
            {t("gym.back")}
          </button>
        </div>
      </form>
    </Card>
  );
}
