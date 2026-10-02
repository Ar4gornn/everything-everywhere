import { useId, useState, type ReactNode } from "react";

import { useT } from "../../i18n";
import { parseNumber, sanitise, toText } from "./measure";

function clean(text: string): number | null {
  const parsed = parseNumber(text);
  return parsed === null || Number.isNaN(parsed) ? null : parsed;
}

/**
 * A number field that is a text field: a controlled numeric input cannot hold "62." while the
 * next digit is on its way. It keeps what was typed, filtered as it is typed, and reports the
 * number (or null when blank). A decimal comma is accepted. `value` wins when it changes from
 * outside — a stepper press, a new prefill.
 */
export function MeasureInput({
  label,
  value,
  onChange,
  decimal = false,
  suffix,
}: {
  label: string;
  value: number | null;
  onChange: (next: number | null) => void;
  decimal?: boolean;
  /** A unit shown after the field ("kg", "s"). */
  suffix?: string;
}) {
  const [text, setText] = useState(toText(value));
  // Re-derive the text when the number was changed from outside; typing keeps its own text.
  if (clean(text) !== value) setText(toText(value));
  return (
    <span className="gym-measure">
      <input
        className="num gym-measure-input"
        type="text"
        inputMode={decimal ? "decimal" : "numeric"}
        autoComplete="off"
        aria-label={label}
        value={text}
        onChange={(event) => {
          const next = sanitise(event.target.value, decimal);
          setText(next);
          onChange(clean(next));
        }}
      />
      {suffix ? <span className="gym-measure-suffix">{suffix}</span> : null}
    </span>
  );
}

/** A caption over a `MeasureInput` (a label cannot wrap it: Biome cannot see the input inside). */
export function Field({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`gym-field ${className}`.trim()}>
      <span className="gym-field-label">{label}</span>
      {children}
    </div>
  );
}

/** − [field] +, for a number changed with a thumb. */
export function Stepper({
  label,
  value,
  onChange,
  step,
  decimal = false,
  suffix,
  min = 0,
}: {
  label: string;
  value: number | null;
  onChange: (next: number | null) => void;
  step: number;
  decimal?: boolean;
  suffix?: string;
  min?: number;
}) {
  const t = useT();
  const id = useId();
  const round = (n: number) => Math.round(n * 100) / 100;
  return (
    <div className="gym-stepper" role="group" aria-labelledby={id}>
      <span className="gym-stepper-label" id={id}>
        {label}
      </span>
      <div className="gym-stepper-row">
        <button
          type="button"
          className="quiet gym-step"
          aria-label={t("gym.less", { field: label })}
          disabled={value === null || value <= min}
          onClick={() => onChange(Math.max(min, round((value ?? 0) - step)))}
        >
          −
        </button>
        <MeasureInput
          label={label}
          value={value}
          onChange={onChange}
          decimal={decimal}
          suffix={suffix}
        />
        <button
          type="button"
          className="quiet gym-step"
          aria-label={t("gym.more", { field: label })}
          onClick={() => onChange(round((value ?? 0) + step))}
        >
          +
        </button>
      </div>
    </div>
  );
}
