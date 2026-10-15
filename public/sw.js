/* SubSweep service worker.
 * The version and the precache list are filled in at build time (see vite.config.ts and src/swBuild.ts), so
 * every build gets its own cache and old caches are removed on activate. Only the app shell is cached here:
 * user data lives in IndexedDB and is never touched by a cache update.
 *
 * A new worker waits instead of taking over (no automatic skipWaiting). The page shows an "Update available"
 * banner and sends SKIP_WAITING when the user chooses to reload, so an open form is never lost.
 */
const VERSION = '__VERSION__';
const PRECACHE = /*__PRECACHE__*/[];
const CACHE = 'subsweep-' + VERSION;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('subsweep-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const type = event.data && event.data.type;
  if (type === 'SKIP_WAITING') self.skipWaiting();
  if (type === 'GET_VERSION' && event.source) event.source.postMessage({ type: 'VERSION', version: VERSION });
});

async function put(request, response) {
  if (response && response.ok && response.type === 'basic') {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

// Hashed build output never changes for a given URL, so the cache wins.
async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  return put(request, await fetch(request));
}

// Navigations: fresh when online, the cached shell when offline (it is a single-page app).
async function navigate(request) {
  try {
    return await fetch(request);
  } catch (err) {
    return (await caches.match('/index.html')) || (await caches.match('/')) || Response.error();
  }
}

// Icons, manifest: answer from the cache and refresh it in the background.
async function staleWhileRevalidate(request) {
  const hit = await caches.match(request);
  const refresh = fetch(request).then((res) => put(request, res)).catch(() => hit);
  return hit || refresh;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname === '/sw.js') return;
  if (request.mode === 'navigate') event.respondWith(navigate(request));
  else if (url.pathname.startsWith('/assets/')) event.respondWith(cacheFirst(request));
  else event.respondWith(staleWhileRevalidate(request));
});
