import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EntryInput } from "../api/client";
import {
  SAVE_TIMEOUT_MS,
  clearEntriesStore,
  countUnsent,
  discardEntry,
  flushEntries,
  readOutbox,
  readPicksCache,
  saveEntry,
  subscribe,
  undoEntry,
  useEntryOutbox,
  writePicksCache,
  type QueuedEntry,
} from "./outbox";

/**
 * The entries on the device (Epic 45, AD-61; spec docs/epic-45-offline-entries.md §2 Device).
 * The real api client runs against a stubbed `fetch`, so a network failure is what the app sees
 * offline: `fetch` rejecting with a TypeError.
 */

vi.mock("../auth/AuthContext", () => ({ useOptionalAuth: () => ({ user: { id: "u1" } }) }));

const U = "u1";
const KEY = "everything-everywhere.entries.u1.outbox";
const PICKS_KEY = "everything-everywhere.entries.u1.picks";

const body = (name: string, amount = "3"): EntryInput => ({
  kind: "expense",
  amount,
  occurred_on: "2031-01-01",
  category_name: name,
});

function json(value: unknown, status = 200): Response {
  return new Response(value === undefined ? null : JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Post {
  ref: string;
  category: string;
}

let posts: Post[];
let deletes: string[];
/** The answer to a POST /api/entries, by what was posted. */
let answer: (post: Post) => Promise<Response> | Response;
let serial: number;

const online = (post: Post) => json({ id: `srv-${post.category}` }, 201);
const offline = () => {
  throw new TypeError("Failed to fetch");
};

beforeEach(() => {
  window.localStorage.clear();
  posts = [];
  deletes = [];
  serial = 0;
  answer = online;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "POST" && url.endsWith("/api/entries")) {
        const sent = JSON.parse(String(init?.body)) as { client_ref: string; category_name: string };
        const post = { ref: sent.client_ref, category: sent.category_name };
        posts.push(post);
        serial += 1;
        return answer(post);
      }
      if (method === "DELETE") {
        deletes.push(url);
        return json(undefined, 204);
      }
      return json({});
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Queue entries straight into storage, as an earlier offline session left them. */
function seed(...entries: Array<Partial<QueuedEntry> & { name: string }>): string[] {
  const queued = entries.map((entry, index) => {
    const ref = entry.client_ref ?? `00000000-0000-4000-8000-00000000000${index + 1}`;
    return {
      client_ref: ref,
      body: { ...body(entry.name), client_ref: ref },
      category_name: entry.name,
      queued_at: `2031-01-01T10:0${index}:00Z`,
      refused: entry.refused ?? null,
    } satisfies QueuedEntry;
  });
  window.localStorage.setItem(KEY, JSON.stringify(queued));
  return queued.map((entry) => entry.client_ref);
}

describe("saveEntry", () => {
  it("queues first, sends at once, and reports the server's entry", async () => {
    const outcome = await saveEntry(U, body("Fuel"), "Fuel");
    expect(outcome).toMatchObject({ status: "sent", entry: { id: "srv-Fuel" } });
    expect(posts).toHaveLength(1);
    expect(posts[0]?.ref).toMatch(/^[0-9a-f-]{36}$/);
    expect(readOutbox(U)).toEqual([]);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("keeps the entry on the device when the network is down", async () => {
    answer = offline;
    const outcome = await saveEntry(U, body("Fuel", "12.5"), "Fuel");
    expect(outcome).toMatchObject({ status: "queued" });
    const queue = readOutbox(U);
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      category_name: "Fuel",
      refused: null,
      body: { amount: "12.5", category_name: "Fuel", client_ref: posts[0]?.ref },
    });
    expect(queue[0]?.client_ref).toBe(posts[0]?.ref);
    expect(countUnsent(U)).toBe(1);
  });

  it("is per account: another account's keys are untouched", async () => {
    answer = offline;
    await saveEntry(U, body("Fuel"), "Fuel");
    expect(readOutbox("u2")).toEqual([]);
    expect(window.localStorage.getItem("everything-everywhere.entries.u2.outbox")).toBeNull();
  });

  it("leaves a 5xx queued, not refused", async () => {
    answer = () => json({ detail: "boom", code: "unknown" }, 503);
    const outcome = await saveEntry(U, body("Fuel"), "Fuel");
    expect(outcome.status).toBe("queued");
    expect(readOutbox(U)[0]?.refused).toBeNull();
  });

  it("leaves a 401 queued, not refused", async () => {
    answer = () => json({ detail: "expired" }, 401);
    const outcome = await saveEntry(U, body("Fuel"), "Fuel");
    expect(outcome.status).toBe("queued");
    expect(readOutbox(U)[0]?.refused).toBeNull();
  });

  it("marks a 4xx refused with the server's code and keeps the entry", async () => {
    answer = () => json({ detail: "no pot", code: "pot_not_found" }, 422);
    const outcome = await saveEntry(U, body("Fuel"), "Fuel");
    expect(outcome).toMatchObject({ status: "refused", code: "pot_not_found" });
    expect(readOutbox(U)[0]?.refused).toBe("pot_not_found");
  });

  it("uses the code 'error' when the refusal carries none", async () => {
    answer = () => json({ detail: "nope" }, 422);
    const outcome = await saveEntry(U, body("Fuel"), "Fuel");
    expect(outcome).toMatchObject({ status: "refused", code: "error" });
  });

  it("reuses the ref of the refused entry it replaces, and replaces it in place", async () => {
    const [refA, refB] = seed(
      { name: "Old", refused: "pot_not_found" },
      { name: "Other", refused: "x" },
    ) as [string, string];
    const outcome = await saveEntry(U, body("Fixed", "9"), "Fixed", refA);
    expect(outcome).toMatchObject({ status: "sent" });
    expect(posts).toHaveLength(1);
    expect(posts[0]).toEqual({ ref: refA, category: "Fixed" });
    // The other refused entry is still there, the replaced one is gone, nothing doubled.
    expect(readOutbox(U).map((entry) => entry.client_ref)).toEqual([refB]);
  });

  it("a replaced entry that is refused again stays under the same ref with the new body", async () => {
    const [refA] = seed({ name: "Old", refused: "pot_not_found" }) as [string];
    answer = () => json({ detail: "still", code: "category_not_found" }, 422);
    await saveEntry(U, body("Fixed", "9"), "Fixed", refA);
    const queue = readOutbox(U);
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      client_ref: refA,
      category_name: "Fixed",
      refused: "category_not_found",
    });
  });

  it("stops waiting after the timeout and leaves the entry queued", async () => {
    vi.useFakeTimers();
    let release: (response: Response) => void = () => undefined;
    // A connection that is slow past the timeout.
    answer = () => new Promise<Response>((resolve) => (release = resolve));
    let outcome: unknown;
    const saving = saveEntry(U, body("Fuel"), "Fuel").then((value) => {
      outcome = value;
    });
    await vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS - 1);
    expect(outcome).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2);
    await saving;
    expect(outcome).toMatchObject({ status: "queued" });
    expect(readOutbox(U)).toHaveLength(1);
    // Let the slow send land so the account's flush does not outlive the test.
    release(json({ id: "srv-Fuel" }, 201));
    await vi.advanceTimersByTimeAsync(1);
    vi.useRealTimers();
    await vi.waitFor(() => expect(readOutbox(U)).toEqual([]));
  });
});

