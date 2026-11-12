// Median-game estimate for the timer rules (Design Update 5: 120 s start,
// 150 s cap, level-up +5 s per 15 placements, charges persist until used
// (30 s expiry REMOVED, Dylan Nov 12), auto-save on no-moves: Reshuffle,
// then Bomb best 3x3, then Sweep fullest line. Timeout never auto-uses a
// charge, so it still ends the game.)
// Greedy simulated player: each placement takes ~3s of human time; each
// placed piece goes to the spot maximizing lines cleared, then minimizing
// board fill. Game ends on timeout OR no-moves-left, whichever comes first.
// Uses the real difficulty.js dealTray + scoring.js clearPoints + TIMER.
// Variant: pass CB_VARIANT=relaxed|spicy|standard (default: all three plus
// the 2/3-relaxed + 1/3-spicy mix Dylan ordered, each 300 games).
import { N, dealTray, fits, fitsAnywhere, TIMER, timeForClear, levelFor, LEVEL_EVERY, POWERUPS, rollVariant } from '../js/difficulty.js';
import { clearPoints } from '../js/scoring.js';

function bestSpot(board, shape) {
  let best = null;
  for (let r = 0; r <= N - shape.h; r++) for (let c = 0; c <= N - shape.w; c++) {
    if (!fits(board, shape, r, c)) continue;
    const b = board.map((row) => row.slice());
    for (const [dr, dc] of shape.cells) b[r + dr][c + dc] = 1;
    let lines = 0, fill = 0;
    for (let i = 0; i < N; i++) {
      if (b[i].every(Boolean)) lines++;
      if (b.every((row) => row[i])) lines++;
      for (let j = 0; j < N; j++) if (b[i][j]) fill++;
    }
    const score = lines * 100 - fill;
    if (!best || score > best.score) best = { r, c, lines, score };
  }
  return best;
}
// --- auto-save helpers (mirror js/main.js findBombSave/findSweepSave) ---
function trayFitsOn(board, tray) { return tray.some((p) => p && fitsAnywhere(board, p.shape)); }
function countFitsOn(board, tray) {
  let n = 0;
  for (const p of tray) {
    if (!p) continue;
    for (let r = 0; r <= N - p.shape.h; r++) for (let c = 0; c <= N - p.shape.w; c++) if (fits(board, p.shape, r, c)) n++;
  }
  return n;
}
function findBombSave(board, tray) {
  let best = null;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const b = board.map((row) => row.slice());
    let cleared = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < N && cc >= 0 && cc < N && b[rr][cc]) { b[rr][cc] = null; cleared++; }
    }
    if (!cleared) continue;
    const fitsN = countFitsOn(b, tray);
    if (fitsN === 0) continue;
    if (!best || fitsN > best.fits || (fitsN === best.fits && cleared > best.cleared)) best = { r, c, fits: fitsN, cleared };
  }
  return best;
}
function findSweepSave(board, tray) {
  let best = null;
  const consider = (axis, idx) => {
    const b = board.map((row) => row.slice());
    let full = 0;
    if (axis === 'row') { for (let cc = 0; cc < N; cc++) { if (b[idx][cc]) full++; b[idx][cc] = null; } }
    else { for (let rr = 0; rr < N; rr++) { if (b[rr][idx]) full++; b[rr][idx] = null; } }
    if (!full || !trayFitsOn(b, tray)) return;
    if (!best || full > best.full) best = { axis, idx, full };
  };
  for (let i = 0; i < N; i++) consider('row', i);
  for (let i = 0; i < N; i++) consider('col', i);
  return best;
}
function playGame(seed, variant) {
  let rngState = seed >>> 0;
  const rng = () => { rngState = (rngState + 0x6d2b79f5) >>> 0; let t = rngState; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  let board = Array.from({ length: N }, () => Array(N).fill(null));
  let timeLeft = TIMER.start, placed = 0, lines = 0, combo = 0, sinceClear = 0, score = 0;
  let tray = dealTray({ board, placed, helperAvailable: false, variant }, rng).tray;
  let elapsed = 0;
  // Power-up charges persist until used (no expiry clocks since Nov 12).
  // Same earn rules as the game: 1 per 3-line combo, 1 per 10 lines,
  // max 3, fixed rotation bomb -> sweep -> reshuffle -> star. The greedy
  // sim never uses power-ups manually; charges only get auto-used on
  // no-moves.
  const charges = { bomb: 0, sweep: 0, reshuffle: 0, star: 0 };
  let earnIdx = 0, saves = { reshuffle: 0, bomb: 0, sweep: 0 };
  const totalCharges = () => charges.bomb + charges.sweep + charges.reshuffle + charges.star;
  const grant = () => {
    if (totalCharges() >= POWERUPS.maxCharges) return;
    const type = POWERUPS.earnOrder[earnIdx++ % POWERUPS.earnOrder.length];
    charges[type]++;
  };
  const spend = (type) => { charges[type]--; };
  // Auto-save on no-moves (same priority + choice rules as the game).
  // Returns true if the game was saved and can continue.
  const tryAutoSave = () => {
    if (charges.reshuffle > 0) {
      spend('reshuffle');
      tray = dealTray({ board, placed, helperAvailable: false, variant }, rng).tray;
      if (trayFitsOn(board, tray)) { saves.reshuffle++; return true; }
    }
    if (charges.bomb > 0) {
      const t = findBombSave(board, tray);
      if (t) {
        spend('bomb');
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const rr = t.r + dr, cc = t.c + dc;
          if (rr >= 0 && rr < N && cc >= 0 && cc < N) board[rr][cc] = null;
        }
        saves.bomb++; return true;
      }
    }
    if (charges.sweep > 0) {
      const t = findSweepSave(board, tray);
      if (t) {
        spend('sweep');
        if (t.axis === 'row') for (let cc = 0; cc < N; cc++) board[t.idx][cc] = null;
        else for (let rr = 0; rr < N; rr++) board[rr][t.idx] = null;
        saves.sweep++; return true;
      }
    }
    return false;
  };
  const SECS_PER_PLACE = 3;
  for (;;) {
    // pick a playable piece, best spot
    let move = null;
    for (let s = 0; s < tray.length; s++) {
      if (!tray[s]) continue;
      const spot = bestSpot(board, tray[s].shape);
      if (spot && (!move || spot.score > move.spot.score)) move = { slot: s, spot, piece: tray[s] };
    }
    if (!move) {
      if (tryAutoSave()) continue;
      return { end: 'no_moves', elapsed, placed, lines, score, saves, reviveOffered: score > 0 };
    }
    if (timeLeft <= 0) return { end: 'timeout', elapsed, placed, lines, score, saves, reviveOffered: score > 0 };
    // spend the human time for this placement
    elapsed += SECS_PER_PLACE; timeLeft -= SECS_PER_PLACE;
    if (timeLeft <= 0) return { end: 'timeout', elapsed, placed, lines, score, saves, reviveOffered: score > 0 };
    const { piece, spot } = move;
    for (const [dr, dc] of piece.shape.cells) board[spot.r + dr][spot.c + dc] = 1;
    tray[move.slot] = null; placed++;
    score += piece.shape.cells.length;
    // Level-up: +5 s every 15 pieces placed (Update 5, same as the game).
    if (levelFor(placed) > levelFor(placed - 1)) timeLeft = Math.min(TIMER.cap, timeLeft + TIMER.levelUpBonus);
    const rows = [], cols = [];
    for (let i = 0; i < N; i++) { if (board[i].every(Boolean)) rows.push(i); if (board.every((row) => row[i])) cols.push(i); }
    const n = rows.length + cols.length;
    if (n) {
      combo++; sinceClear = 0;
      const linesBefore = lines; lines += n;
      const cells = new Set();
      rows.forEach((rr) => { for (let i = 0; i < N; i++) cells.add(rr * N + i); });
      cols.forEach((cc) => { for (let i = 0; i < N; i++) cells.add(i * N + cc); });
      for (const id of cells) board[Math.floor(id / N)][id % N] = null;
      score += clearPoints(n, cells.size, combo);
      if (board.every((row) => row.every((v) => !v))) score += 300;
      timeLeft = Math.min(TIMER.cap, timeLeft + timeForClear(n));
      // Earn: 1 per 3-line combo, plus 1 per 10-line milestone crossed.
      let grants = n >= 3 ? 1 : 0;
      for (let m = Math.floor(linesBefore / POWERUPS.linesMilestone) + 1; m <= Math.floor(lines / POWERUPS.linesMilestone); m++) grants++;
      for (let i = 0; i < grants; i++) grant();
    } else { sinceClear++; if (sinceClear >= 3) combo = 0; }
    if (tray.every((p) => !p)) tray = dealTray({ board, placed, helperAvailable: false, variant }, rng).tray;
    if (placed > 600) return { end: 'cap', elapsed, placed, lines, score, saves, reviveOffered: score > 0 };
  }
}
const GAMES = 300;
function runBatch(label, variantOf) {
  const out = [];
  for (let i = 0; i < GAMES; i++) out.push(playGame(12345 + i * 7919, variantOf(i)));
  out.sort((a, b) => a.elapsed - b.elapsed);
  const med = out[Math.floor(GAMES / 2)];
  const byEnd = {};
  for (const g of out) byEnd[g.end] = (byEnd[g.end] || 0) + 1;
  const avg = (k) => (out.reduce((a, g) => a + g[k], 0) / GAMES).toFixed(1);
  const totSaves = out.reduce((a, g) => a + g.saves.reshuffle + g.saves.bomb + g.saves.sweep, 0);
  const savesByType = { reshuffle: out.reduce((a, g) => a + g.saves.reshuffle, 0), bomb: out.reduce((a, g) => a + g.saves.bomb, 0), sweep: out.reduce((a, g) => a + g.saves.sweep, 0) };
  const reviveOffered = out.filter((g) => g.reviveOffered).length;
  console.log(JSON.stringify({ batch: label, games: GAMES, median_secs: med.elapsed, median_min: +(med.elapsed / 60).toFixed(2), median_placed: out[Math.floor(GAMES / 2)].placed, median_lines: out[Math.floor(GAMES / 2)].lines, p10_secs: out[Math.floor(GAMES * 0.1)].elapsed, p90_secs: out[Math.floor(GAMES * 0.9)].elapsed, avg_placed: avg('placed'), avg_lines: avg('lines'), end_reasons: byEnd, revive_offered_games: reviveOffered, revive_offered_pct: +(100 * reviveOffered / GAMES).toFixed(1), autosaves_total: totSaves, autosaves_per_game: +(totSaves / GAMES).toFixed(2), autosaves_by_type: savesByType }, null, 2));
}
// The variant roll in the real game uses a rng separate from the deal
// stream (so the roll never changes the pieces); the sim mirrors that with
// a second mulberry32 seeded per game.
function mixRoll(seed) {
  let s = (seed ^ 0x9e3779b9) >>> 0;
  const rng = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return rollVariant(rng);
}
const only = process.env.CB_VARIANT;
if (only) runBatch(only, () => (only === 'standard' ? undefined : only));
else {
  runBatch('standard (no variant)', () => undefined);
  runBatch('relaxed', () => 'relaxed');
  runBatch('spicy', () => 'spicy');
  runBatch('mix (2/3 relaxed + 1/3 spicy, Dylan Nov 12)', (i) => mixRoll(12345 + i * 7919));
}
