import { NavLink } from "react-router-dom";

import { useT } from "../../i18n";
import { isAt, type NavModel } from "../../nav/model";

/**
 * Epic 52 (AD-65): the phone's bottom bar — the pinned places, then More, which opens the
 * drawer. SKELETON: builder A owns this file (look, More's "on" state when the current page
 * is a drawer place, badges none). Keep `aria-label={t("nav.sections")}`: the tour and many
 * tests find the bar by that name.
 */
export function BottomBar({
  model,
  pathname,
  moreOpen,
  onMore,
}: {
  model: NavModel;
  pathname: string;
  moreOpen: boolean;
  onMore: () => void;
}) {
  const t = useT();
  const inDrawer = !model.pinned.some((def) => isAt(def, pathname));
  return (
    <nav className="bottom-nav" aria-label={t("nav.sections")}>
      {model.pinned.map((def) => (
        <NavLink key={def.id} to={def.to} end={def.end} className={isAt(def, pathname) ? "on" : ""}>
          <span className="glyph" aria-hidden="true">
            {def.glyph}
          </span>
          {t(def.label)}
        </NavLink>
      ))}
      <button
        type="button"
        className={`bottom-more ${inDrawer && !moreOpen ? "on" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={moreOpen}
        onClick={onMore}
      >
        <span className="glyph" aria-hidden="true">
          ☰
        </span>
        {t("nav.moreTab")}
      </button>
    </nav>
  );
}