describe("flushEntries", () => {
  it("sends oldest first, one at a time", async () => {
    seed({ name: "A" }, { name: "B" }, { name: "C" });
    let running = 0;
    let peak = 0;
    answer = async (post) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return online(post);
    };
    const result = await flushEntries(U);
    expect(posts.map((post) => post.category)).toEqual(["A", "B", "C"]);
    expect(peak).toBe(1);
    expect(result).toEqual({ sent: 3, pending: 0, refused: 0 });
    expect(readOutbox(U)).toEqual([]);
  });

  it("is single-flight: two concurrent flushes send each entry once", async () => {
    seed({ name: "A" }, { name: "B" });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    answer = async (post) => {
      await gate;
      return online(post);
    };
    const first = flushEntries(U);
    const second = flushEntries(U);
    expect(second).toBe(first);
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(posts.map((post) => post.category)).toEqual(["A", "B"]);
    expect(a).toEqual(b);
  });

  it("stops on a network failure and leaves the rest untouched", async () => {
    seed({ name: "A" }, { name: "B" });
    answer = offline;
    const result = await flushEntries(U);
    expect(posts.map((post) => post.category)).toEqual(["A"]);
    expect(result).toEqual({ sent: 0, pending: 2, refused: 0 });
    // Back online: the next flush sends both, A first.
    answer = online;
    await flushEntries(U);
    expect(posts.map((post) => post.category)).toEqual(["A", "A", "B"]);
    expect(readOutbox(U)).toEqual([]);
  });

  it("stops on a 5xx", async () => {
    seed({ name: "A" }, { name: "B" });
    answer = () => json({ detail: "x", code: "unknown" }, 500);
    const result = await flushEntries(U);
    expect(posts).toHaveLength(1);
    expect(result.pending).toBe(2);
  });

  it("stops on a 401 and keeps everything", async () => {
    seed({ name: "A" }, { name: "B" });
    answer = () => json({ detail: "expired" }, 401);
    const result = await flushEntries(U);
    expect(posts).toHaveLength(1);
    expect(result).toEqual({ sent: 0, pending: 2, refused: 0 });
  });

  it("marks a refused entry and carries on with the next", async () => {
    seed({ name: "A" }, { name: "B" });
    answer = (post) =>
      post.category === "A" ? json({ detail: "x", code: "pot_not_found" }, 422) : online(post);
    const result = await flushEntries(U);
    expect(posts.map((post) => post.category)).toEqual(["A", "B"]);
    expect(result).toEqual({ sent: 1, pending: 0, refused: 1 });
    expect(readOutbox(U)).toMatchObject([{ body: { category_name: "A" }, refused: "pot_not_found" }]);
  });

  it("never retries a refused entry on a later flush", async () => {
    seed({ name: "A", refused: "pot_not_found" }, { name: "B" });
    await flushEntries(U);
    await flushEntries(U);
    expect(posts.map((post) => post.category)).toEqual(["B"]);
    expect(readOutbox(U)).toHaveLength(1);
  });

  it("counts a 200 replay as sent", async () => {
    seed({ name: "A" });
    answer = (post) => json({ id: `srv-${post.category}` }, 200);
    const result = await flushEntries(U);
    expect(result.sent).toBe(1);
    expect(readOutbox(U)).toEqual([]);
  });

  it("does nothing, and posts nothing, with an empty queue", async () => {
    expect(await flushEntries(U)).toEqual({ sent: 0, pending: 0, refused: 0 });
    expect(posts).toHaveLength(0);
  });
});

