import { useCallback, useSyncExternalStore } from "react";

import { ApiError, api, type EntryInput } from "../api/client";
import type { Category, Entry, Pot, QuickPicks, Vendor } from "../api/types";
import { useOptionalAuth } from "../auth/AuthContext";
import { newId } from "../gym/id";
import { PREFIX } from "../storage";

/**
 * Entries on the device (Epic 45, AD-61). Spec: docs/epic-45-offline-entries.md §2.
 *
 * Keys: `everything-everywhere.entries.<userId>.{outbox,picks}` in localStorage, every read and
 * write in try/catch — storage can be full, blocked or absent, and then the sheet sends directly
 * as it did before Epic 45 and says nothing alarming. Same shape and rules as Gym's outbox
 * (`gym/store.ts`, AD-58): read that file before changing this one.
 *
 * - **outbox**: sheet entries not yet accepted by the server, oldest first.
 * - **picks**: the sheet's last good chips, categories, vendors and pots, so it opens at once and
 *   works offline.
 *
 * Both are removed by `clearEntriesStore` on explicit sign-out (AD-48); an expired session keeps
 * them. Subscribers hear every change, across components and tabs (`storage` event).
 */

export interface QueuedEntry {
  /** Also `body.client_ref`; the queue's key. */
  client_ref: string;
  /** What will be POSTed, `client_ref` included. */
  body: EntryInput & { client_ref: string };
  /** For the Waiting card: the category's name as typed or picked. */
  category_name: string;
  /** ISO instant it was queued. */
  queued_at: string;
  /** The server's error code when it refused this entry; null while merely waiting. */
  refused: string | null;
}

export interface PicksCache {
  picks: QuickPicks | null;
  categories: Category[];
  vendors: Vendor[];
  pots: Pot[];
  /** ISO instant of the server answer this copy came from. */
  saved_at: string;
}

export interface FlushResult {
  /** Accepted this run (201 or a 200 replay). */
  sent: number;
  /** Still waiting (network down, 5xx, 401 stopped the run, or not reached). */
  pending: number;
  /** Marked refused so far (this run or earlier). */
  refused: number;
}

/** What a sheet save did with the entry. */
export type QueueOutcome =
  /** Accepted by the server during the save. */
  | { status: "sent"; entry: Entry; client_ref: string }
  /** On the device, waiting for the network. */
  | { status: "queued"; client_ref: string }
  /** Refused by the server (4xx other than 401): kept on the device, marked. */
  | { status: "refused"; client_ref: string; code: string };

/** How long a Save waits for the server before leaving the entry queued and moving on. */
export const SAVE_TIMEOUT_MS = 10_000;

const base = (userId: string) => `${PREFIX}entries.${userId}.`;
const OUTBOX = "outbox";
const PICKS = "picks";
const SENT = "sent";

/** How long one entry's POST may hang before it counts as a network failure (a stall). */
export const ENTRY_SEND_TIMEOUT_MS = 20_000;

function readRaw(userId: string, part: string): string | null {
  try {
    return window.localStorage.getItem(base(userId) + part);
  } catch {
    // Blocked storage: as if nothing were stored.
    return null;
  }
}

