import { Link } from "react-router-dom";

import { useT } from "../../i18n";
import { isAt, type NavModel } from "../../nav/model";
import "./drawer.css";

/**
 * Epic 52 (AD-65): the phone's bottom bar — the pinned places, then More, which opens the
 * drawer. More is lit when the current page is one of the drawer's places, or Settings (which
 * the drawer also holds), so five slots still say where you are. Keep `aria-label={t("nav.sections")}`: the tour and many tests
 * find the bar by that name.
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
  const atSettings = pathname === "/settings" || pathname.startsWith("/settings/");
  const inDrawer =
    atSettings || model.drawer.some((group) => group.items.some((def) => isAt(def, pathname)));
  return (
    <nav className="bottom-nav" aria-label={t("nav.sections")}>
      {model.pinned.map((def) => {
        // A plain `Link`, `aria-current` from `isAt`: NavLink only knows an exact match, and a
        // page under a place (a category, a note, a recipe) lights its tab and must say so.
        const on = isAt(def, pathname);
        return (
          <Link
            key={def.id}
            to={def.to}
            className={on ? "on" : ""}
            aria-current={on ? "page" : undefined}
          >
            <span className="glyph" aria-hidden="true">
              {def.glyph}
            </span>
            {t(def.label)}
          </Link>
        );
      })}
      <button
        type="button"
        className={`bottom-more ${inDrawer ? "on" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={moreOpen}
        aria-current={inDrawer ? "true" : undefined}
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
