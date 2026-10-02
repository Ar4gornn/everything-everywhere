import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { api } from "../../api/client";
import type { RoutineDetail } from "../../api/types";
import { useToast } from "../../components/Toast";
import { Card, ErrorBanner } from "../../components/ui";
import { ImportError, parseWorkoutFile, toImportBody, validateLine } from "../../gym/format";
import { buildPrompt, buildPromptContext, PROFILES, type PromptProfile } from "../../gym/prompts";
import { startSession } from "../../gym/session";
import { newId } from "../../gym/id";
import { takeSharedWorkout } from "../../gym/share";
import { IMPORT_DRAFT_PREFIX, readRecent } from "../../gym/store";
import { useT } from "../../i18n";
import { errorMessage } from "../../i18n/errors";
import { useGym } from "./GymContext";
import { ImportReview, stepsOf, wizardFor, type Wizard } from "./ImportReview";

/** The file the share target and the picker accept; anything bigger is not a workout. */
const MAX_BYTES = 256 * 1024;

const CLAUDE_URL = "https://claude.ai/new";
const CHATGPT_URL = "https://chatgpt.com/";

function readText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

const draftKey = (userId: string) => `${IMPORT_DRAFT_PREFIX}${userId}`;

/** The review survives a reload (and an offline stretch) in sessionStorage — this tab only. */
function loadDraft(userId: string): Wizard | null {
  try {
    const raw = window.sessionStorage.getItem(draftKey(userId));
    return raw ? (JSON.parse(raw) as Wizard) : null;
  } catch {
    return null;
  }
}

function saveDraft(userId: string, wizard: Wizard | null): void {
  try {
    if (wizard) window.sessionStorage.setItem(draftKey(userId), JSON.stringify(wizard));
    else window.sessionStorage.removeItem(draftKey(userId));
  } catch {
    /* no storage: the review still works, it just does not survive a reload */
  }
}

/**
 * `/gym/import` (Epic 43 §7.3): two halves. Get a prompt for the kind of workout wanted and
 * carry it to Claude or ChatGPT; bring the answer back by Paste, file or share; review it;
 * create it, and start it.
 */
