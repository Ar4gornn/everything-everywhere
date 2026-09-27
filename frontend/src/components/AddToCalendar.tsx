import { downloadIcs, type IcsEvent } from "../ics";
import { useT } from "../i18n";

/**
 * "Add to calendar" for one dated thing (Epic 39): an .ics file built on the device and
 * handed to the person's own calendar app. Icon-only, the bell's size, so it fits a row
 * without widening it; the label names the row.
 */
export function AddToCalendar({ event, name }: { event: IcsEvent; name: string }) {
  const t = useT();
  return (
    <button
      type="button"
      className="quiet cal-add"
      aria-label={t("feed.addNamed", { name })}
      title={t("feed.addToCalendar")}
      onClick={() => downloadIcs(event)}
    >
      <span aria-hidden="true">📅</span>
    </button>
  );
}
