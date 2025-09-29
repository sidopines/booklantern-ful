/* BookLantern Service Worker (FINAL) */
const SW_VERSION = 'bl-v3-2025-09-29';

const APP_SHELL = [
  '/',               // homepage
  '/about',
  '/contact',
  '/public/css/site.css',
  '/public/js/ui.js',
  '/public/js/theme.js',
  '/public/logo.svg',
  '/favicon.ico',
  '/favicon-16x16.png',
  '/favicon-32x32.png',
  '/apple-touch-icon.png',
  '/site.webmanifest',
  '/public/offline.html'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SW_VERSION).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== SW_VERSION ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

function isHTMLNavigation(req) {
  return (
    req.mode === 'navigate' ||
    (req.method === 'GET' &&
      req.headers.get('accept') &&
      req.headers.get('accept').includes('text/html'))
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;

  // Cache-first for our static assets
  if (
    url.origin === location.origin &&
    (url.pathname.startsWith('/public/') ||
      url.pathname.startsWith('/favicon') ||
      url.pathname === '/apple-touch-icon.png' ||
      url.pathname === '/site.webmanifest')
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SW_VERSION);
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const net = await fetch(req);
          cache.put(req, net.clone());
          return net;
        } catch {
          return new Response('', { status: 504 });
        }
      })()
    );
    return;
  }

  // Cache /read/* navigations for offline resume
  if (isHTMLNavigation(req) || url.pathname.startsWith('/read/')) {
    event.respondWith(
      (async () => {
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
      })()
    );
    return;
  }

  // Stale-while-revalidate for API/proxy
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/proxy')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SW_VERSION);
        const cached = await cache.match(req);
        const fetchPromise = fetch(req)
          .then((net) => {
            cache.put(req, net.clone());
            return net;
          })
          .catch(() => null);
        return cached || (await fetchPromise) || new Response('', { status: 504 });
      })()
    );
    return;
  }
});

// Background Sync: notify clients to flush offline queue if any
self.addEventListener('sync', (event) => {
  if (event.tag === 'bl-sync') {
    event.waitUntil(
      (async () => {
        const clientsArr = await self.clients.matchAll({
          includeUncontrolled: true,
          type: 'window'
        });
        for (const client of clientsArr) {
          client.postMessage({ type: 'BL_SYNC' });
        }
      })()
    );
  }
});
