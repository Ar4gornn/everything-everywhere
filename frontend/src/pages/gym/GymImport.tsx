import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { api } from "../../api/client";
import { useToast } from "../../components/Toast";
import { Card, ErrorBanner } from "../../components/ui";
import { ImportError, parseWorkoutFile, toImportBody, validateLine } from "../../gym/format";
import { takeSharedWorkout } from "../../gym/share";
import { IMPORT_DRAFT_PREFIX } from "../../gym/store";
import { useT } from "../../i18n";
import { errorMessage } from "../../i18n/errors";
import { useGym } from "./GymContext";
import { ImportReview, stepsOf, wizardFor, type Wizard } from "./ImportReview";

/** The file the share target and the picker accept; anything bigger is not a workout. */
const MAX_BYTES = 256 * 1024;

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

/** The prompt to give Claude or ChatGPT, with a Copy button that has a select-all fallback. */
function PromptBlock() {
  const t = useT();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const pre = useRef<HTMLPreElement>(null);
  const prompt = t("gym.prompt");

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      toast.show(t("gym.copied"));
    } catch {
      // No Clipboard API (or refused): select the text so a long-press can copy it.
      const node = pre.current;
      if (node) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      toast.show(t("gym.copySelected"));
    }
  }

  return (
    <div className="gym-prompt">
      <button
        type="button"
        className="quiet"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        {t("gym.promptTitle")}
      </button>
      {open && (
        <>
          <p className="hint">{t("gym.promptHint")}</p>
          <pre ref={pre} className="gym-prompt-text">
            {prompt}
          </pre>
          <button type="button" onClick={() => void copy()}>
            {t("gym.copyPrompt")}
          </button>
        </>
      )}
    </div>
  );
}

/** `/gym/import`: file, paste or share in; then a step-by-step review; then Create. */
export function GymImport() {
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { userId, unit, refresh, cache } = useGym();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [wizard, setWizardState] = useState<Wizard | null>(() => loadDraft(userId));
  const [created, setCreated] = useState<number[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const tookShared = useRef(false);

  function setWizard(next: Wizard | null) {
    setWizardState(next);
    saveDraft(userId, next);
  }

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
      setWizard(wizardFor(routines));
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

  async function create() {
    if (!wizard) return;
    setCreating(true);
    setCreateError(null);
    const done = [...created];
    try {
      for (const [ri, routine] of wizard.routines.entries()) {
        if (done.includes(ri)) continue;
        const lines = routine.lines.filter((_, li) => wizard.decisions[ri]?.[li] !== "skipped");
        if (lines.length === 0) continue;
        await api.importRoutine(toImportBody({ ...routine, lines }));
        done.push(ri);
        setCreated([...done]);
      }
      setWizard(null);
      await refresh();
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
          onCreate={() => void create()}
          creating={creating}
          error={createError}
          created={created}
          onStartOver={() => setWizard(null)}
        />
      ) : (
        <>
          <Card title={t("gym.importTitle")}>
            <p className="hint">{t("gym.importIntro")}</p>
            <ErrorBanner message={error} />
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
            <label>
              {t("gym.pasteLabel")}
              <textarea
                className="gym-textarea"
                rows={8}
                value={text}
                spellCheck={false}
                placeholder={t("gym.pastePlaceholder")}
                onChange={(event) => setText(event.target.value)}
              />
            </label>
            <button type="button" disabled={!text.trim()} onClick={() => read(text)}>
              {t("gym.readWorkout")}
            </button>
          </Card>
          <Card>
            <PromptBlock />
          </Card>
        </>
      )}
    </>
  );
}
