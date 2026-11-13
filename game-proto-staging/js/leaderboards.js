// Clearbloom leaderboards (Update 3, batch 2) — Daily + Weekly, global +
// friends, with an honest sample preview for guests.
//
// HOW IT WORKS
// - Scores are best-only per board: submitting a score reads the player's
//   existing doc for that board and keeps the max (same pattern as the
//   player doc). Scores are validated client-side (0–999999, integers)
//   and again by firestore.rules — a bad score is rejected, never stored.
// - Global boards read the public score docs (displayName + score are
//   public by design; `hideFromGlobal` keeps a player off them). The
//   queries need composite indexes (declared in firestore.indexes.json);
//   if an index is missing Firestore answers failed-precondition and the
//   fetch returns { ok: false, reason: 'needs-index' } instead of
//   throwing — the UI says the board is still being set up.
// - Friends come in two ways: an invite link (carries uid + friend code
//   + name in `?friend=<uid>&code=<CODE>&name=<Name>`) or a friend code
//   typed in the boards panel. Code entry looks the code up in the public
//   friendCodes/{code} directory (findByCode) — one doc get by code, so
//   there is still NO query over player docs, which the rules deliberately
//   forbid. The directory only answers once firestore.rules deploys; until
//   then findByCode returns 'lookup-unavailable' and the UI says so
//   honestly. Friends live in localStorage (`gb_friends`); the friends
//   board filters the same public score docs to those uids (+ yourself).
//   No cloud function, no extra permissions.
// - SAMPLE BOARDS ARE NEVER PRESENTED AS REAL. Guests (and anyone with
//   `?sample=1`) see a clearly-labelled "Sample leaderboard" built from
//   deterministic mock data, so the UI is demonstrable without faking
//   ranks. Live boards show live data or an honest empty/setup state.
// - The game NEVER depends on leaderboards: every method is safe to call
//   in guest/local mode and never throws. Guests can still play everything.
// - Fairness: this module only RECORDS scores. It never touches
//   difficulty, pieces, timer or scoring, and nothing in it is imported
//   by difficulty.js.
import { Accounts, COLLECTIONS } from './accounts.js';
import { localDateKey } from './rng.js';
import { cleanDisplayName } from './names.js';

export const MAX_BOARD_SCORE = 999999;
export const BOARD_LIMIT = 50;
export const FRIENDS_KEY = 'gb_friends';
export const MAX_FRIENDS = 50;

const SAMPLE_NAMES = ['Mabel', 'Rex', 'Pip', 'Juno', 'Theo', 'Ivy', 'Max', 'Luna', 'Finn', 'Zoe'];

// ISO 8601 week key, e.g. '2026-W46'.
export function weekKeyFor(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = (date.getUTCDay() + 6) % 7; // Mon = 0
  date.setUTCDate(date.getUTCDate() - day + 3); // Thursday of this week
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const fday = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - fday + 3);
  const week = 1 + Math.round((date - firstThursday) / (7 * 86400000));
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
// Board key for a board + date: daily uses the local date key, weekly the ISO week.
export function boardKey(board, d = new Date()) {
  return board === 'weekly' ? weekKeyFor(d) : localDateKey(d);
}
function keyField(board) { return board === 'weekly' ? 'week' : 'date'; }
function collectionFor(board) { return board === 'weekly' ? COLLECTIONS.scoresWeekly : COLLECTIONS.scoresDaily; }

export function validateScore(score, lines = 0, maxCombo = 0) {
  if (!Number.isInteger(score) || score < 0 || score > MAX_BOARD_SCORE) return { ok: false, reason: 'bad-score' };
  if (!Number.isInteger(lines) || lines < 0 || lines > 10000) return { ok: false, reason: 'bad-score' };
  if (!Number.isInteger(maxCombo) || maxCombo < 0 || maxCombo > 10000) return { ok: false, reason: 'bad-score' };
  return { ok: true };
}

// Deterministic sample board (seeded by board + scope + key so it is
// stable within a day/week). Flagged sample:true on every entry.
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function mockBoard(board, scope, key, ownName = '', ownScore = 0) {
  const rnd = mulberry32(hashSeed(`${board}:${scope}:${key}`));
  const entries = SAMPLE_NAMES.map((name, i) => ({
    uid: `sample-${i}`, displayName: name,
    score: Math.round(1200 + rnd() * 7300),
    lines: 5 + Math.floor(rnd() * 40), maxCombo: 2 + Math.floor(rnd() * 6),
    sample: true,
  }));
  entries.sort((a, b) => b.score - a.score);
  if (ownScore > 0) {
    entries.push({ uid: 'you', displayName: ownName || 'You', score: ownScore, lines: 0, maxCombo: 0, sample: true });
    entries.sort((a, b) => b.score - a.score);
  }
  return entries.slice(0, 10);
}

