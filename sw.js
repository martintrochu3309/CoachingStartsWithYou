/* Offline copy of the app. Bump VERSION every time you upload a new build.
   Network first: always try the newest files online, and keep a copy; the saved copy is only used with no signal.
   (Cache-first used to keep serving old files after an update, which could mix old and new files.) */
const VERSION = "cc-v51";
const FILES = [
  "./", "index.html", "manifest.json",
  "dx/dailyxcellence.css", "css/change-check.css",
  "dx/fonts/magistral-bold-italic.woff2", "dx/fonts/nhd-light.woff2", "dx/fonts/nhd-light-italic.woff2",
  "dx/fonts/nhd-medium.woff2", "dx/fonts/nhd-bold.woff2",
  "js/vendor/supabase.js", "js/data.js", "js/app.js",
  "assets/logo.png", "assets/icon-180.png", "assets/icon-192.png", "assets/icon-512.png", "assets/icon-maskable-512.png"
];
self.addEventListener("install", e => {
  // Never let one missing file stop the update.
  e.waitUntil(caches.open(VERSION).then(c => Promise.all(FILES.map(f => c.add(new Request(f, { cache: "reload" })).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  // Supabase (login, saving) always goes straight to the network: never cached, never answered with index.html.
  if (url.origin !== location.origin) return;
  // The admin dashboard and ?dashboard always load fresh from the network (never an old cached copy).
  if (url.pathname.includes("/admin/") || url.pathname.endsWith("/admin") || url.searchParams.has("dashboard")) return;
  e.respondWith(
    fetch(e.request, { cache: "no-cache" }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: e.request.mode === "navigate" })
      .then(hit => hit || (e.request.mode === "navigate" ? caches.match("index.html") : undefined))
      .then(hit => hit || Response.error()))
  );
});
