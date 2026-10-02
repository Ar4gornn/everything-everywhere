import type { PhaseName } from "../moon/engine";

/**
 * One module's figure by day, with the moon's phase behind it (Epic 47). Hand-rolled SVG like
 * the other charts. The bands are a quiet alternating tint, one per run of the same phase, so
 * the eye can find "the full moon days" without any colour meaning good or bad.
 */
const WIDTH = 640;
const HEIGHT = 110;
const PAD = 6;

export function MoonLines({
  values,
  phases,
  label,
  min = 0,
  max,
}: {
  /** One value per day in the window, null = no data that day (the line breaks). */
  values: (number | null)[];
  /** The phase of each of those days, same length. */
  phases: PhaseName[];
  label: string;
  min?: number;
  max?: number;
}) {
  const count = values.length;
  if (count === 0) return null;
  const top = max ?? Math.max(1, ...values.map((v) => v ?? 0));
  const span = Math.max(top - min, 1e-9);
  const x = (i: number) => PAD + (count === 1 ? 0 : (i / (count - 1)) * (WIDTH - PAD * 2));
  const y = (v: number) => HEIGHT - PAD - ((v - min) / span) * (HEIGHT - PAD * 2);

  const runs: { phase: PhaseName; from: number; to: number }[] = [];
  phases.forEach((phase, i) => {
    const last = runs[runs.length - 1];
    if (last && last.phase === phase) last.to = i;
    else runs.push({ phase, from: i, to: i });
  });

  let path = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    path += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
    pen = true;
  });

  return (
    <svg
      className="moon-lines"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width="100%"
      role="img"
      aria-label={label}
    >
      {runs.map((run, index) => {
        const left = run.from === 0 ? PAD : (x(run.from - 1) + x(run.from)) / 2;
        const right = run.to === count - 1 ? WIDTH - PAD : (x(run.to) + x(run.to + 1)) / 2;
        return (
          <rect
            key={`${run.from}-${run.phase}`}
            data-phase={run.phase}
            x={left}
            y={0}
            width={right - left}
            height={HEIGHT}
            fill="var(--border)"
            fillOpacity={index % 2 === 0 ? 0.35 : 0.1}
          />
        );
      })}
      <path
        d={path.trim()}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
