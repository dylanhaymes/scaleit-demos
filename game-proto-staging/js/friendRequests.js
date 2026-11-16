// Friend requests (replication build, Nov 15) — the request → accept step
// between "enter a code" and "you're friends", copied from the Pokémon GO /
// Brawl Stars pattern: a code alone never makes two people friends.
//
// Firestore collection `friendRequests/{id}`:
//   { fromUid, fromName, toUid, toName, code, status: 'pending' |
//     'accepted' | 'declined', createdAt, expiresAt }
// Requests expire 7 days after they are sent (Pokémon GO's window).
// The rules (firestore.rules, NOT deployed yet — needs Dylan's word in
// the Firebase console) let only the two players read a request, only
// the sender create one, only the receiver accept/decline it, and only
// the sender delete it (cancel). Until the rules deploy, Firestore is
// deny-by-default and every call here fails gracefully with
// { ok: false } — the game never depends on it.
//
// The local friends list (gb_friends, leaderboards.js) is still the
// source of truth for "who are my friends": a request only ADDS to it
// when the receiver accepts (the receiver adds the sender on accept;
// the sender's list gains the friend the next time it syncs an accepted
// outgoing request). Expired requests are inert — sending again after
// expiry is allowed, accepting an expired request is refused.
// Fairness: this module only moves friend requests. It never touches
// difficulty, pieces, timer or scoring, and nothing in it is imported
// by difficulty.js.
import { Accounts, COLLECTIONS } from './accounts.js';
import { Leaderboards } from './leaderboards.js';

export const FRIEND_REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Pure status from the stored fields — no Firestore, so tests can drive
// it. 'expired' beats the stored status: a request that ran out is
// expired even if it was never answered.
export function requestStatus(req, now = Date.now()) {
  if (!req) return 'not-found';
  if (typeof req.expiresAt === 'number' && req.expiresAt <= now) return 'expired';
  return req.status || 'pending';
}

export function requestTimeLeftText(req, now = Date.now()) {
  if (!req) return '';
  const left = (typeof req.expiresAt === 'number' ? req.expiresAt : 0) - now;
  if (left <= 0) return 'Expired';
  const d = Math.floor(left / 86400000);
  if (d >= 1) return `expires in ${d}d`;
  const h = Math.floor(left / 3600000);
  if (h >= 1) return `expires in ${h}h`;
  return `expires in ${Math.max(1, Math.round(left / 60000))}m`;
}

function toMillis(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  return 0;
}

