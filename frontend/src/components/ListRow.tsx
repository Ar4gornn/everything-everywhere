import { useCallback, useId, useState, type ReactNode } from "react";

/**
 * One line of a phone list (AD-53): what it is on the left, how much on the right, an
 * optional bar under both, and anything else one tap away.
 *
 * A row with `details` has a real `<button>` for a head, so it opens by keyboard and says
 * whether it is open. A row without them is not a button at all — a control that does
 * nothing is worse than no control. The bar sits outside the button because a button may
 * only hold phrasing content, and a meter is not that.
 *
 * `trailing` is one action that does not need the row open (Bought, Add): it sits beside
 * the head, never inside it, since a button may not contain a button.
 */
export function ListRow({
  title,
  meta,
  amount,
  amountTone,
  bar,
  details,
  trailing,
  muted = false,
  open = false,
  onToggle,
}: {
  title: ReactNode;
  /** The second, quieter line: vendor, note, rate. Omitted when empty. */
  meta?: ReactNode;
  amount?: ReactNode;
  amountTone?: "in" | "over";
  bar?: ReactNode;
  details?: ReactNode;
  /** One action on the row itself, outside the head button. */
  trailing?: ReactNode;
  /** Drawn quieter: a paused template, say. */
  muted?: boolean;
  open?: boolean;
  onToggle?: () => void;
}) {
  const detailsId = useId();
  const expandable = details !== undefined && details !== null && details !== false;

  const inner = (
    <>
      <span className="list-row-main">
        <span className="list-row-title">{title}</span>
        {meta ? <span className="list-row-meta">{meta}</span> : null}
      </span>
      {amount !== undefined && (
        <span className={`list-row-amount num${amountTone ? ` ${amountTone}` : ""}`}>
          {amount}
        </span>
      )}
      {expandable && (
        <span className={`chevron${open ? "" : " closed"}`} aria-hidden="true">
          ▾
        </span>
      )}
    </>
  );

  const head = expandable ? (
    <button
      type="button"
      className="list-row-head"
      aria-expanded={open}
      aria-controls={detailsId}
      onClick={onToggle}
    >
      {inner}
    </button>
  ) : (
    <div className="list-row-head">{inner}</div>
  );

  return (
    <li className={`list-row${open ? " open" : ""}${muted ? " muted" : ""}`}>
      {trailing ? (
        <div className="list-row-line">
          {head}
          <span className="list-row-trailing">{trailing}</span>
        </div>
      ) : (
        head
      )}
      {bar ? <div className="list-row-bar">{bar}</div> : null}
      {expandable && open && (
        <div id={detailsId} className="list-row-details">
          {details}
        </div>
      )}
    </li>
  );
}

/** Which row of a list is open: one at a time, and tapping the open one closes it. */
export function useOpenRow(): [string | null, (id: string) => void] {
  const [openId, setOpenId] = useState<string | null>(null);
  const toggle = useCallback((id: string) => setOpenId((was) => (was === id ? null : id)), []);
  return [openId, toggle];
}
