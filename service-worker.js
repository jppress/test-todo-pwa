/* Todo Orchestrator PWA service worker
 * - 앱 셸: 캐시 우선(cache-first)
 * - todo.json / node_registry.json 등 데이터: 네트워크 우선(network-first), 실패 시 캐시 폴백
 */
const CACHE = 'claude-todo-v2.2.0'
const SHELL = ['./', './index.html', './manifest.json', './icon-192.svg', './icon-512.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  // Google API/OAuth 요청은 SW가 가로채지 않음
  if (url.hostname.includes('googleapis.com') || url.hostname.includes('google.com')) return

  const isData = url.pathname.endsWith('.json') && !url.pathname.endsWith('manifest.json')

  if (isData) {
    // 네트워크 우선 → 실패 시 캐시
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(request, copy))
          return res
        })
        .catch(() => caches.match(request)),
    )
  } else {
    // 앱 셸: 캐시 우선 → 없으면 네트워크
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request)))
  }
})
