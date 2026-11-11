/*
 * Clearbloom difficulty module. These rules are the whole story; they are also
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
 * 6. Daily challenge: same rules 1-3 and the same scoring, but pieces come from
 *    a seeded generator whose seed is only the local date (YYYY-MM-DD). Same
 *    date + same moves = same pieces for everyone. The comeback helper (rule 4)
 *    is off in the daily so every player faces the identical deal. The daily
 *    has its own best score per date; it does not count toward rule 4 history.
 * 5. Score is never adjusted: points come only from the scoring table in
 *    main.js. High score is the exact highest final score.
 * 6. Timer: every game starts with TIMER.start seconds (see TIMER below).
 *    Clearing lines adds time (TIMER.perLine per line, plus TIMER.extraPerLine
 *    per extra line on a multi-line clear), capped at TIMER.cap. Time out ends
 *    the game like no-moves-left; a revive refills to TIMER.reviveRefill. The
 *    timer pauses during the tutorial, pause/menu, settings, ads, and when the
 *    app is backgrounded. Same numbers for everyone, stored here — never in
 *    ads.js, never per-player. From 20 s a big countdown shows and a gentle
 *    tick sounds each second (faster in the last 5 s).
 * 7. Power-ups: earned only through play (POWERUPS below) — one charge per
 *    3-line combo and per 10 lines cleared, at most POWERUPS.maxCharges held.
 *    Never sold, never ad-gated, same rules for everyone, reset every game.
 *    Each charge lasts POWERUPS.chargeLifetimeSeconds seconds of PLAY time
 *    (the clock pauses whenever the game timer pauses, and while a banner is
 *    showing), oldest first; an expired charge fades away with no points.
 *    If no tray piece fits while a charge is held, the game auto-uses one to
 *    save you — Reshuffle first, then the Bomb on the 3x3 that makes the most
 *    room for a tray piece, then the Sweep on the fullest row or column.
 *    The choice is deterministic and the same for everyone. Timeout never
 *    auto-uses a charge: it ends the game like no-moves-left.
 * 8. Levels: the in-game level is levelFor(pieces placed) — the same ramp as
 *    rule 1, so difficulty stays transparent. Levelling up adds
 *    TIMER.levelUpBonus seconds and a celebration. The lifetime player level
 *    (see js/progress.js) is XP from lines, combos and games played; it only
 *    ever unlocks cosmetics, never changes difficulty, pieces or loss timing
 *    for any player. No random rewards, no loot boxes, no near-misses.
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

// ---- Timer (same numbers for everyone; never per-player, never ad-based) ----
// Start 120 s. Each cleared line adds +6 s; a multi-line clear adds another
// +2 s per extra line (2 lines = +14 s, 3 lines = +22 s). The bar caps at
// 150 s. A rewarded revive refills the timer to 60 s. Levelling up mid-game
// adds +5 s. From 20 s a big countdown shows. The timer pauses during the
// tutorial, pause/menu, settings, ads, and when the app is backgrounded.
export const TIMER = { start: 120, perLine: 6, extraPerLine: 2, cap: 150, reviveRefill: 60, lowSeconds: 20, levelUpBonus: 5 };
export function timeForClear(lines) {
  if (lines <= 0) return 0;
  return lines * TIMER.perLine + (lines - 1) * TIMER.extraPerLine;
}

// ---- Power-ups (earned only through play; never sold, never ad-gated) ----
// Earn one charge for each 3-line combo (3+ lines cleared in one placement)
// and for every 10 lines cleared in total (milestones at 10, 20, 30, ...).
// A single placement can earn two charges if it is a 3-line clear that also
// crosses a 10-line milestone. Charges are granted in a fixed rotation
// (bomb, sweep, reshuffle, star) and the player holds at most 3 in total.
// Charges do not carry between games. Daily uses the same rules.
// Power-up clears score 10 points per cell, with no combo multiplier, and do
// not count toward earning more power-ups (no earn loops).
// NOTE on wording: "add 15 s back by clearing lines" is covered by the
// +6 s per line above plus the Time Star's +15 s — there is no separate
// +15 s per clear.
export const POWERUPS = {
  maxCharges: 3, linesMilestone: 10, timeStarSeconds: 15, chargeLifetimeSeconds: 30,
  earnOrder: ['bomb', 'sweep', 'reshuffle', 'star'],
  defs: {
    bomb: { name: 'Boom Bomb', icon: 'bomb', hint: 'Clears a 3x3 area.' },
    sweep: { name: 'Eraser Sweep', icon: 'eraser', hint: 'Clears one row or column.' },
    reshuffle: { name: 'Shuffle Tray', icon: 'shuffle', hint: 'Deals a new tray.' },
    star: { name: 'Time Star', icon: 'clock', hint: '+15 seconds.' },
  },
};
export function powerUpPoints(cells) { return 10 * cells; }

export const RULES_TEXT = [
  `Level goes up by 1 every ${LEVEL_EVERY} pieces you place. Everyone gets the same curve.`,
  'Higher levels shift the random mix toward bigger, more awkward pieces and away from tiny ones.',
  `Fair deal: if none of a new tray's 3 pieces fits anywhere, the tray is re-rolled (up to ${FAIR_REROLLS} tries).`,
  `Comeback helper: after ${HELPER.lossesNeeded} games in a row under half your best, your next game gets one helper piece (marked ✦) that fits and clears a line when the board gets crowded. Once per game.`,
  'Daily challenge: same rules and scoring, but everyone plays the same pieces for the same moves today. No helper piece in the daily. It keeps its own best score per day.',
  `How the timer works: every game starts with ${TIMER.start} seconds on the labelled TIME bar above the board. Each line you clear adds ${TIMER.perLine} seconds, plus ${TIMER.extraPerLine} more per extra line on a multi-line clear (2 lines = +${timeForClear(2)} s, 3 lines = +${timeForClear(3)} s). The bar caps at ${TIMER.cap} seconds. From ${TIMER.lowSeconds} seconds a big countdown shows and a gentle tick sounds. When it runs out, the game ends, just like having no moves left — and the same optional revive is offered, which also refills the timer to ${TIMER.reviveRefill} seconds. Levelling up mid-game adds ${TIMER.levelUpBonus} seconds. The timer pauses during the tutorial, pause, settings, and ads. The same numbers apply to everyone.`,
  `Power-ups, earned only by playing: clear 3 lines at once, or reach every ${POWERUPS.linesMilestone} lines, and you earn one charge (at most ${POWERUPS.maxCharges} held). Each charge lasts ${POWERUPS.chargeLifetimeSeconds} seconds of play time — use it fast, or it fades away with a soft poof and no points. The ring on a filled slot drains as its oldest charge runs down (seconds left shown, pulsing under 5 s). If you run out of moves while holding a charge, the game uses one to save you automatically — Reshuffle first, then the Bomb on the 3x3 that makes the most room for a tray piece, then the Sweep on the fullest row or column — with a "SAVED!" banner. Boom Bomb clears a 3x3 area, Eraser Sweep clears one row or column you choose, Shuffle Tray deals a new tray, Time Star adds ${POWERUPS.timeStarSeconds} seconds. Tap a power-up, then tap its target — tap again or the ✕ to cancel. Power-up clears score 10 points per cell with no combo multiplier and never earn more power-ups. Charges reset every game. Nothing here is sold or tied to ads.`,
  `Levels: your in-game level starts at Level 1 and rises by 1 every ${LEVEL_EVERY} pieces you place (max Level 11) — the labelled LEVEL bar above the TIME bar shows your progress to the next level, and levelling up adds ${TIMER.levelUpBonus} seconds plus a celebration. Your lifetime player level grows from XP (10 per line, 5 per max combo, 25 per game played) and only ever unlocks cosmetic stickers, block skins, board frames and backgrounds — it never changes difficulty, pieces or timing for anyone.`,
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
