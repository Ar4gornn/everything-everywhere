import type { ReactNode } from "react";

import type { Shade } from "../clocks/time";
import { useT } from "../i18n";

/**
 * One clock row, shared by the dashboard card and the Clocks page (Epic 48, AD-64): name
 * (and city, unless the name says it), time, then day word, difference and shade. A grid of
 * `name | time | meta`, so the times of every row line up in a column. `children` are the
 * page's extras (Edit toggle, editor), laid out on their own full-width rows.
 */
export function ClockLine({
  className,
  id,
  label,
  city,
  time,
  dayWord,
  diff,
  shade,
  ownHours,
  children,
}: {
  className: "clocks-row" | "clocks-line";
  id: string;
  label: string;
  city: string | null;
  time: string;
  dayWord: string | null;
  diff: string | null;
  shade: Shade;
  ownHours?: boolean;
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <li className={className} data-place={id}>
      <span className="clocks-name">
        <strong>{label}</strong>
        {city && <span className="clocks-zone">{city}</span>}
        {ownHours && <span className="clocks-tag">{t("clocks.page.ownHours")}</span>}
      </span>
      <span className="clocks-time">{time}</span>
      <span className="clocks-meta">
        {dayWord && <span className="clocks-day">{dayWord}</span>}
        {diff && <span className="clocks-diff">{diff}</span>}
        <span className="clocks-shade" data-shade={shade}>
          {t(`clocks.shade.${shade}`)}
        </span>
      </span>
      {children}
    </li>
  );
}

/** "tomorrow" / "yesterday" / null for a -1/0/+1 day shift. */
export function useDayWord(): (shift: -1 | 0 | 1) => string | null {
  const t = useT();
  return (shift) =>
    shift === 1 ? t("clocks.tomorrow") : shift === -1 ? t("clocks.yesterday") : null;
}
