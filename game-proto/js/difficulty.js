/*
 * Gridbloom difficulty module. These rules are the whole story; they are also
 * shown to players in the "How difficulty works" screen (RULES_TEXT below).
 *
 * INPUTS this module is allowed to see:
 *   - the current board (which cells are filled)
 *   - how many pieces were placed this game
 *   - the player's own recent final scores on this device (for rule 4)
 * INPUTS it never sees (by design, not just by policy):
 *   - ad readiness, ad fill, ad value, past ad views or revenue
 *   - device model, country, settings, purchases
 * ads.js is never imported here, and nothing passes ad state into these functions.
 *
 * RULES
 * 1. Level: level = min(10, floor(piecesPlacedThisGame / 15)). Same for everyone.
 * 2. Piece mix: each size class has a weight that moves linearly from its
 *    level-0 value to its level-10 value (WEIGHTS below). Higher levels mean
 *    more big and awkward pieces, fewer tiny ones. Pieces are random within
 *    those weights.
 * 3. Fair deal: when a new tray of 3 is dealt, if none of the 3 pieces fits
 *    anywhere on the board, the tray is re-rolled (up to 5 tries). This helps
 *    every player equally and never depends on anything but the board.
 * 4. Comeback helper: if your last 2 finished games both ended below 50% of
 *    your best score (and your best is at least 300), then ONCE in your next
 *    game, the first time a tray is dealt while the board is at least 45% full,
 *    one piece is swapped for a "helper" piece that fits and completes a row or
 *    column if any such piece exists. It is marked with a ✦ in the tray and
 *    logged as helper_piece_dealt. It is never taken away or tied to ads.
 * 5. Score is never adjusted: points come only from the scoring table in
 *    main.js. High score is the exact highest final score.
 */
import { SHAPES, makePiece } from './pieces.js';

export const N = 8;

export const WEIGHTS = {
  //          level 0  level 10
  tiny:  [3.0, 0.8],
  small: [4.0, 2.5],
  mid:   [5.0, 5.0],
  big:   [1.6, 3.6],
  huge:  [0.4, 1.4],
};
export const LEVEL_EVERY = 15;
export const FAIR_REROLLS = 5;
export const HELPER = { lossesNeeded: 2, belowFractionOfBest: 0.5, minBest: 300, boardFill: 0.45 };

export const RULES_TEXT = [
  `Level goes up by 1 every ${LEVEL_EVERY} pieces you place (max 10). Everyone gets the same curve.`,
  'Higher levels shift the random mix toward bigger, more awkward pieces and away from tiny ones.',
  `Fair deal: if none of a new tray's 3 pieces fits anywhere, the tray is re-rolled (up to ${FAIR_REROLLS} tries).`,
  `Comeback helper: after ${HELPER.lossesNeeded} games in a row under half your best, your next game gets one helper piece (marked ✦) that fits and clears a line when the board gets crowded. Once per game.`,
  'Ads never touch difficulty, pieces, or score. Watching an ad only ever gives the revive you chose.',
];

export function levelFor(placed) { return Math.min(10, Math.floor(placed / LEVEL_EVERY)); }

function weightsFor(level) {
  const k = level / 10, out = {};
  for (const [cls, [a, b]] of Object.entries(WEIGHTS)) out[cls] = a + (b - a) * k;
  return out;
}

export function fits(board, shape, r, c) {
  for (const [dr, dc] of shape.cells) {
    const rr = r + dr, cc = c + dc;
    if (rr < 0 || cc < 0 || rr >= N || cc >= N || board[rr][cc]) return false;
  }
  return true;
}
export function fitsAnywhere(board, shape) {
  for (let r = 0; r <= N - shape.h; r++) for (let c = 0; c <= N - shape.w; c++) if (fits(board, shape, r, c)) return true;
  return false;
}
function fillRatio(board) { let n = 0; for (const row of board) for (const v of row) if (v) n++; return n / (N * N); }

function linesCompletedBy(board, shape, r, c) {
  const b = board.map((row) => row.slice());
  for (const [dr, dc] of shape.cells) b[r + dr][c + dc] = 1;
  let n = 0;
  for (let i = 0; i < N; i++) { if (b[i].every(Boolean)) n++; if (b.every((row) => row[i])) n++; }
  return n;
}

function randomShape(level, rng) {
  const w = weightsFor(level);
  const pool = SHAPES.map((s) => w[s.cls] / SHAPES.filter((x) => x.cls === s.cls).length);
  let t = rng() * pool.reduce((a, b) => a + b, 0);
  for (let i = 0; i < SHAPES.length; i++) { t -= pool[i]; if (t <= 0) return SHAPES[i]; }
  return SHAPES[SHAPES.length - 1];
}

// history: array of the player's recent final scores (newest last). best: best score.
export function helperEligible(history, best) {
  if (best < HELPER.minBest || history.length < HELPER.lossesNeeded) return false;
  return history.slice(-HELPER.lossesNeeded).every((s) => s < best * HELPER.belowFractionOfBest);
}

function findHelper(board) {
  let bestShape = null, bestLines = 0;
  for (const s of SHAPES) {
    for (let r = 0; r <= N - s.h; r++) for (let c = 0; c <= N - s.w; c++) {
      if (!fits(board, s, r, c)) continue;
      const l = linesCompletedBy(board, s, r, c);
      if (l > bestLines || (l === bestLines && l > 0 && s.cells.length > bestShape.cells.length)) { bestLines = l; bestShape = s; }
    }
  }
  if (bestShape) return bestShape;
  return SHAPES.find((s) => fitsAnywhere(board, s)) || SHAPES[0];
}

/**
 * Deal a tray of 3 pieces.
 * ctx = { board, placed, helperAvailable } -> { tray, helperUsed, rerolls, level }
 */
export function dealTray({ board, placed, helperAvailable }, rng = Math.random) {
  const level = levelFor(placed);
  let tray, rerolls = 0;
  for (;;) {
    tray = [0, 1, 2].map(() => makePiece(randomShape(level, rng), rng));
    if (tray.some((p) => fitsAnywhere(board, p.shape)) || rerolls >= FAIR_REROLLS) break;
    rerolls++;
  }
  let helperUsed = false;
  if (helperAvailable && fillRatio(board) >= HELPER.boardFill) {
    const p = makePiece(findHelper(board), rng);
    p.helper = true;
    tray[Math.floor(rng() * 3)] = p;
    helperUsed = true;
  }
  return { tray, helperUsed, rerolls, level };
}
