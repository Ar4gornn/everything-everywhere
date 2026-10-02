import { useEffect, useRef, useState } from "react";

import type { ExerciseKind, WeightUnit } from "../../api/types";
import type { SetDraft } from "../../gym/session";
import { useT } from "../../i18n";
import { vibrate, useNow } from "./device";
import { Stepper } from "./MeasureInput";
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
function SetTimer({
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
          step={measureStep(kind)}
          suffix="m"
          onChange={(distance) => onChange({ ...entry, distance })}
        />
      )}
      <Stepper
        label={t("gym.weightIn", { unit })}
        value={entry.weight}
        step={weightStep(unit)}
        decimal
        suffix={unit}
        onChange={(weight) => onChange({ ...entry, weight })}
      />
    </div>
  );
}