function parse(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** Returns false when the write did not happen (full or blocked storage). */
function writeJson(userId: string, part: string, value: unknown): boolean {
  try {
    if (value === null) window.localStorage.removeItem(base(userId) + part);
    else window.localStorage.setItem(base(userId) + part, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const EMPTY: QueuedEntry[] = [];

function toOutbox(raw: unknown): QueuedEntry[] {
  if (!Array.isArray(raw)) return EMPTY;
  const kept = raw.filter(
    (entry): entry is QueuedEntry =>
      isRecord(entry) && typeof entry["client_ref"] === "string" && isRecord(entry["body"]),
  );
  return kept.length === 0 ? EMPTY : kept;
}

// --------------------------------------------------------------------- subscribers

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

/** Another tab wrote one of our keys: tell this tab's components. */
function onStorage(event: StorageEvent): void {
  if (event.key === null || event.key.startsWith(`${PREFIX}entries.`)) emit();
}

/** Hear every change to this account's outbox (this tab and others). Returns unsubscribe. */
export function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

// --------------------------------------------------------------------- outbox

/** Every queued entry for this account, oldest first. [] when storage is unreadable. */
export function readOutbox(userId: string): QueuedEntry[] {
  const list = toOutbox(parse(readRaw(userId, OUTBOX)));
  return list === EMPTY ? [] : list;
}

function writeOutbox(userId: string, entries: QueuedEntry[]): boolean {
  const ok = writeJson(userId, OUTBOX, entries.length === 0 ? null : entries);
  emit();
  return ok;
}

/** Waiting + refused, for the `+` badge, the dashboard line and the sign-out question. */
export function countUnsent(userId: string): number {
  return readOutbox(userId).length;
}

/** Drop a refused (or waiting) entry the person chose to discard. */
export function discardEntry(userId: string, clientRef: string): void {
  const entries = readOutbox(userId);
  const kept = entries.filter((entry) => entry.client_ref !== clientRef);
  if (kept.length !== entries.length) writeOutbox(userId, kept);
}

// --------------------------------------------------------------------- flushing

/** client_ref → the server's entry, for an Undo that lasts seconds. Newest few only. */
const sentEntries = new Map<string, Entry>();
const SENT_KEPT = 20;

const SENT_STORED = 50;

/** client_ref → server id for the newest sends, so another tab or a reload can still undo. */
function readSent(userId: string): [string, string][] {
  const raw = parse(readRaw(userId, SENT));
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (pair): pair is [string, string] =>
      Array.isArray(pair) && typeof pair[0] === "string" && typeof pair[1] === "string",
  );
}

function rememberStored(userId: string, clientRef: string, id: string): void {
  const kept = readSent(userId).filter(([ref]) => ref !== clientRef);
  kept.push([clientRef, id]);
  writeJson(userId, SENT, kept.slice(-SENT_STORED));
}

function forgetStored(userId: string, clientRef: string): void {
  const kept = readSent(userId).filter(([ref]) => ref !== clientRef);
  writeJson(userId, SENT, kept.length === 0 ? null : kept);
}

function remember(userId: string, clientRef: string, entry: Entry): void {
  rememberStored(userId, clientRef, entry.id);
  sentEntries.set(clientRef, entry);
  while (sentEntries.size > SENT_KEPT) {
    const oldest = sentEntries.keys().next().value;
    if (oldest === undefined) break;
    sentEntries.delete(oldest);
  }
}

const flights = new Map<string, Promise<FlushResult>>();

/** client_ref → the send in progress (settled once its bookkeeping is done). */
const inFlight = new Map<string, Promise<void>>();

/** Refs a flush has tried since they were queued; lets a Save tell "not reached" from "failed". */
const attempted = new Set<string>();

/** Accounts whose last flush stopped on a failure: re-running it at once would only fail again. */
const stalled = new Set<string>();

function tally(userId: string, sent: number): FlushResult {
  const entries = readOutbox(userId);
  const refused = entries.filter((entry) => entry.refused !== null).length;
  return { sent, pending: entries.length - refused, refused };
}

/**
 * A refusal the server will give again for the same body: a 4xx other than 401 (sign back in),
 * 408 and 429 (try again later), and a failed token refresh — none of which says anything about
 * the entry itself. Network errors (not an ApiError) and 5xx are never refusals.
 */
function isRefusal(caught: unknown): caught is ApiError {
  return (
    caught instanceof ApiError &&
    caught.code !== "refresh_failed" &&
    caught.status >= 400 &&
    caught.status < 500 &&
    caught.status !== 401 &&
    caught.status !== 408 &&
    caught.status !== 429
  );
}

/**
 * Send what waits, oldest first, one at a time. Single-flight per account: a call while one
 * runs returns the running promise. Outcomes per §2 Device 3.
 */
export function flushEntries(userId: string): Promise<FlushResult> {
  const running = flights.get(userId);
  if (running) return running;
  const run = (async () => {
    let sent = 0;
    stalled.delete(userId);
    for (;;) {
      // Re-read every time: the person may have discarded or queued something meanwhile.
      const next = readOutbox(userId).find((entry) => entry.refused === null);
      if (!next) break;
      const ref = next.client_ref;
      attempted.add(ref);
      let landed!: () => void;
      inFlight.set(
        ref,
        new Promise<void>((resolve) => {
          landed = resolve;
        }),
      );
      emit(); // "being sent" changed: the Waiting card hides Discard meanwhile
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ENTRY_SEND_TIMEOUT_MS);
      try {
        const saved: unknown = await api.createEntry(next.body, undefined, controller.signal);
        // Only an entry counts as sent. A captive portal answers a POST with an HTML 200,
        // which `request` turns into null: that is a stall, never a delivery.
        if (!isRecord(saved) || typeof saved["id"] !== "string") {
          throw new Error("The answer was not an entry");
        }
        remember(userId, ref, saved as unknown as Entry);
        writeOutbox(
          userId,
          readOutbox(userId).filter((entry) => entry.client_ref !== ref),
        );
        sent += 1;
      } catch (caught) {
        if (!isRefusal(caught)) {
          stalled.add(userId); // no network, a 5xx, a session to sign back into
          break;
        }
        const code = caught.code ?? "error";
        writeOutbox(
          userId,
          readOutbox(userId).map((entry) =>
            entry.client_ref === ref ? { ...entry, refused: code } : entry,
          ),
        );
      } finally {
        clearTimeout(timer);
        inFlight.delete(ref);
        landed();
        emit();
      }
    }
    return tally(userId, sent);
  })().finally(() => {
    flights.delete(userId);
  });
  flights.set(userId, run);
  return run;
}

// --------------------------------------------------------------------- saving and undoing

/**
 * The sheet's Save: queue the entry (coining `client_ref` unless `replaceRef` names a refused
 * entry being edited, whose ref is reused) and flush. Storage blocked → send directly.
 */
export async function saveEntry(
  userId: string,
  body: EntryInput,
  categoryName: string,
  replaceRef?: string,
): Promise<QueueOutcome> {
  const ref = replaceRef ?? newId();
  const full = { ...body, client_ref: ref };
  const item: QueuedEntry = {
    client_ref: ref,
    body: full,
    category_name: categoryName,
    queued_at: new Date().toISOString(),
    refused: null,
  };
  const existing = readOutbox(userId);
  const stored = existing.some((entry) => entry.client_ref === ref)
    ? existing.map((entry) => (entry.client_ref === ref ? item : entry))
    : [...existing, item];
  attempted.delete(ref);
  if (!writeOutbox(userId, stored)) {
    // Storage refused the write: send straight away, as before Epic 45. A failure is the
    // caller's to show; nothing is kept.
    const entry = await api.createEntry(full);
    return { status: "sent", entry, client_ref: ref };
  }

  const settle = async (): Promise<void> => {
    await flushEntries(userId);
    // A flush that was already running may have ended before it reached this entry.
    const left = readOutbox(userId).find((entry) => entry.client_ref === ref);
    if (left && left.refused === null && !attempted.has(ref) && !stalled.has(userId)) {
      await flushEntries(userId);
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, SAVE_TIMEOUT_MS);
  });
  try {
    await Promise.race([settle(), timeout]);
  } finally {
    clearTimeout(timer);
  }

  const left = readOutbox(userId).find((entry) => entry.client_ref === ref);
  if (left?.refused) return { status: "refused", client_ref: ref, code: left.refused };
  if (left) return { status: "queued", client_ref: ref };
  const entry = sentEntries.get(ref);
  // Gone without a server answer on record (discarded in another tab): nothing is on the
  // server, so the honest reading is "queued", and Undo then has nothing to do.
  return entry ? { status: "sent", entry, client_ref: ref } : { status: "queued", client_ref: ref };
}

/**
 * Undo of a sheet save. Queued → removed from the queue. Being sent → deleted on the server once
 * the send resolves. Sent (`serverId` known) → `DELETE /api/entries/{serverId}`.
 */
export async function undoEntry(
  userId: string,
  clientRef: string,
  serverId?: string,
): Promise<void> {
  // A send in progress must land first: it either leaves the entry queued (discard) or
  // records the server id (delete) — deciding earlier would miss an entry about to exist.
  await inFlight.get(clientRef);
  if (readOutbox(userId).some((entry) => entry.client_ref === clientRef)) {
    discardEntry(userId, clientRef);
    return;
  }
  const id =
    serverId ??
    sentEntries.get(clientRef)?.id ??
    readSent(userId).find(([ref]) => ref === clientRef)?.[1];
  // Not queued, and no server id on record: the caller must not tell the person it is undone.
  if (!id) throw new Error("This entry can no longer be undone from here");
  await api.deleteEntry(id);
  sentEntries.delete(clientRef);
  forgetStored(userId, clientRef);
}

/** True while a flush is posting this entry (Discard would race the POST). */
export function isSending(_userId: string, clientRef: string): boolean {
  return inFlight.has(clientRef);
}

/** `isSending` as a hook: a boolean snapshot, so it only re-renders when the answer changes. */
export function useIsSending(userId: string, clientRef: string): boolean {
  const getSnapshot = useCallback(() => isSending(userId, clientRef), [userId, clientRef]);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

// --------------------------------------------------------------------- picks cache

export function readPicksCache(userId: string): PicksCache | null {
  const raw = parse(readRaw(userId, PICKS));
  if (!isRecord(raw)) return null;
  const list = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
  const picks = isRecord(raw["picks"]) ? (raw["picks"] as unknown as QuickPicks) : null;
  return {
    picks,
    categories: list<Category>(raw["categories"]),
    vendors: list<Vendor>(raw["vendors"]),
    pots: list<Pot>(raw["pots"]),
    saved_at: typeof raw["saved_at"] === "string" ? raw["saved_at"] : "",
  };
}

export function writePicksCache(userId: string, cache: Omit<PicksCache, "saved_at">): void {
  writeJson(userId, PICKS, { ...cache, saved_at: new Date().toISOString() });
}

/** Explicit sign-out only (AD-48): outbox and picks go with the session. */
export function clearEntriesStore(userId: string): void {
  writeJson(userId, OUTBOX, null);
  writeJson(userId, PICKS, null);
  writeJson(userId, SENT, null);
  emit();
}

// --------------------------------------------------------------------- the hook

/** Last parse per account, so an unchanged outbox is the same array (a stable snapshot). */
const snapshots = new Map<string, { raw: string | null; value: QueuedEntry[] }>();

function snapshotOf(userId: string): QueuedEntry[] {
  const raw = readRaw(userId, OUTBOX);
  const last = snapshots.get(userId);
  if (last && last.raw === raw) return last.value;
  const value = toOutbox(parse(raw));
  snapshots.set(userId, { raw, value });
  return value;
}

/**
 * The outbox for the signed-in account, re-rendering on every change. `[]` when signed out.
 * Built on `subscribe` + `readOutbox` (useSyncExternalStore with a cached snapshot).
 */
export function useEntryOutbox(): QueuedEntry[] {
  const userId = useOptionalAuth()?.user?.id ?? null;
  const getSnapshot = useCallback(() => (userId ? snapshotOf(userId) : EMPTY), [userId]);
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}
