import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { useTutorial } from "../../components/Tutorial/useTutorial";
import { readOutbox } from "../../gym/store";
import { useT } from "../../i18n";
import type { MessageKey } from "../../i18n/catalogue";
import { useLayout } from "../../layout/useLayout";
import { isInstalled } from "../../pwa";
import { useBrowserOffline, useNow } from "./device";
import { useGym } from "./GymContext";
import { Stepper } from "./MeasureInput";
import { measureStep, weightStep } from "./measure";
import { SetTimer } from "./SetFields";

/**
 * The guided tour of the gym home (Epic 42, §12 of `docs/epic-42-gym-revamp.md`).
 *
 * A spotlight coach-mark: a dimmed full-screen layer with a cut-out around the real card a
 * step is about, and a panel that says what it is. Two steps are a **sandbox** (`SetDemo`,
 * `TimerDemo`): a miniature of the real set row and timer, in local state only. They never
 * touch the store, the API or the live session, because a tour that left a phantom set in the
 * person's history would be worse than no tour.
 *
 * It opens by itself once per user per device (`tourSeen`), never over the app's first-login
 * tour and never while a session is running (the resume card matters more). The `?` button
 * replays it. It does not use the app tour's `body[data-tour-step]`: the two are independent.
 */

type StepId =
  | "welcome"
  | "start"
  | "log"
  | "timer"
  | "routines"
  | "import"
  | "history"
  | "offline"
  | "done";

interface StepSpec {
  id: StepId;
  /** The `data-tour` value of the real element to spotlight; absent means a centred card. */
  target?: string;
  /** Collapsible cards the target needs open (restored when the tour closes). */
  open?: string[];
}

const STEPS: readonly StepSpec[] = [
  { id: "welcome" },
  { id: "start", target: "gym-start" },
  { id: "log" },
  { id: "timer" },
  { id: "routines", target: "gym-routines", open: ["gym-routines"] },
  { id: "import", target: "gym-import", open: ["gym-routines"] },
  { id: "history", target: "gym-history", open: ["gym-history"] },
  { id: "offline" },
  { id: "done" },
];

const TOTAL = STEPS.length;
const PAD = 6;
const PANEL_W = 360;
const MARGIN = 12;
const REST_MS = 5000;

const seenKey = (userId: string) => `everything-everywhere.gym.${userId}.tourSeen`;
/** Remembered for the page's life too, so blocked storage does not mean a tour on every visit. */
const seenInMemory = new Set<string>();

function hasSeen(userId: string): boolean {
  try {
    return window.localStorage.getItem(seenKey(userId)) === "1";
  } catch {
    return seenInMemory.has(userId);
  }
}

