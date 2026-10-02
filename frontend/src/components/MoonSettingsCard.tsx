import { useState } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";
import { useT } from "../i18n";
import { useModule } from "../layout/modules";
import { usePreferences } from "../layout/useLayout";
import type { Hemisphere } from "../moon/hemisphere";
import { clearPlace, usePlace } from "../moon/location";
import { Card, ErrorBanner } from "./ui";

const CHOICES: { value: Hemisphere | null; label: "moon.settings.auto" | "moon.settings.north" | "moon.settings.south" }[] = [
  { value: null, label: "moon.settings.auto" },
  { value: "north", label: "moon.settings.north" },
  { value: "south", label: "moon.settings.south" },
];

/**
 * Settings → Moon (Epic 47, AD-63): which way the moon is drawn, and the place moonrise is
 * computed for. The place is set on the Moon page (locate or type it); here it is only shown
 * and removed. Only while the Moon module is on.
 */
export function MoonSettingsCard() {
  const on = useModule("moon");
  if (!on) return null;
  return <MoonSettings />;
}

function MoonSettings() {
  const t = useT();
  const { user } = useAuth();
  const { preferences, update } = usePreferences();
  const [place, setPlace] = usePlace();
  const [failed, setFailed] = useState(false);
  const chosen = preferences.moon_hemisphere ?? null;

  function choose(value: Hemisphere | null) {
    setFailed(false);
    // null is "Auto": the server keeps the key as null and the device derives it.
    update({ moon_hemisphere: value }).catch(() => setFailed(true));
  }

  function remove() {
    if (user) clearPlace(user.id);
    setPlace(null);
  }

  const where = place
    ? `${place.label ? `${place.label} · ` : ""}${place.lat.toFixed(1)}, ${place.lon.toFixed(1)}`
    : null;

  return (
    <Card title={t("moon.settings.title")}>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 600, marginBottom: 6 }}>{t("moon.settings.hemisphere")}</legend>
        <div className="stack-checks">
          {CHOICES.map((choice) => (
            <label key={choice.label} className="check">
              <input
                type="radio"
                name="moon-hemisphere"
                checked={chosen === choice.value}
                onChange={() => choose(choice.value)}
              />
              <span>{t(choice.label)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <h3 style={{ fontSize: 15, margin: "16px 0 6px" }}>{t("moon.place.title")}</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        {where ? t("moon.settings.placeNow", { place: where }) : t("moon.place.none")}
      </p>
      <p className="hint">{t("moon.place.privacy")}</p>
      <div className="row" style={{ flexWrap: "wrap", gap: "8px 16px" }}>
        {place && (
          <button type="button" className="quiet" onClick={remove}>
            {t("moon.place.remove")}
          </button>
        )}
        <Link to="/moon">{t("moon.settings.placeLink")}</Link>
      </div>
      <ErrorBanner message={failed ? t("notify.couldNotSave") : null} />
    </Card>
  );
}
