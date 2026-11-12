// Head-to-head async challenges (Update 3, batch 3).
//
// One deal, two players, 48 hours. The challenger creates a challenge with
// a random seed; both players play the SAME seed (challengeRng), so the
// pieces arrive in the same order for both — the only difference is how
// they play them. Same rules as a classic game (same timer, same scoring,
// same power-up rules). Best score wins; either player may retry as often
// as they like before expiry — the best score stands, like the leaderboards.
// A challenge is never real-time, never paid, and never affects the
// classic/daily bests or the comeback-helper history.
//
// Firestore collection `challenges/{id}`:
//   { fromUid, fromName, toUid, toName, seed, mode: 'challenge',
//     status: 'pending' | 'done', createdAt, expiresAt, scores: { [uid]: { score, ts } } }
// The rules (batch 4) let only fromUid/toUid read a challenge, only fromUid
// create one, and only let each player write their own scores entry.
// Until the rules deploy, Firestore is deny-by-default and every call here
// fails gracefully with { ok: false } — the game never depends on it.
import { hashSeed, makeRng } from './rng.js';
import { Accounts } from './accounts.js';

// Seeded RNG for a challenge game: the same seed deals the same pieces.
export function challengeRng(seedKey) {
  return makeRng(hashSeed('clearbloom-challenge-' + seedKey));
}

// A short random seed, shared by both players. 12 hex chars from crypto;
// Math.random fallback for environments without crypto.getRandomValues.
// The Firestore rules require exactly 12 hex chars — keep this in sync.
export function newSeed() {
  try {
    const b = new Uint8Array(6);
    crypto.getRandomValues(b);
    return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  } catch {
    return Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0')
      + Math.floor(Date.now() % 0xffff).toString(16).padStart(4, '0');
  }
}

export const CHALLENGE_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours

// Firestore Timestamps carry toMillis(); plain numbers are millis already.
function toMillis(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  return 0;
}

// Pure status from the stored fields — no Firestore, so tests can drive it.
// 'expired' beats 'done': a challenge that ran out is expired even if both
// players finished.
export function challengeStatus(ch, now = Date.now()) {
  if (!ch) return 'not-found';
  if (toMillis(ch.expiresAt) <= now) return 'expired';
  const s = ch.scores || {};
  if (s[ch.fromUid] && s[ch.toUid]) return 'done';
  return 'pending';
}

export function timeLeftText(ch, now = Date.now()) {
  const left = toMillis(ch.expiresAt) - now;
  if (left <= 0) return 'Expired';
  const h = Math.floor(left / 3600000);
  if (h >= 1) return `${h}h left`;
  return `${Math.max(1, Math.round(left / 60000))}m left`;
}

export function validateScore(score) {
  if (!Number.isInteger(score) || score < 0 || score > 999999) return { ok: false, reason: 'bad-score' };
  return { ok: true };
}

function scoreOf(ch, uid) {
  const s = (ch.scores || {})[uid];
  return s ? s.score : null;
}

