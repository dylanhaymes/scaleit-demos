// Display names for Clearbloom accounts (Update 3).
// Pure functions — no DOM, no network — so they can be unit-tested directly.
// Rules: 2–16 characters, letters / numbers / spaces / _ . - only; a small
// profanity + impersonation filter for names that appear on leaderboards.
// The filter is a first pass, not a guarantee: it blocks the obvious words
// and is deliberately narrow so ordinary names never get rejected.
export const MAX_NAME_LEN = 16;
export const MIN_NAME_LEN = 2;

// Whole-word matches (checked per token). Keep this list to unambiguous
// profanity, slurs and sexual terms.
const BLOCKED_WORDS = new Set([
  'fuck', 'fucking', 'fucker', 'shit', 'shitty', 'bitch', 'bitches', 'bastard',
  'cunt', 'dick', 'cock', 'pussy', 'whore', 'slut', 'damn',
  'asshole', 'ass', 'wank', 'wanker', 'bollocks', 'crap',
  'piss', 'pissed', 'tits', 'boobs', 'boob', 'penis', 'vagina', 'porn',
  'sex', 'sexy', 'nigger', 'nigga', 'faggot', 'fag', 'dyke', 'tranny',
  'retard', 'retarded', 'hitler', 'nazi', 'kkk', 'pedo', 'pedophile',
  'rape', 'rapist', 'murder', 'kill', 'suicide', 'hate',
]);
// Substrings that are never acceptable anywhere in a name (checked on the
// name with spaces removed). Deliberately short — only the worst offenders.
const BLOCKED_SUBSTRINGS = ['fuck', 'shit', 'cunt', 'nigg', 'porn', 'xxx'];
// Names that impersonate the game or its staff.
const IMPOSTOR_WORDS = new Set(['admin', 'moderator', 'mod', 'support', 'clearbloom', 'official', 'developer', 'dev', 'staff', 'owner']);

function tokensOf(name) {
  return name.toLowerCase().split(/[^a-z]+/).filter(Boolean);
}

// Clean raw input into a displayable name, or '' when nothing usable is left.
export function cleanDisplayName(raw) {
  if (typeof raw !== 'string') return '';
  let name = raw.trim().replace(/\s+/g, ' ');
  name = name.replace(/[^A-Za-z0-9 _.'-]/g, '');
  name = name.replace(/\s+/g, ' ').trim();
  if (name.length > MAX_NAME_LEN) name = name.slice(0, MAX_NAME_LEN).trim();
  // Title-case: each word gets a capital first letter, the rest lower.
  // 'cool player' -> 'Cool Player'. Display names read as names, not slugs.
  name = name.split(' ').map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w)).join(' ');
  return name;
}

// { ok: true } or { ok: false, reason } — reason is a short code for the UI.
export function nameIsClean(name) {
  if (typeof name !== 'string') return { ok: false, reason: 'empty' };
  const n = name.trim();
  if (n.length < MIN_NAME_LEN) return { ok: false, reason: 'short' };
  if (n.length > MAX_NAME_LEN) return { ok: false, reason: 'long' };
  // 'Guest' is the default name for players who never pick one — nobody
  // may claim it, or leaderboards would have indistinguishable Guests.
  if (n.toLowerCase() === 'guest') return { ok: false, reason: 'reserved' };
  if (/https?:|www\.|@|\.com|\.net|\.org|\.io/i.test(n)) return { ok: false, reason: 'link' };
  const tokens = tokensOf(n);
  for (const t of tokens) {
    if (BLOCKED_WORDS.has(t)) return { ok: false, reason: 'blocked' };
    if (IMPOSTOR_WORDS.has(t)) return { ok: false, reason: 'impersonation' };
  }
  const squashed = n.toLowerCase().replace(/[^a-z]/g, '');
  for (const s of BLOCKED_SUBSTRINGS) {
    if (squashed.includes(s)) return { ok: false, reason: 'blocked' };
  }
  return { ok: true };
}

// Human-readable reason for a rejected name (shown in the UI).
export function nameRejectMessage(reason) {
  switch (reason) {
    case 'short': return 'Pick a name with at least 2 letters.';
    case 'long': return 'Keep it to 16 letters or fewer.';
    case 'link': return 'No links or web addresses in names.';
    case 'reserved': return 'That name is taken — pick another one.';
    case 'impersonation': return 'That name looks like staff — pick another one.';
    case 'blocked': return 'That name is not allowed — pick another one.';
    default: return 'That name does not work — try another one.';
  }
}

export function defaultGuestName() { return 'Guest'; }
