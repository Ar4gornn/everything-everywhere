import { Link } from "react-router-dom";

import { useOptionalAuth } from "../auth/AuthContext";
import { formatDiff, homeZone, hoursFor, readClock, zoneHint } from "../clocks/time";
import { useNow } from "../clocks/useNow";
import { useT } from "../i18n";
import { clockHoursOf, clocksOf, preferencesOf } from "../layout/preferences";
import { ClockLine, useDayWord } from "./ClockLine";
import { Card } from "./ui";

/** Epic 48 (AD-64): the account's own time and the first three places, one line each, then
 *  "+N more" linking to the page. Nothing at all while there are no places, so an account
 *  that never adds one sees no card. The "Custom hours" tag is the page's, not the card's. */
const SHOWN = 3;

export function ClocksCard() {
  const t = useT();
  const user = useOptionalAuth()?.user ?? null;
  // Optional auth, like the moon line: the dashboard is also rendered without a provider.
  const preferences = preferencesOf(user);
  const places = clocksOf(preferences);
  const now = useNow();
  const dayWord = useDayWord();
  if (places.length === 0) return null;

  const defaults = clockHoursOf(preferences);
  const home = homeZone(user);
  const homeReading = readClock(home, now, home, defaults);
  // The rest are on the page: say how many, rather than leaving them out silently.
  const more = places.length - SHOWN;

  return (
    <Card
      title={t("clocks.card")}
      actions={
        <Link to="/clocks" className="clocks-open" aria-label={t("clocks.card.openLabel")}>
          {t("clocks.card.open")}
        </Link>
      }
    >
      <ul className="clocks-lines" aria-label={t("clocks.card.list")}>
        <ClockLine
          className="clocks-line"
          id="home"
          label={t("clocks.you")}
          city={null}
          time={homeReading.time}
          dayWord={null}
          diff={null}
          shade={homeReading.shade}
        />
        {places.slice(0, SHOWN).map((place) => {
          const reading = readClock(place.zone, now, home, hoursFor(place, defaults));
          return (
            <ClockLine
              key={place.id}
              className="clocks-line"
              id={place.id}
              label={place.label}
              city={zoneHint(place.label, place.zone)}
              time={reading.time}
              dayWord={dayWord(reading.dayShift)}
              diff={formatDiff(reading.diff) ?? t("clocks.sameTime")}
              shade={reading.shade}
            />
          );
        })}
      </ul>
      {more > 0 && (
        <p className="clocks-more">
          <Link to="/clocks" aria-label={t.n("clocks.card.moreLabel", more)}>
            {t.n("clocks.card.more", more)}
          </Link>
        </p>
      )}
    </Card>
  );
}