export const FriendRequests = {
  // Incoming (to me) + outgoing (from me), newest first, each with a
  // computed `status` ('pending' | 'accepted' | 'declined' | 'expired').
  // Outgoing requests the other player accepted are synced into the
  // local friends list here, so the sender's list gains the friend
  // without the receiver having to do anything else.
  async fetchRequests() {
    if (!Accounts.signedIn || !Accounts.uid) return { ok: false, reason: 'guest' };
    try {
      const fb = await Accounts.ensureFirebase();
      if (!fb || !fb.db) return { ok: false, reason: 'no-firebase' };
      const uid = Accounts.uid;
      const [inc, out] = await Promise.all([
        fb.db.collection(COLLECTIONS.friendRequests).where('toUid', '==', uid).get(),
        fb.db.collection(COLLECTIONS.friendRequests).where('fromUid', '==', uid).get(),
      ]);
      const now = Date.now();
      const read = (snap) => {
        const list = [];
        snap.forEach((d) => { const v = d.data() || {}; list.push({ id: d.id, ...v, status: requestStatus(v, now) }); });
        return list;
      };
      const incoming = read(inc).sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      const outgoing = read(out).sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      // Sync: an outgoing request the other player accepted means we're
      // friends now — make sure the local list has them.
      let synced = 0;
      for (const r of outgoing) {
        if (r.status !== 'accepted') continue;
        const friends = Leaderboards.friends();
        if (!friends.some((f) => f.uid === r.toUid)) {
          Leaderboards.addFriend({ uid: r.toUid, code: r.code, displayName: r.toName });
          synced++;
        }
      }
      return { ok: true, incoming, outgoing, synced };
    } catch (e) {
      if (e && e.code === 'permission-denied') return { ok: false, reason: 'rules-not-deployed' };
      return { ok: false, reason: 'fetch-failed' };
    }
  },

  // Is there already a live (pending, unexpired) request from me to uid?
  // Used before showing the preview's Send button — a second request to
  // the same player is refused with a plain message instead.
  async hasPendingWith(uid) {
    if (!Accounts.signedIn || !Accounts.uid) return { ok: false, reason: 'guest' };
    if (!uid || typeof uid !== 'string') return { ok: false, reason: 'bad-request' };
    try {
      const fb = await Accounts.ensureFirebase();
      if (!fb || !fb.db) return { ok: false, reason: 'no-firebase' };
      const snap = await fb.db.collection(COLLECTIONS.friendRequests).where('fromUid', '==', Accounts.uid).get();
      const now = Date.now();
      let found = null;
      snap.forEach((d) => {
        const v = d.data() || {};
        if (v.toUid === uid && requestStatus(v, now) === 'pending') found = { id: d.id, ...v, status: 'pending' };
      });
      return { ok: true, pending: !!found, request: found };
    } catch (e) {
      if (e && e.code === 'permission-denied') return { ok: false, reason: 'rules-not-deployed' };
      return { ok: false, reason: 'fetch-failed' };
    }
  },

  // Send a friend request to a player found by code. Guards run here
  // too (the UI pre-checks them, but the send must not depend on that):
  // signed in, not yourself, not already friends, no live request
  // already out to them. Returns { ok, id } or { ok: false, reason }.
  async sendRequest({ toUid, toName, code }) {
    if (!Accounts.signedIn || !Accounts.uid) return { ok: false, reason: 'guest' };
    if (!toUid || typeof toUid !== 'string' || !toName) return { ok: false, reason: 'bad-request' };
    if (toUid === Accounts.uid) return { ok: false, reason: 'self-request' };
    if (!/^[A-Z0-9]{6}$/.test(code || '')) return { ok: false, reason: 'bad-code' };
    if (Leaderboards.friends().some((f) => f.uid === toUid)) return { ok: false, reason: 'already-friends' };
    const pend = await this.hasPendingWith(toUid);
    if (pend.ok && pend.pending) return { ok: false, reason: 'already-pending', request: pend.request };
    try {
      const fb = await Accounts.ensureFirebase();
      if (!fb || !fb.db) return { ok: false, reason: 'no-firebase' };
      const now = Date.now();
      const doc = {
        fromUid: Accounts.uid,
        fromName: Accounts.displayName || 'Guest',
        toUid,
        toName,
        code,
        status: 'pending',
        createdAt: now,
        expiresAt: now + FRIEND_REQUEST_TTL_MS,
      };
      const ref = await fb.db.collection(COLLECTIONS.friendRequests).add(doc);
      return { ok: true, id: ref.id };
    } catch (e) {
      if (e && e.code === 'permission-denied') return { ok: false, reason: 'rules-not-deployed' };
      return { ok: false, reason: 'send-failed' };
    }
  },

  // Accept an incoming request (receiver only). Both lists gain the
  // friend: the receiver adds the sender here; the sender's list picks
  // the friend up on its next fetchRequests sync. Expired requests
  // cannot be accepted — send a fresh one instead.
  async acceptRequest(id) {
    if (!id) return { ok: false, reason: 'bad-request' };
    if (!Accounts.signedIn || !Accounts.uid) return { ok: false, reason: 'guest' };
    try {
      const fb = await Accounts.ensureFirebase();
      if (!fb || !fb.db) return { ok: false, reason: 'no-firebase' };
      const ref = fb.db.collection(COLLECTIONS.friendRequests).doc(id);
      const snap = await ref.get();
      if (!snap.exists) return { ok: false, reason: 'not-found' };
      const req = snap.data() || {};
      if (req.toUid !== Accounts.uid) return { ok: false, reason: 'not-yours' };
      if (requestStatus(req) === 'expired') return { ok: false, reason: 'expired' };
      if (req.status !== 'pending') return { ok: false, reason: 'already-answered' };
      await ref.set({ status: 'accepted' }, { merge: true });
      const added = Leaderboards.addFriend({ uid: req.fromUid, code: req.code, displayName: req.fromName });
      return { ok: true, name: added.ok ? added.name : (req.fromName || 'Friend') };
    } catch (e) {
      if (e && e.code === 'permission-denied') return { ok: false, reason: 'rules-not-deployed' };
      return { ok: false, reason: 'accept-failed' };
    }
  },

  // Decline an incoming request (receiver only). The sender sees it
  // disappear from their pending list on their next refresh.
  async declineRequest(id) {
    if (!id) return { ok: false, reason: 'bad-request' };
    if (!Accounts.signedIn || !Accounts.uid) return { ok: false, reason: 'guest' };
    try {
      const fb = await Accounts.ensureFirebase();
      if (!fb || !fb.db) return { ok: false, reason: 'no-firebase' };
      const ref = fb.db.collection(COLLECTIONS.friendRequests).doc(id);
      const snap = await ref.get();
      if (!snap.exists) return { ok: false, reason: 'not-found' };
      const req = snap.data() || {};
      if (req.toUid !== Accounts.uid) return { ok: false, reason: 'not-yours' };
      if (req.status !== 'pending') return { ok: false, reason: 'already-answered' };
      await ref.set({ status: 'declined' }, { merge: true });
      return { ok: true };
    } catch (e) {
      if (e && e.code === 'permission-denied') return { ok: false, reason: 'rules-not-deployed' };
      return { ok: false, reason: 'decline-failed' };
    }
  },

  // Cancel an outgoing request (sender only). Deletes the doc — the
  // receiver's pending row disappears on their next refresh.
  async cancelRequest(id) {
    if (!id) return { ok: false, reason: 'bad-request' };
    if (!Accounts.signedIn || !Accounts.uid) return { ok: false, reason: 'guest' };
    try {
      const fb = await Accounts.ensureFirebase();
      if (!fb || !fb.db) return { ok: false, reason: 'no-firebase' };
      const ref = fb.db.collection(COLLECTIONS.friendRequests).doc(id);
      const snap = await ref.get();
      if (!snap.exists) return { ok: false, reason: 'not-found' };
      const req = snap.data() || {};
      if (req.fromUid !== Accounts.uid) return { ok: false, reason: 'not-yours' };
      await ref.delete();
      return { ok: true };
    } catch (e) {
      if (e && e.code === 'permission-denied') return { ok: false, reason: 'rules-not-deployed' };
      return { ok: false, reason: 'cancel-failed' };
    }
  },
};
