import { useState } from "react";
import { Link } from "react-router-dom";

import type { ClockHours, WallTime } from "../api/types";
import { canonicalZone, fromMinutes, zoneCity } from "../clocks/time";
import { useT } from "../i18n";
import { clockHoursOf, clocksOf } from "../layout/preferences";
import { useModule } from "../layout/modules";
import { usePreferences } from "../layout/useLayout";
import { Card, ErrorBanner } from "./ui";

/** Every quarter hour of a day: the 96 values the server's grid accepts. */
const TIMES: WallTime[] = Array.from({ length: 96 }, (_, i) => fromMinutes(i * 15));

type Range = "work" | "night";

/**
 * Settings → Clocks (Epic 48, AD-64): the account's default work and night hours, and the
 * zone the calendar also shows times in. Only while the Clocks module is on.
 */
export function ClocksSettingsCard() {
  const on = useModule("clocks");
  if (!on) return null;
  return <ClocksSettings />;
}

function ClocksSettings() {
  const t = useT();
  const { preferences, update } = usePreferences();
  const [failed, setFailed] = useState(false);
  const hours = clockHoursOf(preferences);
  const places = clocksOf(preferences);
  const zone = preferences.calendar_zone ?? null;

  function setHours(range: Range, index: 0 | 1, value: WallTime) {
    setFailed(false);
    const pair: [WallTime, WallTime] = [...hours[range]];
    pair[index] = value;
    const next: ClockHours = { ...hours, [range]: pair };
    update({ clock_hours: next }).catch(() => setFailed(true));
  }

  function setZone(value: string) {
    setFailed(false);
    // null is "Off": the server keeps the key as null.
    update({ calendar_zone: value === "" ? null : value }).catch(() => setFailed(true));
  }

  const rows: {
    range: Range;
    label: "clocks.settings.work" | "clocks.settings.night";
    aria: [
      "clocks.settings.workStart" | "clocks.settings.nightStart",
      "clocks.settings.workEnd" | "clocks.settings.nightEnd",
    ];
  }[] = [
    {
      range: "work",
      label: "clocks.settings.work",
      aria: ["clocks.settings.workStart", "clocks.settings.workEnd"],
    },
    {
      range: "night",
      label: "clocks.settings.night",
      aria: ["clocks.settings.nightStart", "clocks.settings.nightEnd"],
    },
  ];
  // One option per zone: two places in Paris are one choice, named after both. The zone is
  // kept under its current name, so a legacy spelling saved earlier still selects its place.
  const options: { zone: string; labels: string[] }[] = [];
  for (const place of places) {
    const key = canonicalZone(place.zone);
    const found = options.find((option) => option.zone === key);
    if (found) found.labels.push(place.label);
    else options.push({ zone: key, labels: [place.label] });
  }
  const optionText = ({ zone: key, labels }: { zone: string; labels: string[] }) => {
    const city = zoneCity(key);
    const only = labels.length === 1 ? (labels[0] ?? "") : null;
    return only !== null && only.trim().toLowerCase() === city.toLowerCase()
      ? city
      : `${labels.join(", ")} · ${city}`;
  };
  const current = zone ? canonicalZone(zone) : "";
  // A zone saved earlier whose place was since removed still has to show, or the select lies.
  const removed = current !== "" && !options.some((option) => option.zone === current);

  return (
    <Card title={t("clocks.settings.title")}>
      <h3 style={{ fontSize: 15, margin: "0 0 6px" }}>{t("clocks.settings.hours")}</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        {t("clocks.settings.hoursHint")}
      </p>
      {rows.map(({ range, label, aria }) => (
        <div key={range} className="row" style={{ flexWrap: "wrap", gap: "8px 12px", marginBottom: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 120 }}>{t(label)}</span>
          {([0, 1] as const).map((index) => (
            // `label` is a grid app-wide: say flex outright so the word sits beside its select.
            <label key={index} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span>{t(index === 0 ? "clocks.settings.from" : "clocks.settings.to")}</span>
              <select
                style={{ width: "6.5rem" }}
                aria-label={t(aria[index])}
                value={hours[range][index]}
                onChange={(event) => setHours(range, index, event.target.value)}
              >
                {TIMES.map((time) => (
                  <option key={time} value={time}>
                    {time}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      ))}
      <h3 style={{ fontSize: 15, margin: "16px 0 6px" }}>{t("clocks.settings.calendarZone")}</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        {places.length > 0 ? t("clocks.settings.calendarZoneHint") : t("clocks.settings.noPlaces")}
      </p>
      <select
        aria-label={t("clocks.settings.calendarZone")}
        value={current}
        onChange={(event) => setZone(event.target.value)}
      >
        <option value="">{t("clocks.settings.calendarOff")}</option>
        {removed ? <option value={current}>{zoneCity(current)}</option> : null}
        {options.map((option) => (
          <option key={option.zone} value={option.zone}>
            {optionText(option)}
          </option>
        ))}
      </select>
      {removed ? (
        <p className="hint" role="status">
          {t("clocks.settings.removedPlace")}
        </p>
      ) : null}
      <p>
        <Link to="/clocks">{t("clocks.settings.link")}</Link>
      </p>
      <ErrorBanner message={failed ? t("notify.couldNotSave") : null} />
    </Card>
  );
}
