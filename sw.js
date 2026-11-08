/* Offline cache. Bump VERSION every time you upload a new build. */
const VERSION = "cc-v36";
const FILES = [
  "./", "index.html", "manifest.json",
  "dx/dailyxcellence.css", "css/change-check.css",
  "dx/fonts/magistral-bold-italic.woff2", "dx/fonts/nhd-light.woff2", "dx/fonts/nhd-light-italic.woff2",
  "dx/fonts/nhd-medium.woff2", "dx/fonts/nhd-bold.woff2",
  "js/vendor/supabase.js", "js/data.js", "js/app.js",
  "assets/logo.png", "assets/icon-180.png", "assets/icon-192.png", "assets/icon-512.png", "assets/icon-maskable-512.png"
];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  // Supabase (login, saving) always goes straight to the network: never cached, never answered with index.html.
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  // The admin dashboard and ?dashboard always load fresh from the network (never an old cached copy).
  if (url.pathname.includes("/admin/") || url.pathname.endsWith("/admin") || url.searchParams.has("dashboard")) return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok && new URL(e.request.url).origin === location.origin) {
        const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match("index.html")))
  );
});
