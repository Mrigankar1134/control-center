/*
 * Neural Control service worker.
 *
 * Hand-written rather than generated, because the caching rules here are
 * safety-critical: this dashboard triggers real automation, so nothing under
 * /api is ever served from a cache. Stale schedule rows or a replayed dispatch
 * response would be worse than an offline error.
 *
 * Bump CACHE_VERSION to retire every previous cache on the next activation.
 */

const CACHE_VERSION = "v1";
const STATIC_CACHE = `neural-static-${CACHE_VERSION}`;
const SHELL_CACHE = `neural-shell-${CACHE_VERSION}`;

const PRECACHE = ["/offline", "/manifest.json", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // A single missing asset must not fail the whole install.
      .then((cache) =>
        Promise.allSettled(PRECACHE.map((url) => cache.add(url))),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== STATIC_CACHE && key !== SHELL_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/** Immutable build output — safe to serve from cache first. */
function isImmutable(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/")
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache the API, and never intercept the SSE stream — a buffered
  // response would defeat the live terminal entirely.
  if (url.pathname.startsWith("/api/")) return;
  if (request.headers.get("accept") === "text/event-stream") return;

  if (isImmutable(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  if (request.mode === "navigate") {
    // Network-first: the dashboard must never open showing yesterday's page.
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached ?? (await caches.match("/offline")) ?? Response.error();
        }),
    );
  }
});
