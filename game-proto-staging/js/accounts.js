// Clearbloom accounts (Update 3, batch 1) — sign-in state, local profile,
// display names, friend codes, privacy and account deletion.
//
// HOW IT WORKS
// - Guests play everything except social. A guest has a LOCAL identity only
//   (guestUid + friend code + display name, all in localStorage gb_profile).
//   Nothing leaves the device until the player signs in.
// - The Firebase compat SDK is self-hosted in js/vendor/ and loaded
//   lazily (dynamic import) only when a player signs in or returns with
//   a session — guests never load it, and the game works fully offline
//   in guest mode. EXCEPTION: a redirect sign-in (iOS, see
//   useRedirectAuth) reloads the page, so the SDK loads at boot when a
//   redirect is pending (localStorage gb_auth_redirect) to complete it.
//   Every sign-in call returns { ok: false, reason } instead of
//   throwing when the SDK can't load or the network is down. The UI
//   shows that plainly (authErrorMessage) instead of faking a sign-in.
// - The game NEVER depends on Firebase: every method is safe to call in
//   guest/local mode and never throws. Social features degrade gracefully
//   when signed out (batch 2: leaderboards show a "sign in to see friends"
//   state; batch 3: head-to-head needs a signed-in account).
// - Fairness: this module never touches difficulty, pieces, timer or
//   scoring, and nothing in it is imported by difficulty.js.
//
// FIRESTORE DATA MODEL (paths are fixed here so the rules file and the
// client agree; scores + challenges land in batch 2/3):
//   players/{uid}            { displayName, friendCode, hideFromGlobal,
//                              xp, games, best, provider, updatedAt }
//   scores_daily/{date}_{uid}  (batch 2) { uid, displayName, score, lines,
//                              maxCombo, date, hideFromGlobal, ts }
//   scores_weekly/{week}_{uid} (batch 2) { uid, displayName, score, week,
//                              hideFromGlobal, ts }
//   challenges/{id}            (batch 3) { fromUid, toUid, seed, mode,
//                              status, createdAt, expiresAt, scores: {} }
//   friendCodes/{code}         (add-friend-by-code) { uid, displayName,
//                              updatedAt } — public directory, one doc get
//                              per lookup; written right after the player
//                              doc sync below, deleted with the account.
import { FIREBASE_CONFIG, isFirebaseConfigured, FACEBOOK_PROVIDER_ENABLED, FIREBASE_SDK_URLS } from './firebase-config.js';
import { cleanDisplayName, nameIsClean, nameRejectMessage, defaultGuestName } from './names.js';
import { Analytics } from './analytics.js';

export const PROFILE_KEY = 'gb_profile';
export const COLLECTIONS = {
  players: 'players',
  scoresDaily: 'scores_daily',
  scoresWeekly: 'scores_weekly',
  challenges: 'challenges',
  friendCodes: 'friendCodes',
};
// Local keys wiped by account deletion (identity + progress, not settings:
// music/sfx/haptics/motion + the tutorial flag are device preferences).
export const ACCOUNT_DATA_KEYS = ['gb_profile', 'gb_xp', 'gb_games', 'gb_best', 'gb_history', 'gb_daily_best', 'gb_save', 'gb_events'];

const FRIEND_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
const FRIEND_CODE_LEN = 6;

// Set just before a redirect sign-in starts; cleared once the result is
// handled at boot. Lets init() know the SDK must load to complete it.
export const REDIRECT_FLAG = 'gb_auth_redirect';

// iOS Safari and standalone web apps (Add to Home Screen) cannot do
// pop-up sign-in: a standalone app has no window to host the Firebase
// pop-up, and mobile Safari blocks pop-ups by default — signInWithPopup
// fails there with auth/popup-blocked (Dylan, Nov 12: Google sign-in
// dead on his iPhone home-screen app). Those environments use the
// redirect flow instead (signInWithRedirect + getRedirectResult);
// desktop browsers keep the pop-up. `env` is injectable for tests.
export function useRedirectAuth(env) {
  const nav = (env && env.navigator) || (typeof navigator !== 'undefined' ? navigator : {});
  const standalone = (env && 'standalone' in env) ? env.standalone === true : nav.standalone === true;
  let displayStandalone = false;
  try {
    displayStandalone = (env && 'displayMode' in env) ? env.displayMode === 'standalone'
      : (typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone)').matches);
  } catch {}
  const ua = (env && 'userAgent' in env) ? env.userAgent : (nav.userAgent || '');
  return standalone === true || displayStandalone || /iPad|iPhone|iPod/.test(ua);
}