export const Challenges = {
  // The opponent for this player in a challenge: the other uid + name.
  opponentOf(ch, myUid) {
    if (!ch) return null;
    if (ch.fromUid === myUid) return { uid: ch.toUid, name: ch.toName, score: scoreOf(ch, ch.toUid) };
    return { uid: ch.fromUid, name: ch.fromName, score: scoreOf(ch, ch.fromUid) };
  },

  // Create a challenge against a friend (by uid). Signed-in only: the
  // challenge doc carries both uids, and guests have no stable uid.
  async createChallenge({ toUid, toName }) {
    if (!Accounts.signedIn || !Accounts.uid) return { ok: false, reason: 'guest' };
    if (!toUid || typeof toUid !== 'string' || !toName) return { ok: false, reason: 'bad-challenge' };
    if (toUid === Accounts.uid) return { ok: false, reason: 'self-challenge' };
    try {
      const fb = await Accounts.ensureFirebase();
      if (!fb || !fb.db) return { ok: false, reason: 'no-firebase' };
      const now = Date.now();
      const doc = {
        fromUid: Accounts.uid,
        fromName: Accounts.displayName || 'Guest',
        toUid,
        toName,
        seed: newSeed(),
        mode: 'challenge',
        status: 'pending',
        createdAt: now,
        expiresAt: now + CHALLENGE_TTL_MS,
        scores: {},
      };
      const ref = await fb.db.collection('challenges').add(doc);
      return { ok: true, id: ref.id, seed: doc.seed, link: this.challengeLink(ref.id) };
    } catch (e) {
      if (e && e.code === 'permission-denied') return { ok: false, reason: 'rules-not-deployed' };
      return { ok: false, reason: 'create-failed' };
    }
  },

  async fetchChallenge(id) {
    if (!id) return { ok: false, reason: 'bad-challenge' };
    if (!Accounts.signedIn || !Accounts.uid) return { ok: false, reason: 'guest' };
    try {
      const fb = await Accounts.ensureFirebase();
      if (!fb || !fb.db) return { ok: false, reason: 'no-firebase' };
      const snap = await fb.db.collection('challenges').doc(id).get();
      if (!snap.exists) return { ok: false, reason: 'not-found' };
      const ch = { id: snap.id, ...snap.data() };
      return { ok: true, challenge: ch, status: challengeStatus(ch) };
    } catch (e) {
      if (e && e.code === 'permission-denied') return { ok: false, reason: 'rules-not-deployed' };
      return { ok: false, reason: 'fetch-failed' };
    }
  },

  // Incoming (challenged me) + outgoing (I challenged), newest first.
  async fetchChallenges() {
    if (!Accounts.signedIn || !Accounts.uid) return { ok: false, reason: 'guest' };
    try {
      const fb = await Accounts.ensureFirebase();
      if (!fb || !fb.db) return { ok: false, reason: 'no-firebase' };
      const uid = Accounts.uid;
      const [inc, out] = await Promise.all([
        fb.db.collection('challenges').where('toUid', '==', uid).get(),
        fb.db.collection('challenges').where('fromUid', '==', uid).get(),
      ]);
      const all = [...inc.docs, ...out.docs].map((d) => ({ id: d.id, ...d.data() }));
      all.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      const now = Date.now();
      return {
        ok: true,
        incoming: all.filter((c) => c.toUid === uid).map((c) => ({ ...c, status: challengeStatus(c, now) })),
        outgoing: all.filter((c) => c.fromUid === uid).map((c) => ({ ...c, status: challengeStatus(c, now) })),
      };
    } catch (e) {
      if (e && e.code === 'permission-denied') return { ok: false, reason: 'rules-not-deployed' };
      return { ok: false, reason: 'fetch-failed' };
    }
  },

  // Submit my score for a challenge. Best-only, like the leaderboards:
  // a retry that scores lower keeps the old score. Rejected after expiry.
  async submitChallengeScore(id, score) {
    const valid = validateScore(score);
    if (!valid.ok) return valid;
    if (!Accounts.signedIn || !Accounts.uid) return { ok: false, reason: 'guest' };
    try {
      const fb = await Accounts.ensureFirebase();
      if (!fb || !fb.db) return { ok: false, reason: 'no-firebase' };
      const ref = fb.db.collection('challenges').doc(id);
      const snap = await ref.get();
      if (!snap.exists) return { ok: false, reason: 'not-found' };
      const ch = { id: snap.id, ...snap.data() };
      if (challengeStatus(ch) === 'expired') return { ok: false, reason: 'expired' };
      const prev = scoreOf(ch, Accounts.uid);
      if (prev != null && score <= prev) return { ok: true, kept: prev, improved: false };
      const scores = { ...(ch.scores || {}), [Accounts.uid]: { score, ts: Date.now() } };
      const done = !!(scores[ch.fromUid] && scores[ch.toUid]);
      await ref.set({ scores, status: done ? 'done' : 'pending' }, { merge: true });
      return { ok: true, kept: score, improved: true, done };
    } catch (e) {
      if (e && e.code === 'permission-denied') return { ok: false, reason: 'rules-not-deployed' };
      return { ok: false, reason: 'submit-failed' };
    }
  },

  // A challenge invite link — opening it shows the challenge in the
  // boards overlay, with a Play button. Never auto-starts a game.
  challengeLink(id) {
    return `${location.origin}${location.pathname}?challenge=${encodeURIComponent(id)}`;
  },

  parseChallengeLink(url) {
    try {
      const id = new URL(url, location.href).searchParams.get('challenge');
      if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
      return id;
    } catch {
      return null;
    }
  },
};
