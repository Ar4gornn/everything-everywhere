import { useState, type FormEvent } from "react";

import type { Exercise, ExerciseKind } from "../../api/types";
import { NameSuggest } from "../../components/NameSuggest";
import { useT } from "../../i18n";

export interface ExerciseChoice {
  /** Set when the name matches one of the person's exercises; then `kind` is that one's. */
  exercise_id: string | null;
  name: string;
  kind: ExerciseKind;
}

export const KINDS: ExerciseKind[] = ["reps", "duration", "distance"];

/**
 * Pick an existing exercise or type a new name and say what it counts in. Used by the live
 * session and the routine editor. A name that matches an existing exercise (case-insensitive)
 * is that exercise, and its kind is shown and locked: the same name never becomes two kinds.
 */
export function ExerciseAdder({
  exercises,
  onAdd,
  disabled = false,
  submitLabel,
}: {
  exercises: Exercise[];
  onAdd: (choice: ExerciseChoice) => void | Promise<void>;
  disabled?: boolean;
  submitLabel: string;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ExerciseKind>("reps");
  const wanted = name.trim().toLowerCase();
  const match = wanted ? exercises.find((e) => e.name.toLowerCase() === wanted) : undefined;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    await onAdd({
      exercise_id: match?.id ?? null,
      name: match?.name ?? name.trim(),
      kind: match?.kind ?? kind,
    });
    setName("");
  }

  return (
    <form className="gym-adder" onSubmit={(event) => void submit(event)}>
      <label>
        {t("gym.exerciseName")}
        <NameSuggest
          ariaLabel={t("gym.exerciseName")}
          value={name}
          maxLength={80}
          placeholder={t("gym.exercisePlaceholder")}
          onChange={setName}
          names={exercises.map((exercise) => exercise.name)}
        />
      </label>
      <label>
        {t("gym.kind")}
        <select
          value={match?.kind ?? kind}
          disabled={match !== undefined}
          onChange={(event) => setKind(event.target.value as ExerciseKind)}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`gym.kind.${k}`)}
            </option>
          ))}
        </select>
      </label>
      {match ? <p className="hint gym-adder-note">{t("gym.usesExisting", { name: match.name })}</p> : null}
      <button type="submit" disabled={disabled || !name.trim()}>
        {submitLabel}
      </button>
    </form>
  );
}
