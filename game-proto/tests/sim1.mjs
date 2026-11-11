// Median-game estimate for the timer rules (Design Update 1).
// Greedy simulated player: each placement takes ~3s of human time; each
// placed piece goes to the spot maximizing lines cleared, then minimizing
// board fill. Game ends on timeout OR no-moves-left, whichever comes first.
// Uses the real difficulty.js dealTray + scoring.js clearPoints + TIMER.
import { N, dealTray, fits, fitsAnywhere, TIMER, timeForClear } from '../js/difficulty.js';
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
function playGame(seed) {
  let rngState = seed >>> 0;
  const rng = () => { rngState = (rngState + 0x6d2b79f5) >>> 0; let t = rngState; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  let board = Array.from({ length: N }, () => Array(N).fill(null));
  let timeLeft = TIMER.start, placed = 0, lines = 0, combo = 0, sinceClear = 0;
  let tray = dealTray({ board, placed, helperAvailable: false }, rng).tray;
  let elapsed = 0;
  const SECS_PER_PLACE = 3;
  for (;;) {
    // pick a playable piece, best spot
    let move = null;
    for (let s = 0; s < tray.length; s++) {
      if (!tray[s]) continue;
      const spot = bestSpot(board, tray[s].shape);
      if (spot && (!move || spot.score > move.spot.score)) move = { slot: s, spot, piece: tray[s] };
    }
    if (!move) return { end: 'no_moves', elapsed, placed, lines };
    if (timeLeft <= 0) return { end: 'timeout', elapsed, placed, lines };
    // spend the human time for this placement
    elapsed += SECS_PER_PLACE; timeLeft -= SECS_PER_PLACE;
    if (timeLeft <= 0) return { end: 'timeout', elapsed, placed, lines };
    const { piece, spot } = move;
    for (const [dr, dc] of piece.shape.cells) board[spot.r + dr][spot.c + dc] = 1;
    tray[move.slot] = null; placed++;
    const rows = [], cols = [];
    for (let i = 0; i < N; i++) { if (board[i].every(Boolean)) rows.push(i); if (board.every((row) => row[i])) cols.push(i); }
    const n = rows.length + cols.length;
    if (n) {
      combo++; sinceClear = 0; lines += n;
      const cells = new Set();
      rows.forEach((rr) => { for (let i = 0; i < N; i++) cells.add(rr * N + i); });
      cols.forEach((cc) => { for (let i = 0; i < N; i++) cells.add(i * N + cc); });
      for (const id of cells) board[Math.floor(id / N)][id % N] = null;
      timeLeft = Math.min(TIMER.cap, timeLeft + timeForClear(n));
    } else { sinceClear++; if (sinceClear >= 3) combo = 0; }
    if (tray.every((p) => !p)) tray = dealTray({ board, placed, helperAvailable: false }, rng).tray;
    if (placed > 600) return { end: 'cap', elapsed, placed, lines };
  }
}
const GAMES = 300, out = [];
for (let i = 0; i < GAMES; i++) out.push(playGame(12345 + i * 7919));
out.sort((a, b) => a.elapsed - b.elapsed);
const med = out[Math.floor(GAMES / 2)];
const byEnd = {};
for (const g of out) byEnd[g.end] = (byEnd[g.end] || 0) + 1;
const avg = (k) => (out.reduce((a, g) => a + g[k], 0) / GAMES).toFixed(1);
console.log(JSON.stringify({ games: GAMES, median_secs: med.elapsed, median_min: +(med.elapsed / 60).toFixed(2), median_placed: out[Math.floor(GAMES / 2)].placed, median_lines: out[Math.floor(GAMES / 2)].lines, p10_secs: out[Math.floor(GAMES * 0.1)].elapsed, p90_secs: out[Math.floor(GAMES * 0.9)].elapsed, avg_placed: avg('placed'), avg_lines: avg('lines'), end_reasons: byEnd }, null, 2));
