import { type FormEvent, useState } from "react";

import { api } from "../api/client";
import type { Invite, IssuedInvite } from "../api/types";
import { useToast } from "../components/Toast";
import { Card, Empty, ErrorBanner } from "../components/ui";
import { useT } from "../i18n";
import { errorMessage } from "../i18n/errors";
import { useDates } from "../useDates";
import { useLoad } from "../useLoad";

/**
 * Issuing invites from the app (AD-54). Reached from Settings, and only offered to an
 * admin; the server answers 404 to anyone else on every route this page calls.
 *
 * The code exists in plaintext exactly once — in the create's answer — so the page turns it
 * straight into the message the admin sends: a link that opens sign-up with the code already
 * filled in (`/?invite=…`, read by `SignInPage`). The message is editable before it is
 * copied or shared; it is written in the admin's language, which is usually the invitee's.
 */

const DEFAULT_DAYS = 14;
const MAX_DAYS = 90;

/** The local calendar day of a timestamp, as the date labels expect it. */
function localDay(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The sign-up link. The app's own origin, so a dev or a second instance links to itself. */
export function inviteLink(code: string, origin = window.location.origin): string {
  return `${origin}/?invite=${encodeURIComponent(code)}`;
}

export function InvitesPage() {
  const t = useT();
  const dates = useDates();
  const toast = useToast();

  const [note, setNote] = useState("");
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedInvite | null>(null);
  const [message, setMessage] = useState("");

  const { data, loading, failure: loadFailure, reload } = useLoad(
    () => api.listInvites(),
    [] as Invite[],
    [],
    "invites.couldNotLoad",
  );

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      const made = await api.createInvite(note, days);
      setIssued(made);
      setMessage(
        t("invites.messageBody", {
          link: inviteLink(made.code),
          date: dates.dayAcrossYears(localDay(made.expires_at)),
        }),
      );
      setNote("");
      setDays(DEFAULT_DAYS);
      await reload();
    } catch (caught) {
      setFailure(errorMessage(t, caught, "invites.couldNotCreate"));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      toast.show(t("invites.copied"));
    } catch {
      setFailure(t("invites.couldNotCopy"));
    }
  }

  async function share() {
    try {
      await navigator.share({ text: message });
    } catch {
      // Dismissing the share sheet rejects too; there is nothing to report.
    }
  }

  async function revoke(invite: Invite) {
    setBusy(true);
    setFailure(null);
    try {
      await api.revokeInvite(invite.id);
      if (issued?.id === invite.id) {
        setIssued(null);
        setMessage("");
      }
      await reload();
      toast.show(t("invites.revoked"));
    } catch (caught) {
      setFailure(errorMessage(t, caught, "invites.couldNotRevoke"));
    } finally {
      setBusy(false);
    }
  }

  function stateLabel(invite: Invite): string {
    if (invite.state === "used" && invite.used_at) {
      return t("invites.stateUsed", { date: dates.dayAcrossYears(localDay(invite.used_at)) });
    }
    const date = dates.dayAcrossYears(localDay(invite.expires_at));
    return t(invite.state === "open" ? "invites.stateOpen" : "invites.stateExpired", { date });
  }

  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <div className="invites-page">
      <h1 style={{ fontSize: 18, margin: "0 0 16px" }}>{t("invites.title")}</h1>
      <ErrorBanner message={failure ?? loadFailure} />

      <Card title={t("invites.new")}>
        <form onSubmit={create}>
          <div className="row">
            <label style={{ flex: "1 1 200px" }}>
              {t("invites.note")}
              <input
                value={note}
                maxLength={200}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            <label style={{ flex: "0 0 140px" }}>
              {t("invites.days")}
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_DAYS}
                value={days}
                onChange={(event) => {
                  // Clamped as typed: a controlled number input cannot hold "2." anyway.
                  const n = Math.trunc(Number(event.target.value));
                  setDays(Number.isFinite(n) ? Math.min(MAX_DAYS, Math.max(1, n)) : 1);
                }}
              />
            </label>
          </div>
          <p className="hint" style={{ margin: "6px 0 10px" }}>
            {t("invites.noteHint")}
          </p>
          <button type="submit" disabled={busy}>
            {t("invites.create")}
          </button>
        </form>

        {issued && (
          <div className="invite-issued" style={{ marginTop: 16 }}>
            <label>
              {t("invites.message")}
              <textarea
                rows={8}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
            </label>
            <p className="hint" style={{ margin: "6px 0 10px" }}>
              {t("invites.onceOnly")}
            </p>
            <div className="row">
              <button type="button" onClick={copy}>
                {t("invites.copy")}
              </button>
              {canShare && (
                <button type="button" className="quiet" onClick={share}>
                  {t("invites.share")}
                </button>
              )}
            </div>
          </div>
        )}
      </Card>

      <Card title={t("invites.issued")}>
        {!loading && !loadFailure && data.length === 0 && <Empty>{t("invites.none")}</Empty>}
        <ul className="invite-list">
          {data.map((invite) => (
            <li key={invite.id} className={`invite-row ${invite.state}`}>
              <span className="invite-text">
                <strong>{invite.note ?? t("invites.noNote")}</strong>
                <span className="hint">{stateLabel(invite)}</span>
              </span>
              {invite.state === "open" && (
                <button
                  type="button"
                  className="quiet"
                  disabled={busy}
                  onClick={() => void revoke(invite)}
                >
                  {t("invites.revoke")}
                </button>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
