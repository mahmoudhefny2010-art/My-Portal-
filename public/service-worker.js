const CACHE_NAME = 'control-portal-static-v3';
const STATIC_ASSETS = [
  '/offline.html',
  '/manifest.webmanifest',
  '/css/portal-v2.css',
  '/js/theme-bootstrap.js',
  '/js/portal.js',
  '/js/pwa-register.js',
  '/icons/control-portal-192.png',
  '/icons/control-portal-512.png',
  '/icons/portal-logo-dark.svg',
  '/icons/portal-logo-light.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.filter((name) => name.startsWith('control-portal-') && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/offline.html')));
    return;
  }

  if (url.pathname.endsWith('.css')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cacheKey = new URL(url.pathname, self.location.origin).toString();
      try {
        const response = await fetch(request, { cache: 'no-cache' });
        if (response.ok) await cache.put(cacheKey, response.clone());
        return response;
      } catch {
        return (await cache.match(cacheKey)) || new Response('Stylesheet unavailable offline.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
    })());
    return;
  }

  if (!STATIC_ASSETS.includes(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cacheKey = new URL(url.pathname, self.location.origin).toString();
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) await cache.put(cacheKey, response.clone());
    return response;
  })());
});
