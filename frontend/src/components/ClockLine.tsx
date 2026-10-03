import type { ReactNode } from "react";

import type { Shade } from "../clocks/time";
import { useT } from "../i18n";

/**
 * One clock row, shared by the dashboard card and the Clocks page (Epic 48, AD-64): name
 * (and city, unless the name says it), time, then day word, difference and shade. The list
 * is the grid (`name | time | meta`) and each row a subgrid of it, so the time column is one
 * track for every row and the times line up. `action` sits on the name's line (the page's
 * Edit toggle); `children` (errors, the editor) take full-width rows under it.
 */
export function ClockLine({
  className,
  id,
  label,
  labelFocusable,
  city,
  time,
  dayWord,
  diff,
  shade,
  ownHours,
  action,
  children,
}: {
  className: "clocks-row" | "clocks-line";
  id: string;
  label: string;
  /** Focus can be sent to the name (tabIndex -1), as after the page changes your zone. */
  labelFocusable?: boolean;
  city: string | null;
  time: string;
  dayWord: string | null;
  diff: string | null;
  shade: Shade;
  ownHours?: boolean;
  action?: ReactNode;
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <li className={className} data-place={id}>
      <span className="clocks-name">
        <span className="clocks-name-line">
          <strong className="clocks-label" tabIndex={labelFocusable ? -1 : undefined}>
            {label}
          </strong>
          {action}
        </span>
        {city && <span className="clocks-zone">{city}</span>}
        {ownHours && <span className="clocks-tag">{t("clocks.page.ownHoursTag")}</span>}
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