// Rank of the player's own score on a sample board (1-based), or null when
// they have no score or fall outside the shown top 10. Pure — no network.
// The title-screen rank chip uses this so it renders instantly and honestly.
export function sampleRank(board, scope, key, ownScore) {
  if (!(ownScore > 0)) return null;
  const entries = mockBoard(board, scope, key, '', ownScore);
  const idx = entries.findIndex((e) => e.uid === 'you');
  return idx >= 0 ? idx + 1 : null;
}

// Normalize a typed friend code: trim + uppercase. Pure — the suite
// calls it directly; the UI also normalizes on submit.
export function normalizeFriendCode(code) {
  return String(code || '').trim().toUpperCase();
}

// Parse a friend invite link back into { uid, code, displayName }, or
// null when it isn't one. Module-level export (the suite calls it
// directly); the Leaderboards method below is the same function.
export function parseInviteLink(url) {
  try {
    const q = new URL(url, location.href).searchParams;
    const uid = q.get('friend') || '';
    const code = q.get('code') || '';
    const name = q.get('name') || '';
    if (!uid || !/^[A-Z0-9]{6}$/.test(code)) return null;
    return { uid, code, displayName: cleanDisplayName(name) || 'Friend' };
  } catch { return null; }
}

// One board row: rank medal (gold/silver/bronze for 1/2/3), the escaped
// display name, a YOU badge on the player's own row, and a thousands
// separator on the score. Pure — no DOM, no network.
export function rowHTML(entry, rank, ownUid) {
  const medal = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
  const you = entry.uid === ownUid ? ' <span class="board-you">YOU</span>' : '';
  return `<li class="board-row${medal ? ' ' + medal : ''}${entry.uid === ownUid ? ' own' : ''}"><span class="board-rank">${rank}</span><span class="board-name">${escapeHtml(entry.displayName)}${you}</span><span class="board-score">${Number(entry.score || 0).toLocaleString('en-US')}</span></li>`;
}

