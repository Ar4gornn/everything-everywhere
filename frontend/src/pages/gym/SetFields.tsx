import { useEffect, useRef, useState } from "react";

import type { ExerciseKind, WeightUnit } from "../../api/types";
import type { SetDraft } from "../../gym/session";
import { FIELD_RANGES } from "../../gym/format";
import { useT } from "../../i18n";
import type { MessageKey } from "../../i18n";
import { vibrate, useNow } from "./device";
import { MeasureInput, Stepper } from "./MeasureInput";
import { clock, measureStep, toWeight, weightStep } from "./measure";

/** What the fields edit: numbers, with weight as a number until it is sent. */
export interface SetEntry {
  reps: number | null;
  weight: number | null;
  seconds: number | null;
  distance: number | null;
}

export function entryFromDraft(draft: SetDraft): SetEntry {
  return {
    reps: draft.reps,
    weight: draft.weight === null ? null : Number(draft.weight),
    seconds: draft.duration_seconds,
    distance: draft.distance_m,
  };
}

/** Only the measure the kind counts in is sent; a weight of 0 is no weight. */
export function draftFromEntry(kind: ExerciseKind, entry: SetEntry): SetDraft {
  return {
    reps: kind === "reps" ? entry.reps : null,
    weight: entry.weight !== null && entry.weight > 0 ? toWeight(entry.weight) : null,
    duration_seconds: kind === "duration" ? entry.seconds : null,
    distance_m: kind === "distance" ? entry.distance : null,
  };
}

// ------------------------------------------------------------------ Epic 54.3: per-set targets

/** The measure fields a row can carry. */
type RowField = "reps" | "seconds" | "distance_m" | "weight";

/** One planned set: the target of a routine line or a draft in the import review. */
export interface SetRow {
  reps: number | null;
  seconds: number | null;
  distance_m: number | null;
  weight: number | null;
  warmup: boolean;
  errors?: Partial<Record<RowField, MessageKey>>;
}

interface Flat {
  reps: number | null;
  seconds: number | null;
  distance_m: number | null;
  weight: number | null;
}

/** The measure a kind counts in, as the row field that holds it. */
export function measureField(kind: ExerciseKind): "reps" | "seconds" | "distance_m" {
  return kind === "reps" ? "reps" : kind === "duration" ? "seconds" : "distance_m";
}

/** A row of the kind's own measure and a weight, nothing else set. */
export function blankRow(kind: ExerciseKind, from: Flat, warmup = false): SetRow {
  const field = measureField(kind);
  return { reps: null, seconds: null, distance_m: null, weight: from.weight, warmup, [field]: from[field] };
}

/** Per-set mode seeds one row per set from the flat values (1 to 99 rows). */
export function seedRows(kind: ExerciseKind, count: number | null, from: Flat): SetRow[] {
  const n = Math.min(99, Math.max(1, count ?? 1));
  return Array.from({ length: n }, () => blankRow(kind, from));
}

/** The first working set (the first set when all are warm-ups): what "same every set" keeps. */
export function firstWorking(rows: SetRow[]): SetRow | undefined {
  return rows.find((row) => !row.warmup) ?? rows[0];
}

/** True when going back to "same every set" would lose something. */
export function rowsDiffer(kind: ExerciseKind, rows: SetRow[]): boolean {
  const first = firstWorking(rows);
  if (!first) return false;
  const field = measureField(kind);
  return rows.some((row) => row.warmup || row[field] !== first[field] || row.weight !== first.weight);
}

/** Range check of one row, in the same keys the review's validation uses. */
export function rowErrors(kind: ExerciseKind, row: SetRow): SetRow["errors"] {
  const errors: NonNullable<SetRow["errors"]> = {};
  const field = measureField(kind);
  for (const key of [field, "weight"] as const) {
    const value = row[key];
    if (value === null) continue;
    const [low, high] = FIELD_RANGES[key];
    if (value < low || value > high) errors[key] = "gymCore.field.range";
  }
  return Object.keys(errors).length > 0 ? errors : undefined;
}