function markSeen(userId: string): void {
  seenInMemory.add(userId);
  try {
    window.localStorage.setItem(seenKey(userId), "1");
  } catch {
    /* blocked storage: the in-memory mark still holds until the page is reloaded */
  }
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (a === null || b === null) return a === b;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

function findTarget(name: string | undefined): HTMLElement | null {
  return name ? document.querySelector<HTMLElement>(`[data-tour="${name}"]`) : null;
}

function reducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

// --- the sandboxed demos ----------------------------------------------------------------

/** Step 3: a miniature of the set row. Done adds a line and starts a 5-second rest. */
function SetDemo() {
  const t = useT();
  const { unit } = useGym();
  const [reps, setReps] = useState<number | null>(8);
  const [weight, setWeight] = useState<number | null>(unit === "kg" ? 60 : 135);
  const [sets, setSets] = useState<{ reps: number; weight: number }[]>([]);
  const [restEnd, setRestEnd] = useState<number | null>(null);
  // A timestamp and a 250 ms tick: a phone that slept shows the true remaining time.
  const now = useNow(restEnd !== null, 250);
  const remaining = restEnd === null ? 0 : Math.min(REST_MS, Math.max(0, restEnd - now));

  useEffect(() => {
    if (restEnd !== null && remaining === 0) setRestEnd(null);
  }, [restEnd, remaining]);

  const circumference = 2 * Math.PI * 22;
  return (
    <div className="gym-tour-demo">
      <Stepper
        label={t("gym.reps")}
        value={reps}
        field="reps"
        step={measureStep("reps")}
        min={0}
        onChange={setReps}
      />
      <Stepper
        label={t("gym.weightIn", { unit })}
        value={weight}
        field="weight"
        step={weightStep(unit)}
        decimal
        suffix={unit}
        onChange={setWeight}
      />
      <button
        type="button"
        className="gym-done"
        disabled={reps === null || reps < 1}
        onClick={() => {
          setSets((list) => [...list, { reps: reps ?? 0, weight: weight ?? 0 }]);
          setRestEnd(Date.now() + REST_MS);
        }}
      >
        {t("gym.doneSet")}
      </button>
      {sets.length > 0 && (
        <>
          <ul className="gym-tour-sets" aria-label={t("gym.tour.set.list")}>
            {sets.map((set, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: an append-only demo list
              <li key={index}>
                {t("gym.tour.set.line", {
                  n: index + 1,
                  reps: set.reps,
                  weight: set.weight,
                  unit,
                })}
              </li>
            ))}
          </ul>
          <p>{t("gym.tour.set.done")}</p>
        </>
      )}
      {restEnd !== null && (
        <div className="gym-tour-rest">
          <div className="gym-tour-ring" role="timer" aria-label={t("gym.rest")}>
            <svg viewBox="0 0 56 56" aria-hidden="true">
              <circle className="gym-tour-ring-track" cx="28" cy="28" r="22" />
              <circle
                className="gym-tour-ring-bar"
                cx="28"
                cy="28"
                r="22"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - remaining / REST_MS)}
              />
            </svg>
            <span className="gym-tour-ring-number num">{Math.ceil(remaining / 1000)}</span>
          </div>
          <button type="button" className="quiet" onClick={() => setRestEnd(null)}>
            {t("gym.skipRest")}
          </button>
        </div>
      )}
      <p className="gym-tour-demo-note">{t("gym.tour.practice")}</p>
    </div>
  );
}

/** Step 4: the real set timer (`SetTimer`), counting down from 5 s, into a local seconds field. */
function TimerDemo() {
  const t = useT();
  const [seconds, setSeconds] = useState<number | null>(null);
  const [held, setHeld] = useState<number | null>(null);
  return (
    <div className="gym-tour-demo">
      <p>
        <strong>{t("gym.tour.timer.label", { n: 5 })}</strong>
      </p>
      <Stepper
        label={t("gym.seconds")}
        value={seconds}
        field="seconds"
        step={measureStep("duration")}
        suffix="s"
        onChange={setSeconds}
      />
      <SetTimer
        target={5}
        onStop={(done) => {
          setSeconds(done);
          setHeld(done);
        }}
      />
      {held !== null && <p>{t("gym.tour.timer.held", { n: held })}</p>}
      <p className="gym-tour-demo-note">{t("gym.tour.practice")}</p>
    </div>
  );
}

/** Step 6: the four stages of an import, and the real prompt to copy. */
function ImportDemo() {
  const t = useT();
  const prompt = t("gym.prompt");
  const [copied, setCopied] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (blocked) field.current?.select();
  }, [blocked]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setBlocked(false);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // No Clipboard API (or refused): show the text selected so a long-press can copy it.
      setBlocked(true);
    }
  }

  const steps: MessageKey[] = [
    "gym.tour.import.step1",
    "gym.tour.import.step2",
    "gym.tour.import.step3",
    "gym.tour.import.step4",
  ];
  return (
    <div className="gym-tour-demo">
      <ol className="gym-tour-import-steps" aria-label={t("gym.tour.import.steps")}>
        {steps.map((step) => (
          <li key={step}>
            <span>{t(step)}</span>
          </li>
        ))}
      </ol>
      <button type="button" onClick={() => void copy()}>
        {copied ? t("gym.tour.import.copied") : t("gym.copyPrompt")}
      </button>
      {blocked && (
        <>
          <p role="status">{t("gym.tour.import.copyFailed")}</p>
          <textarea
            ref={field}
            className="gym-tour-prompt"
            readOnly
            rows={3}
            aria-label={t("gym.tour.import.promptField")}
            value={prompt}
          />
        </>
      )}
    </div>
  );
}

