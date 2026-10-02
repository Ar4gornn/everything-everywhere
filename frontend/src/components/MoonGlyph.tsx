import { useT } from "../i18n";
import type { Hemisphere } from "../moon/hemisphere";
import type { PhaseName } from "../moon/engine";

/**
 * The moon as a disc with its lit part drawn (Epic 47). SVG, `currentColor` only, so it
 * follows the theme and is crisp at 14px and at 96px (the viewBox is 100 units; strokes use
 * `vector-effect`).
 *
 * Geometry: the lit limb is a half circle on one side, the terminator a half ellipse whose
 * width is `|cos(angle)|` of the radius. Waxing (angle < 180) lights the right in the north;
 * the south hemisphere sees the same moon mirrored. "Waxing" still means waxing.
 */
const R = 46;
const C = 50;

/** The path of the lit part for an elongation `angle` (0 new, 90 first quarter, 180 full). */
export function litPath(angle: number): { d: string; side: "right" | "left" } {
  const a = ((angle % 360) + 360) % 360;
  const waxing = a < 180;
  const rx = Math.abs(Math.cos((a * Math.PI) / 180)) * R;
  const top = `${C} ${C - R}`;
  const bottom = `${C} ${C + R}`;
  // Limb: right side clockwise when waxing, left side counter-clockwise when waning.
  const limbSweep = waxing ? 1 : 0;
  // Terminator bulges right for a waxing crescent and a waning gibbous, left otherwise.
  const bulgesRight = waxing ? a < 90 : a < 270;
  const termSweep = bulgesRight ? 0 : 1;
  return {
    d: `M ${top} A ${R} ${R} 0 0 ${limbSweep} ${bottom} A ${rx.toFixed(2)} ${R} 0 0 ${termSweep} ${top} Z`,
    side: waxing ? "right" : "left",
  };
}

export function MoonGlyph({
  phase,
  angle,
  hemisphere = "north",
  size = 24,
  illumination,
  decorative = false,
}: {
  phase: PhaseName;
  /** Elongation of the moon from the sun, 0-360. */
  angle: number;
  hemisphere?: Hemisphere;
  size?: number;
  /** 0-1; when given, the label also says how much is lit. */
  illumination?: number;
  /** Hidden from assistive tech when a visible name sits beside it. */
  decorative?: boolean;
}) {
  const t = useT();
  const { d, side } = litPath(angle);
  const name = t(`moon.phase.${phase}`);
  const label =
    illumination === undefined
      ? name
      : `${name}, ${t("moon.lit", { percent: Math.round(illumination * 100) })}`;
  return (
    <svg
      className="moon-glyph"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
      data-phase={phase}
      data-hemisphere={hemisphere}
      data-lit-side={hemisphere === "south" ? (side === "right" ? "left" : "right") : side}
    >
      <circle cx={C} cy={C} r={R} fill="currentColor" fillOpacity={0.15} />
      <path
        d={d}
        fill="currentColor"
        transform={hemisphere === "south" ? "translate(100 0) scale(-1 1)" : undefined}
      />
      <circle
        cx={C}
        cy={C}
        r={R}
        fill="none"
        stroke="currentColor"
        strokeWidth={size < 30 ? 6 : 3}
      />
    </svg>
  );
}