export function GymImport() {
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { userId, unit, refresh, cache, active, setActive } = useGym();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [wizard, setWizardState] = useState<Wizard | null>(() => loadDraft(userId));
  const [created, setCreated] = useState<number[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [openProfile, setOpenProfile] = useState<PromptProfile | null>(null);
  const [notes, setNotes] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);
  const [needSelect, setNeedSelect] = useState(false);
  const [banner, setBanner] = useState(false);
  const [pasteHint, setPasteHint] = useState(false);
  const tookShared = useRef(false);
  /** The first routine made, kept across a retry so "start" still has something to start. */
  const firstMade = useRef<RoutineDetail | null>(null);
  const pre = useRef<HTMLPreElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  function setWizard(next: Wizard | null) {
    setWizardState(next);
    saveDraft(userId, next);
  }

  const prompt = useMemo(
    () =>
      openProfile === null
        ? ""
        : buildPrompt(
            openProfile,
            buildPromptContext(cache, readRecent(userId), unit),
            t.lang,
            notes,
          ),
    [openProfile, cache, userId, unit, t.lang, notes],
  );

  function read(source: string) {
    setError(null);
    try {
      const parsed = parseWorkoutFile(source, unit);
      if (stepsOf(parsed.routines).length === 0) {
        setError(t("gym.importEmpty"));
        return;
      }
      // A name that is already one of the person's exercises is that exercise, whatever kind
      // the file claims: the kind is taken from it, and the review shows it locked.
      const kinds = new Map(cache.exercises.map((e) => [e.name.toLowerCase(), e.kind]));
      const routines = parsed.routines.map((routine) => ({
        ...routine,
        lines: routine.lines.map((line) => {
          const kind = kinds.get(line.name.trim().toLowerCase());
          return kind && kind !== line.kind ? validateLine({ ...line, kind }) : line;
        }),
      }));
      setCreated([]);
      firstMade.current = null;
      setBanner(false);
      setWizard(wizardFor(routines, parsed.schedule));
    } catch (caught) {
      setError(caught instanceof ImportError ? t(caught.key) : t("gym.importUnreadable"));
    }
  }

  // Arriving from the share target: the service worker left the file in a cache for us.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, on arrival
  useEffect(() => {
    if (params.get("shared") !== "1" || tookShared.current) return;
    tookShared.current = true;
    // The worker refused the share for its size: say so, rather than "nothing was shared".
    if (params.get("refused") === "1") {
      setError(t("gym.fileTooBig"));
      return;
    }
    void takeSharedWorkout().then((shared) => {
      if (shared) {
        setText(shared);
        read(shared);
      } else {
        setError(t("gym.nothingShared"));
      }
    });
  }, []);

  // Back from the AI app: with a prompt copied and nothing pasted yet, offer the Paste button.
  useEffect(() => {
    if (openProfile === null || wizard || text.trim() !== "") {
      setBanner(false);
      return;
    }
    function onVisible() {
      if (document.visibilityState === "visible") setBanner(true);
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [openProfile, wizard, text]);

  // The Clipboard API was refused: leave the prompt selected so a long-press can copy it.
  useEffect(() => {
    if (!needSelect || !showPrompt) return;
    const node = pre.current;
    if (node) {
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    setNeedSelect(false);
  }, [needSelect, showPrompt]);

  async function copy(url: string | null) {
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      // No Clipboard API (or refused): show the text selected, and do not leave the page
      // with nothing to paste into the chat.
      setShowPrompt(true);
      setNeedSelect(true);
      toast.show(t("gym.copySelected"));
      return;
    }
    toast.show(t("gym.copied"));
    // Copy first, then go: the clipboard must hold the prompt before the other app opens.
    if (url) window.open(url, "_blank", "noopener");
  }

  async function pasteFromClipboard() {
    try {
      const clip = await navigator.clipboard.readText();
      if (clip.trim() === "") throw new Error("empty");
      setPasteHint(false);
      setText(clip);
      read(clip);
    } catch {
      setPasteHint(true);
      box.current?.focus();
    }
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError(t("gym.fileTooBig"));
      return;
    }
    try {
      const content = await readText(file);
      setText(content);
      read(content);
    } catch {
      setError(t("gym.importUnreadable"));
    }
  }

  async function create(startAfter: boolean) {
    if (!wizard) return;
    setCreating(true);
    setCreateError(null);
    const done = [...created];
    try {
      for (const [ri, routine] of wizard.routines.entries()) {
        if (done.includes(ri)) continue;
        const lines = routine.lines.filter((_, li) => wizard.decisions[ri]?.[li] !== "skipped");
        if (lines.length === 0) continue;
        const made = await api.importRoutine(toImportBody({ ...routine, lines }));
        firstMade.current ??= made;
        done.push(ri);
        setCreated([...done]);
      }
      setWizard(null);
      await refresh();
      const first = firstMade.current;
      if (startAfter && first) {
        // One session at a time: starting another would silently drop the sets already done.
        if (active && !window.confirm(t("gym.replaceConfirm"))) {
          navigate("/gym");
          return;
        }
        setActive(startSession(first, new Date(), newId));
        navigate("/gym/session");
        return;
      }
      toast.show(t.n("gym.imported", done.length));
      navigate("/gym");
    } catch (caught) {
      setCreateError(errorMessage(t, caught, "gym.couldNotImport"));
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <p>
        <Link to="/gym">← {t("gym.title")}</Link>
      </p>
      {wizard ? (
        <ImportReview
          wizard={wizard}
          onChange={setWizard}
          onCreate={(startAfter) => void create(startAfter)}
          creating={creating}
          error={createError}
          created={created}
          onStartOver={() => setWizard(null)}
        />
      ) : (
        <>
          <Card title={t("gym.hub.get")}>
            <p className="hint">{t("gym.hub.getHint")}</p>
            <ul className="gym-profiles" aria-label={t("gym.hub.profiles")}>
              {PROFILES.map((profile) => {
                const open = openProfile === profile.id;
                return (
                  <li key={profile.id} className={`gym-profile${open ? " is-open" : ""}`}>
                    <button
                      type="button"
                      className="quiet gym-profile-head"
                      aria-expanded={open}
                      onClick={() => {
                        setOpenProfile(open ? null : profile.id);
                        setShowPrompt(false);
                      }}
                    >
                      <span className="gym-profile-glyph" aria-hidden="true">
                        {profile.glyph}
                      </span>
                      <span className="gym-profile-text">
                        <span className="gym-profile-title">{t(profile.title)}</span>
                        <span className="gym-profile-desc">{t(profile.description)}</span>
                      </span>
                    </button>
                    {open && (
                      <div className="gym-profile-body">
                        {profile.takesNotes && (
                          <label>
                            {t("gym.hub.notes")}
                            <textarea
                              className="gym-textarea"
                              rows={4}
                              maxLength={2000}
                              value={notes}
                              placeholder={t("gym.hub.notesPlaceholder")}
                              onChange={(event) => setNotes(event.target.value)}
                            />
                          </label>
                        )}
                        <button
                          type="button"
                          className="quiet"
                          aria-expanded={showPrompt}
                          onClick={() => setShowPrompt((was) => !was)}
                        >
                          {showPrompt ? t("gym.hub.hidePrompt") : t("gym.hub.showPrompt")}
                        </button>
                        {showPrompt && (
                          <pre ref={pre} className="gym-prompt-text">
                            {prompt}
                          </pre>
                        )}
                        <div className="gym-copy-row">
                          <button type="button" onClick={() => void copy(CLAUDE_URL)}>
                            {t("gym.hub.copyClaude")}
                          </button>
                          <button type="button" onClick={() => void copy(CHATGPT_URL)}>
                            {t("gym.hub.copyChatGpt")}
                          </button>
                          <button type="button" className="quiet" onClick={() => void copy(null)}>
                            {t("gym.hub.copyOnly")}
                          </button>
                        </div>
                        <p className="hint">{t("gym.hub.hint")}</p>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card title={t("gym.hub.back")}>
            {banner && (
              <p className="gym-banner" role="status">
                {t("gym.hub.banner")}
              </p>
            )}
            <ErrorBanner message={error} />
            <button type="button" className="gym-paste" onClick={() => void pasteFromClipboard()}>
              {t("gym.hub.paste")}
            </button>
            {pasteHint && (
              <p className="hint" role="status">
                {t("gym.hub.pasteDenied")}
              </p>
            )}
            <label>
              {t("gym.pasteLabel")}
              <textarea
                ref={box}
                className="gym-textarea"
                rows={6}
                value={text}
                spellCheck={false}
                placeholder={t("gym.pastePlaceholder")}
                onChange={(event) => setText(event.target.value)}
              />
            </label>
            <button type="button" disabled={!text.trim()} onClick={() => read(text)}>
              {t("gym.readWorkout")}
            </button>
            <label className="gym-file">
              {t("gym.chooseFile")}
              <input
                type="file"
                accept=".json,.txt,application/json,text/plain"
                onChange={(event) => {
                  void pick(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>
          </Card>
        </>
      )}
    </>
  );
}