/** "Same every set / Vary per set". */
export function VarySwitch({
  name,
  varies,
  onChange,
}: {
  name: string;
  varies: boolean;
  onChange: (varies: boolean) => void;
}) {
  const t = useT();
  return (
    <div className="gym-vary" role="group" aria-label={t("gymPlans.sets.switch", { name })}>
      <button
        type="button"
        className={varies ? "quiet" : "secondary"}
        aria-pressed={!varies}
        onClick={() => varies && onChange(false)}
      >
        {t("gymPlans.sets.same")}
      </button>
      <button
        type="button"
        className={varies ? "secondary" : "quiet"}
        aria-pressed={varies}
        onClick={() => !varies && onChange(true)}
      >
        {t("gymPlans.sets.vary")}
      </button>
    </div>
  );
}

/** One row per set: the kind's measure, the weight, a warm-up box; add and remove. */
export function SetRows({
  kind,
  rows,
  unit,
  name,
  disabled = false,
  onChange,
}: {
  kind: ExerciseKind;
  rows: SetRow[];
  unit: WeightUnit;
  name: string;
  disabled?: boolean;
  onChange: (rows: SetRow[]) => void;
}) {
  const t = useT();
  const field = measureField(kind);
  const patch = (index: number, change: Partial<SetRow>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...change, errors: undefined } : row)));
  const measureLabel = (n: number) =>
    kind === "reps"
      ? t("gymPlans.sets.reps", { n, name })
      : kind === "duration"
        ? t("gymPlans.sets.seconds", { n, name })
        : t("gymPlans.sets.metres", { n, name });
  return (
    <div className="gym-setrows">
      <ol className="gym-setrows-list" aria-label={t("gymPlans.sets.list", { name })}>
        {rows.map((row, index) => {
          const n = index + 1;
          return (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional, they have no id
              key={index}
              className={row.warmup ? "gym-setrow is-warmup" : "gym-setrow"}
            >
              <span className="gym-setrow-n num">{t("gymPlans.sets.setN", { n })}</span>
              <div className="gym-setrow-fields">
                <MeasureInput
                  label={measureLabel(n)}
                  value={row[field]}
                  field={field}
                  suffix={kind === "duration" ? "s" : kind === "distance" ? "m" : undefined}
                  onChange={(value) => patch(index, { [field]: value })}
                />
                <MeasureInput
                  label={t("gymPlans.sets.weight", { n, name })}
                  value={row.weight}
                  field="weight"
                  decimal
                  suffix={unit}
                  onChange={(weight) => patch(index, { weight })}
                />
              </div>
              <label className="gym-setrow-warm">
                <input
                  type="checkbox"
                  checked={row.warmup}
                  disabled={disabled}
                  aria-label={t("gymPlans.sets.warmupOf", { n, name })}
                  onChange={(event) => patch(index, { warmup: event.target.checked })}
                />
                <span>{t("gymPlans.sets.warmup")}</span>
              </label>
              <button
                type="button"
                className="quiet gym-setrow-remove"
                disabled={disabled || rows.length <= 1}
                aria-label={t("gymPlans.sets.remove", { n, name })}
                onClick={() => onChange(rows.filter((_, i) => i !== index))}
              >
                ×
              </button>
              {(["reps", "seconds", "distance_m", "weight"] as const).map((key) => {
                const message = row.errors?.[key];
                return message ? (
                  <p key={key} className="gym-field-error gym-setrow-error" role="alert">
                    {t("gymPlans.sets.setN", { n })}: {t(message)}
                  </p>
                ) : null;
              })}
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        className="secondary"
        disabled={disabled || rows.length >= 99}
        aria-label={t("gymPlans.sets.addTo", { name })}
        onClick={() => {
          const last = rows[rows.length - 1];
          onChange([...rows, blankRow(kind, last ?? { reps: null, seconds: null, distance_m: null, weight: null })]);
        }}
      >
        {t("gymPlans.sets.add")}
      </button>
    </div>
  );
}

export type EffortKind = "none" | "rpe" | "rir";

/** The effort target: a scale (RPE, RIR or none) and its number. */
export function EffortFields({
  name,
  rpe,
  rir,
  error,
  onChange,
}: {
  name: string;
  rpe: number | null;
  rir: number | null;
  error?: MessageKey;
  onChange: (next: { rpe: number | null; rir: number | null }) => void;
}) {
  const t = useT();
  // The scale the person picked; a file carrying both fixes itself through `error`.
  const [picked, setPicked] = useState<EffortKind | null>(null);
  const kind: EffortKind = picked ?? (rpe !== null ? "rpe" : rir !== null ? "rir" : "none");
  return (
    <div className="gym-effort">
      <span className="gym-field-label">{t("gymPlans.effort.label")}</span>
      <div className="gym-effort-row">
        <select
          value={kind}
          aria-label={t("gymPlans.effort.kind", { name })}
          onChange={(event) => {
            const next = event.target.value as EffortKind;
            setPicked(next);
            // Switching scale drops the other number: they are exclusive.
            if (next === "none") onChange({ rpe: null, rir: null });
            else if (next === "rpe") onChange({ rpe, rir: null });
            else onChange({ rpe: null, rir });
          }}
        >
          <option value="none">{t("gymPlans.effort.none")}</option>
          <option value="rpe">{t("gymPlans.effort.rpe")}</option>
          <option value="rir">{t("gymPlans.effort.rir")}</option>
        </select>
        {kind !== "none" && (
          <MeasureInput
            label={t("gymPlans.effort.value", { name })}
            value={kind === "rpe" ? rpe : rir}
            decimal={kind === "rpe"}
            onChange={(value) =>
              onChange(kind === "rpe" ? { rpe: value, rir: null } : { rpe: null, rir: value })
            }
          />
        )}
      </div>
      {error && (
        <p className="gym-field-error" role="alert">
          {t(error)}
        </p>
      )}
    </div>
  );
}

const TEMPO = /^[0-9X]-[0-9X]-[0-9X]-[0-9X]$/;

/** Trim and uppercase, as the server does. */
export function cleanTempo(text: string): string {
  return text.trim().toUpperCase();
}

/** Empty is fine (no tempo); anything else must match the pattern. */
export function tempoValid(text: string): boolean {
  const cleaned = cleanTempo(text);
  return cleaned === "" || TEMPO.test(cleaned);
}

/** RPE: 1 to 10 in halves. RIR: whole 0 to 10. Null is "none". */
export function effortError(rpe: number | null, rir: number | null): MessageKey | undefined {
  if (rpe !== null && rir !== null) return "gymPlans.effort.both";
  if (rpe !== null && (rpe < 1 || rpe > 10 || (rpe * 2) % 1 !== 0)) return "gymPlans.effort.rpeRange";
  if (rir !== null && (rir < 0 || rir > 10 || !Number.isInteger(rir))) return "gymPlans.effort.rirRange";
  return undefined;
}

/** The tempo text field with its pattern hint. */
export function TempoField({
  name,
  value,
  error,
  onChange,
}: {
  name: string;
  value: string;
  error?: MessageKey;
  onChange: (next: string) => void;
}) {
  const t = useT();
  const bad = error ?? (tempoValid(value) ? undefined : "gymPlans.tempo.bad");
  return (
    <label className="gym-tempo">
      {t("gymPlans.tempo.label")}
      <input
        value={value}
        maxLength={7}
        placeholder="3-1-1-0"
        autoComplete="off"
        aria-label={t("gymPlans.tempo.of", { name })}
        aria-invalid={bad ? true : undefined}
        title={t("gymPlans.tempo.hint")}
        onChange={(event) => onChange(event.target.value)}
      />
      <span className="hint">{t("gymPlans.tempo.hint")}</span>
      {bad && (
        <span className="gym-field-error" role="alert">
          {t(bad)}
        </span>
      )}
    </label>
  );
}

/** "Superset with next": the line and the one after it alternate set by set. */
export function SupersetToggle({
  name,
  checked,
  disabled,
  onChange,
}: {
  name: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  const t = useT();
  return (
    <label className="gym-superset-toggle">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={t("gymPlans.superset.of", { name })}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{t("gymPlans.superset.toggle")}</span>
    </label>
  );
}

/** True when the measure the kind needs is there and positive. */
export function entryIsComplete(kind: ExerciseKind, entry: SetEntry): boolean {
  const value = kind === "reps" ? entry.reps : kind === "duration" ? entry.seconds : entry.distance;
  return value !== null && value >= 1;
}

/**
 * The timer of a duration set. Counts up, or down from the target (then it stops itself and
 * vibrates at zero). The start is a timestamp in a ref and the reading is `now - start`, so a
 * phone that slept mid-plank still shows the true time. Stopping writes the seconds into the
 * field; the person can still correct them before Done.
 */
export function SetTimer({
  target,
  onStop,
}: {
  target: number | null;
  onStop: (seconds: number) => void;
}) {
  const t = useT();
  const start = useRef<number | null>(null);
  const [running, setRunning] = useState(false);
  const now = useNow(running, 200);
  const elapsed = start.current === null ? 0 : Math.max(0, (now - start.current) / 1000);
  const finished = running && target !== null && elapsed >= target;
  const onStopRef = useRef(onStop);
  onStopRef.current = onStop;

  useEffect(() => {
    if (!finished || target === null) return;
    // Reached zero: the set is the target, held in full.
    vibrate([300, 150, 300]);
    setRunning(false);
    onStopRef.current(target);
  }, [finished, target]);

  if (!running) {
    return (
      <button
        type="button"
        className="secondary gym-timer-start"
        onClick={() => {
          start.current = Date.now();
          setRunning(true);
        }}
      >
        {t("gym.startTimer")}
      </button>
    );
  }
  const shown = target === null ? elapsed : Math.max(0, target - elapsed);
  return (
    <div className="gym-timer" role="timer" aria-label={t("gym.timer")}>
      <span className="gym-timer-clock num">{clock(Math.ceil(shown))}</span>
      <button
        type="button"
        className="secondary"
        onClick={() => {
          setRunning(false);
          onStop(Math.max(1, Math.round(elapsed)));
        }}
      >
        {t("gym.stopTimer")}
      </button>
    </div>
  );
}

/**
 * The fields of one set, kind-aware: the measure with its steppers, then the optional weight.
 * Shared by the next-set row and the editor of a logged set.
 */
export function SetFields({
  kind,
  entry,
  onChange,
  unit,
  targetSeconds = null,
  timer = false,
}: {
  kind: ExerciseKind;
  entry: SetEntry;
  onChange: (next: SetEntry) => void;
  unit: WeightUnit;
  targetSeconds?: number | null;
  /** Offer the start/stop timer (the live row only). */
  timer?: boolean;
}) {
  const t = useT();
  return (
    <div className="gym-fields">
      {kind === "reps" && (
        <Stepper
          label={t("gym.reps")}
          value={entry.reps}
          field="reps"
          step={measureStep(kind)}
          min={0}
          onChange={(reps) => onChange({ ...entry, reps })}
        />
      )}
      {kind === "duration" && (
        <>
          <Stepper
            label={t("gym.seconds")}
            value={entry.seconds}
            field="seconds"
            step={measureStep(kind)}
            suffix="s"
            onChange={(seconds) => onChange({ ...entry, seconds })}
          />
          {timer && (
            <SetTimer target={targetSeconds} onStop={(seconds) => onChange({ ...entry, seconds })} />
          )}
        </>
      )}
      {kind === "distance" && (
        <Stepper
          label={t("gym.metres")}
          value={entry.distance}
          field="distance_m"
          step={measureStep(kind)}
          suffix="m"
          onChange={(distance) => onChange({ ...entry, distance })}
        />
      )}
      <Stepper
        label={t("gym.weightIn", { unit })}
        value={entry.weight}
        field="weight"
        step={weightStep(unit)}
        decimal
        suffix={unit}
        onChange={(weight) => onChange({ ...entry, weight })}
      />
    </div>
  );
}