// Plain-language sign-in errors for the UI. Never show raw Firebase
// codes to the player — every reason maps to something actionable.
export function authErrorMessage(code) {
  switch (code) {
    case 'auth/popup-blocked': return 'Your browser blocked the sign-in window — allow pop-ups for this site, then tap again.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request': return 'Sign-in was closed before it finished — tap again to retry.';
    case 'auth/unauthorized-domain': return 'Google sign-in isn\u2019t set up for this site yet. The game team needs to add this site in the Firebase console, then it will work.';
    case 'auth/network-request-failed': return 'No connection — check you\u2019re online and try again.';
    case 'auth/operation-not-supported-in-this-environment': return 'This browser can\u2019t open the sign-in window — try again from Safari.';
    case 'auth/account-exists-with-different-credential':
    case 'auth/credential-already-in-use':
    case 'auth/email-already-in-use': return 'That Google account is already linked a different way — try the other sign-in option.';
    case 'auth/user-cancelled': return 'Sign-in was cancelled — tap again to retry.';
    case 'auth/invalid-credential': return 'That sign-in didn\u2019t work — try again.';
    case 'facebook-not-configured': return 'Facebook sign-in isn\u2019t set up yet.';
    case 'not-configured': return 'Sign-in isn\u2019t set up yet — the game is still being set up. Keep playing as a guest.';
    default: return 'Couldn\u2019t sign in — try again.';
  }
}

function makeLocalUid() {
  let s = '';
  const rnd = new Uint32Array(3);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(rnd);
  else for (let i = 0; i < 3; i++) rnd[i] = Math.floor(Math.random() * 0xffffffff);
  for (const n of rnd) s += n.toString(36);
  return 'guest-' + s.slice(0, 12);
}
export function makeFriendCode() {
  let code = '';
  const rnd = new Uint32Array(FRIEND_CODE_LEN);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(rnd);
  else for (let i = 0; i < FRIEND_CODE_LEN; i++) rnd[i] = Math.floor(Math.random() * 0xffffffff);
  for (let i = 0; i < FRIEND_CODE_LEN; i++) code += FRIEND_ALPHABET[rnd[i] % FRIEND_ALPHABET.length];
  return code;
}
function readLocalProgress() {
  return {
    xp: +localStorage.getItem('gb_xp') || 0,
    games: +localStorage.getItem('gb_games') || 0,
    best: +localStorage.getItem('gb_best') || 0,
  };
}

