const V = 'clearbloom-v10';
const FILES = ['./', 'index.html', 'style.css', 'manifest.webmanifest', 'js/main.js', 'js/difficulty.js', 'js/pieces.js', 'js/ads.js', 'js/analytics.js', 'js/audio.js', 'js/haptics.js', 'js/scoring.js', 'js/rng.js', 'js/brand.js', 'js/sprites.js', 'js/progress.js', 'js/cosmetics.js', 'js/names.js', 'js/firebase-config.js', 'js/accounts.js', 'js/leaderboards.js', 'js/challenges.js', 'js/store.js', 'js/vendor/firebase-app-compat.js', 'js/vendor/firebase-auth-compat.js', 'js/vendor/firebase-firestore-compat.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon.svg'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(V).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // Firebase auth handler requests must NEVER be served from cache (or
  // cached): the sign-in redirect state lives in sessionStorage and the
  // handler response is single-use. Let them go straight to the network.
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/__/auth/') || url.pathname.startsWith('/__/firebase/')) return;
  e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(V).then((c) => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request)));
});
