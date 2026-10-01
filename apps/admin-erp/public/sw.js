// Minimal service worker: makes the phone app installable. Data is always fetched live
// (stock and tasks must never come from a stale cache); only the app shell is cached for start-up.
const CACHE = "jst-shell-v1";
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/m", "/manifest.webmanifest", "/icon-192.png"])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  // pages: network first, fall back to the cached shell when offline
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("/m")));
  }
});
