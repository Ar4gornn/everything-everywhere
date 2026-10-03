import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ClockHours, ClockPlace } from "../api/types";
import { useOptionalAuth } from "../auth/AuthContext";
import { LABEL_MAX, labelProblem } from "../clocks/label";
import {
  type ClockReading,
  allZones,
  canonicalZone,
  findZones,
  formatDiff,
  fromMinutes,
  homeZone,
  hoursFor,
  newPlaceId,
  placeAliases,
  readClock,
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
const RESULTS_MAX = 20;
/** How long "Removed Mum. Undo" stays, unless another write comes first. */
export const UNDO_MS = 8000;

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

/** The Edit toggle of a place's row, found in the DOM so focus can land on a row that has
 *  only just been rendered (a new place, the neighbour of a removed one). */
const editButtonOf = (id: string) =>
  document.querySelector<HTMLButtonElement>(`[data-place="${id}"] .clocks-edit`);
const searchInput = () => document.getElementById("clocks-search");

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
  // The place an add is saving: the list already holds it (the saver is optimistic), but the
  // Add card must not count it, or an 11 -> 12 add unmounts the form mid-save.
  const [adding, setAdding] = useState<string | null>(null);
  // The last removed place, for Undo, until another write or UNDO_MS.
  const [removed, setRemoved] = useState<{ place: ClockPlace; index: number } | null>(null);
  const sliderRef = useRef<HTMLInputElement>(null);

  // Focus that must wait for a render: a request is kept until its element exists.
  const focusWanted = useRef<(() => HTMLElement | null) | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const focusSoon = (find: () => HTMLElement | null) => {
    focusWanted.current = find;
    setFocusTick((n) => n + 1);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: retried whenever the list changes
  useEffect(() => {
    const element = focusWanted.current?.();
    if (element) {
      focusWanted.current = null;
      element.focus();
    }
  }, [focusTick, places]);

  useEffect(() => {
    if (!removed) return;
    const timer = window.setTimeout(() => setRemoved(null), UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [removed]);

  const clearFailure = (key: string) => setFailures((f) => (f[key] ? { ...f, [key]: false } : f));

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

  /** Any write but a remove ends the chance to undo the last remove. */
  const write = (next: ClockPlace[], key: string) => {
    setRemoved(null);
    clearFailure("undo");
    return save(next, key);
  };

  // The day word is counted from the real today, so a shifted home time can say "tomorrow".
  const homeReading = readClock(home, now, home, defaults, real);
  const shift = offset === 0 ? null : formatDiff(offset * 15);
  const homeDay = dayWord(homeReading.dayShift);
  const readout =
    offset === 0
      ? t("clocks.page.now")
      : `${homeDay ? `${homeDay} ` : ""}${homeReading.time}${shift ? ` (${shift})` : ""}`;
  // "Your time: {time}" with the readout in bold, French spacing included.
  const [readoutBefore = "", readoutAfter = ""] = t("clocks.page.yourTime", {
    time: "\u0000",
  }).split("\u0000");

  const patch = (id: string, change: Partial<ClockPlace>) =>
    write(
      places.map((place) => (place.id === id ? { ...place, ...change } : place)),
      id,
    );

  const move = (index: number, by: -1 | 1) => {
    const next = [...places];
    const other = index + by;
    const moved = next[index];
    if (!moved || other < 0 || other >= next.length) return;
    [next[index], next[other]] = [next[other] as ClockPlace, moved];
    void write(next, moved.id);
  };

  const remove = (index: number) => {
    const place = places[index];
    if (!place) return;
    // Focus goes to the next row's Edit, else the previous one's, else the search.
    const neighbour = places[index + 1] ?? places[index - 1];
    focusSoon(() => (neighbour ? editButtonOf(neighbour.id) : searchInput()));
    void save(
      places.filter((p) => p.id !== place.id),
      place.id,
    ).then((ok) => setRemoved(ok ? { place, index } : null));
  };

  const undo = () => {
    if (!removed) return;
    const { place, index } = removed;
    const next = [...places];
    next.splice(Math.min(index, next.length), 0, place);
    focusSoon(() => editButtonOf(place.id));
    // A refused undo has no row to report in (the place is still gone): it says so here.
    void write(next, "undo").then((ok) => {
      if (!ok) setRemoved({ place, index });
    });
  };

  const add = async (zone: string, label: string): Promise<boolean> => {
    const id = newPlaceId();
    setAdding(id);
    const ok = await write(
      [...places, { id, zone: canonicalZone(zone), label, hours: null }],
      "add",
    );
    setAdding(null);
    if (ok) focusSoon(() => editButtonOf(id));
    return ok;
  };

  const sliderCard = (
    <section className="card clocks-slider-card" aria-labelledby="clocks-slider-title">
      <h2 id="clocks-slider-title" className="clocks-slider-title">
        {t("clocks.page.sliderTitle")}
      </h2>
      <div className="clocks-slider">
        <label htmlFor="clocks-shift" className="clocks-slider-label">
          {t("clocks.page.slider")}
        </label>
        <input
          ref={sliderRef}
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
          {readoutBefore}
          <strong data-testid="clocks-readout">{readout}</strong>
          {readoutAfter}
        </p>
        <button
          type="button"
          className="quiet"
          aria-label={t("clocks.page.backToNow")}
          disabled={offset === 0}
          onClick={() => {
            setOffset(0);
            // The button disables itself, so focus goes to the slider it belongs to.
            sliderRef.current?.focus();
          }}
        >
          <span aria-hidden="true">↺</span>{" "}
          <span className="clocks-back-word">{t("clocks.page.backToNow")}</span>
        </button>
      </div>
    </section>
  );

  const counted = adding ? places.filter((place) => place.id !== adding).length : places.length;
  const addCard = (
    <AddPlace
      full={counted >= CLOCKS_MAX}
      home={home}
      now={real}
      defaults={defaults}
      failed={failures.add === true}
      onAdd={add}
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
              onDismissError={() => clearFailure(place.id)}
              onRename={(label) => patch(place.id, { label })}
              onHours={(next) => patch(place.id, { hours: next })}
              onMove={(by) => move(index, by)}
              onRemove={() => remove(index)}
            />
          );
        })}
      </ul>
      {places.length === 0 && <Empty>{t("clocks.page.empty")}</Empty>}
      <div className="clocks-undo" role="status">
        {removed && (
          <>
            <span>{t("clocks.page.removed", { label: removed.place.label })}</span>{" "}
            <button
              type="button"
              className="quiet"
              aria-label={t("clocks.page.undoOf", { label: removed.place.label })}
              onClick={undo}
            >
              {t("toast.undo")}
            </button>
          </>
        )}
      </div>
      {failures.undo && <ErrorBanner message={t("notify.couldNotSave")} />}
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
  onDismissError,
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
  onDismissError: () => void;
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

  const problem = labelProblem(draft);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const label = draft.trim();
    if (!label || problem) return;
    if (label === place.label) {
      setRenaming(false);
      return;
    }
    // A refused save leaves the form open with what was typed.
    if (await onRename(label)) setRenaming(false);
  };

  const cancelRename = () => {
    onDismissError();
    setRenaming(false);
  };

  /** Close the hours editor (saved, cancelled or reset) and hand focus back to Edit. */
  const closeHours = () => {
    setHoursOpen(false);
    editRef.current?.focus();
  };

  const cancelHours = () => {
    onDismissError();
    closeHours();
  };

  const toggle = () => {
    if (open) onDismissError();
    setOpen((was) => !was);
    setRenaming(false);
    setHoursOpen(false);
  };

  const move = (by: -1 | 1) => {
    moved.current = by === -1 ? "up" : "down";
    onMove(by);
  };

  const editButton = (
    <button
      ref={editRef}
      type="button"
      className="quiet clocks-edit"
      aria-label={t(open ? "clocks.page.doneOf" : "clocks.page.editOf", { label: place.label })}
      aria-expanded={open}
      onClick={toggle}
    >
      <span className="clocks-edit-icon" aria-hidden="true">
        {open ? "✓" : "✎"}
      </span>
      <span className="clocks-edit-word">
        {t(open ? "clocks.page.done" : "clocks.page.edit")}
      </span>
    </button>
  );

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
      action={editButton}
    >
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
                    cancelRename();
                  }
                }}
              />
              <button type="submit" disabled={!draft.trim() || problem !== null}>
                {t("clocks.page.save")}
              </button>
              <button type="button" className="quiet" onClick={cancelRename}>
                {t("clocks.page.cancel")}
              </button>
              <LabelProblem problem={problem} />
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
            <div
              className="clocks-hours"
              role="group"
              aria-label={t("clocks.page.ownHoursOf", { label: place.label })}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelHours();
                }
              }}
            >
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
                    if (await onHours(hoursDraft)) closeHours();
                  }}
                >
                  {t("clocks.page.save")}
                </button>
                <button type="button" className="quiet" onClick={cancelHours}>
                  {t("clocks.page.cancel")}
                </button>
                {place.hours && (
                  <button
                    type="button"
                    className="quiet"
                    onClick={async () => {
                      if (await onHours(null)) closeHours();
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

/** Why a typed name cannot be saved, in words. */
function LabelProblem({ problem }: { problem: "character" | "invisible" | null }) {
  const t = useT();
  if (!problem) return null;
  return (
    <p className="clocks-hint" role="alert">
      {t(problem === "character" ? "clocks.page.labelBad" : "clocks.page.labelInvisible")}
    </p>
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
  // The query the current choice was picked from: editing the search after picking shows
  // results again, but the choice and its name stay until another result is picked.
  const [pickedFrom, setPickedFrom] = useState<string | null>(null);
  const [zone, setZone] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const focusName = useRef(false);

  const { matches, total } = useMemo(
    () =>
      query.trim() ? findZones(query, zones, RESULTS_MAX) : { matches: [], total: 0 },
    [query, zones],
  );

  // A picked result hands focus to the Name field, once it is there.
  useEffect(() => {
    if (zone && focusName.current) {
      focusName.current = false;
      nameRef.current?.focus();
    }
  }, [zone]);

  const pick = (chosen: string, alias: string | null) => {
    setZone(chosen);
    setPickedFrom(query);
    // Found as "Delhi": the place is called Delhi. Found by a legacy id ("Calcutta"): the
    // current name, as everywhere else.
    const named = alias && alias in placeAliases ? alias : zoneCity(chosen);
    setLabel(named.slice(0, LABEL_MAX));
    focusName.current = true;
  };

  const reset = () => {
    setZone(null);
    setLabel("");
    setQuery("");
    setPickedFrom(null);
  };

  // Escape anywhere in the card starts over, back in the search.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || full) return;
    if (!query && !zone) return;
    event.preventDefault();
    reset();
    searchRef.current?.focus();
  };

  const problem = labelProblem(label);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const clean = label.trim();
    if (!zone || !clean || problem || full) return;
    // A refused save keeps the form, so the person can try again.
    if (await onAdd(zone, clean)) reset();
  };

  const showResults = !full && query.trim() !== "" && query !== pickedFrom;

  return (
    <Card title={t("clocks.page.addTitle")}>
      <div
        className="clocks-add-card"
        role="group"
        aria-label={t("clocks.page.addTitle")}
        onKeyDown={onKeyDown}
      >
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
                ref={searchRef}
                id="clocks-search"
                type="search"
                value={query}
                autoComplete="off"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </>
        )}
        {showResults &&
          (matches.length === 0 ? (
            <p className="clocks-hint">{t("clocks.page.noMatch")}</p>
          ) : (
            <>
              <ul className="clocks-results" aria-label={t("clocks.page.results")}>
                {matches.map(({ zone: candidate, alias }) => {
                  const there = readClock(candidate, now, home, defaults);
                  const diff = formatDiff(there.diff);
                  const city = zoneCity(candidate);
                  const name = alias ? t("clocks.page.foundAs", { alias, city }) : city;
                  return (
                    <li key={candidate}>
                      <button
                        type="button"
                        className="quiet"
                        aria-label={`${name} — ${candidate} · ${there.time}${diff ? ` (${diff})` : ""}`}
                        onClick={() => pick(candidate, alias)}
                      >
                        <strong>{name}</strong>
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
              {total > matches.length && (
                <p className="clocks-hint clocks-more-results">
                  {t("clocks.page.moreResults", { shown: matches.length, total })}
                </p>
              )}
            </>
          ))}
        {zone && !full && (
          <form className="clocks-add" onSubmit={submit}>
            <p className="clocks-hint">{t("clocks.page.chosen", { zone })}</p>
            <label className="clocks-field">
              <span>{t("clocks.page.labelField")}</span>
              <input
                ref={nameRef}
                value={label}
                maxLength={LABEL_MAX}
                onChange={(event) => setLabel(event.target.value)}
              />
            </label>
            <LabelProblem problem={problem} />
            <div className="clocks-actions">
              <button type="submit" disabled={!label.trim() || problem !== null}>
                {t("clocks.page.add")}
              </button>
              <button type="button" className="quiet" onClick={reset}>
                {t("clocks.page.cancel")}
              </button>
            </div>
          </form>
        )}
        {failed && <ErrorBanner message={t("notify.couldNotSave")} />}
      </div>
    </Card>
  );
}

export default ClocksPage;
