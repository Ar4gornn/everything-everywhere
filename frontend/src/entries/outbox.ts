import type { EntryInput } from "../api/client";
import type { Category, Entry, Pot, QuickPicks, Vendor } from "../api/types";

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
  | { status: "sent"; entry: Entry }
  /** On the device, waiting for the network. */
  | { status: "queued"; client_ref: string }
  /** Refused by the server (4xx other than 401): kept on the device, marked. */
  | { status: "refused"; client_ref: string; code: string };

/** Every queued entry for this account, oldest first. [] when storage is unreadable. */
export function readOutbox(userId: string): QueuedEntry[] {
  void userId;
  throw new Error("not built");
}

/**
 * The sheet's Save: queue the entry (coining `client_ref` unless `replaceRef` names a refused
 * entry being edited, whose ref is reused) and flush. Storage blocked → send directly.
 */
export function saveEntry(
  userId: string,
  body: EntryInput,
  categoryName: string,
  replaceRef?: string,
): Promise<QueueOutcome> {
  void userId;
  void body;
  void categoryName;
  void replaceRef;
  throw new Error("not built");
}

/**
 * Send what waits, oldest first, one at a time. Single-flight per account: a call while one
 * runs returns the running promise. Outcomes per §2 Device 3.
 */
export function flushEntries(userId: string): Promise<FlushResult> {
  void userId;
  throw new Error("not built");
}

/**
 * Undo of a sheet save. Queued → removed from the queue. Being sent → deleted on the server once
 * the send resolves. Sent (`serverId` known) → `DELETE /api/entries/{serverId}`.
 */
export function undoEntry(userId: string, clientRef: string, serverId?: string): Promise<void> {
  void userId;
  void clientRef;
  void serverId;
  throw new Error("not built");
}

/** Drop a refused (or waiting) entry the person chose to discard. */
export function discardEntry(userId: string, clientRef: string): void {
  void userId;
  void clientRef;
  throw new Error("not built");
}

/** Waiting + refused, for the `+` badge, the dashboard line and the sign-out question. */
export function countUnsent(userId: string): number {
  void userId;
  throw new Error("not built");
}

export function readPicksCache(userId: string): PicksCache | null {
  void userId;
  throw new Error("not built");
}

export function writePicksCache(userId: string, cache: Omit<PicksCache, "saved_at">): void {
  void userId;
  void cache;
  throw new Error("not built");
}

/** Explicit sign-out only (AD-48): outbox and picks go with the session. */
export function clearEntriesStore(userId: string): void {
  void userId;
  throw new Error("not built");
}

/** Hear every change to this account's outbox (this tab and others). Returns unsubscribe. */
export function subscribe(listener: () => void): () => void {
  void listener;
  throw new Error("not built");
}

/**
 * The outbox for the signed-in account, re-rendering on every change. `[]` when signed out.
 * Built on `subscribe` + `readOutbox` (useSyncExternalStore with a cached snapshot).
 */
export function useEntryOutbox(): QueuedEntry[] {
  throw new Error("not built");
}
