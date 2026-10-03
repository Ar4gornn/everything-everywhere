/* Service worker (Story 8.1).
 *
 * Hand-rolled rather than pulled from a plugin, for the same reason the charts are: what it
 * has to do is small, and a caching bug in a finance app shows someone stale money.
 *
 * The rules, and why each one is what it is:
 *
 *   /api/*        NEVER touched. Not cached, not intercepted, no offline fallback. Two
 *                 reasons. It is financial data behind a bearer token, and a cache would
 *                 outlive the sign-out that was supposed to remove it. And a stale balance
 *                 presented as current is worse than an honest error.
 *
 *   navigations   Network first, falling back to the cached shell. So the app opens offline
 *                 and says so, instead of showing the browser's dinosaur.
 *
 *   POST /gym/share  The Web Share Target (Epic 42): a workout file shared to the installed
 *                 app from another app. The only POST the worker answers. It reads the form,
 *                 keeps the file's text (or the shared text) in a cache of its own and
 *                 redirects to the import page, which reads it back with `takeSharedWorkout`
 *                 and deletes it. Capped at 256 KB; nothing in it is evaluated here — the
 *                 page parses it. It is the one thing the worker stores that a person typed,
 *                 which is why it has its own cache name, is removed on read, and is kept
 *                 across updates (an update must not eat a file waiting to be imported).
 *
 *   static assets Cache first. Safe *only* because Vite content-hashes these filenames — a
 *                 changed file is a new URL, so a cached one can never be stale.
 *
 * There is deliberately no precache manifest. Hashed filenames change every build, so
 * maintaining a list by hand is a standing source of 404s on deploy; runtime caching gets
 * the same result without the list.
 */

const VERSION = "v1";
const SHELL = `shell-${VERSION}`;
const ASSETS = `assets-${VERSION}`;
const SHARE_INBOX = "share-inbox";
const SHARE_KEY = "/__share/gym";
const SHARE_MAX_BYTES = 256 * 1024;
const SHARE_URL = "/gym/share";
const SHELL_URL = "/index.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.add(new Request(SHELL_URL, { cache: "reload" })))
      // Take over without waiting for every tab to close. Paired with skipWaiting below,
      // this is what stops an old worker serving an old shell for days.
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name !== SHELL && name !== ASSETS && name !== SHARE_INBOX)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// A multipart body carries a little framing around the file itself.
const SHARE_OVERHEAD_BYTES = 300 * 1024;

async function receiveShare(request) {
  let text = "";
  let refused = false;
  const headers = request.headers;
  const header = (name) => (headers && typeof headers.get === "function" ? headers.get(name) : null);
  // A share comes from the OS share sheet (Sec-Fetch-Site: none) or this origin. A page on
  // another site posting here is not a share: keep nothing, say nothing.
  const site = header("Sec-Fetch-Site");
  if (site && site !== "same-origin" && site !== "none") {
    return Response.redirect(new URL("/gym/import", self.location.origin).href, 303);
  }
  // Refuse on the declared size before a single byte is buffered into memory.
  const declared = Number(header("Content-Length"));
  if (Number.isFinite(declared) && declared > SHARE_MAX_BYTES + SHARE_OVERHEAD_BYTES) {
    return Response.redirect(new URL("/gym/import?shared=1&refused=1", self.location.origin).href, 303);
  }
  try {
    const form = await request.formData();
    const file = form.getAll("file").find((item) => typeof item !== "string");
    if (file) {
      // Size is checked before the bytes are read into a string.
      if (file.size > SHARE_MAX_BYTES) refused = true;
      else text = await file.text();
    } else {
      const shared = form.get("text");
      if (typeof shared === "string") text = shared;
    }
    if (new Blob([text]).size > SHARE_MAX_BYTES) refused = true;
  } catch {
    // A body that is not a form, or a file that would not read: nothing to keep.
    text = "";
  }
  if (!refused && text !== "") {
    const cache = await caches.open(SHARE_INBOX);
    await cache.put(
      SHARE_KEY,
      new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8" } }),
    );
  }
  // 303: the browser follows with a GET, which is the import page's route (a navigation,
  // served by the shell below). `refused=1` lets the page say "too large" instead of "nothing".
  const to = refused ? "/gym/import?shared=1&refused=1" : "/gym/import?shared=1";
  return Response.redirect(new URL(to, self.location.origin).href, 303);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Before the GET-only return below: a share is a POST.
  if (request.method === "POST" && url.origin === self.location.origin && url.pathname === SHARE_URL) {
    event.respondWith(receiveShare(request));
    return;
  }

  if (request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;

  // The API and the health endpoint are the server's business, never the cache's.
  if (url.pathname.startsWith("/api/") || url.pathname === "/health") return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Keep the shell fresh whenever the network is available. AD-66: only an ok,
          // non-opaque response without X-EE-Page. A landing page or an error page must
          // never become the offline app shell, or the installed app opens onto it.
          if (response.ok && response.type !== "opaqueredirect" && !response.headers.get("X-EE-Page")) {
            const copy = response.clone();
            caches.open(SHELL).then((cache) => cache.put(SHELL_URL, copy));
          }
          return response;
        })
        .catch(() => caches.match(SHELL_URL).then((hit) => hit || Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((response) => {
        // Only cache what is safely cacheable: our own successful, complete responses.
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(ASSETS).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});

// Lets the page trigger an immediate update rather than waiting for a natural reload.
self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

// --------------------------------------------------------------- push (Epic 18)

// The payload is JSON the server built: {title, body, url}. It is treated as data, never
// as anything to evaluate — a notification body is plain text by definition.
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // A push with no body, or a body we did not send. Show nothing rather than a blank
    // notification: some platforms require *a* notification, but an empty one is worse.
    return;
  }
  if (!payload.body) return;

  event.waitUntil(
    self.registration.showNotification(payload.title || "Everything Everywhere", {
      body: payload.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      // One tag, so a second digest replaces the first instead of stacking up.
      tag: "everything-everywhere-digest",
      renotify: false,
      data: { url: payload.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";

  // Focus an open window if there is one rather than opening a second copy of the app.
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin) {
          return client.focus().then(() => client.navigate(target));
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
