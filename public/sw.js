// Trip Splitter — app shell service worker
// Scope: cache the static app shell only. Never touches API/auth calls.
const CACHE_VERSION = 'trip-splitter-shell-v2';

const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/favicon-192.png',
  '/favicon-512.png',
  '/maskable-icon-192.png',
  '/maskable-icon-512.png',
  '/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only ever handle same-origin GET requests.
  // Anything else (Supabase API/auth calls, POST/PUT/DELETE, fonts CDN, etc.)
  // passes straight through to the network, untouched by the cache.
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) {
    return;
  }

  // Never cache Vite dev/build JS chunks by a stale hash — always try network first,
  // fall back to cache only if offline. This keeps the app shell fresh when online
  // while still working when there's no connection at all.
  event.respondWith(
    fetch(request)
      .then((response) => {
        const responseClone = response.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(request, responseClone));
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => {
          if (cached) return cached;
          // Only fall back to the app shell HTML for page navigations.
          // A missing JS/CSS chunk should fail cleanly, not silently return HTML.
          if (request.mode === 'navigate') return caches.match('/index.html');
          return undefined;
        })
      )
  );
});