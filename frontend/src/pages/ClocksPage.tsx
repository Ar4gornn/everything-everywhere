import { type FormEvent, useMemo, useState } from "react";

import type { ClockHours, ClockPlace } from "../api/types";
import { useOptionalAuth } from "../auth/AuthContext";
import {
  allZones,
  formatDiff,
  fromMinutes,
  homeZone,
  hoursFor,
  newPlaceId,
  readClock,
  searchZones,
  zoneCity,
} from "../clocks/time";
import { useNow } from "../clocks/useNow";
import { DASHBOARD_VIEWS, ViewSwitch } from "../components/ViewSwitch";
import { Card, Empty, ErrorBanner } from "../components/ui";
import { useT } from "../i18n";
import { CLOCKS_MAX, clockHoursOf, clocksOf } from "../layout/preferences";
import { usePreferences } from "../layout/useLayout";

/**
 * The Clocks page (Epic 48, AD-64): the account's own zone first, then the places the person
 * chose. Every write sends the whole list (AD-49). The slider is local state, so leaving the
 * page puts the clocks back on now.
 */

const SLIDER_MAX = 48; // quarter hours: +-12 h
const QUARTERS = Array.from({ length: 96 }, (_, index) => fromMinutes(index * 15));
const LABEL_MAX = 32;

type HourKey = "workStart" | "workEnd" | "nightStart" | "nightEnd";
const HOUR_FIELDS: { key: HourKey; label: `clocks.page.${HourKey}` }[] = [
  { key: "workStart", label: "clocks.page.workStart" },
  { key: "workEnd", label: "clocks.page.workEnd" },
  { key: "nightStart", label: "clocks.page.nightStart" },
  { key: "nightEnd", label: "clocks.page.nightEnd" },
];

function withHour(hours: ClockHours, key: HourKey, value: string): ClockHours {
  switch (key) {
    case "workStart":
      return { ...hours, work: [value, hours.work[1]] };
    case "workEnd":
      return { ...hours, work: [hours.work[0], value] };
    case "nightStart":
      return { ...hours, night: [value, hours.night[1]] };
    default:
      return { ...hours, night: [hours.night[0], value] };
  }
}

function hourValue(hours: ClockHours, key: HourKey): string {
  switch (key) {
    case "workStart":
      return hours.work[0];
    case "workEnd":
      return hours.work[1];
    case "nightStart":
      return hours.night[0];
    default:
      return hours.night[1];
  }
}