export const Leaderboards = {
  // --- Friends (local list; invite links + typed codes) ---
  friends() {
    try {
      const list = JSON.parse(localStorage.getItem(FRIENDS_KEY) || '[]');
      return Array.isArray(list) ? list.filter((f) => f && typeof f.uid === 'string') : [];
    } catch { return []; }
  },
  saveFriends(list) {
    try { localStorage.setItem(FRIENDS_KEY, JSON.stringify(list.slice(0, MAX_FRIENDS))); } catch {}
  },
  addFriend({ uid, code, displayName }) {
    // Codes are validated against the same shape firestore.rules enforces
    // (^[A-Z0-9]{6}$) — the generator only makes unambiguous codes, but a
    // code with a 1 or 0 in it is still a valid code, never a bad invite.
    if (typeof uid !== 'string' || !uid || typeof code !== 'string' || !/^[A-Z0-9]{6}$/.test(code)) return { ok: false, reason: 'bad-invite' };
    const name = cleanDisplayName(displayName || '') || 'Friend';
    const list = this.friends().filter((f) => f.uid !== uid);
    list.push({ uid, code, displayName: name, addedAt: Date.now() });
    this.saveFriends(list);
    return { ok: true, name };
  },
  removeFriend(uid) {
    this.saveFriends(this.friends().filter((f) => f.uid !== uid));
    return { ok: true };
  },
  // Invite links only make sense once signed in: a guest's local guestUid
  // never appears on a board, and it goes stale the moment they sign in
  // (their cloudUid differs). Guests get the sign-in prompt instead.
  inviteLink() {
    if (!Accounts.signedIn || !Accounts.uid) return null;
    const base = `${location.origin}${location.pathname}`;
    const p = new URLSearchParams({
      friend: Accounts.uid,
      code: Accounts.friendCode || '',
      name: Accounts.displayName || 'Guest',
    });
    return `${base}?${p.toString()}`;
  },
  parseInviteLink,
  // --- Add friend by code (public friendCodes directory) ---
  // Returns { ok, name } or { ok: false, reason } — 'bad-code' (not 6
  // letters/numbers), 'own-code', 'guest', 'not-found', or
  // 'lookup-unavailable' (any fetch failure, including permission-denied
  // while the friendCodes rules haven't deployed yet — the UI says the
  // lookup isn't live yet instead of blaming the code). Validation runs
  // before any Firebase call, so a bad/own code never touches the
  // network. No live-Firestore test in the suite: the suite has no prod
  // access, and the directory only answers once firestore.rules deploys.
  async findByCode(rawCode) {
    const code = normalizeFriendCode(rawCode);
    if (!/^[A-Z0-9]{6}$/.test(code)) return { ok: false, reason: 'bad-code' };
    if (code === Accounts.friendCode) return { ok: false, reason: 'own-code' };
    const fb = await Accounts.ensureFirebase();
    if (!fb || !fb.user) return { ok: false, reason: 'guest' };
    try {
      const snap = await fb.db.collection(COLLECTIONS.friendCodes).doc(code).get();
      if (!snap.exists) return { ok: false, reason: 'not-found' };
      const data = snap.data() || {};
      if (!data.uid || typeof data.uid !== 'string') return { ok: false, reason: 'not-found' };
      const added = this.addFriend({ uid: data.uid, code, displayName: data.displayName || 'Friend' });
      if (!added.ok) return { ok: false, reason: 'bad-invite' };
      return { ok: true, name: added.name };
    } catch (e) {
      return { ok: false, reason: 'lookup-unavailable' };
    }
  },

  // --- Submit (best-only; signed-in players only; never throws) ---
  async submitScore({ board = 'daily', score, lines = 0, maxCombo = 0, key = boardKey(board) } = {}) {
    const valid = validateScore(score, lines, maxCombo);
    if (!valid.ok) return valid;
    if (!Accounts.signedIn) return { ok: false, reason: 'guest' };
    const fb = await Accounts.ensureFirebase();
    if (!fb || !fb.user) return { ok: false, reason: 'guest' };
    const uid = fb.user.uid;
    const coll = collectionFor(board);
    const field = keyField(board);
    const ref = fb.db.collection(coll).doc(`${key}_${uid}`);
    const FieldValue = window.firebase?.firestore?.FieldValue;
    try {
      const snap = await ref.get();
      const prev = snap.exists ? (snap.data().score || 0) : 0;
      if (score <= prev) return { ok: true, kept: prev, improved: false };
      await ref.set({
        uid, displayName: Accounts.displayName, score, lines, maxCombo,
        [field]: key, hideFromGlobal: Accounts.hideFromGlobal,
        ts: FieldValue ? FieldValue.serverTimestamp() : Date.now(),
      }, { merge: true });
      return { ok: true, kept: score, improved: true };
    } catch (e) {
      if (e && e.code === 'failed-precondition') return { ok: false, reason: 'needs-index' };
      return { ok: false, reason: 'submit-failed' };
    }
  },

  // --- Fetch (live boards; never throws) ---
  // Returns { ok, entries, ownRank, sample } — entries are
  // { uid, displayName, score, lines, maxCombo, sample? } sorted desc.
  // ownRank is 1-based when the player is on the fetched page, else null.
  async fetchBoard({ board = 'daily', scope = 'global', key = boardKey(board) } = {}) {
    if (!Accounts.signedIn) return { ok: false, reason: 'guest' };
    // A preview identity has no live session: a live fetch can never
    // succeed, and reaching ensureFirebase here would load the Firebase
    // SDK for nothing (the rank chip calls this on every sign-in UI
    // refresh — that load is what made a bad-code submit look like it
    // touched Firebase). Return before any Firebase call.
    if (Accounts.isPreview) return { ok: false, reason: 'guest' };
    const fb = await Accounts.ensureFirebase();
    if (!fb || !fb.user) return { ok: false, reason: 'guest' };
    const coll = collectionFor(board);
    const field = keyField(board);
    try {
      let q = fb.db.collection(coll).where(field, '==', key);
      if (scope === 'friends') {
        const uids = [fb.user.uid, ...this.friends().map((f) => f.uid)].slice(0, 10);
        if (this.friends().length === 0) return { ok: true, entries: [], ownRank: null, sample: false, empty: 'no-friends' };
        q = q.where('uid', 'in', uids);
      } else {
        q = q.where('hideFromGlobal', '==', false);
      }
      const snap = await q.orderBy('score', 'desc').limit(BOARD_LIMIT).get();
      const entries = [];
      snap.forEach((d) => { const v = d.data(); entries.push({ uid: v.uid, displayName: v.displayName || 'Player', score: v.score || 0, lines: v.lines || 0, maxCombo: v.maxCombo || 0 }); });
      const ownIdx = entries.findIndex((e) => e.uid === fb.user.uid);
      return { ok: true, entries, ownRank: ownIdx >= 0 ? ownIdx + 1 : null, sample: false, empty: entries.length === 0 ? 'no-scores' : null };
    } catch (e) {
      if (e && e.code === 'failed-precondition') return { ok: false, reason: 'needs-index' };
      return { ok: false, reason: 'fetch-failed' };
    }
  },

  // --- Render (pure: no DOM writes outside the given element) ---
  // rowHTML is a module-level export (the suite calls it directly) and
  // the Leaderboards method below; both are the same function.
  rowHTML,
  renderInto(el, entries, ownUid) {
    if (!el) return;
    el.innerHTML = entries.length
      ? entries.map((e, i) => this.rowHTML(e, i + 1, ownUid)).join('')
      : '<li class="board-empty">No scores yet — be the first!</li>';
  },
};

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}