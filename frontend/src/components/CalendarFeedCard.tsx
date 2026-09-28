import { useState } from "react";

import { api, apiUrl } from "../api/client";
import type { CalendarFeed, FeedLayer, ModuleId } from "../api/types";
import { type MessageKey, useT } from "../i18n";
import { errorMessage } from "../i18n/errors";
import { usePreferences } from "../layout/useLayout";
import { useDates } from "../useDates";
import { useLoad } from "../useLoad";
import { Card, ErrorBanner } from "./ui";

/** In the server's catalogue order (`calendar_feed.LAYERS`). */
const LAYERS = [
  ["due", "feed.layerDue"],
  ["money", "feed.layerMoney"],
  ["savings", "feed.layerSavings"],
  ["stock", "feed.layerStock"],
  ["gym", "feed.layerGym"],
  ["habits", "feed.layerHabits"],
  ["schedule", "feed.layerSchedule"],
  ["mood", "feed.layerMood"],
  ["meals", "feed.layerMeals"],
] as const satisfies readonly (readonly [FeedLayer, MessageKey])[];

/** A layer that belongs to a module sends nothing while the module is off (Epic 33). */
const LAYER_MODULE: Partial<Record<FeedLayer, ModuleId>> = {
  stock: "stock",
  gym: "gym",
  habits: "habits",
  schedule: "habits",
  mood: "mood",
  meals: "recipes",
};

const OFF: CalendarFeed = {
  on: false,
  layers: [],
  detailed: false,
  alarm: false,
  created_at: null,
  last_fetched_at: null,
};

/** `webcal:` asks the operating system to hand the URL to its calendar app. */
const webcal = (url: string): string => url.replace(/^https?:/, "webcal:");

function localDay(instant: Date): string {
  const month = String(instant.getMonth() + 1).padStart(2, "0");
  const day = String(instant.getDate()).padStart(2, "0");
  return `${instant.getFullYear()}-${month}-${day}`;
}

/**
 * Settings → Calendar apps (Epic 39, AD-55). One secret subscribe link per account, shown
 * once when it is made; what it sends; and whether titles carry names and amounts.
 */
