import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import type { ClockHours, ClockPlace } from "../api/types";
import { useOptionalAuth } from "../auth/AuthContext";
import { LABEL_MAX, labelRefused } from "../clocks/label";
import {
  type ClockReading,
  allZones,
  canonicalZone,
  formatDiff,
  fromMinutes,
  homeZone,
  hoursFor,
  newPlaceId,
  readClock,
  searchZones,
  zoneCity,
  zoneHint,
} from "../clocks/time";
import { useNow } from "../clocks/useNow";
import { ClockLine, useDayWord } from "../components/ClockLine";
import { DASHBOARD_VIEWS, ViewSwitch } from "../components/ViewSwitch";
import { Card, Empty, ErrorBanner } from "../components/ui";
import { useT } from "../i18n";
import { CLOCKS_MAX, clockHoursOf, clocksOf } from "../layout/preferences";
import { usePreferences } from "../layout/useLayout";

/**
 * The Clocks page (Epic 48, AD-64): the account's own zone first, then the places the person
 * chose. Every write sends the whole list (AD-49). The slider is local state, so leaving the
 * page puts the clocks back on now. A failed write is reported where the action was: in the
 * place's row, or in the Add card.
 */

const SLIDER_MAX = 48; // quarter hours: +-12 h
const QUARTERS = Array.from({ length: 96 }, (_, index) => fromMinutes(index * 15));

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
  const dayWord = useDayWord();
  const places = clocksOf(preferences);
  const defaults = clockHoursOf(preferences);
  const home = homeZone(user);
  const [offset, setOffset] = useState(0); // quarter hours
  const real = useNow();
  const now = useMemo(() => new Date(real.getTime() + offset * 900000), [real, offset]);
  // Which write failed, keyed by place id or "add": the message belongs where the action was.
  const [failures, setFailures] = useState<Record<string, boolean>>({});

  const save = async (next: ClockPlace[], key: string): Promise<boolean> => {
    setFailures((f) => ({ ...f, [key]: false }));
    try {
      await update({ clocks: next });
      return true;
    } catch {
      setFailures((f) => ({ ...f, [key]: true }));
      return false;
    }
  };

  // The day word is counted from the real today, so a shifted home time can say "tomorrow".
  const homeReading = readClock(home, now, home, defaults, real);
  const shift = offset === 0 ? null : formatDiff(offset * 15);
  const homeDay = dayWord(homeReading.dayShift);
  const readout =
    offset === 0
      ? t("clocks.page.now")
      : `${homeDay ? `${homeDay} ` : ""}${homeReading.time}${shift ? ` (${shift})` : ""}`;

  const patch = (id: string, change: Partial<ClockPlace>) =>
    save(
      places.map((place) => (place.id === id ? { ...place, ...change } : place)),
      id,
    );

  const move = (index: number, by: -1 | 1) => {
    const next = [...places];
    const other = index + by;
    const moved = next[index];
    if (!moved || other < 0 || other >= next.length) return;
    [next[index], next[other]] = [next[other] as ClockPlace, moved];
    void save(next, moved.id);
  };

  const sliderCard = (
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
  );

  const addCard = (
    <AddPlace
      full={places.length >= CLOCKS_MAX}
      home={home}
      now={real}
      defaults={defaults}
      failed={failures.add === true}
      onAdd={(zone, label) =>
        save(
          [...places, { id: newPlaceId(), zone: canonicalZone(zone), label, hours: null }],
          "add",
        )
      }
    />
  );

  const listCard = (
    <Card title={t("clocks.page.list")}>
      <ul className="clocks-list" aria-label={t("clocks.page.list")}>
        <ClockLine
          className="clocks-row"
          id="home"
          label={t("clocks.you")}
          city={zoneCity(home)}
          time={homeReading.time}
          dayWord={offset === 0 ? null : homeDay}
          diff={null}
          shade={homeReading.shade}
        />
        {places.map((place, index) => {
          const hours = hoursFor(place, defaults);
          const reading = readClock(place.zone, now, home, hours, real);
          return (
            <PlaceRow
              key={place.id}
              place={place}
              index={index}
              count={places.length}
              hours={hours}
              reading={reading}
              dayWord={dayWord(reading.dayShift)}
              diff={formatDiff(reading.diff) ?? t("clocks.sameTime")}
              failed={failures[place.id] === true}
              onRename={(label) => patch(place.id, { label })}
              onHours={(next) => patch(place.id, { hours: next })}
              onMove={(by) => move(index, by)}
              onRemove={() =>
                void save(
                  places.filter((p) => p.id !== place.id),
                  place.id,
                )
              }
            />
          );
        })}
      </ul>
      {places.length === 0 && <Empty>{t("clocks.page.empty")}</Empty>}
    </Card>
  );

  return (
    <div className="clocks-page">
      <div className="clocks-top">
        <h1>{t("clocks.module")}</h1>
        <ViewSwitch label="view.dashboardView" views={DASHBOARD_VIEWS} current="/clocks" />
      </div>
      {/* No places yet: adding one is the whole job, so it comes first and the slider waits. */}
      {places.length === 0 ? (
        <>
          {addCard}
          {listCard}
        </>
      ) : (
        <>
          {sliderCard}
          {listCard}
          {addCard}
        </>
      )}
    </div>
  );
}