export function ClocksPage() {
  const t = useT();
  const user = useOptionalAuth()?.user ?? null;
  const { preferences, update } = usePreferences();
  const places = clocksOf(preferences);
  const defaults = clockHoursOf(preferences);
  const home = homeZone(user);
  const [offset, setOffset] = useState(0); // quarter hours
  const now = useNow(offset * 15);
  const [failed, setFailed] = useState(false);

  const save = (next: ClockPlace[]) => {
    setFailed(false);
    update({ clocks: next }).catch(() => setFailed(true));
  };

  const homeReading = readClock(home, now, home, defaults);
  const shift = offset === 0 ? null : formatDiff(offset * 15);
  const readout =
    offset === 0 ? t("clocks.page.now") : `${homeReading.time}${shift ? ` (${shift})` : ""}`;

  const patch = (id: string, change: Partial<ClockPlace>) =>
    save(places.map((place) => (place.id === id ? { ...place, ...change } : place)));

  const move = (index: number, by: -1 | 1) => {
    const next = [...places];
    const other = index + by;
    if (other < 0 || other >= next.length) return;
    [next[index], next[other]] = [next[other] as ClockPlace, next[index] as ClockPlace];
    save(next);
  };

  return (
    <div className="clocks-page">
      <div className="clocks-top">
        <h1>{t("clocks.module")}</h1>
        <ViewSwitch label="view.dashboardView" views={DASHBOARD_VIEWS} current="/clocks" />
      </div>

      <Card title={t("clocks.page.sliderTitle")}>
        <div className="clocks-slider">
          <label htmlFor="clocks-shift">{t("clocks.page.slider")}</label>
          <input
            id="clocks-shift"
            type="range"
            min={-SLIDER_MAX}
            max={SLIDER_MAX}
            step={1}
            value={offset}
            aria-valuetext={readout}
            onChange={(event) => setOffset(Number(event.target.value))}
          />
          <p className="clocks-readout">
            <span>{t("clocks.page.yourTime")}: </span>
            <strong data-testid="clocks-readout">{readout}</strong>
          </p>
          <button
            type="button"
            className="quiet"
            disabled={offset === 0}
            onClick={() => setOffset(0)}
          >
            {t("clocks.page.backToNow")}
          </button>
        </div>
      </Card>

      <Card title={t("clocks.page.list")}>
        <ul className="clocks-list" aria-label={t("clocks.page.list")}>
          <li className="clocks-row" data-place="home">
            <span className="clocks-name">
              <strong>{t("clocks.you")}</strong>
              <span className="clocks-zone">{zoneCity(home)}</span>
            </span>
            <span className="clocks-time">{homeReading.time}</span>
            <span className="clocks-meta">
              <span className="clocks-shade" data-shade={homeReading.shade}>
                {t(`clocks.shade.${homeReading.shade}`)}
              </span>
            </span>
          </li>
          {places.map((place, index) => {
            const hours = hoursFor(place, defaults);
            const reading = readClock(place.zone, now, home, hours);
            const diff = formatDiff(reading.diff);
            return (
              <PlaceRow
                key={place.id}
                place={place}
                index={index}
                count={places.length}
                hours={hours}
                time={reading.time}
                dayWord={
                  reading.dayShift === 1
                    ? t("clocks.tomorrow")
                    : reading.dayShift === -1
                      ? t("clocks.yesterday")
                      : null
                }
                diff={diff ?? t("clocks.sameTime")}
                shade={t(`clocks.shade.${reading.shade}`)}
                shadeKey={reading.shade}
                onRename={(label) => patch(place.id, { label })}
                onHours={(next) => patch(place.id, { hours: next })}
                onMove={(by) => move(index, by)}
                onRemove={() => save(places.filter((p) => p.id !== place.id))}
              />
            );
          })}
        </ul>
        {places.length === 0 && <Empty>{t("clocks.page.empty")}</Empty>}
      </Card>

      <AddPlace
        full={places.length >= CLOCKS_MAX}
        onAdd={(zone, label) =>
          save([...places, { id: newPlaceId(), zone, label, hours: null }])
        }
      />
      <ErrorBanner message={failed ? t("notify.couldNotSave") : null} />
    </div>
  );
}

