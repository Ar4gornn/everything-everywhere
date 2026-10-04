import { type FormEvent, useMemo, useState } from "react";

import { api } from "../api/client";
import type { MoodDay } from "../api/types";
import { useOptionalAuth } from "../auth/AuthContext";
import { ListRow } from "../components/ListRow";
import { MoonGlyph } from "../components/MoonGlyph";
import { Card, Empty, ErrorBanner, TableWrap } from "../components/ui";
import { MoonLines } from "../charts/MoonLines";
import { useT } from "../i18n";
import { MODULE_NAME, useModules } from "../layout/modules";
import { useLayout } from "../layout/useLayout";
import { type PhaseName, useMoonEngine } from "../moon/engine";
import { moonOnDay } from "../moon/useMoonView";
import { type Hemisphere, resolveHemisphere } from "../moon/hemisphere";
import { clearPlace, locateOnce, type MoonPlace, usePlace, writePlace } from "../moon/location";
import {
  bucketByPhase,
  cyclesCovered,
  type DayValue,
  type PhaseBucket,
  SYNODIC_DAYS,
} from "../moon/overlay";
import { fromCents, toCents } from "../money";
import { monthOf, todayIso } from "../months";
import { useDates } from "../useDates";
import { useLoad } from "../useLoad";
import { useMoney } from "../useMoney";

/**
 * The Moon page (Epic 47, AD-63): today's moon, this month's quarters, your days against the
 * phases, and the place for moonrise.
 *
 * **Composed at the edge** (AD-37): the overlay reads each module's own month endpoint, only
 * for modules switched on, and buckets the days here. It states how many cycles and days the
 * figures cover and nothing else: no ranking, no highlight, no word about a difference.
 */

const CYCLE_CHOICES = [3, 6, 12] as const;
type Cycles = (typeof CYCLE_CHOICES)[number];

/** Window length for N cycles: just enough whole days to cover them (89, 178, 355). */
const windowDays = (cycles: number): number => Math.ceil(cycles * SYNODIC_DAYS);

const pad = (n: number): string => String(n).padStart(2, "0");
const isoOf = (d: Date): string => todayIso(d);
const clock = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** The `count` local days ending yesterday, oldest first. */
function lastDays(count: number, now: Date): string[] {
  const out: string[] = [];
  for (let back = count; back >= 1; back--) {
    out.push(isoOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - back)));
  }
  return out;
}

type ModuleKey = "mood" | "habits" | "spending" | "gym";

interface Overlay {
  mood: DayValue[] | null;
  habits: DayValue[] | null;
  spending: DayValue[] | null;
  gym: DayValue[] | null;
}
const NO_OVERLAY: Overlay = { mood: null, habits: null, spending: null, gym: null };

const noonOf = (iso: string): Date => new Date(`${iso}T12:00:00`);

