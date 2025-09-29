/* BookLantern Service Worker */
const SW_VERSION = 'bl-v2-2025-09-29';
const APP_SHELL = [
  '/',
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

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SW_VERSION).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => (k !== SW_VERSION ? caches.delete(k) : null))))
  );
  self.clients.claim();
});

const isHTMLNavigation = (req) =>
  req.mode === 'navigate' ||
  (req.method === 'GET' &&
   req.headers.get('accept') &&
   req.headers.get('accept').includes('text/html'));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET') return;

  // Cache-first for static
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

  // Cache /read/* navigations (so user can resume offline)
  if (isHTMLNavigation(req) || url.pathname.startsWith('/read/')) {
    event.respondWith((async () => {
      try {
        const net = await fetch(req);
        const cache = await caches.open(SW_VERSION);
        cache.put(req, net.clone());
        return net;
      } catch {
        const cache = await caches.open(SW_VERSION);
        const cached = await cache.match(req);
        return cached || cache.match('/public/offline.html');
      }
    })());
    return;
  }

  // API/proxy: stale-while-revalidate
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/proxy')) {
    event.respondWith((async () => {
      const cache = await caches.open(SW_VERSION);
      const cached = await cache.match(req);
      const fetchPromise = fetch(req)
        .then((net) => { cache.put(req, net.clone()); return net; })
        .catch(() => null);
      return cached || (await fetchPromise) || new Response('', { status: 504 });
    })());
    return;
  }
});

// Background Sync: ask clients to flush their offline queue
self.addEventListener('sync', (event) => {
  if (event.tag === 'bl-sync') {
    event.waitUntil((async () => {
      const clientsArr = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
      for (const client of clientsArr) {
        client.postMessage({ type: 'BL_SYNC' });
      }
    })());
  }
});
