import { Link } from "react-router-dom";

import { useOptionalAuth } from "../../auth/AuthContext";
import { useT } from "../../i18n";
import { type NavModel, isAt } from "../../nav/model";
import { useNavHints } from "../../nav/hints";
import { useTheme } from "../../theme";
import { HintView } from "./HintView";
import "./sidebar.css";

/**
 * Epic 52 (AD-65): the desktop sidebar (≥721px) — every visible place, grouped, then
 * Settings (with who is signed in: the desktop has no top bar) and the theme switch. Rendered
 * only on a desktop layout (App.tsx), where the phone's bar and drawer do the same job.
 * Between 721 and 960px it narrows to an icon rail (sidebar.css), so the content column keeps
 * its readable width; the labels stay in the DOM, visually hidden, and each link shows its
 * name as a tooltip on hover and keyboard focus (the app's `data-tip`).
 *
 * Group names are labels, not headings, so the page's own h1 is the first heading. Links are
 * plain `Link`s with an explicit `aria-current`: `NavLink` lights only an exact route match,
 * and `isAt` also owns the paths under a place (a category, a note, a recipe).
 */
export function Sidebar({ model, pathname }: { model: NavModel; pathname: string }) {
  const t = useT();
  const hints = useNavHints();
  const theme = useTheme();
  const email = useOptionalAuth()?.user?.email ?? null;
  const dark = theme.resolved === "dark" || theme.resolved === "oled";
  const themeLabel = t(dark ? "theme.toLight" : "theme.toDark");
  const atSettings = pathname === "/settings" || pathname.startsWith("/settings/");
  return (
    <nav className="sidebar" aria-label={t("nav.sidebar")}>
      <div className="sidebar-brand">
        <span className="sidebar-brand-mark" aria-hidden="true">
          EE
        </span>
        <span className="sidebar-brand-name">{t("app.name")}</span>
      </div>
      <div className="sidebar-groups">
        {model.sidebar.map((group) => (
          <div
            key={group.id}
            className="sidebar-group"
            role="group"
            aria-labelledby={`sidebar-group-${group.id}`}
          >
            <p className="sidebar-heading" id={`sidebar-group-${group.id}`}>
              {t(group.label)}
            </p>
            {group.items.map((def) => {
              const on = isAt(def, pathname);
              const hint = hints[def.id];
              return (
                <Link
                  key={def.id}
                  to={def.to}
                  className={on ? "sidebar-link on" : "sidebar-link"}
                  aria-current={on ? "page" : undefined}
                  data-tip={t(def.label)}
                >
                  <span className="glyph" aria-hidden="true">
                    {def.glyph}
                  </span>
                  <span className="sidebar-label">{t(def.label)}</span>
                  {hint ? <HintView hint={hint} className="sidebar-hint" /> : null}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
      <div className="sidebar-foot" role="group" aria-label={t("nav.sidebar.account")}>
        <Link
          to="/settings"
          className={atSettings ? "sidebar-link on" : "sidebar-link"}
          aria-current={atSettings ? "page" : undefined}
          data-tip={t("nav.settings")}
        >
          <span className="glyph" aria-hidden="true">
            ⚙
          </span>
          <span className="sidebar-label">
            {t("nav.settings")}
            {email ? <span className="sidebar-email">{email}</span> : null}
          </span>
        </Link>
        <button
          type="button"
          className="theme-toggle"
          onClick={theme.toggle}
          aria-label={themeLabel}
          data-tip={themeLabel}
        >
          <span aria-hidden="true">{dark ? "☀︎" : "☾"}</span>
        </button>
      </div>
    </nav>
  );
}