export function CalendarFeedCard() {
  const t = useT();
  const dates = useDates();
  const { preferences } = usePreferences();
  const feed = useLoad<CalendarFeed>(() => api.calendarFeed(), OFF, [], "feed.couldNotLoad");
  // The URL exists in this component's memory only, from the answer that minted it.
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function attempt<T>(key: string, action: () => Promise<T>): Promise<T | null> {
    setError(null);
    setBusy(key);
    try {
      return await action();
    } catch (caught) {
      setError(errorMessage(t, caught, "feed.couldNotChange"));
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function mint(action: () => Promise<{ path: string }>) {
    const minted = await attempt("mint", action);
    if (minted) {
      setCopied(false);
      setUrl(apiUrl(minted.path));
      await feed.reload();
    }
  }

  async function turnOff() {
    if (!window.confirm(t("feed.turnOffConfirm"))) return;
    if ((await attempt("off", () => api.turnOffCalendarFeed().then(() => true))) !== null) {
      setUrl(null);
      await feed.reload();
    }
  }

  async function rotate() {
    if (!window.confirm(t("feed.rotateConfirm"))) return;
    await mint(() => api.rotateCalendarFeed());
  }

  async function change(patch: { layers?: FeedLayer[]; detailed?: boolean; alarm?: boolean }) {
    if ((await attempt("patch", () => api.updateCalendarFeed(patch))) !== null) {
      await feed.reload();
    }
  }

  function toggleLayer(layer: FeedLayer, on: boolean) {
    const chosen = feed.data.layers.filter((each) => each !== layer);
    void change({ layers: on ? [...chosen, layer] : chosen });
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // No clipboard permission: the field is selectable, which is the fallback.
      setCopied(false);
    }
  }

  const current = feed.data;
  const fetched = current.last_fetched_at ? new Date(current.last_fetched_at) : null;

  return (
    <div id="calendar-feed">
      <Card title={t("feed.title")}>
        <p className="hint" style={{ margin: "0 0 10px" }}>
          {t("feed.hint")}
        </p>
        {feed.failure && <ErrorBanner message={feed.failure} />}
        <ErrorBanner message={error} />

        {!current.on ? (
          <button
            type="button"
            disabled={busy !== null || feed.loading}
            onClick={() => void mint(() => api.turnOnCalendarFeed())}
          >
            {busy === "mint" ? t("state.working") : t("feed.turnOn")}
          </button>
        ) : (
          <>
            {url ? (
              <div className="feed-link">
                <label>
                  {t("feed.linkLabel")}
                  <input
                    type="text"
                    readOnly
                    value={url}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                </label>
                <p className="hint" style={{ margin: "4px 0 8px" }}>
                  {t("feed.linkOnce")}
                </p>
                <div className="row">
                  <button type="button" onClick={() => void copy(url)}>
                    {t("feed.copy")}
                  </button>
                  <button
                    type="button"
                    className="quiet"
                    onClick={() => window.location.assign(webcal(url))}
                  >
                    {t("feed.open")}
                  </button>
                </div>
                {copied && (
                  <p className="hint" role="status">
                    {t("feed.copied")}
                  </p>
                )}
              </div>
            ) : (
              <p className="hint">{t("feed.linkHidden")}</p>
            )}
            <p className="hint" style={{ marginTop: 8 }}>
              {fetched
                ? t("feed.lastFetched", {
                    when: `${dates.dayAcrossYears(localDay(fetched))} ${fetched
                      .toTimeString()
                      .slice(0, 5)}`,
                  })
                : t("feed.neverFetched")}
            </p>
            <div className="row" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="quiet"
                disabled={busy !== null}
                onClick={() => void rotate()}
              >
                {busy === "mint" ? t("state.working") : t("feed.rotate")}
              </button>
              <button
                type="button"
                className="quiet"
                disabled={busy !== null}
                onClick={() => void turnOff()}
              >
                {busy === "off" ? t("state.working") : t("feed.turnOff")}
              </button>
            </div>

            <fieldset style={{ border: 0, padding: 0, margin: "14px 0 0" }}>
              <legend style={{ fontWeight: 600, marginBottom: 6 }}>{t("feed.whatTitle")}</legend>
              <div className="stack-checks">
                {LAYERS.map(([layer, label]) => {
                  const module = LAYER_MODULE[layer];
                  const moduleOff = module !== undefined && !preferences.modules[module];
                  return (
                    <label key={layer} className="check">
                      <input
                        type="checkbox"
                        checked={current.layers.includes(layer) && !moduleOff}
                        disabled={moduleOff || busy !== null}
                        onChange={(event) => toggleLayer(layer, event.target.checked)}
                      />
                      <span>
                        {t(label)}
                        {moduleOff && <span className="hint"> · {t("feed.moduleOff")}</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
              <p className="hint" style={{ marginTop: 6 }}>
                {t("feed.window")}
              </p>
            </fieldset>

            <div className="stack-checks" style={{ marginTop: 14 }}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={current.detailed}
                  disabled={busy !== null}
                  onChange={(event) => void change({ detailed: event.target.checked })}
                />
                <span>
                  {t("feed.detailed")}
                  <span className="hint" style={{ display: "block" }}>
                    {t("feed.detailedHint")}
                  </span>
                </span>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={current.alarm}
                  disabled={busy !== null}
                  onChange={(event) => void change({ alarm: event.target.checked })}
                />
                <span>
                  {t("feed.alarm")}
                  <span className="hint" style={{ display: "block" }}>
                    {t("feed.alarmHint")}
                  </span>
                </span>
              </label>
            </div>
            <p className="hint" style={{ marginTop: 10 }}>
              {t("feed.googleSlow")}
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
