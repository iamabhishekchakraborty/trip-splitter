/**
 * Service worker for the installable app. `src/main.jsx` registers it
 * in production builds only. Its job is to let the app shell start
 * without a network connection; it never handles data requests.
 *
 * - install: precaches the files in `APP_SHELL` and activates at once
 *   (`skipWaiting`).
 * - activate: deletes caches left by any other `CACHE_VERSION` and takes
 *   control of open pages immediately (`clients.claim`).
 * - fetch: only same-origin GET requests are handled. Supabase API and
 *   auth calls, and every non-GET request, go straight to the network
 *   untouched. Handled requests are network-first: while online the
 *   response always comes from the network (so a new deploy's hashed
 *   JS/CSS is picked up immediately) and a copy is stored; if the
 *   network fails, the stored copy is served, and a page navigation
 *   with no stored copy gets the cached `/index.html`.
 *
 * Because every same-origin GET response is stored - not just the
 * `APP_SHELL` list - a visit while online also caches the built JS and
 * CSS, which is what lets the app start offline afterwards. Responses
 * are stored without checking `response.ok`, and the cache is only
 * cleaned when `CACHE_VERSION` changes, so files from earlier deploys
 * pile up until then.
 *
 * Bump `CACHE_VERSION` whenever `APP_SHELL` changes (see the README).
 */

// Trip Splitter — app shell service worker
// Scope: cache the static app shell only. Never touches API/auth calls.
/** Name of the current cache. Changing it makes `activate` delete every older cache. */
const CACHE_VERSION = 'trip-splitter-shell-v2';

/** Files fetched and cached when the worker installs: the page itself, the manifest and the icons. */
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

  // Network first: while online every response comes from the network, so the app
  // shell is always fresh (a new deploy's hashed JS/CSS is never shadowed by an old
  // cached copy). Each response is also stored, and the stored copy is used only
  // when the network fails.
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