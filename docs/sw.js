/* Vanilla Creme Radio — Service Worker
 * Cacht nur die eigene App-Shell (same-origin). Radio-/Stream-Anfragen
 * (cross-origin) werden NIE abgefangen oder gecacht — sie laufen immer
 * direkt übers Netz, damit Live-Streams und die Radio-Browser-API
 * unangetastet bleiben. */
const CACHE = 'vcr-shell-v5';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Fremde Hosts (Radio-Browser-API, Audio-Streams, hearthis.at) niemals anfassen.
  if (url.origin !== self.location.origin) return;

  // Navigationsanfragen: Netzwerk zuerst, offline auf die App-Shell zurückfallen.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('./index.html')));
    return;
  }

  // Statische Assets: Netzwerk zuerst (damit Updates sofort ankommen),
  // offline auf den Cache zurückfallen.
  e.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req))
  );
});
