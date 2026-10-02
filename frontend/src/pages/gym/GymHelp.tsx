import { useEffect, useRef, useState } from "react";

import { useT } from "../../i18n";
import type { MessageKey } from "../../i18n/catalogue";

/**
 * How the gym tab works, in one popup (Epic 42).
 *
 * The app's house rule is "no modal" (see `MoodCheckin.tsx`), and the reason given there is
 * the machinery a hand-rolled one needs: a focus trap, an inert background, Escape. A native
 * `<dialog>` opened with `showModal()` gets all three from the browser, so this is the one
 * place a real popup costs nothing to keep right. It is reading matter, several screens of
 * it, which a popover anchored under a button would carry badly at 375px.
 *
 * jsdom has no `showModal`; the fallback sets `open`, which is enough for a test to read the
 * content and close it.
 */

const SECTIONS: { title: MessageKey; points: MessageKey[] }[] = [
  {
    title: "gym.help.startTitle",
    points: ["gym.help.start1", "gym.help.start2", "gym.help.start3"],
  },
  {
    title: "gym.help.sessionTitle",
    points: [
      "gym.help.session1",
      "gym.help.session2",
      "gym.help.session3",
      "gym.help.session4",
      "gym.help.session5",
    ],
  },
  {
    title: "gym.help.kindsTitle",
    points: ["gym.help.kinds1", "gym.help.kinds2", "gym.help.kinds3"],
  },
  {
    title: "gym.help.routinesTitle",
    points: ["gym.help.routines1", "gym.help.routines2"],
  },
  {
    title: "gym.help.importTitle",
    points: [
      "gym.help.import1",
      "gym.help.import2",
      "gym.help.import3",
      "gym.help.import4",
    ],
  },
  {
    title: "gym.help.offlineTitle",
    points: ["gym.help.offline1", "gym.help.offline2", "gym.help.offline3"],
  },
];

export function GymHelp() {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      if (typeof element.showModal === "function") element.showModal();
      else element.setAttribute("open", "");
    } else if (!open && element.open) {
      if (typeof element.close === "function") element.close();
      else element.removeAttribute("open");
    }
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="quiet gym-help-button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">?</span> {t("gym.help.open")}
      </button>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the backdrop tap is a pointer shortcut; Escape is the keyboard way out, handled by the browser. */}
      <dialog
        ref={dialog}
        className="gym-help"
        aria-labelledby="gym-help-title"
        // Escape and the browser's own close both land here, so state follows the element.
        onClose={() => setOpen(false)}
        onCancel={() => setOpen(false)}
        // A tap on the backdrop is a click on the dialog itself, never on its content.
        onClick={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}
      >
        <div className="gym-help-body">
          <div className="gym-help-head">
            <h2 id="gym-help-title">{t("gym.help.title")}</h2>
            <button type="button" className="quiet" onClick={() => setOpen(false)}>
              {t("gym.help.close")}
            </button>
          </div>
          {SECTIONS.map((section, index) => (
            <section key={section.title} aria-labelledby={`gym-help-${index}`}>
              <h3 id={`gym-help-${index}`}>{t(section.title)}</h3>
              <ul>
                {section.points.map((point) => (
                  <li key={point}>{t(point)}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </dialog>
    </>
  );
}
