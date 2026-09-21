// 같은 origin 의 todo PWA 캐시를 건드리지 않도록 naeba-shell- 접두사만 정리. 앱 셸만 캐시(네트워크 우선, 실패 시 캐시). API·Drive·config 는 절대 캐시하지 않는다.
const CACHE = "naeba-shell-v1";
const SHELL = ["./", "./index.html", "./app.js", "./style.css", "./menus.json", "./manifest.json", "./icon.svg"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("naeba-shell-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.includes("/api/") || u.pathname.endsWith("config.js")) return;
  e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request)));
});