function PlaceRow({
  place,
  index,
  count,
  hours,
  reading,
  dayWord,
  diff,
  failed,
  onRename,
  onHours,
  onMove,
  onRemove,
}: {
  place: ClockPlace;
  index: number;
  count: number;
  hours: ClockHours;
  reading: ClockReading;
  dayWord: string | null;
  diff: string;
  failed: boolean;
  onRename: (label: string) => Promise<boolean>;
  onHours: (hours: ClockHours | null) => Promise<boolean>;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(place.label);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [hoursDraft, setHoursDraft] = useState(hours);
  const editRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const upRef = useRef<HTMLButtonElement>(null);
  const downRef = useRef<HTMLButtonElement>(null);
  const moved = useRef<"up" | "down" | null>(null);
  const renamedBefore = useRef(false);

  // Rename opens on the name, selected; closing it (save or cancel) hands focus back to Edit.
  useEffect(() => {
    if (renaming) {
      renamedBefore.current = true;
      nameRef.current?.focus();
      nameRef.current?.select();
    } else if (renamedBefore.current) {
      renamedBefore.current = false;
      editRef.current?.focus();
    }
  }, [renaming]);

  // After a move the row has a new index: keep focus on the same arrow, or on the other one
  // when this one has just run out of road.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the row's index changes
  useEffect(() => {
    const was = moved.current;
    if (!was) return;
    moved.current = null;
    const same = was === "up" ? upRef.current : downRef.current;
    const other = was === "up" ? downRef.current : upRef.current;
    if (same && !same.disabled) same.focus();
    else if (other && !other.disabled) other.focus();
  }, [index]);

  const refused = labelRefused(draft);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const label = draft.trim();
    if (!label || refused) return;
    if (label === place.label) {
      setRenaming(false);
      return;
    }
    // A refused save leaves the form open with what was typed.
    if (await onRename(label)) setRenaming(false);
  };

  const toggle = () => {
    setOpen((was) => !was);
    setRenaming(false);
    setHoursOpen(false);
  };

  const move = (by: -1 | 1) => {
    moved.current = by === -1 ? "up" : "down";
    onMove(by);
  };

  return (
    <ClockLine
      className="clocks-row"
      id={place.id}
      label={place.label}
      city={zoneHint(place.label, place.zone)}
      time={reading.time}
      dayWord={dayWord}
      diff={diff}
      shade={reading.shade}
      ownHours={place.hours !== null}
    >
      <button
        ref={editRef}
        type="button"
        className="quiet clocks-edit"
        aria-label={t("clocks.page.editOf", { label: place.label })}
        aria-expanded={open}
        onClick={toggle}
      >
        {t("clocks.page.edit")}
      </button>
      {failed && <ErrorBanner message={t("notify.couldNotSave")} />}
      {open && (
        <div className="clocks-panel">
          {renaming ? (
            <form className="clocks-rename" onSubmit={submit}>
              <input
                ref={nameRef}
                aria-label={t("clocks.page.nameOf", { label: place.label })}
                value={draft}
                maxLength={LABEL_MAX}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setRenaming(false);
                  }
                }}
              />
              <button type="submit" disabled={!draft.trim() || refused}>
                {t("clocks.page.save")}
              </button>
              <button type="button" className="quiet" onClick={() => setRenaming(false)}>
                {t("clocks.page.cancel")}
              </button>
              {refused && (
                <p className="clocks-hint" role="alert">
                  {t("clocks.page.labelBad")}
                </p>
              )}
            </form>
          ) : (
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
                aria-expanded={hoursOpen}
                onClick={() => {
                  setHoursDraft(hours);
                  setHoursOpen((was) => !was);
                }}
              >
                {t("clocks.page.ownHours")}
              </button>
              <button
                ref={upRef}
                type="button"
                className="quiet"
                aria-label={t("clocks.page.up", { label: place.label })}
                disabled={index === 0}
                onClick={() => move(-1)}
              >
                ↑
              </button>
              <button
                ref={downRef}
                type="button"
                className="quiet"
                aria-label={t("clocks.page.down", { label: place.label })}
                disabled={index === count - 1}
                onClick={() => move(1)}
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
          )}
          {hoursOpen && !renaming && (
            <div className="clocks-hours">
              {HOUR_FIELDS.map((field) => (
                <label key={field.key}>
                  <span>{t(field.label)}</span>
                  <select
                    aria-label={`${place.label}: ${t(field.label)}`}
                    value={hourValue(hoursDraft, field.key)}
                    onChange={(event) =>
                      setHoursDraft(withHour(hoursDraft, field.key, event.target.value))
                    }
                  >
                    {QUARTERS.map((quarter) => (
                      <option key={quarter} value={quarter}>
                        {quarter}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <span className="clocks-actions">
                <button
                  type="button"
                  onClick={async () => {
                    if (await onHours(hoursDraft)) setHoursOpen(false);
                  }}
                >
                  {t("clocks.page.save")}
                </button>
                <button type="button" className="quiet" onClick={() => setHoursOpen(false)}>
                  {t("clocks.page.cancel")}
                </button>
                {place.hours && (
                  <button
                    type="button"
                    className="quiet"
                    onClick={async () => {
                      if (await onHours(null)) setHoursOpen(false);
                    }}
                  >
                    {t("clocks.page.useDefault")}
                  </button>
                )}
              </span>
            </div>
          )}
        </div>
      )}
    </ClockLine>
  );
}

function AddPlace({
  full,
  home,
  now,
  defaults,
  failed,
  onAdd,
}: {
  full: boolean;
  home: string;
  now: Date;
  defaults: ClockHours;
  failed: boolean;
  onAdd: (zone: string, label: string) => Promise<boolean>;
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

  const refused = labelRefused(label);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const clean = label.trim();
    if (!zone || !clean || refused || full) return;
    // A refused save keeps the form, so the person can try again.
    if (await onAdd(zone, clean)) reset();
  };

  return (
    <Card title={t("clocks.page.addTitle")}>
      {full ? (
        <p className="clocks-hint" role="status">
          {t("clocks.page.full", { max: CLOCKS_MAX })}
        </p>
      ) : (
        <>
          <p className="clocks-hint">{t("clocks.page.searchHint")}</p>
          <label className="clocks-field">
            <span>{t("clocks.page.search")}</span>
            <input
              type="search"
              value={query}
              autoComplete="off"
              onChange={(event) => {
                setQuery(event.target.value);
                setZone(null);
              }}
            />
          </label>
        </>
      )}
      {!full &&
        !zone &&
        query.trim() !== "" &&
        (found.length === 0 ? (
          <p className="clocks-hint">{t("clocks.page.noMatch")}</p>
        ) : (
          <ul className="clocks-results" aria-label={t("clocks.page.results")}>
            {found.map((candidate) => {
              const there = readClock(candidate, now, home, defaults);
              const diff = formatDiff(there.diff);
              return (
                <li key={candidate}>
                  <button
                    type="button"
                    className="quiet"
                    aria-label={`${zoneCity(candidate)} — ${candidate} · ${there.time}${diff ? ` (${diff})` : ""}`}
                    onClick={() => pick(candidate)}
                  >
                    <strong>{zoneCity(candidate)}</strong>
                    <span className="clocks-zone"> — {candidate}</span>
                    <span className="clocks-zone">
                      {" "}
                      · {there.time}
                      {diff ? ` (${diff})` : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ))}
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
          {refused && (
            <p className="clocks-hint" role="alert">
              {t("clocks.page.labelBad")}
            </p>
          )}
          <div className="clocks-actions">
            <button type="submit" disabled={!label.trim() || refused}>
              {t("clocks.page.add")}
            </button>
            <button type="button" className="quiet" onClick={reset}>
              {t("clocks.page.cancel")}
            </button>
          </div>
        </form>
      )}
      {failed && <ErrorBanner message={t("notify.couldNotSave")} />}
    </Card>
  );
}

export default ClocksPage;