function PlaceRow({
  place,
  index,
  count,
  hours,
  time,
  dayWord,
  diff,
  shade,
  shadeKey,
  onRename,
  onHours,
  onMove,
  onRemove,
}: {
  place: ClockPlace;
  index: number;
  count: number;
  hours: ClockHours;
  time: string;
  dayWord: string | null;
  diff: string;
  shade: string;
  shadeKey: string;
  onRename: (label: string) => void;
  onHours: (hours: ClockHours | null) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(place.label);
  const [editing, setEditing] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const label = draft.trim();
    if (!label) return;
    if (label !== place.label) onRename(label);
    setRenaming(false);
  };

  return (
    <li className="clocks-row" data-place={place.id}>
      <span className="clocks-name">
        {renaming ? (
          <form className="clocks-rename" onSubmit={submit}>
            <input
              aria-label={t("clocks.page.nameOf", { label: place.label })}
              value={draft}
              maxLength={LABEL_MAX}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button type="submit" disabled={!draft.trim()}>
              {t("clocks.page.save")}
            </button>
            <button type="button" className="quiet" onClick={() => setRenaming(false)}>
              {t("clocks.page.cancel")}
            </button>
          </form>
        ) : (
          <>
            <strong>{place.label}</strong>
            <span className="clocks-zone">{zoneCity(place.zone)}</span>
          </>
        )}
      </span>
      <span className="clocks-time">{time}</span>
      <span className="clocks-meta">
        {dayWord && <span className="clocks-day">{dayWord}</span>}
        <span className="clocks-diff">{diff}</span>
        <span className="clocks-shade" data-shade={shadeKey}>
          {shade}
        </span>
      </span>
      <span className="clocks-actions">
        <button
          type="button"
          className="quiet"
          aria-label={t("clocks.page.renameOf", { label: place.label })}
          onClick={() => {
            setDraft(place.label);
            setRenaming(true);
          }}
        >
          {t("clocks.page.rename")}
        </button>
        <button
          type="button"
          className="quiet"
          aria-label={t("clocks.page.ownHoursOf", { label: place.label })}
          aria-expanded={editing}
          onClick={() => setEditing((open) => !open)}
        >
          {t("clocks.page.ownHours")}
        </button>
        <button
          type="button"
          className="quiet"
          aria-label={t("clocks.page.up", { label: place.label })}
          disabled={index === 0}
          onClick={() => onMove(-1)}
        >
          ↑
        </button>
        <button
          type="button"
          className="quiet"
          aria-label={t("clocks.page.down", { label: place.label })}
          disabled={index === count - 1}
          onClick={() => onMove(1)}
        >
          ↓
        </button>
        <button
          type="button"
          className="quiet"
          aria-label={t("clocks.page.removeOf", { label: place.label })}
          onClick={onRemove}
        >
          {t("clocks.page.remove")}
        </button>
      </span>
      {editing && (
        <div className="clocks-hours">
          {HOUR_FIELDS.map((field) => (
            <label key={field.key}>
              <span>{t(field.label)}</span>
              <select
                aria-label={`${place.label}: ${t(field.label)}`}
                value={hourValue(hours, field.key)}
                onChange={(event) => onHours(withHour(hours, field.key, event.target.value))}
              >
                {QUARTERS.map((quarter) => (
                  <option key={quarter} value={quarter}>
                    {quarter}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {place.hours && (
            <button type="button" className="quiet" onClick={() => onHours(null)}>
              {t("clocks.page.useDefault")}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function AddPlace({
  full,
  onAdd,
}: {
  full: boolean;
  onAdd: (zone: string, label: string) => void;
}) {
  const t = useT();
  const zones = useMemo(() => allZones(), []);
  const [query, setQuery] = useState("");
  const [zone, setZone] = useState<string | null>(null);
  const [label, setLabel] = useState("");

  const found = useMemo(
    () => (query.trim() ? searchZones(query, zones).slice(0, 20) : []),
    [query, zones],
  );

  const pick = (chosen: string) => {
    setZone(chosen);
    setLabel(zoneCity(chosen).slice(0, LABEL_MAX));
  };

  const reset = () => {
    setZone(null);
    setLabel("");
    setQuery("");
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const clean = label.trim();
    if (!zone || !clean || full) return;
    onAdd(zone, clean);
    reset();
  };

  return (
    <Card title={t("clocks.page.addTitle")}>
      {full ? (
        <p className="clocks-hint" role="status">
          {t("clocks.page.full", { max: CLOCKS_MAX })}
        </p>
      ) : (
        <p className="clocks-hint">{t("clocks.page.searchHint")}</p>
      )}
      <label className="clocks-field">
        <span>{t("clocks.page.search")}</span>
        <input
          type="search"
          value={query}
          disabled={full}
          autoComplete="off"
          onChange={(event) => {
            setQuery(event.target.value);
            setZone(null);
          }}
        />
      </label>
      {!full && !zone && query.trim() !== "" && (
        found.length === 0 ? (
          <p className="clocks-hint">{t("clocks.page.noMatch")}</p>
        ) : (
          <ul className="clocks-results" aria-label={t("clocks.page.results")}>
            {found.map((candidate) => (
              <li key={candidate}>
                <button type="button" className="quiet" onClick={() => pick(candidate)}>
                  {candidate}
                </button>
              </li>
            ))}
          </ul>
        )
      )}
      {zone && !full && (
        <form className="clocks-add" onSubmit={submit}>
          <p className="clocks-hint">{t("clocks.page.chosen", { zone })}</p>
          <label className="clocks-field">
            <span>{t("clocks.page.labelField")}</span>
            <input
              value={label}
              maxLength={LABEL_MAX}
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
          <div className="clocks-actions">
            <button type="submit" disabled={!label.trim()}>
              {t("clocks.page.add")}
            </button>
            <button type="button" className="quiet" onClick={reset}>
              {t("clocks.page.cancel")}
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}

export default ClocksPage;
