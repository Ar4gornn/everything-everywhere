import { useEffect, useLayoutEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";

import { useT } from "../../i18n";
import { isAt, type NavModel } from "../../nav/model";
import { useNavHints } from "../../nav/hints";
import "./drawer.css";

/**
 * Epic 52 (AD-65): the More drawer on a phone — a native modal `<dialog>` bottom sheet (the
 * app's modal pattern since AD-60) with one tile per place not pinned to the bar, grouped,
 * each with icon, name and live hint (`useNavHints`), then Settings last. Closes on a tile
 * tap, Escape, the close button and a backdrop tap; focus returns to More.
 *
 * Anything outside a modal dialog is inert while it is open, so everything it needs is in it.
 * Its body is mounted only while open: the hints (and the lazy moon chunk) cost nothing
 * until the drawer is asked for.
 */
export function NavDrawer({
  model,
  open,
  onClose,
}: {
  model: NavModel;
  open: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const wasOpen = useRef(false);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  // A tap on the backdrop. The padding is on the inner box, so a click that lands on the
  // dialog element itself is the backdrop's. Escape and the close button are the keyboard
  // routes, so this is a listener rather than an `onClick` the linter would want a key for.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const tap = (event: MouseEvent) => {
      if (event.target === dialog) onClose();
    };
    dialog.addEventListener("click", tap);
    return () => dialog.removeEventListener("click", tap);
  }, [onClose]);

  // Back to the More button. The browser does this for a real dialog when the opener was
  // focused, but Safari does not focus a button on tap, so say it here.
  useEffect(() => {
    if (wasOpen.current && !open) {
      document.querySelector<HTMLElement>(".bottom-nav .bottom-more")?.focus();
    }
    wasOpen.current = open;
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="nav-drawer"
      aria-labelledby="nav-drawer-title"
      onClose={() => {
        if (open) onClose();
      }}
      onCancel={() => {
        if (open) onClose();
      }}
    >
      {open && <DrawerBody model={model} onClose={onClose} />}
    </dialog>
  );
}

function DrawerBody({ model, onClose }: { model: NavModel; onClose: () => void }) {
  const t = useT();
  const { pathname } = useLocation();
  const hints = useNavHints({ moon: true });
  const settingsHere = pathname === "/settings" || pathname.startsWith("/settings/");

  return (
    <div className="nav-drawer-body">
      <div className="nav-drawer-head">
        <h2 id="nav-drawer-title">{t("nav.drawer.title")}</h2>
        <button
          type="button"
          className="quiet nav-close"
          aria-label={t("nav.drawer.close")}
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      {model.drawer.map((group) => (
        <section key={group.id} className="nav-drawer-group" aria-labelledby={`nav-group-${group.id}`}>
          <h3 id={`nav-group-${group.id}`}>{t(group.label)}</h3>
          <ul className="nav-tiles">
            {group.items.map((def) => (
              <li key={def.id}>
                <Link
                  to={def.to}
                  className="nav-tile"
                  aria-current={isAt(def, pathname) ? "page" : undefined}
                  onClick={onClose}
                >
                  <span className="glyph" aria-hidden="true">
                    {def.glyph}
                  </span>
                  <span className="nav-tile-name">{t(def.label)}</span>
                  {hints[def.id] && <span className="nav-tile-hint">{hints[def.id]}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <ul className="nav-tiles">
        <li>
          <Link
            to="/settings"
            className="nav-tile"
            aria-current={settingsHere ? "page" : undefined}
            onClick={onClose}
          >
            <span className="glyph" aria-hidden="true">
              ⚙
            </span>
            <span className="nav-tile-name">{t("nav.settings")}</span>
          </Link>
        </li>
      </ul>
    </div>
  );
}