/** Step 8: live facts about this device that decide whether the gym works without a network. */
function OfflineStatus() {
  const t = useT();
  const { userId } = useGym();
  const offline = useBrowserOffline();
  const installed = isInstalled();
  const waiting = readOutbox(userId).filter((entry) => !entry.refused).length;
  return (
    <div className="gym-tour-demo">
      <dl className="gym-tour-status">
        <div>
          <dt>{t("gym.tour.offline.installed")}</dt>
          <dd>{installed ? t("gym.tour.offline.yes") : t("gym.tour.offline.no")}</dd>
        </div>
        <div>
          <dt>{t("gym.tour.offline.connection")}</dt>
          <dd>{offline ? t("gym.tour.offline.offline") : t("gym.tour.offline.online")}</dd>
        </div>
        <div>
          <dt>{t("gym.tour.offline.waiting")}</dt>
          <dd>{waiting}</dd>
        </div>
      </dl>
      {!installed && <p className="gym-tour-demo-note">{t("gym.tour.offline.installHow")}</p>}
    </div>
  );
}

function demoFor(id: StepId): ReactNode {
  switch (id) {
    case "log":
      return <SetDemo />;
    case "timer":
      return <TimerDemo />;
    case "import":
      return <ImportDemo />;
    case "offline":
      return <OfflineStatus />;
    default:
      return null;
  }
}

// --- the engine -------------------------------------------------------------------------

const FOCUSABLE = 'button:not([disabled]), a[href], input, textarea, select, [tabindex="0"]';

