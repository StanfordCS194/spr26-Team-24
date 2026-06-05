// Nexa service worker — offline app shell + static asset caching.
// Part of the PWA work (issue #41). Pairs with the web app manifest and the
// offline report queue (src/lib/offline-queue.ts), which replays queued POSTs
// from the page on reconnect rather than here.

const CACHE = "nexa-v2";
const OFFLINE_URLS = ["/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(OFFLINE_URLS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin GETs; never cache API traffic, POSTs, or React
  // Server Component data requests. RSC fetches (router.refresh, client
  // navigations) must always hit the network — caching them serves stale
  // pages after mutations like deleting a report.
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api") ||
    request.headers.get("RSC") === "1" ||
    url.searchParams.has("_rsc")
  ) {
    return;
  }

  // Navigations: network-first, fall back to the cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match("/")),
        ),
    );
    return;
  }

  // Only static build output / public files get stale-while-revalidate;
  // everything else falls through to the network untouched so dynamic data
  // stays fresh.
  const isStaticAsset =
    url.pathname.startsWith("/_next/static/") ||
    /\.(?:css|js|mjs|woff2?|ttf|otf|png|jpe?g|gif|svg|webp|ico)$/.test(
      url.pathname,
    );
  if (!isStaticAsset) {
    return;
  }

  // Static assets: stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
