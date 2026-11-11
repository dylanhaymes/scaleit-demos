const V = 'clearbloom-v3';
const FILES = ['./', 'index.html', 'style.css', 'manifest.webmanifest', 'js/main.js', 'js/difficulty.js', 'js/pieces.js', 'js/ads.js', 'js/analytics.js', 'js/audio.js', 'js/haptics.js', 'js/scoring.js', 'js/rng.js', 'js/brand.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon.svg'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(V).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => { if (e.request.method !== 'GET') return; e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(V).then((c) => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request))); });
