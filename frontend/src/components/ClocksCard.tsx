import { Link } from "react-router-dom";

import { useOptionalAuth } from "../auth/AuthContext";
import { formatDiff, homeZone, hoursFor, readClock, zoneCity } from "../clocks/time";
import { useNow } from "../clocks/useNow";
import { useT } from "../i18n";
import { clockHoursOf, clocksOf, preferencesOf } from "../layout/preferences";
import { Card } from "./ui";

/** Epic 48 (AD-64): the account's own time and the first three places, one line each.
 *  Nothing at all while there are no places, so an account that never adds one sees no card. */
const SHOWN = 3;

export function ClocksCard() {
  const t = useT();
  const user = useOptionalAuth()?.user ?? null;
  // Optional auth, like the moon line: the dashboard is also rendered without a provider.
  const preferences = preferencesOf(user);
  const places = clocksOf(preferences);
  const now = useNow();
  if (places.length === 0) return null;

  const defaults = clockHoursOf(preferences);
  const home = homeZone(user);
  const homeReading = readClock(home, now, home, defaults);

  return (
    <Card
      title={t("clocks.card")}
      actions={
        <Link to="/clocks" className="clocks-open">
          {t("clocks.card.open")}
        </Link>
      }
    >
      <ul className="clocks-lines" aria-label={t("clocks.card.list")}>
        <li className="clocks-line" data-place="home">
          <span className="clocks-name">
            <strong>{t("clocks.you")}</strong>
          </span>
          <span className="clocks-time">{homeReading.time}</span>
          <span className="clocks-meta">
            <span className="clocks-shade" data-shade={homeReading.shade}>
              {t(`clocks.shade.${homeReading.shade}`)}
            </span>
          </span>
        </li>
        {places.slice(0, SHOWN).map((place) => {
          const reading = readClock(place.zone, now, home, hoursFor(place, defaults));
          return (
            <li className="clocks-line" key={place.id} data-place={place.id}>
              <span className="clocks-name">
                <strong>{place.label}</strong>
                <span className="clocks-zone">{zoneCity(place.zone)}</span>
              </span>
              <span className="clocks-time">{reading.time}</span>
              <span className="clocks-meta">
                {reading.dayShift !== 0 && (
                  <span className="clocks-day">
                    {reading.dayShift === 1 ? t("clocks.tomorrow") : t("clocks.yesterday")}
                  </span>
                )}
                <span className="clocks-diff">
                  {formatDiff(reading.diff) ?? t("clocks.sameTime")}
                </span>
                <span className="clocks-shade" data-shade={reading.shade}>
                  {t(`clocks.shade.${reading.shade}`)}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
