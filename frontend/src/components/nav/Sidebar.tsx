import { NavLink } from "react-router-dom";

import { useT } from "../../i18n";
import { isAt, type NavModel } from "../../nav/model";

/**
 * Epic 52 (AD-65): the desktop sidebar (≥721px) — every visible place, grouped, then
 * Settings. Hidden on a phone by CSS. SKELETON: builder B owns this file (look, hints,
 * sticky full-height column, brand at top).
 */
export function Sidebar({ model, pathname }: { model: NavModel; pathname: string }) {
  const t = useT();
  return (
    <nav className="sidebar" aria-label={t("nav.sidebar")}>
      {model.sidebar.map((group) => (
        <section key={group.id} className="sidebar-group">
          <h2 className="sidebar-heading">{t(group.label)}</h2>
          {group.items.map((def) => (
            <NavLink key={def.id} to={def.to} end={def.end} className={isAt(def, pathname) ? "on" : ""}>
              <span className="glyph" aria-hidden="true">
                {def.glyph}
              </span>
              {t(def.label)}
            </NavLink>
          ))}
        </section>
      ))}
    </nav>
  );
}
