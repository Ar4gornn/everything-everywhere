import type { ReactNode } from "react";

import type { MessageKey } from "../../i18n/catalogue";
import { useT } from "../../i18n";

/**
 * The pieces every install drawing is built from (Epic 46, AD-62 §3). Colours come from the
 * `.install-page .dia-*` classes (currentColor + theme tokens), never baked in, so light, dark,
 * OLED and high-contrast all work. Text inside a drawing is `t()`, never literal.
 */

/** One drawing: an `img` with a translated description. 200 x 110 viewBox, scales to width. */
export function Diagram({ label, children }: { label: MessageKey; children: ReactNode }) {
  const t = useT();
  return (
    <svg
      className="dia"
      viewBox="0 0 200 110"
      role="img"
      aria-label={t(label)}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect className="dia-line" x="2" y="2" width="196" height="106" rx="8" />
      {children}
    </svg>
  );
}

/** The accent ring that says "tap here". */
export function Ring({ cx, cy, r = 11 }: { cx: number; cy: number; r?: number }) {
  return <circle className="dia-ring" cx={cx} cy={cy} r={r} />;
}

/** The address bar: a pill, with room on the right for a button. */
export function AddressBar({ x, y, w }: { x: number; y: number; w: number }) {
  return <rect className="dia-line dia-soft" x={x} y={y} width={w} height="16" rx="8" />;
}

/** A list row; `hi` marks the one to tap. */
export function Row({
  y,
  label,
  hi = false,
  x = 20,
  w = 160,
}: {
  y: number;
  label: string;
  hi?: boolean;
  x?: number;
  w?: number;
}) {
  return (
    <g>
      <rect
        className={hi ? "dia-line dia-hi" : "dia-line dia-soft"}
        x={x}
        y={y}
        width={w}
        height="18"
        rx="4"
      />
      <text className="dia-text" x={x + 8} y={y + 12.5}>
        {label}
      </text>
    </g>
  );
}

/** A pill button with a word on it. */
export function PillButton({
  x,
  y,
  w,
  label,
  hi = false,
}: {
  x: number;
  y: number;
  w: number;
  label: string;
  hi?: boolean;
}) {
  return (
    <g>
      <rect
        className={hi ? "dia-line dia-hi" : "dia-line dia-soft"}
        x={x}
        y={y}
        width={w}
        height="18"
        rx="9"
      />
      <text className="dia-text dia-mid" x={x + w / 2} y={y + 12.5}>
        {label}
      </text>
    </g>
  );
}

/** The three dots of a menu button, vertical (⋮) or horizontal (⋯). */
export function Dots({ cx, cy, vertical }: { cx: number; cy: number; vertical: boolean }) {
  return (
    <g className="dia-fill">
      {[-5, 0, 5].map((d) => (
        <circle key={d} cx={vertical ? cx : cx + d} cy={vertical ? cy + d : cy} r="1.8" />
      ))}
    </g>
  );
}

/** The Share glyph: a box with an arrow leaving it. */
export function ShareGlyph({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g className="dia-line dia-nofill">
      <path d={`M${cx - 5} ${cy} v7 h10 v-7`} />
      <path d={`M${cx} ${cy + 4} v-11 M${cx - 3.5} ${cy - 4} l3.5 -3.5 l3.5 3.5`} />
    </g>
  );
}