describe("undoEntry", () => {
  it("removes a queued entry from the queue without touching the server", async () => {
    answer = offline;
    const outcome = await saveEntry(U, body("Fuel"), "Fuel");
    if (outcome.status !== "queued") throw new Error("expected queued");
    await undoEntry(U, outcome.client_ref);
    expect(readOutbox(U)).toEqual([]);
    expect(deletes).toHaveLength(0);
  });

  it("deletes a sent entry on the server by the id it was given", async () => {
    const outcome = await saveEntry(U, body("Fuel"), "Fuel");
    if (outcome.status !== "sent") throw new Error("expected sent");
    await undoEntry(U, posts[0]?.ref ?? "", outcome.entry.id);
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toMatch(/\/api\/entries\/srv-Fuel$/);
  });

  it("finds the server id itself when it is not passed", async () => {
    await saveEntry(U, body("Fuel"), "Fuel");
    await undoEntry(U, posts[0]?.ref ?? "");
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toMatch(/\/api\/entries\/srv-Fuel$/);
  });

  it("deletes once, after the send lands, when the undo comes mid-send", async () => {
    let release: (response: Response) => void = () => undefined;
    answer = () => new Promise<Response>((resolve) => (release = resolve));
    const saving = saveEntry(U, body("Fuel"), "Fuel");
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    const ref = posts[0]?.ref ?? "";
    const undone = undoEntry(U, ref);
    // Nothing is deleted while the answer is outstanding: there is no id yet.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(deletes).toHaveLength(0);
    release(json({ id: "srv-late" }, 201));
    await undone;
    await saving;
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toMatch(/\/api\/entries\/srv-late$/);
    expect(readOutbox(U)).toEqual([]);
  });

  it("just drops the entry when the send it waited for failed", async () => {
    let release: () => void = () => undefined;
    answer = () =>
      new Promise<Response>((_, reject) => {
        release = () => reject(new TypeError("Failed to fetch"));
      });
    const saving = saveEntry(U, body("Fuel"), "Fuel");
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    const undone = undoEntry(U, posts[0]?.ref ?? "");
    release();
    await undone;
    await saving;
    expect(deletes).toHaveLength(0);
    expect(readOutbox(U)).toEqual([]);
  });
});