export const Accounts = {
  profile: null, // { guestUid, cloudUid, provider, displayName, friendCode, hideFromGlobal, createdAt }
  fb: null, // { auth, db, user } once Firebase is loaded + a user exists (or auth ready)
  _loading: null,
  _authWired: false, // the auth singleton keeps one listener for the page lifetime
  _listeners: new Set(),
  _redirectError: null, // last redirect sign-in failure code, for the panel to explain

  get configured() { return isFirebaseConfigured(); },
  get facebookEnabled() { return FACEBOOK_PROVIDER_ENABLED; },
  // 'guest' | 'anonymous' | 'google' | 'facebook'
  get status() { return this.profile ? this.profile.provider : 'guest'; },
  get signedIn() { return !!this.profile?.cloudUid; },
  // A preview identity (setAccountPreview test hook, cloudUid 'preview-*')
  // is UI-only: no live session, so it must never trigger a Firebase load
  // (fetchBoard/submitScore would load the SDK for a fetch that cannot
  // succeed). Real sign-in flows do not use this path.
  get isPreview() { return !!this.profile?.cloudUid && String(this.profile.cloudUid).startsWith('preview-'); },
  get uid() { return this.profile?.cloudUid || this.profile?.guestUid || null; },
  get displayName() { return this.profile?.displayName || defaultGuestName(); },
  get friendCode() { return this.profile?.friendCode || ''; },
  get hideFromGlobal() { return !!this.profile?.hideFromGlobal; },

  onChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); },
  _notify() { for (const fn of this._listeners) { try { fn(this.debugState()); } catch {} } },

  loadProfile() {
    try {
      const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
      if (p && typeof p.guestUid === 'string' && typeof p.friendCode === 'string') return p;
    } catch {}
    return null;
  },
  saveProfile() {
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(this.profile)); } catch {}
  },
  freshGuestProfile() {
    return {
      guestUid: makeLocalUid(), cloudUid: null, provider: 'guest',
      displayName: defaultGuestName(), friendCode: makeFriendCode(),
      hideFromGlobal: false, createdAt: Date.now(),
    };
  },

  // Never throws. The SDK loads at boot ONLY for a returning signed-in
  // player (their cloudUid is in the local profile) so their session
  // restores — plus when a redirect sign-in is pending (see
  // useRedirectAuth): the redirect reloads the page, so the SDK must
  // load at boot to complete it. Guests never pay for the SDK at boot
  // otherwise — it loads on the first sign-in attempt instead
  // (ensureFirebase).
  async init() {
    this.profile = this.loadProfile() || this.freshGuestProfile();
    this.saveProfile();
    let pendingRedirect = false;
    try { pendingRedirect = localStorage.getItem(REDIRECT_FLAG) === '1'; } catch {}
    if (isFirebaseConfigured() && (this.profile.cloudUid || pendingRedirect)) {
      await this._loadFirebase();
    }
    return null;
  },

  // Load the self-hosted compat SDKs (js/vendor/) and wire auth state.
  // Only ever called when a real config is present. Concurrent callers
  // share one load. Returns { auth, db } or null. Never throws.
  async _loadFirebase() {
    if (this.fb) return this.fb;
    if (this._loading) return this._loading;
    this._loading = (async () => {
      try {
        const g = window.firebase;
        if (!g || !g.apps) {
          await import(FIREBASE_SDK_URLS.app);
          await import(FIREBASE_SDK_URLS.auth);
          await import(FIREBASE_SDK_URLS.firestore);
        }
        const firebase = window.firebase;
        if (!firebase || !firebase.auth || !firebase.firestore) return null;
        if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
        const auth = firebase.auth();
        const db = firebase.firestore();
        this.fb = { auth, db, user: auth.currentUser || null };
        // firebase.auth() is a singleton per app: wire the listener once
        // for the page lifetime, even if this.fb is later reset (delete).
        if (!this._authWired) {
          auth.onAuthStateChanged((user) => this._onAuth(user));
          this._authWired = true;
        }
        // Complete a redirect sign-in started before the reload (iOS
        // standalone). Runs before the currentUser adoption below so a
        // just-returned user is picked up either way.
        await this._handleRedirectResult(auth);
        if (auth.currentUser) await this._onAuth(auth.currentUser);
        return this.fb;
      } catch { return null; }
    })();
    const out = await this._loading;
    this._loading = null;
    return out;
  },
  // Finish a redirect sign-in (see useRedirectAuth). Clears the pending
  // flag either way. Never throws. When the redirect failed, the reason
  // is kept on _redirectError so the account panel can say so plainly
  // instead of failing silently.
  async _handleRedirectResult(auth) {
    let pending = false;
    try { pending = localStorage.getItem(REDIRECT_FLAG) === '1'; } catch {}
    if (!pending || !auth || typeof auth.getRedirectResult !== 'function') return null;
    try { localStorage.removeItem(REDIRECT_FLAG); } catch {}
    try {
      const res = await auth.getRedirectResult();
      this._redirectError = null;
      return res;
    } catch (e) {
      const code = (e && e.code) || 'sign-in-failed';
      this._redirectError = code;
      // The Google account is already linked another way: sign in with
      // the credential from the failed redirect instead of losing it.
      if ((code === 'auth/credential-already-in-use' || code === 'auth/email-already-in-use' || code === 'auth/account-exists-with-different-credential') && e.credential && typeof auth.signInWithCredential === 'function') {
        try { await auth.signInWithCredential(e.credential); this._redirectError = null; } catch {}
      }
      return null;
    }
  },
  // Returns { auth, db } or null (no config / load failure / offline).
  async ensureFirebase() {
    if (!isFirebaseConfigured()) return null;
    return this._loadFirebase();
  },

  async _onAuth(user) {
    if (!user) {
      // Signed out: back to the guest identity. Local progress is untouched.
      // EXCEPT a preview identity (setAccountPreview, cloudUid 'preview-*'):
      // it has no live session by design, so the null auth event that fires
      // when the SDK loads must not wipe it — the preview is UI-only and
      // ends when the player signs out or reloads, never by this listener.
      if (this.profile?.cloudUid && String(this.profile.cloudUid).startsWith('preview-')) return;
      if (this.profile) { this.profile.cloudUid = null; this.profile.provider = 'guest'; this.saveProfile(); }
      if (this.fb) this.fb.user = null;
      this._notify();
      return;
    }
    const providerId = user.providerData && user.providerData.length ? user.providerData[0].providerId : null;
    const provider = user.isAnonymous ? 'anonymous' : providerId === 'google.com' ? 'google' : providerId === 'facebook.com' ? 'facebook' : 'google';
    if (this.fb) this.fb.user = user;
    if (this.profile) {
      this.profile.cloudUid = user.uid;
      this.profile.provider = provider;
      // Adopt the account's display name only when the local one is still
      // the default — a name the player chose themselves always wins.
      if (this.profile.displayName === defaultGuestName() && user.displayName) {
        const clean = cleanDisplayName(user.displayName);
        if (clean && nameIsClean(clean).ok) this.profile.displayName = clean;
      }
      this.saveProfile();
    }
    // Best-effort: merge local progress into the cloud player doc.
    try { await this._syncPlayerDoc(); } catch {}
    Analytics.log('account_signed_in', { provider });
    this._notify();
  },

  // Merge local progress (max wins per field) into players/{uid}. No-op
  // when signed out or unconfigured. Never throws.
  async _syncPlayerDoc() {
    const fb = await this.ensureFirebase();
    if (!fb || !fb.user || !this.profile) return { ok: false, reason: 'guest' };
    const p = readLocalProgress();
    const ref = fb.db.collection(COLLECTIONS.players).doc(fb.user.uid);
    const FieldValue = window.firebase?.firestore?.FieldValue;
    try {
      const snap = await ref.get();
      const cloud = snap.exists ? snap.data() : {};
      await ref.set({
        displayName: this.profile.displayName,
        friendCode: this.profile.friendCode,
        hideFromGlobal: this.hideFromGlobal,
        xp: Math.max(p.xp, cloud.xp || 0),
        games: Math.max(p.games, cloud.games || 0),
        best: Math.max(p.best, cloud.best || 0),
        provider: this.profile.provider,
        updatedAt: FieldValue ? FieldValue.serverTimestamp() : Date.now(),
      }, { merge: true });
      // Friend-code directory (public lookup for "add friend by code"):
      // friendCodes/{code} -> { uid, displayName, updatedAt }. Best
      // effort — a squatted code (someone else claimed it first) just
      // means lookup won't find this player by code; the player doc
      // above is the source of truth and is already saved. Display-name
      // changes flow through this same sync, so the entry stays current.
      try {
        await fb.db.collection(COLLECTIONS.friendCodes).doc(this.profile.friendCode).set({
          uid: fb.user.uid,
          displayName: this.profile.displayName,
          updatedAt: FieldValue ? FieldValue.serverTimestamp() : Date.now(),
        }, { merge: true });
      } catch {}
      return { ok: true };
    } catch (e) { return { ok: false, reason: 'sync-failed' }; }
  },

  // --- Sign-in (each returns { ok, reason? } and never throws) ---
  // When the player is anonymous, link first so their anonymous progress
  // carries into the provider account. If that provider account already
  // exists separately (link fails credential-already-in-use), fall back
  // to a plain sign-in — local progress merges into that account's doc
  // by max() in _onAuth, so nothing is lost.
  async _signInWithProvider(makeProvider) {
    const fb = await this.ensureFirebase();
    if (!fb) return { ok: false, reason: 'not-configured' };
    try {
      const provider = makeProvider();
      // iOS Safari / standalone web apps can't do pop-ups (Dylan, Nov 12:
      // Google sign-in dead on his iPhone home-screen app) — use the
      // redirect flow there. The page reloads; _handleRedirectResult at
      // boot completes it. Returns redirect-started (the page navigates
      // away, so the caller shows "opening" instead of "signed in").
      if (useRedirectAuth()) {
        try { localStorage.setItem(REDIRECT_FLAG, '1'); } catch {}
        if (fb.auth.currentUser && fb.auth.currentUser.isAnonymous) {
          await fb.auth.currentUser.linkWithRedirect(provider);
        } else {
          await fb.auth.signInWithRedirect(provider);
        }
        return { ok: true, reason: 'redirect-started' };
      }
      if (fb.auth.currentUser && fb.auth.currentUser.isAnonymous) {
        try {
          await fb.auth.currentUser.linkWithPopup(provider);
        } catch (linkErr) {
          if (linkErr && (linkErr.code === 'auth/credential-already-in-use' || linkErr.code === 'auth/email-already-in-use')) {
            await fb.auth.signInWithPopup(provider);
          } else throw linkErr;
        }
      } else await fb.auth.signInWithPopup(provider);
      return { ok: true };
    } catch (e) { return { ok: false, reason: (e && e.code) || 'sign-in-failed' }; }
  },
  async signInGoogle() {
    return this._signInWithProvider(() => new window.firebase.auth.GoogleAuthProvider());
  },
  async signInFacebook() {
    // Disabled until the provider exists in the Firebase console (needs the
    // Meta App Secret). The button is disabled in the UI too — this is the
    // code-side guard so nothing can call it early.
    if (!FACEBOOK_PROVIDER_ENABLED) return { ok: false, reason: 'facebook-not-configured' };
    return this._signInWithProvider(() => new window.firebase.auth.FacebookAuthProvider());
  },
  async signInAnonymous() {
    const fb = await this.ensureFirebase();
    if (!fb) return { ok: false, reason: 'not-configured' };
    try {
      await fb.auth.signInAnonymously();
      return { ok: true };
    } catch (e) { return { ok: false, reason: (e && e.code) || 'sign-in-failed' }; }
  },
  async signOut() {
    try {
      const fb = await this.ensureFirebase();
      if (fb && fb.auth.currentUser) await fb.auth.signOut();
    } catch {}
    if (this.profile) { this.profile.cloudUid = null; this.profile.provider = 'guest'; this.saveProfile(); }
    if (this.fb) this.fb.user = null;
    Analytics.log('account_signed_out', {});
    this._notify();
    return { ok: true };
  },

  // --- Display name / preferences ---
  setDisplayName(raw) {
    if (!this.profile) return { ok: false, reason: 'empty' };
    const clean = cleanDisplayName(raw);
    if (!clean) return { ok: false, reason: 'empty' };
    const check = nameIsClean(clean);
    if (!check.ok) return { ok: false, reason: check.reason };
    this.profile.displayName = clean;
    this.saveProfile();
    // Cloud copy, best-effort (never blocks the local save).
    if (this.signedIn) this._syncPlayerDoc().catch(() => {});
    this._notify();
    return { ok: true, name: clean };
  },
  nameRejectMessage,
  async setHideFromGlobal(v) {
    if (!this.profile) return { ok: false, reason: 'guest' };
    this.profile.hideFromGlobal = !!v;
    this.saveProfile();
    if (this.signedIn) { try { await this._syncPlayerDoc(); } catch {} }
    this._notify();
    return { ok: true, hideFromGlobal: this.hideFromGlobal };
  },

  // Called at game over (main.js finishGame). Merges local progress into
  // the cloud player doc when signed in; no-op for guests. Never throws.
  async recordGame() {
    if (!this.signedIn) return { ok: false, reason: 'guest' };
    return this._syncPlayerDoc();
  },

  // --- Account deletion (two-step in the UI; this does the wipe) ---
  // Cloud first (player doc + their score/challenge docs + the auth user),
  // then local identity + progress. If the cloud step fails, nothing is
  // wiped locally so the player can retry. Returns { ok, reason? }.
  async deleteAccount() {
    const fb = await this.ensureFirebase();
    if (fb && fb.user) {
      try {
        const uid = fb.user.uid;
        const db = fb.db;
        await db.collection(COLLECTIONS.players).doc(uid).delete();
        // Friend-code directory entry, best-effort in its own try so a
        // failed delete never aborts the rest of the wipe (the rules
        // make it owner-only, so no other player can delete it either —
        // a stale entry can only linger after a failed call).
        if (this.profile?.friendCode) {
          try { await db.collection(COLLECTIONS.friendCodes).doc(this.profile.friendCode).delete(); } catch {}
        }
        for (const coll of [COLLECTIONS.scoresDaily, COLLECTIONS.scoresWeekly]) {
          const snap = await db.collection(coll).where('uid', '==', uid).get();
          const batch = db.batch();
          snap.forEach((d) => batch.delete(d.ref));
          if (!snap.empty) await batch.commit();
        }
        for (const field of ['fromUid', 'toUid']) {
          const snap = await db.collection(COLLECTIONS.challenges).where(field, '==', uid).get();
          const batch = db.batch();
          snap.forEach((d) => batch.delete(d.ref));
          if (!snap.empty) await batch.commit();
        }
        await fb.user.delete();
      } catch (e) {
        // Deleting needs a recent sign-in; an old session must re-auth
        // first (sign out + back in) instead of retrying blindly.
        if (e && e.code === 'auth/requires-recent-login') return { ok: false, reason: 'reauth-required' };
        return { ok: false, reason: 'cloud-delete-failed' };
      }
    }
    for (const k of ACCOUNT_DATA_KEYS) { try { localStorage.removeItem(k); } catch {} }
    this.fb = null;
    this.profile = this.freshGuestProfile();
    this.saveProfile();
    Analytics.log('account_deleted', {});
    this._notify();
    return { ok: true };
  },

  debugState() {
    return {
      status: this.status, provider: this.profile?.provider || 'guest',
      displayName: this.displayName, friendCode: this.friendCode,
      hideFromGlobal: this.hideFromGlobal, signedIn: this.signedIn,
      configured: isFirebaseConfigured(), facebookEnabled: FACEBOOK_PROVIDER_ENABLED,
      hasCloud: !!this.fb, redirectError: this._redirectError || null,
    };
  },
};