/** The `?` button and the tour it opens. Rendered once, in the gym home's title row. */
export function GymTour() {
  const t = useT();
  const { userId, active, start } = useGym();
  const tutorial = useTutorial();
  const phone = useLayout() === "phone";
  const titleId = useId();

  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const shield = useRef<HTMLDivElement>(null);
  const expanded = useRef<HTMLElement[]>([]);
  const decided = useRef(false);

  const spec = STEPS[index] ?? STEPS[0];

  // Auto-open: once per mount, decided the first time the app's own tour is out of the way.
  useEffect(() => {
    if (decided.current || !userId || tutorial.step !== null) return;
    decided.current = true;
    if (active || hasSeen(userId)) return;
    setIndex(0);
    setOpen(true);
  }, [userId, tutorial.step, active]);

  const close = useCallback(() => {
    markSeen(userId);
    setOpen(false);
    button.current?.focus();
  }, [userId]);

  const go = useCallback(
    (delta: number) => setIndex((i) => Math.min(TOTAL - 1, Math.max(0, i + delta))),
    [],
  );

  // Where the spotlight goes: the real element's box, or nothing (a centred card).
  const measure = useCallback(() => {
    const element = findTarget(spec?.target);
    if (!element) {
      setRect((was) => (was === null ? was : null));
      return;
    }
    const box = element.getBoundingClientRect();
    const next = {
      top: box.top - PAD,
      left: box.left - PAD,
      width: box.width + PAD * 2,
      height: box.height + PAD * 2,
    };
    setRect((was) => (sameRect(was, next) ? was : next));
  }, [spec]);

  // Open the collapsed cards a step needs, and put them back when the tour closes.
  useEffect(() => {
    if (!open || !spec?.open) return;
    for (const name of spec.open) {
      const toggle = document.querySelector<HTMLElement>(
        `[data-tour="${name}"] .card-toggle[aria-expanded="false"]`,
      );
      if (toggle) {
        toggle.click();
        expanded.current.push(toggle);
      }
    }
  }, [open, spec]);

  useEffect(() => {
    if (open) return;
    const toggles = expanded.current;
    expanded.current = [];
    for (const toggle of toggles) {
      if (toggle.isConnected && toggle.getAttribute("aria-expanded") === "true") toggle.click();
    }
  }, [open]);

  // Measure before paint on every step change, so the spotlight never shows the last step's box.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `index` is the signal; `measure` follows `spec`
  useLayoutEffect(() => {
    if (open) measure();
  }, [open, index, measure]);

  // Keep it aligned: resize, any scroll, the target resizing, the page re-drawing.
  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const mutations = new MutationObserver(measure);
    mutations.observe(document.body, { childList: true, subtree: true });
    let resize: ResizeObserver | null = null;
    const element = findTarget(spec?.target);
    if (element && typeof ResizeObserver === "function") {
      resize = new ResizeObserver(measure);
      resize.observe(element);
    }
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      mutations.disconnect();
      resize?.disconnect();
    };
  }, [open, measure, spec]);

  // Bring the target into the part of the screen the panel does not cover.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs per step, not per layout change
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      const element = findTarget(spec?.target);
      if (!element || typeof window.scrollBy !== "function") return;
      const box = element.getBoundingClientRect();
      const height = window.innerHeight;
      const covered = phone ? Math.min(panel.current?.offsetHeight ?? 0, height * 0.6) + MARGIN : 0;
      const free = height - covered;
      const delta = box.height > free - 24 ? box.top - 16 : box.top + box.height / 2 - free / 2;
      if (Math.abs(delta) > 1) {
        window.scrollBy({ top: delta, behavior: reducedMotion() ? "auto" : "smooth" });
      }
    }, 30);
    return () => window.clearTimeout(id);
  }, [open, index, phone]);

  // Desktop: the card goes below the target if it fits, above if not, clamped to the screen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the panel's height changes with the step
  useLayoutEffect(() => {
    if (!open || phone || !rect) {
      setPos((was) => (was === null ? was : null));
      return;
    }
    const height = panel.current?.offsetHeight ?? 0;
    const below = window.innerHeight - (rect.top + rect.height) - MARGIN;
    const above = rect.top - MARGIN;
    const rawTop =
      below >= height || below >= above
        ? rect.top + rect.height + MARGIN
        : rect.top - MARGIN - height;
    const top = Math.max(MARGIN, Math.min(rawTop, window.innerHeight - height - MARGIN));
    const left = Math.max(
      MARGIN,
      Math.min(rect.left, window.innerWidth - Math.min(PANEL_W, window.innerWidth - 24) - MARGIN),
    );
    setPos((was) => (was && was.top === top && was.left === left ? was : { top, left }));
  }, [open, phone, rect, index]);

  // Each step: focus its heading (announced by the dialog's label), scroll nothing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `index` is the signal
  useEffect(() => {
    if (open) heading.current?.focus({ preventScroll: true });
  }, [open, index]);

  // The backdrop blocks the page: no wheel or touch scroll through it. Native listeners,
  // because React's are passive and cannot cancel.
  useEffect(() => {
    const element = shield.current;
    if (!open || !element) return;
    const stop = (event: Event) => event.preventDefault();
    element.addEventListener("wheel", stop, { passive: false });
    element.addEventListener("touchmove", stop, { passive: false });
    return () => {
      element.removeEventListener("wheel", stop);
      element.removeEventListener("touchmove", stop);
    };
  }, [open]);

  // Keyboard: Escape leaves, arrows move, Enter on the panel's own text advances, Tab stays in.
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = !!target?.closest("input, textarea, select, [contenteditable='true']");
      const insidePanel = !!target && !!panel.current?.contains(target);
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "ArrowRight" && !typing) {
        event.preventDefault();
        go(1);
      } else if (event.key === "ArrowLeft" && !typing) {
        event.preventDefault();
        go(-1);
      } else if (
        event.key === "Enter" &&
        insidePanel &&
        !target?.closest("button, a, input, textarea, select")
      ) {
        event.preventDefault();
        go(1);
      } else if (event.key === "Tab" && panel.current) {
        const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
        const first = items[0] ?? heading.current;
        const last = items[items.length - 1] ?? heading.current;
        if (!insidePanel) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        } else if (event.shiftKey && (target === heading.current || target === first)) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && target === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close, go]);

  const stepTitle = (id: StepId) => t(`gym.tour.${id}.title` as MessageKey);
  const centred = !rect;
  const placement = centred ? "gym-tour-centered" : phone ? "gym-tour-sheet" : "gym-tour-desk";
  const style = !centred && !phone && pos ? { top: pos.top, left: pos.left } : undefined;
  const id = spec?.id ?? "welcome";
  const first = index === 0;
  const last = index === TOTAL - 1;

  return (
    <>
      <button
        ref={button}
        type="button"
        className="quiet gym-tour-button"
        aria-haspopup="dialog"
        aria-label={t("gym.tour.open")}
        title={t("gym.tour.open")}
        onClick={() => {
          setIndex(0);
          setOpen(true);
        }}
      >
        <span aria-hidden="true">?</span>
      </button>
      {open &&
        createPortal(
          <div className="gym gym-tour-layer">
            {/* The backdrop only blocks: a tap on it does nothing. */}
            <div ref={shield} className={`gym-tour-shield${centred ? " gym-tour-dim" : ""}`} />
            {rect && (
              <div
                className="gym-tour-spot"
                aria-hidden="true"
                style={{
                  top: rect.top,
                  left: rect.left,
                  width: rect.width,
                  height: rect.height,
                }}
              />
            )}
            <div
              ref={panel}
              className={`gym-tour-panel ${placement}`}
              style={style}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
            >
              <div className="gym-tour-progress">
                <span className="gym-tour-dots" aria-hidden="true">
                  {STEPS.map((step, i) => (
                    <span
                      key={step.id}
                      className={`gym-tour-dot${i === index ? " is-on" : ""}`}
                    />
                  ))}
                </span>
                <span>{t("gym.tour.stepOf", { n: index + 1, total: TOTAL })}</span>
              </div>
              <h2 id={titleId} ref={heading} tabIndex={-1}>
                {stepTitle(id)}
              </h2>
              <p className="gym-tour-body">{t(`gym.tour.${id}.body` as MessageKey)}</p>
              {demoFor(id)}
              <div className="gym-tour-actions">
                {first ? (
                  <>
                    <button type="button" className="quiet" onClick={close}>
                      {t("gym.tour.notNow")}
                    </button>
                    <button type="button" className="gym-tour-primary" onClick={() => go(1)}>
                      {t("gym.tour.start")}
                    </button>
                  </>
                ) : last ? (
                  <>
                    <button type="button" className="quiet" onClick={() => go(-1)}>
                      {t("gym.tour.back")}
                    </button>
                    <button type="button" className="quiet" onClick={close}>
                      {t("gym.tour.close")}
                    </button>
                    <button
                      type="button"
                      className="gym-tour-primary"
                      onClick={() => {
                        markSeen(userId);
                        setOpen(false);
                        start(null);
                      }}
                    >
                      {t("gym.startSession")}
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="quiet" onClick={close}>
                      {t("gym.tour.skip")}
                    </button>
                    <button type="button" className="quiet" onClick={() => go(-1)}>
                      {t("gym.tour.back")}
                    </button>
                    <button type="button" className="gym-tour-primary" onClick={() => go(1)}>
                      {t("gym.tour.next")}
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="visually-hidden" aria-live="polite">
              {t("gym.tour.stepOf", { n: index + 1, total: TOTAL })}: {stepTitle(id)}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
