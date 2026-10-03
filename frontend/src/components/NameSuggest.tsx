import { useId, useRef, useState } from "react";
import { useT } from "../i18n";

/**
 * A text input with in-page suggestions, in place of a native `<datalist>`. On Android Chrome the
 * datalist popup covers the input itself, so a new name could not be typed. Here the input is an
 * ordinary one, always typeable; the known names are a row of chips below it. Picking a chip calls
 * the same `onChange` as typing does.
 */
const MAX_CHIPS = 6;

/** Lower case, accents stripped, so "Cafe" finds "Café". */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Up to `limit` known names whose start, or any word's start, matches what is typed. */
export function suggest(names: readonly string[], typed: string, limit = MAX_CHIPS): string[] {
  const query = fold(typed);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const folded = fold(name);
    if (!folded || seen.has(folded)) continue;
    seen.add(folded);
    if (query && folded === query) continue;
    if (query && !` ${folded}`.replace(/[^\p{L}\p{N}]+/gu, " ").includes(` ${query}`)) continue;
    out.push(name);
    if (out.length >= limit) break;
  }
  return out;
}

type Props = {
  value: string;
  onChange: (value: string) => void;
  names: readonly string[];
  ariaLabel: string;
  placeholder?: string;
  required?: boolean;
};

export function NameSuggest({ value, onChange, names, ariaLabel, placeholder, required }: Props) {
  const t = useT();
  const groupId = useId();
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const shown = focused || value.trim() !== "";
  const chips = shown && !dismissed ? suggest(names, value) : [];

  return (
    <div className="name-suggest">
      <input
        ref={inputRef}
        aria-label={ariaLabel}
        placeholder={placeholder}
        required={required}
        value={value}
        autoComplete="off"
        onChange={(event) => {
          setDismissed(false);
          onChange(event.target.value);
        }}
        onFocus={() => {
          setFocused(true);
          setDismissed(false);
        }}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && chips.length > 0) {
            // Hide the suggestions; keep a surrounding dialog open.
            event.preventDefault();
            event.stopPropagation();
            setDismissed(true);
          }
        }}
      />
      {chips.length > 0 && (
        <div id={groupId} className="chips" role="group" aria-label={t("suggest.group")}>
          {chips.map((name) => (
            <button
              key={name}
              type="button"
              className="chip"
              // Keep the input focused (and the keyboard up) when a chip is tapped.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(name);
                inputRef.current?.focus();
              }}
            >
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
