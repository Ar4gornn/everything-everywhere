import { useState } from "react";

import { useOptionalAuth } from "../auth/AuthContext";
import {
  discardEntry,
  flushEntries,
  type QueuedEntry,
  useEntryOutbox,
  useIsSending,
} from "../entries/outbox";
import { useT } from "../i18n";
import { type MessageKey, messages } from "../i18n/catalogue";
import { useLayout } from "../layout/useLayout";
import { useDates } from "../useDates";
import { useMoney } from "../useMoney";
import { useQuickAdd } from "./QuickAdd/QuickAddContext";
import { Card } from "./ui";

/**
 * Epic 45 (AD-61): the entries still on this device, above the Entries list. Refused ones say
 * why; on a phone they can be fixed in the sheet, on a desktop (no sheet) only discarded.
 */
export function WaitingEntries() {
  const user = useOptionalAuth()?.user;
  const queue = useEntryOutbox();
  // The card needs the sheet's provider; a page rendered without one has nothing to show.
  if (!user?.id || queue.length === 0) return null;
  return <WaitingCard userId={user.id} queue={queue} />;
}

function WaitingCard({ userId, queue }: { userId: string; queue: QueuedEntry[] }) {
  const t = useT();
  const money = useMoney();
  const dates = useDates();
  const phone = useLayout() === "phone";
  const { open, bump } = useQuickAdd();
  const [sending, setSending] = useState(false);

  async function sendNow() {
    setSending(true);
    try {
      const result = await flushEntries(userId);
      if (result.sent > 0) bump();
    } catch {
      /* still waiting; the card stays */
    } finally {
      setSending(false);
    }
  }

  function reason(code: string): string {
    const key = `error.${code}`;
    return key in messages ? t(key as MessageKey) : t("entries.couldNotSave");
  }

  return (
    <Card title={t("offline.waitingTitle")}>
      <p className="hint" style={{ margin: "0 0 var(--space-2, 8px)" }}>
        {t("offline.waitingHint")}
      </p>
      <ul className="waiting-list">
        {queue.map((entry) => (
          <li key={entry.client_ref} className="waiting-row">
            <div className="waiting-main">
              <span className="waiting-title">{entry.category_name}</span>
              <span className="waiting-meta">{dates.day(entry.body.occurred_on)}</span>
              {entry.refused !== null && (
                <span className="waiting-refused">
                  {t("offline.notSent", { reason: reason(entry.refused) })}
                </span>
              )}
            </div>
            <span className={`num${entry.body.kind === "income" ? " in" : ""}`}>
              {entry.body.kind === "income" ? "+" : "−"}
              {money.plain(entry.body.amount)}
            </span>
            <div className="waiting-actions">
              {phone && entry.refused !== null && (
                <button type="button" className="quiet" onClick={() => open({ draft: entry })}>
                  {t("offline.edit")}
                </button>
              )}
              <DiscardButton userId={userId} entry={entry} />
            </div>
          </li>
        ))}
      </ul>
      <button type="button" disabled={sending} onClick={() => void sendNow()}>
        {t("offline.sendNow")}
      </button>
    </Card>
  );
}

/** Hidden while this entry is being posted: a discard then would race the answer. */
function DiscardButton({ userId, entry }: { userId: string; entry: QueuedEntry }) {
  const t = useT();
  const sendingNow = useIsSending(userId, entry.client_ref);
  if (sendingNow) return null;
  return (
    <button
      type="button"
      className="quiet"
      onClick={() => {
        const question =
          entry.refused !== null ? t("offline.discardConfirm") : t("offline.discardWaitingConfirm");
        if (window.confirm(question)) discardEntry(userId, entry.client_ref);
      }}
    >
      {t("offline.discard")}
    </button>
  );
}
