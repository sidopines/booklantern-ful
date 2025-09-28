/* BookLantern Service Worker
   Scope: root (served at /sw.js by server.js)
*/
const SW_VERSION = 'bl-v1-2025-09-28';
const APP_SHELL = [
  '/',                       // homepage
  '/about',
  '/contact',
  '/public/css/site.css',
  '/public/js/ui.js',
  '/public/logo.svg',
  '/favicon.ico',
  '/apple-touch-icon.png',
  '/favicon-32x32.png',
  '/favicon-16x16.png',
  '/site.webmanifest',
  '/public/offline.html'
];

// Install: pre-cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SW_VERSION).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      await Promise.all(keys.map((k) => (k !== SW_VERSION ? caches.delete(k) : null)));
    })
  );
  self.clients.claim();
});

// Helpers
const isHTMLNavigation = (req) =>
  req.mode === 'navigate' ||
  (req.method === 'GET' &&
   req.headers.get('accept') &&
   req.headers.get('accept').includes('text/html'));

// Runtime strategies:
//  - HTML pages: Network first, fallback to cache, then offline page
//  - Static assets: Cache first, then network
//  - API/proxy: Stale-while-revalidate (cache then update)
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Ignore non-GET
  if (req.method !== 'GET') return;

  // HTML navigations
  if (isHTMLNavigation(req)) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(SW_VERSION);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        const cache = await caches.open(SW_VERSION);
        const cached = await cache.match(req);
        return cached || cache.match('/public/offline.html');
      }
    })());
    return;
  }

  // Static assets (same-origin /public, favicons, manifest)
  if (url.origin === location.origin &&
      (url.pathname.startsWith('/public/') ||
       url.pathname.startsWith('/favicon') ||
       url.pathname === '/apple-touch-icon.png' ||
       url.pathname === '/site.webmanifest')) {
    event.respondWith((async () => {
      const cache = await caches.open(SW_VERSION);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const net = await fetch(req);
        cache.put(req, net.clone());
        return net;
      } catch {
        return new Response('', { status: 504 });
      }
    })());
    return;
  }

  // API/proxy (stale-while-revalidate)
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/proxy')) {
    event.respondWith((async () => {
      const cache = await caches.open(SW_VERSION);
      const cached = await cache.match(req);
      const fetchPromise = fetch(req)
        .then((net) => {
          cache.put(req, net.clone());
          return net;
        })
        .catch(() => null);
      return cached || (await fetchPromise) || new Response('', { status: 504 });
    })());
    return;
  }
});
