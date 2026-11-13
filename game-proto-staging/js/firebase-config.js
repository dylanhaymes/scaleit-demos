// Clearbloom Firebase config (Update 3) — LIVE project "Clearbloom"
// (project ID clearbloom-game, Spark free plan, created Nov 12, 2026).
// These values are PUBLIC CLIENT IDENTIFIERS: they ship in the app and are
// how the game finds its own backend. They are NOT secrets — there is no
// service-account key anywhere in this repo, and there never should be.
// What is enabled in the console: Google + Anonymous auth, Firestore
// (production mode, deny-by-default rules — firestore.rules in the repo
// is the intended rule set, deployment is a separate step).
// What is NOT enabled: the Facebook provider (needs the Meta App Secret,
// unavailable) — FACEBOOK_PROVIDER_ENABLED stays false and the Facebook
// sign-in button stays disabled until the provider exists.
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyB63ANMDcrI9vscAkdBwk5kQzwCeVgRrJU',
  authDomain: 'clearbloom-game.web.app',
  projectId: 'clearbloom-game',
  storageBucket: 'clearbloom-game.firebasestorage.app',
  messagingSenderId: '22723297343',
  appId: '1:22723297343:web:9212d97a62cea95d9e788a',
};

// Exactly these six keys — accounts.js and the tests both rely on the shape.
export function isFirebaseConfigured() {
  return Object.values(FIREBASE_CONFIG).every((v) => typeof v === 'string' && v.length > 0 && v !== 'TODO');
}

// Facebook sign-in is built but DISABLED until the provider is configured
// in the Firebase console. Never flip this to true without the provider
// in place — signInFacebook() refuses while this is false.
export const FACEBOOK_PROVIDER_ENABLED = false;

// Firebase JS SDK (compat builds, SELF-HOSTED in js/vendor/ — downloaded
// from Google's CDN once, version-pinned 10.12.2, and shipped with the
// game). Self-hosted on purpose: the game never depends on reaching
// gstatic.com at sign-in time, the SDK works offline once cached, and no
// player's network can block sign-in. accounts.js loads these lazily via
// dynamic import — only when a player signs in or returns with a session;
// guests never load them. To upgrade: replace the three files in
// js/vendor/ and bump FIREBASE_SDK_VERSION below.
export const FIREBASE_SDK_VERSION = '10.12.2';
export const FIREBASE_SDK_URLS = {
  app: './vendor/firebase-app-compat.js',
  auth: './vendor/firebase-auth-compat.js',
  firestore: './vendor/firebase-firestore-compat.js',
};