/** A number in the account's language ("21,8" in French), never the machine's locale. */
const fixed = (lang: string, value: number, digits: number): string =>
  new Intl.NumberFormat(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(
    value,
  );

function counted(rows: string[], days: string[]): DayValue[] {
  const per = new Map<string, number>();
  for (const day of rows) per.set(day, (per.get(day) ?? 0) + 1);
  return days.map((day) => ({ day, value: per.get(day) ?? 0 }));
}

export function MoonPage() {
  const t = useT();
  const phone = useLayout() === "phone";
  const dates = useDates();
  const money = useMoney();
  const modules = useModules();
  const engine = useMoonEngine();
  const user = useOptionalAuth()?.user ?? null;
  const startDay = user?.budget_start_day ?? 1;
  const [cycles, setCycles] = useState<Cycles>(3);

  const zone = user?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const setting = (user?.preferences as { moon_hemisphere?: Hemisphere | null } | undefined)
    ?.moon_hemisphere;
  const hemisphere = resolveHemisphere(setting, zone);

  const days = useMemo(() => lastDays(windowDays(cycles), new Date()), [cycles]);

  const { data, loading, failure } = useLoad(
    async (): Promise<Overlay> => {
      // Every endpoint speaks in budget months (AD-10): the window touches a handful of them.
      const months = [
        ...new Set(days.map((day) => monthOf(new Date(`${day}T00:00:00`), startDay))),
      ];
      const each = <T,>(fetch: (month: string) => Promise<T[]>): Promise<T[]> =>
        Promise.all(months.map(fetch)).then((parts) => parts.flat());
      const [mood, habits, spending, gym] = await Promise.all([
        modules.mood ? each((m) => api.moodDays(m)) : null,
        modules.habits ? each((m) => api.listCheckins({ month: m })) : null,
        each((m) => api.listEntries({ month: m })),
        modules.gym ? each((m) => api.listWorkouts({ month: m, limit: 200 })) : null,
      ]);
      const moodBy = new Map<string, MoodDay["mood"]>(mood?.map((row) => [row.on, row.mood]));
      const cents = new Map<string, number>();
      for (const row of spending) {
        if (row.kind !== "expense") continue;
        cents.set(row.occurred_on, (cents.get(row.occurred_on) ?? 0) + toCents(row.amount));
      }
      return {
        mood: mood && days.map((day) => ({ day, value: moodBy.get(day) ?? null })),
        habits: habits && counted(habits.map((row) => row.done_on), days),
        spending: days.map((day) => ({ day, value: cents.get(day) ?? 0 })),
        gym:
          gym &&
          counted(
            gym.filter((row) => !row.rest_day).map((row) => row.performed_on),
            days,
          ),
      };
    },
    NO_OVERLAY,
    [days, startDay, modules.mood, modules.habits, modules.gym],
    "moon.page.couldNotLoad",
  );

  const [place, setPlace] = usePlace();

  // Each window day's phase, once per window and engine: the four modules and the chart's
  // band all read this list, none of them asks the engine again.
  const phases = useMemo(
    () => (engine ? days.map((day) => engine.phaseAt(noonOf(day))) : []),
    [engine, days],
  );
  const phaseByDay = useMemo(
    () => new Map(days.map((day, index) => [day, phases[index] as PhaseName])),
    [days, phases],
  );

  if (!engine) {
    return (
      <div className="moon-page">
        <h1>{t("moon.module")}</h1>
        <Empty>{t("moon.page.loading")}</Empty>
      </div>
    );
  }

  const now = new Date();
  // The day's own reading (local noon), the same one the dashboard line and the nav hint use.
  const state = moonOnDay(engine, now);
  const age = Math.round(state.ageDays * 10) / 10;
  // French takes the singular below 2 ("1,5 jour"), English only at exactly 1.
  const ageCount = t.lang === "fr" && age < 2 ? 1 : age;
  const upcoming = engine.quartersBetween(now, new Date(now.getTime() + 35 * 86_400_000));
  const nextNew = upcoming.find((q) => q.kind === "new");
  const nextFull = upcoming.find((q) => q.kind === "full");
  const monthQuarters = engine.quartersBetween(
    new Date(now.getFullYear(), now.getMonth(), 1),
    new Date(now.getFullYear(), now.getMonth() + 1, 1),
  );
  const when = (d: Date): string => `${dates.day(isoOf(d))}, ${clock(d)}`;
  const rise = place
    ? engine.riseSet(new Date(now.getFullYear(), now.getMonth(), now.getDate()), place.lat, place.lon)
    : null;
  const stamp = (d: Date | null): string => (d ? clock(d) : t("moon.page.noRise"));

  const phaseOf = (day: string): PhaseName => phaseByDay.get(day) ?? "new";

  const specs: {
    key: ModuleKey;
    title: string;
    figure: string;
    per: "dataDays" | "allDays";
    show: (n: number) => string;
    min: number;
    max?: number;
  }[] = [
    {
      key: "mood",
      title: t(MODULE_NAME.mood),
      figure: t("moon.page.figureMood"),
      per: "dataDays",
      show: (n) => fixed(t.lang, n, 1),
      min: 1,
      max: 5,
    },
    {
      key: "habits",
      title: t(MODULE_NAME.habits),
      figure: t("moon.page.figureHabits"),
      per: "allDays",
      show: (n) => fixed(t.lang, n, 2),
      min: 0,
    },
    {
      key: "spending",
      title: t("moon.page.spending"),
      figure: t("moon.page.figureSpending"),
      per: "allDays",
      show: (n) => money.plain(fromCents(Math.round(n))),
      min: 0,
    },
    {
      key: "gym",
      title: t(MODULE_NAME.gym),
      figure: t("moon.page.figureGym"),
      per: "allDays",
      show: (n) => fixed(t.lang, n, 2),
      min: 0,
    },
  ];

  return (
    <div className="moon-page">
      <h1>{t("moon.module")}</h1>

      <Card title={t("moon.page.today")}>
        <div className="moon-today">
          <MoonGlyph
            phase={state.phase}
            angle={state.angle}
            hemisphere={hemisphere}
            size={96}
            decorative
          />
          <div>
            <p className="moon-phase" data-testid="moon-phase">
              {t(`moon.phase.${state.phase}`)}
            </p>
            <p>{t("moon.lit", { percent: Math.round(state.illumination * 100) })}</p>
            <p>
              {t.n("moon.page.age", ageCount, {
                days: new Intl.NumberFormat(t.lang, { maximumFractionDigits: 1 }).format(age),
              })}
            </p>
          </div>
        </div>
        <dl className="moon-facts">
          <dt>{t("moon.page.nextNew")}</dt>
          <dd>{nextNew ? when(nextNew.at) : "–"}</dd>
          <dt>{t("moon.page.nextFull")}</dt>
          <dd>{nextFull ? when(nextFull.at) : "–"}</dd>
          {rise && (
            <>
              <dt>{t("moon.page.rise")}</dt>
              <dd>{stamp(rise.rise)}</dd>
              <dt>{t("moon.page.set")}</dt>
              <dd>{stamp(rise.set)}</dd>
            </>
          )}
        </dl>
        {!place && <p className="moon-hint">{t("moon.place.none")}</p>}
      </Card>

      <Card title={t("moon.page.quarters")}>
        <ul className="moon-quarters">
          {monthQuarters.map((q) => (
            <li key={`${q.kind}-${q.at.getTime()}`}>
              <MoonGlyph
                phase={q.kind}
                angle={{ new: 0, firstQuarter: 90, full: 180, lastQuarter: 270 }[q.kind]}
                hemisphere={hemisphere}
                size={20}
                decorative
              />
              <span>{t(`moon.phase.${q.kind}`)}</span>
              <span className="moon-when">{when(q.at)}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title={t("moon.page.overlay")}>
        <p className="moon-hint">{t("moon.page.overlayNote")}</p>
        <label className="moon-window">
          <span>{t("moon.page.window")}</span>
          <select
            value={cycles}
            onChange={(event) => setCycles(Number(event.target.value) as Cycles)}
          >
            {CYCLE_CHOICES.map((n) => (
              <option key={n} value={n}>
                {t("moon.page.windowOption", { n })}
              </option>
            ))}
          </select>
        </label>
        <p className="moon-covered">
          {t("moon.page.covered", { cycles: cyclesCovered(days.length), days: days.length })}
        </p>
        <ErrorBanner message={failure} />
        {loading && !failure && <Empty>{t("moon.page.loading")}</Empty>}
        {!loading &&
          !failure &&
          specs.map((spec) => {
            const series = data[spec.key];
            if (!series) return null;
            const rows: PhaseBucket[] = bucketByPhase(series, phaseOf, spec.per);
            return (
              <section className="moon-module" key={spec.key} data-module={spec.key}>
                <h3>{spec.title}</h3>
                {phone ? (
                  <>
                  <p className="moon-hint">{spec.figure}</p>
                  <ul className="list-rows" aria-label={spec.title}>
                    {rows.map((row, index) => (
                      <li key={row.phase} data-phase={row.phase}>
                        <ListRow
                          title={
                            <span className="moon-phase-cell">
                              <MoonGlyph
                                phase={row.phase}
                                angle={index * 45}
                                hemisphere={hemisphere}
                                size={16}
                                decorative
                              />
                              {t(`moon.phase.${row.phase}`)}
                            </span>
                          }
                          meta={t.n("streaks.days", row.days)}
                          amount={row.figure === null ? "–" : spec.show(row.figure)}
                        />
                      </li>
                    ))}
                  </ul>
                  </>
                ) : (
                <TableWrap>
                  <table>
                    <thead>
                      <tr>
                        <th>{t("moon.page.colPhase")}</th>
                        <th className="num">{t("moon.page.colDays")}</th>
                        <th className="num">{spec.figure}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, index) => (
                        <tr key={row.phase} data-phase={row.phase}>
                          <td>
                            <span className="moon-phase-cell">
                              <MoonGlyph
                                phase={row.phase}
                                angle={index * 45}
                                hemisphere={hemisphere}
                                size={16}
                                decorative
                              />
                              {t(`moon.phase.${row.phase}`)}
                            </span>
                          </td>
                          <td className="num">{row.days}</td>
                          <td className="num">
                            {row.figure === null ? "–" : spec.show(row.figure)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
                )}
                <MoonLines
                  values={series.map((d) => d.value)}
                  phases={phases}
                  label={t("moon.page.chart", { module: spec.title })}
                  min={spec.min}
                  max={spec.max}
                />
              </section>
            );
          })}
      </Card>

      <PlaceControls
        place={place}
        setPlace={setPlace}
        userId={user?.id ?? ""}
      />
    </div>
  );
}

function PlaceControls({
  place,
  setPlace,
  userId,
}: {
  place: MoonPlace | null;
  setPlace: (next: MoonPlace | null) => void;
  userId: string;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(false);
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [label, setLabel] = useState("");

  // Nobody signed in: there is no account to keep a place for, so nothing is read or written.
  const locate = async () => {
    if (!userId) return;
    setBusy(true);
    setError(null);
    try {
      const found = await locateOnce();
      const stored = writePlace(userId, { ...found, label: null });
      if (stored) setPlace(stored);
      else setError(t("moon.page.unavailable"));
    } catch (thrown) {
      const reason = thrown instanceof Error ? thrown.message : String(thrown);
      setError(
        reason.includes("denied")
          ? t("moon.page.denied")
          : reason.includes("timeout")
            ? t("moon.page.timeout")
            : t("moon.page.unavailable"),
      );
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!userId) return;
    const parse = (text: string): number =>
      text.trim() === "" ? Number.NaN : Number(text.trim().replace(",", "."));
    const la = parse(lat);
    const lo = parse(lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
      setError(t("moon.page.invalid"));
      return;
    }
    const stored = writePlace(userId, { lat: la, lon: lo, label: label.trim() || null });
    if (!stored) {
      setError(t("moon.page.unavailable"));
      return;
    }
    setError(null);
    setPlace(stored);
    setForm(false);
  };

  const remove = () => {
    if (!userId) return;
    clearPlace(userId);
    setPlace(null);
    setError(null);
  };

  return (
    <Card title={t("moon.place.title")}>
      <p className="moon-hint">{t("moon.place.privacy")}</p>
      {place && (
        <p data-testid="moon-place">
          {t("moon.page.placeIs", {
            place: `${place.label ? `${place.label}, ` : ""}${fixed(t.lang, place.lat, 1)}, ${fixed(t.lang, place.lon, 1)}`,
          })}
        </p>
      )}
      <div className="moon-actions">
        <button type="button" onClick={() => void locate()} disabled={busy}>
          {busy ? t("moon.page.locating") : t("moon.place.locate")}
        </button>
        <button type="button" className="secondary" onClick={() => setForm((open) => !open)}>
          {t("moon.place.enter")}
        </button>
        {place && (
          <button type="button" className="secondary" onClick={remove}>
            {t("moon.place.remove")}
          </button>
        )}
      </div>
      {form && (
        <form className="moon-form" onSubmit={submit}>
          <label>
            {t("moon.page.lat")}
            <input
              inputMode="decimal"
              value={lat}
              onChange={(event) => setLat(event.target.value)}
            />
          </label>
          <label>
            {t("moon.page.lon")}
            <input
              inputMode="decimal"
              value={lon}
              onChange={(event) => setLon(event.target.value)}
            />
          </label>
          <label>
            {t("moon.page.label")}
            <input value={label} onChange={(event) => setLabel(event.target.value)} />
          </label>
          <button type="submit">{t("moon.page.save")}</button>
        </form>
      )}
      <ErrorBanner message={error} />
    </Card>
  );
}

export default MoonPage;
