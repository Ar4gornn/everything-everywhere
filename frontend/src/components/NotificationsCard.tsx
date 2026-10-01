import { type FormEvent, useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import type { MutedRow, NotificationKind, PushPreview, PushStatus } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { type MessageKey, useT } from "../i18n";
import { errorMessage } from "../i18n/errors";
import { NOTIFICATIONS } from "../layout/preferences";
import { usePreferences } from "../layout/useLayout";
import { currentEndpoint, deviceZone, disablePush, enablePush, pushSupported } from "../push";
import { useLoad } from "../useLoad";
import { Card, ErrorBanner } from "./ui";

const KIND_LABEL = {
  stock: "notify.kindStock",
  recurring: "notify.kindRecurring",
  habits: "notify.kindHabits",
  due_tomorrow: "notify.kindDueTomorrow",
  savings: "notify.kindSavings",
  streak: "notify.kindStreak",
} as const satisfies Record<NotificationKind, MessageKey>;

/** A kind that belongs to a module is silent while the module is off (AD-49, AD-52). */
const KIND_MODULE: Partial<Record<NotificationKind, "stock" | "habits">> = {
  stock: "stock",
  habits: "habits",
};

const MUTED_LABEL = {
  stock: "notify.mutedStock",
  recurring: "notify.mutedRecurring",
  savings: "notify.mutedSavings",
} as const satisfies Record<MutedRow["kind"], MessageKey>;

function zoneList(current: string | null): string[] {
  let zones: string[] = [];
  try {
    zones = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.(
      "timeZone",
    ) ?? [];
  } catch {
    zones = [];
  }
  // The account's and the device's zones are always offered, even where the list omits
  // them (UTC is missing from some engines' list).
  const extra = [current, deviceZone(), "UTC"].filter(
    (zone): zone is string => zone !== null && !zones.includes(zone),
  );
  return [...extra, ...zones];
}

/**
 * Settings → Notifications (Epic 18, Epic 36). The device switch, then what the daily
 * digest may mention, when it arrives, what it would say tonight, and every row that has
 * been kept out of it. Errors stay in this card, beside the control that failed.
 */
export function NotificationsCard() {
  const t = useT();
  const { user, refreshUser } = useAuth();
  const { preferences, update } = usePreferences();
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [time, setTime] = useState(user?.digest_time ?? "19:00");
  const [zone, setZone] = useState<string | null>(user?.timezone ?? deviceZone());

  useEffect(() => {
    let cancelled = false;
    void api.pushStatus().then(
      (found) => {
        if (!cancelled) setStatus(found);
      },
      () => {
        // An older server with no push endpoints: hide the card rather than show an error.
        if (!cancelled) setStatus(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setTime(user?.digest_time ?? "19:00");
    setZone(user?.timezone ?? deviceZone());
  }, [user?.digest_time, user?.timezone]);

  const enabled = status?.enabled === true && pushSupported();
  const preview = useLoad<PushPreview | null>(
    () => (enabled ? api.pushPreview() : Promise.resolve(null)),
    null,
    [enabled],
    "notify.couldNotLoad",
  );
  const muted = useLoad<MutedRow[]>(
    () => (enabled ? api.pushMuted() : Promise.resolve([])),
    [],
    [enabled],
    "notify.couldNotLoad",
  );
  const zones = useMemo(() => zoneList(user?.timezone ?? null), [user?.timezone]);

  if (!enabled || !status) return null;

  async function attempt(key: string, action: () => Promise<unknown>, fallback: MessageKey) {
    setError(null);
    setNotice(null);
    setBusy(key);
    try {
      await action();
      return true;
    } catch (caught) {
      setError(errorMessage(t, caught, fallback));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function toggleDevice(on: boolean) {
    await attempt(
      "device",
      async () => {
        if (!on) {
          await disablePush();
        } else {
          const outcome = await enablePush();
          if (outcome === "denied") setError(t("settings.pushBlocked"));
          else if (outcome === "unsupported") setError(t("settings.pushUnsupported"));
          else if (outcome === "unavailable") setError(t("settings.pushUnavailable"));
        }
        setStatus(await api.pushStatus());
      },
      "settings.couldNotChange",
    );
  }

  async function sendTest() {
    const endpoint = await currentEndpoint();
    if (endpoint === null) {
      setNotice(null);
      setError(t("notify.testNeedsDevice"));
      return;
    }
    const done = await attempt("test", () => api.pushTest(endpoint), "notify.couldNotTest");
    if (done) setNotice(t("notify.testSent"));
    // A 410 means the server forgot this device; the count has changed with it.
    else setStatus(await api.pushStatus().catch(() => status));
  }

  function setKind(kind: NotificationKind, on: boolean) {
    setError(null);
    update({ notifications: { ...preferences.notifications, [kind]: on } })
      .then(() => preview.reload())
      .catch(() => setError(t("notify.couldNotSave")));
  }

  async function saveSchedule(event: FormEvent) {
    event.preventDefault();
    const done = await attempt(
      "schedule",
      () => api.setNotificationSchedule({ timezone: zone, digest_time: time }),
      "notify.couldNotSave",
    );
    if (done) {
      await refreshUser();
      await preview.reload();
      setNotice(t("notify.scheduleSaved"));
    }
  }

  async function unmute(row: MutedRow) {
    const done = await attempt(
      `unmute:${row.id}`,
      () =>
        row.kind === "stock"
          ? api.updateItem(row.id, { notify: true })
          : row.kind === "recurring"
            ? api.updateTemplate(row.id, { notify: true })
            : api.updateSavingsType(row.id, { notify: true }),
      "notify.couldNotSave",
    );
    if (done) await Promise.all([muted.reload(), preview.reload()]);
  }

  // Nothing to save until the account is known: before that, the fields show defaults.
  const scheduleChanged =
    user !== null && (time !== (user.digest_time ?? "19:00") || zone !== (user.timezone ?? null));
  const shown = preview.data;

  return (
    <div id="notifications">
      <Card title={t("settings.notifications")}>
        <p className="hint" style={{ margin: "0 0 10px" }}>
          {t("settings.notificationsHint")}
        </p>
        <div className="row">
          <button type="button" disabled={busy !== null} onClick={() => void toggleDevice(true)}>
            {busy === "device" ? t("state.working") : t("settings.notificationsOn")}
          </button>
          <button
            type="button"
            className="quiet"
            disabled={busy !== null || status.devices === 0}
            onClick={() => void toggleDevice(false)}
          >
            {t("settings.notificationsOff")}
          </button>
          <button
            type="button"
            className="quiet"
            disabled={busy !== null || status.devices === 0}
            onClick={() => void sendTest()}
          >
            {busy === "test" ? t("state.working") : t("notify.sendTest")}
          </button>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          {status.devices === 0 ? t("settings.noDevices") : t.n("settings.devices", status.devices)}
        </p>
        <ErrorBanner message={error} />
        {notice && (
          <p className="hint" role="status">
            {notice}
          </p>
        )}

        <fieldset style={{ border: 0, padding: 0, margin: "14px 0 0" }}>
          <legend style={{ fontWeight: 600, marginBottom: 6 }}>{t("notify.whatTitle")}</legend>
          <div className="stack-checks">
            {NOTIFICATIONS.map(([kind]) => {
              const module = KIND_MODULE[kind];
              const moduleOff = module !== undefined && !preferences.modules[module];
              return (
                <label key={kind} className="check">
                  <input
                    type="checkbox"
                    checked={preferences.notifications[kind] && !moduleOff}
                    disabled={moduleOff}
                    onChange={(event) => setKind(kind, event.target.checked)}
                  />
                  <span>
                    {t(KIND_LABEL[kind])}
                    {moduleOff && <span className="hint"> · {t("notify.moduleOff")}</span>}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <form onSubmit={saveSchedule} style={{ marginTop: 14 }}>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <label style={{ flex: "0 0 auto" }}>
              {t("notify.time")}
              <input
                type="time"
                required
                value={time}
                onChange={(event) => setTime(event.target.value.slice(0, 5))}
              />
            </label>
            <label style={{ flex: "1 1 12rem", minWidth: 0 }}>
              {t("notify.zone")}
              <select value={zone ?? ""} onChange={(event) => setZone(event.target.value || null)}>
                {zones.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={busy !== null || !scheduleChanged || !time}>
              {busy === "schedule" ? t("state.working") : t("action.save")}
            </button>
          </div>
        </form>

        <h3 style={{ fontSize: 15, margin: "16px 0 6px" }}>{t("notify.previewTitle")}</h3>
        {preview.failure ? (
          <p className="hint">{preview.failure}</p>
        ) : shown === null ? (
          <p className="hint">{t("state.loading")}</p>
        ) : (
          <div className="digest-preview">
            <p className="hint" style={{ margin: 0 }}>
              {t("notify.previewWhen", {
                time: shown.digest_time,
                zone: shown.timezone ?? t("notify.serverClock"),
              })}
            </p>
            <p style={{ margin: "4px 0 0" }}>{shown.empty ? t("notify.previewEmpty") : shown.body}</p>
          </div>
        )}

        <h3 style={{ fontSize: 15, margin: "16px 0 6px" }}>{t("notify.mutedTitle")}</h3>
        {muted.failure ? (
          <p className="hint">{muted.failure}</p>
        ) : muted.data.length === 0 ? (
          <p className="hint">{t("notify.mutedNone")}</p>
        ) : (
          <ul className="muted-list">
            {muted.data.map((row) => (
              <li key={`${row.kind}:${row.id}`}>
                <span className="muted-name">
                  {row.name}
                  <span className="hint"> · {t(MUTED_LABEL[row.kind])}</span>
                </span>
                <button
                  type="button"
                  className="quiet"
                  disabled={busy !== null}
                  aria-label={t("notify.unmuteNamed", { name: row.name })}
                  onClick={() => void unmute(row)}
                >
                  {t("notify.unmute")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