describe("discardEntry and countUnsent", () => {
  it("drops one entry, counts waiting and refused alike", () => {
    const [a, b] = seed({ name: "A" }, { name: "B", refused: "x" }) as [string, string];
    expect(countUnsent(U)).toBe(2);
    discardEntry(U, b);
    expect(readOutbox(U).map((entry) => entry.client_ref)).toEqual([a]);
    discardEntry(U, "nope");
    expect(countUnsent(U)).toBe(1);
  });
});

describe("the device store", () => {
  it("clearEntriesStore removes the outbox and the picks of that account only", () => {
    seed({ name: "A" });
    writePicksCache(U, { picks: null, categories: [], vendors: [], pots: [] });
    window.localStorage.setItem("everything-everywhere.entries.u2.outbox", "[]");
    clearEntriesStore(U);
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(window.localStorage.getItem(PICKS_KEY)).toBeNull();
    expect(window.localStorage.getItem("everything-everywhere.entries.u2.outbox")).toBe("[]");
  });

  it("round-trips the picks cache and stamps it", () => {
    expect(readPicksCache(U)).toBeNull();
    writePicksCache(U, {
      picks: null,
      categories: [{ id: "c1", kind: "expense", name: "Fuel", created_at: "" }],
      vendors: [],
      pots: [],
    });
    const cache = readPicksCache(U);
    expect(cache?.categories[0]?.name).toBe("Fuel");
    expect(cache?.saved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("reads garbage as nothing", () => {
    window.localStorage.setItem(KEY, "{not json");
    window.localStorage.setItem(PICKS_KEY, "[1,2]");
    expect(readOutbox(U)).toEqual([]);
    expect(readPicksCache(U)).toBeNull();
    window.localStorage.setItem(KEY, JSON.stringify([{ nope: 1 }, "x", null]));
    expect(readOutbox(U)).toEqual([]);
  });

  it("sends directly, and still answers with an outcome, when storage refuses the write", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    const outcome = await saveEntry(U, body("Fuel"), "Fuel");
    expect(outcome).toMatchObject({ status: "sent", entry: { id: "srv-Fuel" } });
    expect(posts).toHaveLength(1);
    expect(readOutbox(U)).toEqual([]);
  });

  it("lets a failed direct send reach the caller, keeping nothing", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    answer = offline;
    await expect(saveEntry(U, body("Fuel"), "Fuel")).rejects.toBeInstanceOf(TypeError);
  });

  it("does not throw when storage cannot even be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(readOutbox(U)).toEqual([]);
    expect(readPicksCache(U)).toBeNull();
    expect(countUnsent(U)).toBe(0);
  });
});

describe("subscribe", () => {
  it("hears queue changes and other tabs' storage events, until unsubscribed", async () => {
    const heard = vi.fn();
    const stop = subscribe(heard);
    answer = offline;
    await saveEntry(U, body("Fuel"), "Fuel");
    expect(heard).toHaveBeenCalled();
    heard.mockClear();
    window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
    expect(heard).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent("storage", { key: "something.else" }));
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
    expect(heard).toHaveBeenCalledTimes(1);
  });
});

describe("useEntryOutbox", () => {
  it("follows the queue and keeps one array while nothing changed", async () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useEntryOutbox();
    });
    expect(result.current).toEqual([]);
    const first = result.current;

    answer = offline;
    await act(async () => {
      await saveEntry(U, body("Fuel"), "Fuel");
    });
    expect(result.current).toHaveLength(1);
    const withOne = result.current;
    const rendersBefore = renders;

    // An unrelated emit (a storage event for the same value) must not hand out a new array.
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
    });
    expect(result.current).toBe(withOne);
    expect(renders - rendersBefore).toBeLessThanOrEqual(1);
    expect(first).not.toBe(withOne);

    act(() => discardEntry(U, withOne[0]?.client_ref ?? ""));
    expect(result.current).toEqual([]);
    expect(serial).toBeGreaterThan(0);
  });
});
