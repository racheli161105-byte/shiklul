/**
 * Service worker: makes Shiklul work offline and installable.
 * - App files: cache-first (bump VERSION when you change them, so users get the update)
 * - Google Fonts: stale-while-revalidate
 */
const VERSION = "shiklul-v4";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./app.js",
  "./utils.js",
  "./store.js",
  "./charts.js",
  "./favicon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith("shiklul-") && k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // fonts: serve from cache right away, refresh in the background
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(
      caches.open(VERSION + "-fonts").then(async cache => {
        const cached = await cache.match(request);
        const network = fetch(request).then(res => { if (res.ok) cache.put(request, res.clone()); return res; }).catch(() => cached);
        return cached || network;
      }),
    );
    return;
  }

  if (url.origin !== location.origin) return;

  // navigations: always fall back to the cached app when offline
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("./index.html")));
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(res => {
      // clone right away: the body can only be read once, and the page reads it first
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(cache => cache.put(request, copy)); }
      return res;
    })),
  );
});
