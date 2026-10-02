import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { SHARE_CACHE, SHARE_KEY, takeSharedWorkout } from "./share";

/** A `caches` that remembers what was put in it, as the Cache API does. */
function fakeCaches(initial: Record<string, Record<string, string>> = {}) {
  const store = new Map<string, Map<string, string>>(
    Object.entries(initial).map(([name, entries]) => [name, new Map(Object.entries(entries))]),
  );
  const cacheFor = (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    const entries = store.get(name) as Map<string, string>;
    return {
      match: async (key: string) =>
        entries.has(key) ? new Response(entries.get(key) as string) : undefined,
      put: async (key: string, response: Response) => {
        entries.set(key, await response.text());
      },
      delete: async (key: string) => entries.delete(key),
    };
  };
  return {
    store,
    api: {
      open: async (name: string) => cacheFor(name),
      keys: async () => [...store.keys()],
      delete: async (name: string) => store.delete(name),
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("taking a shared workout", () => {
  it("returns the text and removes it in the same call", async () => {
    const fake = fakeCaches({ [SHARE_CACHE]: { [SHARE_KEY]: '{"routines": []}' } });
    vi.stubGlobal("caches", fake.api);
    expect(await takeSharedWorkout()).toBe('{"routines": []}');
    // a reload of the import page must not import twice
    expect(await takeSharedWorkout()).toBeNull();
    expect(fake.store.get(SHARE_CACHE)?.has(SHARE_KEY)).toBe(false);
  });

  it("returns null when nothing was shared", async () => {
    vi.stubGlobal("caches", fakeCaches().api);
    expect(await takeSharedWorkout()).toBeNull();
  });

  it("returns null for an empty share", async () => {
    vi.stubGlobal("caches", fakeCaches({ [SHARE_CACHE]: { [SHARE_KEY]: "" } }).api);
    expect(await takeSharedWorkout()).toBeNull();
  });

  it("returns null without the Cache API", async () => {
    vi.stubGlobal("caches", undefined);
    expect(await takeSharedWorkout()).toBeNull();
  });

  it("returns null when the cache throws", async () => {
    vi.stubGlobal("caches", {
      open: async () => {
        throw new DOMException("denied", "SecurityError");
      },
    });
    expect(await takeSharedWorkout()).toBeNull();
  });
});

/**
 * The other half: the worker's `POST /gym/share`. `public/sw.js` is not a module, so it is
 * run here against a fake `self` and a fake `caches`, which is all it touches.
 */
describe("the service worker's share target", () => {
  type Handler = (event: unknown) => void;
  const source = readFileSync(join(__dirname, "../../public/sw.js"), "utf8");

  function boot(initial: Record<string, Record<string, string>> = {}) {
    const fake = fakeCaches(initial);
    const handlers: Record<string, Handler> = {};
    const scope = {
      addEventListener: (type: string, handler: Handler) => {
        handlers[type] = handler;
      },
      location: { origin: "https://app.test" },
      skipWaiting: () => Promise.resolve(),
      clients: { claim: () => Promise.resolve() },
    };
    new Function("self", "caches", source)(scope, fake.api);
    return { fake, handlers };
  }

  /** Fire a fetch event; resolves to what the worker answered, or null if it did not respond. */
  async function fetchEvent(
    handlers: Record<string, Handler>,
    request: Record<string, unknown>,
  ): Promise<Response | null> {
    let answer: Promise<Response> | null = null;
    handlers["fetch"]?.({
      request,
      respondWith: (promise: Promise<Response>) => {
        answer = promise;
      },
    });
    return answer ? await answer : null;
  }

  const form = (entries: Record<string, unknown>) => ({
    getAll: (name: string) => (name in entries ? [entries[name]] : []),
    get: (name: string) => entries[name] ?? null,
  });
  const share = (entries: Record<string, unknown>, url = "https://app.test/gym/share") => ({
    method: "POST",
    url,
    mode: "navigate",
    formData: async () => form(entries),
  });
  const file = (text: string) => ({ size: new Blob([text]).size, text: async () => text });

  it("stores a shared file and redirects to the import page with a 303", async () => {
    const { fake, handlers } = boot();
    const response = await fetchEvent(handlers, share({ file: file('{"routines": []}') }));
    expect(response?.status).toBe(303);
    expect(response?.headers.get("Location")).toBe("https://app.test/gym/import?shared=1");
    expect(fake.store.get(SHARE_CACHE)?.get(SHARE_KEY)).toBe('{"routines": []}');
    // and the page's reader finds exactly that
    vi.stubGlobal("caches", fake.api);
    expect(await takeSharedWorkout()).toBe('{"routines": []}');
  });

  it("falls back to the shared text when there is no file", async () => {
    const { fake, handlers } = boot();
    await fetchEvent(handlers, share({ text: "pasted from a chat" }));
    expect(fake.store.get(SHARE_CACHE)?.get(SHARE_KEY)).toBe("pasted from a chat");
  });

  it("refuses a file over 256 KB: nothing stored, the redirect says why", async () => {
    const { fake, handlers } = boot();
    const big = { size: 256 * 1024 + 1, text: async () => "x" };
    const response = await fetchEvent(handlers, share({ file: big }));
    expect(response?.status).toBe(303);
    expect(response?.headers.get("Location")).toContain("refused=1");
    expect(fake.store.get(SHARE_CACHE)?.has(SHARE_KEY) ?? false).toBe(false);
  });

  it("refuses shared text over 256 KB too", async () => {
    const { fake, handlers } = boot();
    const response = await fetchEvent(handlers, share({ text: "y".repeat(256 * 1024 + 1) }));
    expect(response?.headers.get("Location")).toContain("refused=1");
    expect(fake.store.get(SHARE_CACHE)?.has(SHARE_KEY) ?? false).toBe(false);
  });

  it("refuses on Content-Length before reading the body", async () => {
    const { fake, handlers } = boot();
    let read = false;
    const request = {
      ...share({ text: "x" }),
      headers: new Headers({ "Content-Length": String(10 * 1024 * 1024) }),
      formData: async () => {
        read = true;
        return form({ text: "x" });
      },
    };
    const response = await fetchEvent(handlers, request);
    expect(response?.headers.get("Location")).toContain("refused=1");
    expect(read).toBe(false);
    expect(fake.store.get(SHARE_CACHE)?.has(SHARE_KEY) ?? false).toBe(false);
  });

  it("refuses a cross-site post: nothing stored, plain redirect", async () => {
    const { fake, handlers } = boot();
    const request = { ...share({ text: "x" }), headers: new Headers({ "Sec-Fetch-Site": "cross-site" }) };
    const response = await fetchEvent(handlers, request);
    expect(response?.status).toBe(303);
    expect(response?.headers.get("Location")).toBe("https://app.test/gym/import");
    expect(fake.store.get(SHARE_CACHE)?.has(SHARE_KEY) ?? false).toBe(false);
  });

  it("accepts Sec-Fetch-Site none and same-origin", async () => {
    for (const site of ["none", "same-origin"]) {
      const { fake, handlers } = boot();
      await fetchEvent(handlers, { ...share({ text: "ok" }), headers: new Headers({ "Sec-Fetch-Site": site }) });
      expect(fake.store.get(SHARE_CACHE)?.get(SHARE_KEY)).toBe("ok");
    }
  });

  it("accepts exactly 256 KB", async () => {
    const { fake, handlers } = boot();
    await fetchEvent(handlers, share({ text: "z".repeat(256 * 1024) }));
    expect(fake.store.get(SHARE_CACHE)?.get(SHARE_KEY)).toHaveLength(256 * 1024);
  });

  it("stores nothing when the share has no content, and still redirects", async () => {
    const { fake, handlers } = boot();
    const response = await fetchEvent(handlers, share({}));
    expect(response?.status).toBe(303);
    expect(fake.store.get(SHARE_CACHE)?.has(SHARE_KEY) ?? false).toBe(false);
  });

  it("survives a body that is not a form", async () => {
    const { handlers } = boot();
    const response = await fetchEvent(handlers, {
      method: "POST",
      url: "https://app.test/gym/share",
      formData: async () => {
        throw new TypeError("not a form");
      },
    });
    expect(response?.status).toBe(303);
  });

  it("answers no other POST, and no POST to another origin or path", async () => {
    const { handlers } = boot();
    expect(await fetchEvent(handlers, { ...share({ text: "x" }), url: "https://app.test/api/gym/workouts" })).toBeNull();
    expect(await fetchEvent(handlers, { ...share({ text: "x" }), url: "https://evil.test/gym/share" })).toBeNull();
  });

  it("keeps the share inbox when it clears old caches on activate", async () => {
    const { fake, handlers } = boot({
      "shell-v0": { a: "1" },
      "shell-v1": { a: "1" },
      "assets-v1": { a: "1" },
      [SHARE_CACHE]: { [SHARE_KEY]: "waiting" },
    });
    let finished: Promise<unknown> = Promise.resolve();
    handlers["activate"]?.({ waitUntil: (promise: Promise<unknown>) => (finished = promise) });
    await finished;
    expect([...fake.store.keys()].sort()).toEqual(["assets-v1", SHARE_CACHE, "shell-v1"].sort());
  });
});
