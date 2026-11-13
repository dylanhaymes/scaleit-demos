import { N, dealTray, fits, fitsAnywhere, helperEligible, levelFor, TIMER, POWERUPS, timeForClear, powerUpPoints, LEVEL_EVERY, rollVariant } from './difficulty.js';
import { xpForGame, playerLevelFor, playerProgress, nextReward, rewardsForLevel } from './progress.js';
import { Ads } from './ads.js';
import { Analytics } from './analytics.js';
import { Sfx, Music } from './audio.js';
import { Haptics } from './haptics.js';
import { COMBO_GRACE, BOARD_CLEAR_BONUS, clearPoints } from './scoring.js';
import { dailyRng, localDateKey, hashSeed, makeRng } from './rng.js';
import { SHAPES, makePiece, setActivePalette } from './pieces.js';
import { APP_NAME } from './brand.js';
import { Sprites } from './sprites.js';
import { PACKS, packBySlug, isPackUnlocked, lockText, loadCosmetics, selectedPack, setSelectedPack, toggleFavorite, recolorHex, unlockContext } from './cosmetics.js';
import { Accounts, authErrorMessage } from './accounts.js';
import { Leaderboards, mockBoard, sampleRank, boardKey, weekKeyFor, escapeHtml } from './leaderboards.js';
import { Challenges, challengeRng, challengeStatus, timeLeftText } from './challenges.js';
import { Store } from './store.js';

const $ = (id) => document.getElementById(id);
const cv = $('cv'), g = cv.getContext('2d');
const cvb = $('cv-board'), gb = cvb.getContext('2d'); // static layer: background + board well, drawn only on resize

// Scoring table lives in js/scoring.js (the only source of points).

// ---------- Persistent stats ----------
const store = {
  get best() { return +localStorage.getItem('gb_best') || 0; },
  set best(v) { localStorage.setItem('gb_best', String(v)); },
  get history() { try { return JSON.parse(localStorage.getItem('gb_history') || '[]'); } catch { return []; } },
  pushHistory(s) { const h = this.history; h.push(s); localStorage.setItem('gb_history', JSON.stringify(h.slice(-20))); },
  get dailyBests() { try { return JSON.parse(localStorage.getItem('gb_daily_best') || '{}'); } catch { return {}; } },
  dailyBest(k) { return this.dailyBests[k] || 0; },
  setDailyBest(k, v) { const m = this.dailyBests; m[k] = v; const keys = Object.keys(m).sort().slice(-60); localStorage.setItem('gb_daily_best', JSON.stringify(Object.fromEntries(keys.map((x) => [x, m[x]])))); },
  // Daily one-and-done (Dylan, Nov 12): the dateKey of the last daily the
  // player FINISHED. '' when no daily has ever been finished. A finished
  // daily can never be offered as "Continue daily" again that day.
  get dailyDone() { return localStorage.getItem('gb_daily_done') || ''; },
  markDailyDone(k) { localStorage.setItem('gb_daily_done', k); },
  // Lifetime player XP (cosmetics only — never affects difficulty).
  get xp() { return +localStorage.getItem('gb_xp') || 0; },
  set xp(v) { localStorage.setItem('gb_xp', String(v)); },
  get games() { return +localStorage.getItem('gb_games') || 0; },
  set games(v) { localStorage.setItem('gb_games', String(v)); },
};
// Reduced motion: system preference, or the Settings toggle (gb_motion=1).
const reducedMotion = () => localStorage.getItem('gb_motion') === '1' || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const SAVE_KEY = 'gb_save', SAVE_V = 2;

// ---------- State ----------
const S = {
  board: [], tray: [null, null, null], score: 0, shownScore: 0, combo: 0, sinceClear: 0, maxCombo: 0,
  lines: 0, placed: 0, helperAvailable: false, running: false, gamesThisSession: 0,
  startBest: 0, startedAt: 0, mode: 'classic', dateKey: null, rng: Math.random, variant: 'relaxed',
  // Challenge game (Update 3, batch 3): the challenge doc id, the score to
  // beat (the opponent's best so far, 0 if they haven't played), their name,
  // and their score (null until they play). dateKey holds the challenge seed.
  challengeId: null, challengeToBeat: 0, challengeOpponent: '', challengeOpponentScore: null,
  timeLeft: TIMER.start, timerStarted: false, lowTonePlayed: false,
  charges: { bomb: 0, sweep: 0, reshuffle: 0, star: 0 }, earnIdx: 0,
  // Charges never expire (Dylan, Nov 12: the 30 s use-it-or-lose-it clock
  // is removed). A charge stays until the player uses it or it is auto-used
  // to save a no-moves board. No clocks, no ring drain, no poof.
  autoSaving: false, bannerUntil: 0,
  armed: null, sweepMode: 'row', level: 1,
};
const emptyCharges = () => ({ bomb: 0, sweep: 0, reshuffle: 0, star: 0 });
const totalCharges = () => Object.values(S.charges).reduce((a, b) => a + b, 0);
// Charges persist until used (no expiry). Earn in the fixed rotation,
// oldest first when a charge is spent (FIFO per type is implicit: counts
// only, no per-charge state).
function addCharge(type) {
  S.charges[type]++;
}
function spendCharge(type) {
  if (!S.charges[type]) return;
  S.charges[type]--;
  renderPowerups();
}
// Ring + milestone text for the dock. A held charge shows a full ring (it
// is ready, no countdown); an empty slot shows the lines-toward-next-charge
// progress (into/10). Only touches the DOM when the shown value changes.
const lastRingShown = {};
function renderChargeRings() {
  document.querySelectorAll('#powerups .pu').forEach((b) => {
    const type = b.dataset.pu, n = S.charges[type] || 0;
    const ring = b.querySelector('.pu-ring'), prog = b.querySelector('.pu-progress');
    if (n > 0) {
      if (lastRingShown[type] !== 'held') {
        lastRingShown[type] = 'held';
        ring.style.setProperty('--ring', 100);
        prog.textContent = '';
      }
    } else {
      const into = S.lines % POWERUPS.linesMilestone;
      const key = 'm' + into;
      if (lastRingShown[type] !== key) {
        lastRingShown[type] = key;
        ring.style.setProperty('--ring', Math.round((into / POWERUPS.linesMilestone) * 100));
        prog.textContent = `${into}/${POWERUPS.linesMilestone}`;
      }
    }
  });
}
const modeBest = () => (S.mode === 'daily' ? store.dailyBest(S.dateKey) : S.mode === 'challenge' ? S.challengeToBeat : store.best);
const fx = { particles: [], clearing: [], popups: [], shake: 0, placedFlash: [], trayIn: 0, glow: 0, shimmer: 0, squash: [], rings: [], beams: [], trayFlip: 0 };
let L = {}; // layout
let drag = null;

function emptyBoard() { return Array.from({ length: N }, () => Array(N).fill(null)); }

// ---------- Layout ----------
function layout() {
  // DPR capped at 2: block sprites are rendered at ~3x cell size and
  // downscaled, so they stay crisp at 2x/3x without a 3x canvas.
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = cv.clientWidth, h = cv.clientHeight;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Board as large as fits while the HUD, the full power-up dock and safe
  // edges still fit: width-bound (frame kept inside the canvas, bx >= 15),
  // height-bound at 72% of the stage so the tray still has room, capped
  // at 640 so very tall desktops don't grow a giant board. (72%, not 70%:
  // the fixed 36px armed-descriptor slot below the stage reserves vertical
  // space, and the board must stay >= 350px on desktop.)
  const boardSize = Math.floor(Math.min(w - 30, h * 0.72, 640));
  const cell = boardSize / N;
  const bx = (w - boardSize) / 2;
  const trayH = Math.min(cell * 3.4, h - boardSize - 30);
  const by = Math.max(10, (h - boardSize - trayH) / 2 - 6);
  // Tray slots live within the board's width (trayX..trayX+size), not spread
  // across the full canvas — on wide screens w/3 slots floated far apart.
  // Tray tiles rest LARGE: 85% of a board cell (was 55%), capped per piece
  // by trayCellFor() so wide/tall pieces never overflow their slot.
  L = { w, h, cell, bx, by, size: boardSize, trayX: bx, trayY: by + boardSize + 16, trayH, slotW: boardSize / 3, trayCell: cell * 0.85 };
  // Static layer: pre-rendered background + board well, drawn once here (on
  // resize/startup) instead of every frame — the frame loop then only blits
  // blocks, tray, particles and popups.
  if (Sprites.ready) {
    cvb.width = Math.round(w * dpr); cvb.height = Math.round(h * dpr);
    gb.setTransform(dpr, 0, 0, dpr, 0, 0);
    gb.drawImage(Sprites.background(w, h), 0, 0, w, h);
    gb.drawImage(Sprites.board(boardSize, cell), bx - 14, by - 14, boardSize + 28, boardSize + 28);
  }
  // Position the glowing board frame (DOM, behind the canvas) around the board.
  const glow = $('board-glow');
  glow.style.left = (bx - 14) + 'px'; glow.style.top = (by - 14) + 'px';
  glow.style.width = (boardSize + 28) + 'px'; glow.style.height = (boardSize + 28) + 'px';
}
window.addEventListener('resize', layout);
// Re-layout whenever the stage itself changes size. iOS Safari's URL bar
// showing/hiding (and any flex-sibling height change) can resize #stage
// without firing window 'resize' — the board/tray are drawn from the
// layout values, so a stale layout crops the tray at the canvas edge
// (Dylan, Nov 12, 6:10 PM iPhone shot: tray sliced mid-game). A
// ResizeObserver catches every stage resize regardless of cause.
// layout() never changes #stage's own size, so this cannot loop.
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => layout()).observe($('stage'));
}

// ---------- Drawing helpers ----------
// Blocks are pre-rendered glossy 3D sprites (js/sprites.js) — blitted, never
// drawn with per-frame gradients/shadows. No markings, icons, lines or
// textures on the blocks themselves.
function rrect(x, y, w, h, r) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); }
function block(x, y, s, color, alpha = 1, scale = 1) {
  const pad = s * 0.06, ss = (s - pad * 2) * scale, o = (s - ss) / 2;
  const cx = x + o + ss / 2, cy = y + o + ss / 2;
  if (!Sprites.ready) { g.globalAlpha = alpha; g.fillStyle = color; rrect(x + o, y + o, ss, ss, ss * 0.22); g.fill(); g.globalAlpha = 1; return; }
  const sprite = color === '#ffffff' ? Sprites.white() : Sprites.block(color);
  Sprites.drawBlock(g, sprite, cx, cy, ss, alpha, 1);
}

function pieceAt(piece, x, y, s, alpha = 1) { for (const [r, c] of piece.shape.cells) block(x + c * s, y + r * s, s, piece.color, alpha); }

// Resting tray tile size for one piece: as large as fits its slot — 85% of a
// board cell, but capped so a wide (5-long) or tall (5-high) piece never
// overflows its slot or the tray height.
function trayCellFor(sh) {
  return Math.min(L.cell * 0.85, (L.slotW * 0.96) / sh.w, (L.trayH * 0.92) / sh.h);
}

// ---------- Placement / preview ----------
function dropCell() {
  if (!drag) return null;
  const s = L.cell, p = drag.piece.shape;
  const px = drag.x - (p.w * s) / 2, py = drag.y - (p.h * s) / 2;
  // +1e-9 epsilon: float noise can make an exact .5 quotient read as e.g.
  // 2.4999999, which Math.round would send to the wrong cell. The epsilon is
  // far above float64 noise (~1e-15 at these magnitudes) and far below a
  // meaningful offset, so it only rescues the exact-boundary case. It keeps
  // Math.round's .5-rounds-up behaviour for a piece dropped exactly on a
  // cell-centre boundary.
  const c = Math.round((px - L.bx) / s + 1e-9), r = Math.round((py - L.by) / s + 1e-9);
  return { r, c, ok: fits(S.board, p, r, c) };
}
function wouldClear(shape, r, c) {
  const b = S.board.map((row) => row.map(Boolean));
  for (const [dr, dc] of shape.cells) b[r + dr][c + dc] = true;
  const rows = [], cols = [];
  for (let i = 0; i < N; i++) { if (b[i].every(Boolean)) rows.push(i); if (b.every((row) => row[i])) cols.push(i); }
  return { rows, cols };
}

// ---------- Render loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  update(dt); draw(now / 1000);
  requestAnimationFrame(frame);
}
function update(dt) {
  for (const p of fx.particles) { p.vy += 900 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; p.life -= dt; }
  fx.particles = fx.particles.filter((p) => p.life > 0);
  for (const c of fx.clearing) c.t += dt;
  fx.clearing = fx.clearing.filter((c) => c.t < 0.45);
  for (const p of fx.popups) p.t += dt;
  fx.popups = fx.popups.filter((p) => p.t < 1.2 + (p.delay || 0));
  for (const p of fx.placedFlash) p.t += dt;
  fx.placedFlash = fx.placedFlash.filter((p) => p.t < 0.25);
  for (const p of fx.squash) p.t += dt;
  fx.squash = fx.squash.filter((p) => p.t < 0.18);
  for (const p of fx.rings) p.t += dt;
  fx.rings = fx.rings.filter((p) => p.t < 0.6);
  for (const p of fx.beams) p.t += dt;
  fx.beams = fx.beams.filter((p) => p.t < 0.4);
  fx.trayFlip = Math.max(0, fx.trayFlip - dt * 3);
  fx.shake = reducedMotion() ? 0 : Math.max(0, fx.shake - dt * 30);
  fx.glow = Math.max(0, fx.glow - dt * 1.4);
  fx.shimmer = Math.max(0, fx.shimmer - dt * 1.1);
  fx.trayIn = Math.min(1, fx.trayIn + dt * 4);
  tickTimer(dt);
  if (S.shownScore < S.score) {
    S.shownScore = Math.min(S.score, S.shownScore + Math.max(1, (S.score - S.shownScore) * dt * 10));
    renderScore(Math.round(S.shownScore));
    $('score').classList.add('rolling');
  } else $('score').classList.remove('rolling');
}

// ---------- Timer ----------
// Pauses during the tutorial, pause/menu, settings, game-over/ad
// overlays, and when the app is backgrounded (rAF also stops when hidden, and
// dt is clamped, so no time jump on return). 'title' is in the list because
// Main Menu quits to the title mid-game: the run stays live (S.running is
// still true) and the timer + charge clocks must freeze until Continue.
function timerPaused() {
  if (!S.running || !S.timerStarted) return true;
  if (Tutorial.active) return true;
  if (document.hidden) return true;
  if (S.autoSaving) return true; // ~0.6s save freeze
  for (const id of ['menu', 'settings', 'over', 'ad', 'title']) if ($(id).classList.contains('show')) return true;
  return false;
}
let lastTickSecond = -1;
function tickTimer(dt) {
  if (timerPaused()) return;
  S.timeLeft -= dt;
  if (Music.setUrgency) Music.setUrgency(S.timeLeft <= TIMER.lowSeconds);
  if (S.timeLeft <= TIMER.lowSeconds && !S.lowTonePlayed) {
    S.lowTonePlayed = true;
    Music.lowTime();
  }
  // Big countdown from 20 s: gentle tick each second, a little faster pitch
  // in the last 5 s. The bar pulses red (CSS .low).
  const secs = Math.max(0, Math.ceil(S.timeLeft));
  if (S.timeLeft <= TIMER.lowSeconds && secs !== lastTickSecond) {
    lastTickSecond = secs;
    if (secs > 0) Sfx.tick(secs);
    const cd = $('countdown');
    renderCountdown(secs);
    cd.classList.add('on');
    cd.classList.toggle('urgent', secs <= 5);
    cd.classList.remove('pop'); void cd.offsetWidth; cd.classList.add('pop');
  } else if (S.timeLeft > TIMER.lowSeconds) {
    $('countdown').classList.remove('on');
    lastTickSecond = -1;
  }
  if (S.timeLeft <= 0) { S.timeLeft = 0; $('countdown').classList.remove('on'); renderTimerBar(); onTimeout(); return; }
  renderTimerBar();
}
let lastTimerShown = -1;
function renderTimerBar() {
  const secs = Math.max(0, Math.ceil(S.timeLeft));
  const fill = $('timer-fill');
  // Fill is relative to the START value, not the cap: the bar reads 100% at
  // game start (120 s) and only starts draining once time drops below
  // 120 s. Time earned above 120 s (up to the 150 s cap) keeps the bar
  // full. (Dylan, Nov 12: the bar never looked full at start — 120/150.)
  fill.style.width = Math.max(0, Math.min(100, (S.timeLeft / TIMER.start) * 100)) + '%';
  // Glossy pill colour shift: green -> yellow -> red as time runs low.
  // The mid threshold is start-relative too, so the bar is half-full at 60 s.
  const frac = S.timeLeft / TIMER.start;
  fill.classList.toggle('low', S.timeLeft <= TIMER.lowSeconds && S.running);
  fill.classList.toggle('mid', S.timeLeft > TIMER.lowSeconds && frac < 0.5 && S.running);
  $('timerbar').classList.toggle('low', S.timeLeft <= TIMER.lowSeconds && S.running);
  if (secs !== lastTimerShown) { lastTimerShown = secs; $('timer-text').textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`; }
}
// Timeout auto-save (Dylan, Nov 12): if a Time Star charge is held when the
// timer hits 0, the game spends ONE Time Star (+15 s, "SAVED!" banner) and
// play continues instead of ending. Only the Time Star can save a timeout —
// Bomb, Sweep and Reshuffle do not add time, so they never fire here. No
// Time charge held → the game ends exactly as before. At most one charge
// per timeout; each fresh timeout may spend another, until none remain.
// The ~0.6 s save freeze pauses the timer (timerPaused() is true while
// S.autoSaving), so a timeout cannot re-trigger mid-freeze. The try/finally
// guarantees the freeze always lifts — a presentation failure must never
// leave the timer frozen (soft-lock).
async function onTimeout() {
  if (!S.running) return;
  if (Music.setUrgency) Music.setUrgency(false);
  if (S.charges.star > 0) {
    Analytics.log('autosave_attempt', { cause: 'timeout', charges: { ...S.charges } });
    S.autoSaving = true;
    spendCharge('star');
    try {
      await presentSave('clock', 'star', $('timerbar'), () => {
        S.timeLeft = Math.min(TIMER.cap, S.timeLeft + POWERUPS.timeStarSeconds);
        renderTimerBar();
      });
    } catch (e) {
      Analytics.log('autosave_failed', { cause: 'timeout', error: String((e && e.message) || e) });
    } finally {
      S.autoSaving = false;
    }
    Analytics.log('autosave_saved', { type: 'star', cause: 'timeout', timeLeft: Math.round(S.timeLeft) });
    saveGame();
    return;
  }
  // No Time Star held: the game ends like no-moves-left.
  S.running = false;
  Analytics.log('time_out', { score: S.score, placed: S.placed, lines: S.lines });
  setTimeout(() => onNoMoves('timeout'), 450);
}
function setBoardGlow(kind) {
  const el = $('board-glow');
  if (kind === 'clear') { el.classList.remove('bloom'); void el.offsetWidth; el.classList.add('bloom'); setTimeout(() => el.classList.remove('bloom'), 700); }
  if (kind === 'combo') { el.classList.remove('shimmer'); void el.offsetWidth; el.classList.add('shimmer'); setTimeout(() => el.classList.remove('shimmer'), 1000); }
}
function draw(t) {
  const { w, h, cell: s, bx, by, size } = L;
  g.clearRect(0, 0, w, h);
  // Background + board well live on the static #cv-board layer (drawn in
  // layout()); this loop only draws what moves.
  g.save();
  if (fx.shake > 0) g.translate((Math.random() - 0.5) * fx.shake, (Math.random() - 0.5) * fx.shake);
  // preview
  let prev = null;
  if (drag) { const d = dropCell(); if (d && d.ok) prev = { ...d, ...wouldClear(drag.piece.shape, d.r, d.c) }; }
  if (prev) {
    g.fillStyle = 'rgba(255,255,255,0.08)';
    for (const r of prev.rows) { rrect(bx, by + r * s, size, s, s * 0.2); g.fill(); }
    for (const c of prev.cols) { rrect(bx + c * s, by, s, size, s * 0.2); g.fill(); }
  }
  // placed blocks — squash & stretch on freshly landed cells
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const col = S.board[r][c]; if (!col) continue;
    const hl = prev && (prev.rows.includes(r) || prev.cols.includes(c));
    const sq = fx.squash.find((q) => q.r === r && q.c === c);
    const scale = sq && !reducedMotion() ? 1 + 0.28 * (1 - sq.t / 0.18) : 1;
    block(bx + c * s, by + r * s, s, hl ? drag.piece.color : col, 1, scale);
  }
  for (const p of fx.placedFlash) { g.fillStyle = `rgba(255,255,255,${0.5 * (1 - p.t / 0.25)})`; rrect(bx + p.c * s + 2, by + p.r * s + 2, s - 4, s - 4, s * 0.2); g.fill(); }
  if (prev) {
    for (const [dr, dc] of drag.piece.shape.cells) {
      const r = prev.r + dr, c = prev.c + dc;
      const inLine = prev.rows.includes(r) || prev.cols.includes(c);
      block(bx + c * s, by + r * s, s, drag.piece.color, inLine ? 0.9 : 0.42);
    }
  }
  // Clearing animation: staggered glossy pop — each block swells gently
  // (no overshoot, no white flash) then shrinks away with a sparkle burst
  // (burst() is fired per cell when the clear is dealt). Staggered starts
  // (t < 0) draw the block normally until its turn. The old version
  // flashed white and swelled to 1.31x with an easeOutBack overshoot, so
  // clearing blocks read as shattered white tiles with fragments spilling
  // outside their cells (Dylan, Nov 12, 6:10 PM iPhone shot, col 4).
  // A block is drawn at 88% of a cell, so the 1.12x peak (0.88 x 1.12 =
  // 0.99) stays inside its own cell — one clean block + one centred star.
  for (const k of fx.clearing) {
    if (k.t < 0) { block(bx + k.c * s, by + k.r * s, s, k.color, 1, 1); continue; }
    const p = Math.min(1, k.t / 0.45);
    let scale, alpha;
    if (reducedMotion()) { scale = 1 - p * 0.8; alpha = 1 - p; }
    else if (p < 0.35) { scale = 1 + 0.12 * easeOut(p / 0.35); alpha = 1; }
    else {
      const q = (p - 0.35) / 0.65;
      scale = 1.12 * (1 - q * q); alpha = 1 - q;
    }
    block(bx + k.c * s, by + k.r * s, s, k.color, alpha, scale);
  }
  // tray — idle bob (off when reduced motion or while dragging that slot)
  for (let i = 0; i < 3; i++) {
    const p = S.tray[i]; if (!p || (drag && drag.slot === i)) continue;
    const sh = p.shape, ts = trayCellFor(sh);
    const bob = reducedMotion() ? 0 : Math.sin(t * 2 + i * 1.7) * 3;
    const flip = fx.trayFlip > 0 ? Math.abs(Math.cos(fx.trayFlip * Math.PI)) : 1;
    // Deal-in is a fade, never a drop: the old slide dropped fresh pieces
    // 80px below their resting spot, but the tray zone has only ~4px of
    // spare room above the stage bottom, so every re-deal sliced the
    // pieces off at the canvas edge for the first 0.25s (Dylan, Nov 12,
    // 6:10 PM iPhone shot, mid-game — the tray only breaks after play
    // starts, when the tray first re-deals). The flip below still animates
    // the deal; the fade keeps pieces exactly at rest the whole time.
    const cx = L.trayX + L.slotW * (i + 0.5), cy = L.trayY + L.trayH / 2 + bob;
    const canFit = fitsAnywhere(S.board, sh);
    const fade = 0.35 + 0.65 * easeOut(fx.trayIn);
    pieceAt(p, cx - (sh.w * ts) / 2, cy - (sh.h * ts) / 2, ts * flip, (canFit ? 1 : 0.35) * fade);
    if (p.helper && Sprites.ready) {
      // Helper star as a corner badge on the piece (no room above it now
      // that tray tiles are large — a star above would cover board cells).
      const d = ts * 0.95;
      const hx = cx + (sh.w * ts) / 2 - d * 0.25, hy = cy - (sh.h * ts) / 2 + d * 0.25;
      g.drawImage(Sprites.star('#ffd21f'), hx - d / 2, hy - d / 2, d, d);
    }
  }
  // Tutorial: highlight the exact target cells + the expected tray piece.
  if (Tutorial.active) Tutorial.drawHighlights(g, t);
  // dragged piece (full size, lifted) — the sprite already carries its soft
  // contact shadow, so no per-frame canvas shadow is set here.
  if (drag) {
    const sh = drag.piece.shape, sc = drag.scale;
    const ds = s * sc;
    pieceAt(drag.piece, drag.x - (sh.w * ds) / 2, drag.y - (sh.h * ds) / 2, ds, 0.95);
    drag.scale += (1 - drag.scale) * 0.35;
  }
  // particles: glossy gold stars + confetti (pre-rendered sprites)
  for (const p of fx.particles) {
    g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.globalAlpha = Math.min(1, p.life * 2);
    if (Sprites.ready) {
      const sp = p.confetti ? Sprites.confetti(p.color) : Sprites.star(p.color);
      // A missing sprite must never kill the frame loop: drawImage of
      // undefined throws, frame() never re-schedules rAF, and the game
      // freezes forever with the last frame on screen (Dylan, Nov 12,
      // 9:06 PM: Crayon Box freeze). Skip the particle instead.
      if (!sp) { g.restore(); continue; }
      const d = p.size * 3.4;
      g.drawImage(sp, -d / 2, -d / 2, d, d);
    } else {
      g.fillStyle = p.color;
      g.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
    }
    g.restore();
  }
  // Bomb shockwave rings (expanding gold circles).
  for (const p of fx.rings) {
    const k = p.t / 0.6;
    g.globalAlpha = (1 - k) * 0.9; g.strokeStyle = '#ffd21f'; g.lineWidth = 5 * (1 - k) + 1;
    g.beginPath(); g.arc(p.x, p.y, 10 + k * p.r, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = 1;
  }
  // Sweep laser beam (bright swipe across a row or column).
  for (const p of fx.beams) {
    const k = p.t / 0.4, a = (1 - k) * 0.9;
    g.globalAlpha = a;
    g.fillStyle = '#fff';
    if (p.axis === 'row') g.fillRect(L.bx, L.by + p.idx * L.cell + L.cell * 0.3, L.size, L.cell * 0.4);
    else g.fillRect(L.bx + p.idx * L.cell + L.cell * 0.3, L.by, L.cell * 0.4, L.size);
    g.fillStyle = '#ffd21f';
    if (p.axis === 'row') g.fillRect(L.bx, L.by + p.idx * L.cell + L.cell * 0.42, L.size, L.cell * 0.16);
    else g.fillRect(L.bx + p.idx * L.cell + L.cell * 0.42, L.by, L.cell * 0.16, L.size);
    g.globalAlpha = 1;
  }
  // popups — chunky display type. Each popup can carry a delay so a
  // multi-line clear doesn't pile "Double! / Combo xN / Board clear +300"
  // on top of each other mid-animation — they used to all start at t=0 in
  // the middle of the board (see fix9-tut-powerup shots). The lanes are
  // spread 0.20 of a board apart and the delays stagger the pop-in.
  for (const p of fx.popups) {
    const t = p.t - (p.delay || 0);
    if (t < 0) continue;
    const k = t / 1.2;
    g.globalAlpha = 1 - k * k; g.textAlign = 'center'; g.font = `800 ${p.size * (1 + 0.25 * easeOut(Math.min(1, t * 5)))}px 'Baloo 2', 'Fredoka', system-ui, sans-serif`;
    g.lineWidth = 6; g.strokeStyle = 'rgba(122,60,0,0.75)'; g.strokeText(p.text, p.x, p.y - k * 50);
    g.fillStyle = p.color; g.fillText(p.text, p.x, p.y - k * 50); g.globalAlpha = 1;
  }
  g.restore();
}
const easeOut = (x) => 1 - Math.pow(1 - x, 3);

// Per-cell clear bursts are stars only (starsOnly): the angular confetti
// shards read as the piece itself shattering — red/yellow fragments
// spilling outside the tile (Dylan, Nov 12, 6:10 PM iPhone shot). The
// bomb's single centre burst keeps confetti (an explosion, not a piece).
function burst(x, y, color, n = 10, starsOnly = false) {
  if (reducedMotion()) n = Math.min(n, 4);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = 120 + Math.random() * 380;
    fx.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 260, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12,
      life: 0.6 + Math.random() * 0.6, size: 3 + Math.random() * 6, color: Math.random() < 0.3 ? '#ffd21f' : color, confetti: !starsOnly && Math.random() < 0.35 });
  }
}
// Jackpot-style burst: star + confetti shower across the board (visual
// juice only — never a random reward, never a gamble mechanic).
function jackpotBurst() {
  const n = reducedMotion() ? 12 : 48;
  for (let i = 0; i < n; i++) {
    const x = L.bx + Math.random() * L.size, y = L.by + Math.random() * L.size * 0.6;
    const color = ['#ffd21f', '#ff5da2', '#2f8cff', '#2fd65a', '#ff8a1e'][i % 5];
    fx.particles.push({ x, y, vx: (Math.random() - 0.5) * 200, vy: -80 - Math.random() * 260, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 10,
      life: 0.9 + Math.random() * 0.7, size: 4 + Math.random() * 6, color, confetti: i % 2 === 0 });
  }
}
function popup(text, x, y, color = '#fff', size = 28, delay = 0) {
  // One popup per lane: a newer clear replaces the still-fading one in the
  // same lane instead of printing over it. Rapid combo chains used to show
  // "Combo x2" under "Combo x3" and two "Board clear +300" at once
  // (fix9-tut-powerup shot). Lanes have exactly equal y every time, so an
  // exact-y match is the lane key; the piece-anchored +pts popup never
  // shares a lane's y (cell centres sit between the lanes).
  const old = fx.popups.find((p) => p.y === y);
  if (old) { Object.assign(old, { text, x, y, color, size, t: 0, delay }); return; }
  fx.popups.push({ text, x, y, color, size, t: 0, delay });
}
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 1800); }
// Big-moment banner (DOM svg, chunky display type). Visual juice only.
// The text is an SVG <text> (fix13) — the pop animation lives on the
// <svg> element, not the text: an SVG <text> has no offsetWidth, so the
// restart-reflow trick would not work on it.
let bannerTimer = null;
function showBanner(text, ms = 1100) {
  const b = $('banner');
  $('banner-badge').classList.add('hidden');
  const svg = $('banner-svg');
  const span = $('banner-text');
  span.classList.remove('hidden');
  span.textContent = text;
  b.classList.remove('hidden');
  S.bannerUntil = Date.now() + ms; // charge clocks pause while a banner shows
  svg.style.animation = 'none'; void svg.offsetWidth; svg.style.animation = '';
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => b.classList.add('hidden'), ms);
}
// NEW BEST celebration: the same glossy gold medallion as the game-over
// panel, shown big with a spring pop + sparkle burst (jackpotBurst at the
// call site). Not a text banner — a whole badge that appears.
function showBestBadge(ms = 1500) {
  const b = $('banner');
  $('banner-text').classList.add('hidden');
  const badge = $('banner-badge');
  badge.classList.remove('hidden');
  b.classList.remove('hidden');
  S.bannerUntil = Date.now() + ms;
  badge.style.animation = 'none'; void badge.offsetWidth; badge.style.animation = '';
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => b.classList.add('hidden'), ms);
}
function edgeFlash() {
  if (reducedMotion()) return;
  const el = $('edge-flash');
  el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
}
// Fly an icon from (x, y) page coordinates to a target — either a DOM
// element (its centre) or an {x, y} page point (e.g. a board cell) — with a
// sparkle trail. Skipped instantly under reduced motion.
function flyIcon(iconName, fromX, fromY, target, done) {
  const layer = $('fly-layer');
  if (reducedMotion() || !target) { if (done) done(); return; }
  let tx, ty;
  if (typeof target.getBoundingClientRect === 'function') {
    const r = target.getBoundingClientRect();
    tx = r.left + r.width / 2; ty = r.top + r.height / 2;
  } else { tx = target.x; ty = target.y; }
  const el = document.createElement('div');
  el.className = 'fly-icon';
  el.innerHTML = `<img src="${Sprites.iconURL(iconName)}" alt="">`;
  el.style.left = (fromX - 26) + 'px'; el.style.top = (fromY - 26) + 'px';
  layer.appendChild(el);
  for (let i = 0; i < 6; i++) {
    const s = document.createElement('div');
    s.className = 'fly-spark';
    s.style.left = (fromX + (Math.random() - 0.5) * 40) + 'px';
    s.style.top = (fromY + (Math.random() - 0.5) * 40) + 'px';
    layer.appendChild(s);
    setTimeout(() => s.remove(), 700);
  }
  requestAnimationFrame(() => {
    el.style.left = (tx - 26) + 'px';
    el.style.top = (ty - 26) + 'px';
    el.style.transform = 'scale(0.7) rotate(20deg)';
  });
  setTimeout(() => { el.remove(); if (done) done(); }, 750);
}

// ---------- Game flow ----------
function deal() {
  const res = dealTray({ board: S.board, placed: S.placed, helperAvailable: S.helperAvailable, variant: S.variant }, S.rng);
  S.tray = res.tray; fx.trayIn = 0;
  if (res.helperUsed) { S.helperAvailable = false; Analytics.log('helper_piece_dealt', { placed: S.placed, level: res.level }); toast('Helper piece this round — look for the gold star!'); }
  if (res.rerolls) Analytics.log('fair_deal_reroll', { rerolls: res.rerolls });
  return res.helperUsed;
}

function renderLevel() {
  $('level-label').textContent = `LEVEL ${S.level}`;
  const into = S.placed % LEVEL_EVERY;
  $('level-fill').style.width = (S.level >= 11 ? 100 : (into / LEVEL_EVERY) * 100) + '%';
  $('level-xp').textContent = S.level >= 11 ? 'MAX' : `${into}/${LEVEL_EVERY}`;
}
function renderPlayerCard() {
  const p = playerProgress(store.xp);
  $('player-level-label').textContent = `Player Level ${p.level}`;
  $('player-xp-fill').style.width = (p.xpIntoLevel / p.xpForNext) * 100 + '%';
  const nr = nextReward(p.level);
  $('player-next-reward').textContent = nr ? `Next reward at Level ${nr.level}: ${nr.reward}` : 'All level rewards unlocked — superstar!';
}

function setModeUI() {
  $('best-label').textContent = S.mode === 'daily' ? 'DAILY BEST' : S.mode === 'challenge' ? 'TO BEAT' : 'BEST';
  renderBest(modeBest());
}
function startGame(mode = 'classic', dateKey = localDateKey()) {
  // A fresh game never starts under the game-over panel: hide it here, not
  // in every caller. The Play-again button did; the __gb.startDaily hook
  // didn't — a replay started from the panel left #over covering the live
  // game. (function show() is hoisted, so this is safe here.)
  show('over', false);
  S.mode = mode; S.dateKey = (mode === 'daily' || mode === 'challenge') ? dateKey : null;
  // Challenge games reuse the seeded deal: dateKey IS the challenge seed,
  // so both players get the same pieces in the same order.
  S.rng = mode === 'daily' ? dailyRng(dateKey) : mode === 'challenge' ? challengeRng(dateKey) : Math.random;
  // Difficulty variant (Dylan, Nov 12): rolled from a rng SEPARATE from the
  // deal stream, so the roll never changes the pieces. Daily/challenge use
  // a seed derived from the date/seed, so every player gets the same variant
  // that day / for that challenge; classic uses Math.random. Same
  // distribution for everyone.
  const variantRng = mode === 'classic' ? Math.random : makeRng(hashSeed('clearbloom-variant-' + dateKey));
  S.variant = rollVariant(variantRng);
  // A non-challenge game clears the challenge context (a stale challengeId
  // must never ride along into a classic/daily game).
  if (mode !== 'challenge') { S.challengeId = null; S.challengeToBeat = 0; S.challengeOpponent = ''; S.challengeOpponentScore = null; }
  S.board = emptyBoard(); S.score = 0; S.shownScore = 0; S.combo = 0; S.sinceClear = 0; S.maxCombo = 0; S.lines = 0; S.placed = 0;
  S.running = true; S.startBest = modeBest(); S.startedAt = Date.now();
  // Timer: full bar every game. It starts now unless the first-game tutorial
  // is about to run — then it starts when the tutorial finishes.
  S.timeLeft = TIMER.start; S.lowTonePlayed = false; lastTickSecond = -1;
  $('countdown').classList.remove('on'); lastCdShown = '';
  const willTut = mode === 'classic' && !localStorage.getItem('gb_tut_done');
  S.timerStarted = !willTut;
  if (Music.setUrgency) Music.setUrgency(false);
  // Power-ups never carry between games.
  S.charges = emptyCharges(); S.earnIdx = 0; S.armed = null; S.sweepMode = 'row';
  S.level = 1;
  renderPowerups(); renderTimerBar(); renderLevel();
  // Comeback helper is classic-only; the daily deal is identical for everyone.
  S.helperAvailable = mode === 'classic' && helperEligible(store.history, store.best);
  renderScore(0); renderCombo(); setModeUI();
  const helperDealt = deal();
  S.gamesThisSession++;
  Analytics.log('game_start', { game: S.gamesThisSession, mode, best: modeBest(), helper_eligible: S.helperAvailable, variant: S.variant });
  // The variant is disclosed to the player at the start of every game. If
  // the helper toast just fired, the variant toast waits for it to clear
  // instead of overwriting it.
  const variantMsg = S.variant === 'spicy' ? 'Spicy game — pieces run a touch harder!' : 'Relaxed game — pieces run a touch easier';
  if (helperDealt) setTimeout(() => toast(variantMsg), 1900); else toast(variantMsg);
  saveGame();
  if (willTut) Tutorial.start();
}

// ---------- Save / restore a game in progress ----------
function saveGame() {
  if (Tutorial.active) return; // never persist a scripted tutorial board
  // A game that has ended (no moves left / timed out) is OVER, never a
  // resumable save: S.running is false from endNoMoves/onTimeout until
  // finishGame clears the save, and persisting the dead board would offer
  // "Continue" for it (notably "Continue daily" after closing the tab as
  // the game ends). The save is cleared in finishGame.
  if (!S.running) return;
  const data = {
    v: SAVE_V, mode: S.mode, dateKey: S.dateKey, rngState: S.rng.getState ? S.rng.getState() : null,
    challengeId: S.challengeId, challengeToBeat: S.challengeToBeat, challengeOpponent: S.challengeOpponent, challengeOpponentScore: S.challengeOpponentScore,
    pack: selectedPack(), // which skin the board colours belong to, so a resume under a different pack can recolor by slot
    board: S.board, tray: S.tray.map((p) => p && { id: p.shape.id, color: p.color, helper: !!p.helper }),
    score: S.score, combo: S.combo, sinceClear: S.sinceClear, maxCombo: S.maxCombo, lines: S.lines, placed: S.placed,
    helperAvailable: S.helperAvailable, startBest: S.startBest, elapsed: Date.now() - S.startedAt, savedAt: Date.now(),
    timeLeft: S.timeLeft, charges: { ...S.charges }, earnIdx: S.earnIdx, variant: S.variant,
  };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch {}
}
function clearSave() { localStorage.removeItem(SAVE_KEY); }
function readSave() {
  try {
    const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    // v1 saves (no timer/charges) still restore, with timer + charges defaulted.
    if (!d || (d.v !== SAVE_V && d.v !== 1) || !Array.isArray(d.board) || d.board.length !== N || !Array.isArray(d.tray)) return null;
    return d;
  } catch { return null; }
}
// A save is resumable only if it is a game still in progress. A daily save
// is resumable only when it is TODAY's daily and today has NOT already been
// finished (one-and-done, Dylan Nov 12). A finished daily's save — or a
// stale save from another day — is cleared on sight, never offered as
// "Continue daily". Classic/challenge saves are unaffected.
function resumableSave() {
  const sv = readSave();
  if (!sv) return null;
  if (sv.mode === 'daily' && (sv.dateKey !== localDateKey() || store.dailyDone === localDateKey())) { clearSave(); return null; }
  return sv;
}
function restoreGame(d) {
  S.mode = d.mode === 'daily' ? 'daily' : d.mode === 'challenge' ? 'challenge' : 'classic'; S.dateKey = d.dateKey || null;
  S.rng = S.mode === 'daily' ? dailyRng(S.dateKey) : S.mode === 'challenge' ? challengeRng(S.dateKey) : Math.random;
  S.challengeId = d.challengeId || null; S.challengeToBeat = d.challengeToBeat || 0;
  S.challengeOpponent = d.challengeOpponent || ''; S.challengeOpponentScore = d.challengeOpponentScore ?? null;
  if (S.rng.setState && d.rngState != null) S.rng.setState(d.rngState);
  S.board = d.board.map((row) => row.map((v) => v || null));
  S.tray = d.tray.map((p) => { if (!p || !SHAPES[p.id]) return null; const pc = makePiece(SHAPES[p.id]); pc.color = p.color; pc.helper = !!p.helper; return pc; });
  // The save's colours belong to the pack it was saved under. If the
  // player has since equipped a different pack, recolor board + tray by
  // colour slot (old saves have no pack field: they predate packs, so
  // they are Classic Candy). Hexes in no palette are left alone.
  {
    const savedPack = packBySlug(d.pack) || packBySlug('classic-candy');
    const curPack = packBySlug(selectedPack()) || packBySlug('classic-candy');
    if (savedPack && curPack && savedPack.slug !== curPack.slug) {
      S.board = S.board.map((row) => row.map((v) => (v ? recolorHex(v, savedPack.colors, curPack.colors) : v)));
      S.tray = S.tray.map((p) => { if (p) p.color = recolorHex(p.color, savedPack.colors, curPack.colors); return p; });
    }
  }
  Object.assign(S, { score: d.score, shownScore: d.score, combo: d.combo, sinceClear: d.sinceClear, maxCombo: d.maxCombo, lines: d.lines, placed: d.placed,
    helperAvailable: !!d.helperAvailable, startBest: d.startBest, startedAt: Date.now() - (d.elapsed || 0), running: true });
  S.timeLeft = typeof d.timeLeft === 'number' ? d.timeLeft : TIMER.start;
  S.charges = { ...emptyCharges(), ...(d.charges || {}) };
  if (S.charges.petal) { S.charges.star = (S.charges.star || 0) + S.charges.petal; delete S.charges.petal; } // pre-Update-5 saves used "petal"
  // The variant is saved with the game; saves from before variants existed
  // (no variant field) default to Relaxed, the 2-in-3 majority.
  S.variant = d.variant === 'spicy' ? 'spicy' : 'relaxed';
  S.earnIdx = d.earnIdx || 0; S.armed = null; S.lowTonePlayed = S.timeLeft <= TIMER.lowSeconds;
  S.level = levelFor(S.placed) + 1; renderLevel();
  // A restored game is already past the tutorial (it closed mid-game), so the
  // timer runs from the moment play resumes.
  S.timerStarted = true;
  renderPowerups(); renderTimerBar();
  if (!S.tray.some(Boolean)) deal();
  renderScore(S.score); renderCombo(); setModeUI();
  S.gamesThisSession++;
  Analytics.log('game_restored', { mode: S.mode, score: S.score, placed: S.placed });
  checkGameOver();
}

function place(slot, r, c) {
  const piece = S.tray[slot]; const sh = piece.shape;
  for (const [dr, dc] of sh.cells) { S.board[r + dr][c + dc] = piece.color; fx.placedFlash.push({ r: r + dr, c: c + dc, t: 0 }); fx.squash.push({ r: r + dr, c: c + dc, t: 0 }); }
  S.tray[slot] = null; S.placed++;
  let gained = sh.cells.length;
  const { rows, cols } = wouldClearNow();
  const lines = rows.length + cols.length;
  if (lines) {
    const linesBefore = S.lines;
    S.combo++; S.sinceClear = 0; S.maxCombo = Math.max(S.maxCombo, S.combo); S.lines += lines;
    const cells = new Set();
    rows.forEach((rr) => { for (let i = 0; i < N; i++) cells.add(rr * N + i); });
    cols.forEach((cc) => { for (let i = 0; i < N; i++) cells.add(i * N + cc); });
    let k = 0;
    for (const id of cells) {
      const rr = Math.floor(id / N), cc = id % N, col = S.board[rr][cc];
      fx.clearing.push({ r: rr, c: cc, color: col, t: -k * 0.012 });
      burst(L.bx + (cc + 0.5) * L.cell, L.by + (rr + 0.5) * L.cell, col, 7, true);
      S.board[rr][cc] = null; k++;
    }
    const pts = clearPoints(lines, cells.size, S.combo);
    gained += pts;
    // Timer: +6 s per line, +2 s per extra line on a multi-line clear, cap 150.
    const bonus = timeForClear(lines);
    S.timeLeft = Math.min(TIMER.cap, S.timeLeft + bonus);
    renderTimerBar();
    setBoardGlow('clear');
    if (lines >= 2) setBoardGlow('combo');
    // Power-ups: one charge per 3-line combo, plus one per 10-line milestone.
    let grants = lines >= 3 ? 1 : 0;
    for (let m = Math.floor(linesBefore / POWERUPS.linesMilestone) + 1; m <= Math.floor(S.lines / POWERUPS.linesMilestone); m++) grants++;
    for (let i = 0; i < grants; i++) grantCharge();
    // Board clear (the whole board emptied by this placement): its own
    // popup carries the moment, so the +pts popup is skipped here — it sits
    // on the placed piece, which can land right on the Board-clear lane
    // and the two texts print over each other (fix9-tut-powerup shot).
    const boardCleared = S.board.every((row) => row.every((v) => !v));
    const cx = L.bx + (c + sh.w / 2) * L.cell, cy = L.by + (r + sh.h / 2) * L.cell;
    if (!boardCleared) popup(`+${pts}`, cx, cy, '#ffffff', 30 + lines * 4);
    popup(`+${bonus}s`, L.w / 2, L.by - 4, '#7cf0c9', 22);
    // Narrow screens (fix13): the DOM banner moves to the free band at the
    // top of the board (#banner top:22% in the stylesheet), so the canvas
    // popup lanes shift down a tenth of a board — the banner then clears
    // every lane's full 50px rise, and the lanes keep their 0.20 spacing
    // so they still never pile on each other. Desktop keeps 0.30/0.50/0.70.
    const narrow = window.innerWidth <= 600;
    const lane = (f) => L.by + L.size * (narrow ? f + 0.10 : f);
    if (lines >= 2) popup(['', '', 'Double!', 'Triple!', 'Mega!', 'Bloom!'][Math.min(5, lines)], L.w / 2, lane(0.30), '#7cf0c9', 40, 0.12);
    // Combo banner: escalating words with rising pitch (visual juice only).
    if (S.combo >= 2) {
      const words = ['', '', 'Nice!', 'Great!', 'AMAZING!', 'INCREDIBLE!'];
      showBanner(words[Math.min(5, S.combo)], 900);
      popup(`Combo x${S.combo}`, L.w / 2, lane(0.50), '#ff7ab6', 34, 0.28);
      Sfx.combo(S.combo); Analytics.log('combo', { combo: S.combo });
    }
    // 4-line clear: jackpot-style burst (visual celebration, no reward).
    if (lines >= 4) { jackpotBurst(); showBanner('INCREDIBLE!', 1300); }
    Sfx.clear(lines, S.combo); Haptics.medium();
    fx.shake = 4 + lines * 3;
    Analytics.log('lines_cleared', { lines, combo: S.combo, pts });
    if (boardCleared) { gained += BOARD_CLEAR_BONUS; popup('Board clear +300', L.w / 2, lane(0.70), '#ffd166', 32, 0.44); Sfx.boardClear(); Analytics.log('board_clear', {}); }
  } else {
    Sfx.place(); Haptics.light();
    S.sinceClear++;
    if (S.sinceClear >= COMBO_GRACE) S.combo = 0;
  }
  S.score += gained;
  renderCombo();
  const sc = $('score'); sc.classList.add('bump'); setTimeout(() => sc.classList.remove('bump'), 120);
  if (S.score > modeBest()) renderBest(S.score);
  if (S.tray.every((p) => !p)) deal();
  Tutorial.onPlaced();
  // In-game level: levelFor(pieces placed) + 1, so the game starts at
  // Level 1 and levels up at 15, 30, ... pieces (max Level 11). Levelling
  // up adds +5 s and a celebration — same ramp for everyone, documented
  // in RULES_TEXT.
  const lvl = levelFor(S.placed) + 1;
  if (lvl !== S.level) {
    S.level = lvl;
    renderLevel();
    if (lvl > 1) {
      S.timeLeft = Math.min(TIMER.cap, S.timeLeft + TIMER.levelUpBonus);
      renderTimerBar();
      showBanner(`LEVEL ${lvl} UP!  +${TIMER.levelUpBonus}s`, 1400);
      jackpotBurst();
      Sfx.levelUp(); Haptics.medium();
      Analytics.log('level_up', { level: lvl });
    }
  } else renderLevel();
  renderPowerups(); // keep the 10-line progress rings current after every placement
  checkGameOver();
  saveGame();
}
function wouldClearNow() {
  const rows = [], cols = [];
  for (let i = 0; i < N; i++) { if (S.board[i].every(Boolean)) rows.push(i); if (S.board.every((row) => row[i])) cols.push(i); }
  return { rows, cols };
}

// ---------- Power-ups (earned only through play) ----------
function grantCharge() {
  if (totalCharges() >= POWERUPS.maxCharges) { Analytics.log('powerup_earn_blocked_full', {}); return false; }
  const type = POWERUPS.earnOrder[S.earnIdx % POWERUPS.earnOrder.length];
  S.earnIdx++;
  addCharge(type);
  renderPowerups();
  const def = POWERUPS.defs[type];
  Analytics.log('powerup_earned', { type, total: totalCharges() });
  // Earn moment: edge flash, icon flies from the cleared lines into its
  // slot with a sparkle trail, POWER-UP! banner, chime + haptics, slot burst.
  edgeFlash();
  Sfx.powerup(); Haptics.medium();
  showBanner('POWER-UP!', 1100);
  const slotBtn = document.querySelector(`#powerups .pu[data-pu="${type}"]`);
  const cx = L.bx + L.size / 2, cy = L.by + L.size / 2;
  const rect = cv.getBoundingClientRect();
  flyIcon(def.icon, rect.left + cx, rect.top + cy, slotBtn, () => {
    if (slotBtn) { slotBtn.classList.remove('burst'); void slotBtn.offsetWidth; slotBtn.classList.add('burst'); }
  });
  toast(`${def.name} earned!`);
  if (!localStorage.getItem('gb_powerup_tip')) {
    localStorage.setItem('gb_powerup_tip', '1');
    show('pu-first', true);
  }
  return true;
}
function renderPowerups() {
  // Ring + milestone text live in renderChargeRings (full ring while a
  // charge is held, milestone progress while the slot is empty). Charges
  // never expire, so there is no seconds text and no drain.
  document.querySelectorAll('#powerups .pu').forEach((b) => {
    const type = b.dataset.pu, n = S.charges[type] || 0;
    const countEl = b.querySelector('.pu-count');
    countEl.textContent = n;
    // No badge on an empty slot — four "0" badges are clutter.
    countEl.classList.toggle('hidden', n === 0);
    b.classList.toggle('empty', n === 0);
    b.classList.toggle('earned', n > 0);
    b.classList.toggle('armed', S.armed === type);
    b.disabled = n === 0 && S.armed !== type;
  });
  renderChargeRings();
  // The reserved slot stays in the layout whether armed or not (class
  // 'off' hides the chip via visibility, so the box keeps its size and the
  // board never moves). Never display:none here — that was the arm-crop.
  $('pu-target').classList.toggle('off', !S.armed);
  $('pu-mode').classList.toggle('hidden', S.armed !== 'sweep');
  $('pu-mode-row-btn').classList.toggle('on', S.sweepMode === 'row');
  $('pu-mode-col-btn').classList.toggle('on', S.sweepMode === 'col');
  $('pu-hint').textContent = S.armed === 'bomb' ? 'Tap a cell — 3x3 blast!'
    : S.armed === 'sweep' ? 'Tap a cell:'
    : '';
}
function armPowerup(type) {
  if (Tutorial.active) {
    // The power-up step's tap on the highlighted slot advances the
    // tutorial; no power-up ever fires during the walkthrough.
    if (Tutorial.current && Tutorial.current.spot === 'dock' && type === 'star') Tutorial.advanceFromDock();
    return;
  }
  if (!S.running || S.autoSaving) return;
  if (S.armed === type) return cancelArmed();
  if (!S.charges[type]) return;
  if (type === 'reshuffle') return applyReshuffle();
  if (type === 'star') return applyStar();
  S.armed = type;
  renderPowerups();
  // No toast here: the chip above the dock IS the armed descriptor — a
  // second dark pill on top of it was the collision Dylan saw.
}
function cancelArmed() { S.armed = null; renderPowerups(); }
function clearCellsWithFx(cells) {
  // Power-up clears: 10 points per cell, no combo multiplier, and they never
  // count toward earning more power-ups. No board-clear bonus either.
  let n = 0;
  for (const [r, c] of cells) {
    if (!S.board[r] || !S.board[r][c]) continue;
    const col = S.board[r][c];
    fx.clearing.push({ r, c, color: col, t: -n * 0.012 });
    burst(L.bx + (c + 0.5) * L.cell, L.by + (r + 0.5) * L.cell, col, 5, true);
    S.board[r][c] = null; n++;
  }
  if (n) {
    const pts = powerUpPoints(n);
    S.score += pts;
    renderScore(S.score); S.shownScore = S.score;
    popup(`+${pts}`, L.w / 2, L.by + L.size * 0.4, '#ffffff', 28);
    setBoardGlow('clear');
    Sfx.clear(1, 1); Haptics.medium();
  }
  return n;
}
// Bomb/Sweep clears without spending (shared by manual use and auto-save).
function bombClear(r, c) {
  const cells = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    const rr = r + dr, cc = c + dc;
    if (rr >= 0 && rr < N && cc >= 0 && cc < N) cells.push([rr, cc]);
  }
  // Explosion: shockwave ring + screen shake + star burst.
  const cx = L.bx + (c + 0.5) * L.cell, cy = L.by + (r + 0.5) * L.cell;
  fx.rings.push({ x: cx, y: cy, r: L.cell * 3.2, t: 0 });
  fx.shake = Math.max(fx.shake, 12);
  burst(cx, cy, '#ff8a1e', 16);
  return clearCellsWithFx(cells);
}
function sweepClear(axis, idx) {
  // Laser swipe across the chosen row or column.
  fx.beams.push({ axis, idx, t: 0 });
  const cells = [];
  if (axis === 'row') for (let cc = 0; cc < N; cc++) cells.push([idx, cc]);
  else for (let rr = 0; rr < N; rr++) cells.push([rr, idx]);
  return clearCellsWithFx(cells);
}
function applyBomb(r, c) {
  spendCharge('bomb'); cancelArmed();
  const n = bombClear(r, c);
  Analytics.log('powerup_used', { type: 'bomb', cells: n });
  saveGame(); checkGameOver();
}
function applySweep(r, c) {
  spendCharge('sweep'); cancelArmed();
  const n = sweepClear(S.sweepMode, S.sweepMode === 'row' ? r : c);
  Analytics.log('powerup_used', { type: 'sweep', mode: S.sweepMode, cells: n });
  saveGame(); checkGameOver();
}
function applyReshuffle() {
  spendCharge('reshuffle');
  fx.trayFlip = 1; // cards flip and deal (tray re-deals with a flip)
  deal(); // fair-deal tray rule applies to the new tray, same as always
  toast('New tray dealt');
  Analytics.log('powerup_used', { type: 'reshuffle' });
  saveGame(); checkGameOver();
}
function applyStar() {
  spendCharge('star');
  // Clock icon flies into the timer bar with +15s.
  const btn = document.querySelector('#powerups .pu[data-pu="star"]');
  const r = btn ? btn.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2 };
  flyIcon('clock', r.left + r.width / 2, r.top + r.height / 2, $('timerbar'));
  S.timeLeft = Math.min(TIMER.cap, S.timeLeft + POWERUPS.timeStarSeconds);
  renderTimerBar();
  popup(`+${POWERUPS.timeStarSeconds}s`, L.w / 2, L.by - 4, '#ffd166', 26);
  toast(`Time Star: +${POWERUPS.timeStarSeconds} seconds`);
  Analytics.log('powerup_used', { type: 'star', timeLeft: Math.round(S.timeLeft) });
  saveGame();
}

// ---------- Auto-save ----------
// When no tray piece fits and a charge is held, the game auto-uses one to
// save you BEFORE the game ends — Reshuffle first, then the Bomb on the
// 3x3 that makes the most room for a tray piece, then the Sweep on the
// fullest row or column. First choice that lets a piece fit wins. The choice
// is deterministic (fixed priority + fixed tie-breaks) and the same for
// everyone — never ads, spend or segment. Timeout auto-saves only with a
// Time Star (one charge, +15 s, "SAVED!" banner) — Bomb, Sweep and
// Reshuffle do not add time and never fire on timeout.
function trayFitsOn(board) { return S.tray.some((p) => p && fitsAnywhere(board, p.shape)); }
function countFitsOn(board) {
  let n = 0;
  for (const p of S.tray) {
    if (!p) continue;
    for (let r = 0; r <= N - p.shape.h; r++) for (let c = 0; c <= N - p.shape.w; c++) if (fits(board, p.shape, r, c)) n++;
  }
  return n;
}
function findBombSave() {
  let best = null;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const b = S.board.map((row) => row.slice());
    let cleared = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < N && cc >= 0 && cc < N && b[rr][cc]) { b[rr][cc] = null; cleared++; }
    }
    if (!cleared) continue;
    const fitsN = countFitsOn(b);
    if (fitsN === 0) continue;
    if (!best || fitsN > best.fits || (fitsN === best.fits && cleared > best.cleared)) best = { r, c, fits: fitsN, cleared };
  }
  return best; // lowest r, then lowest c wins ties (scan order)
}
function findSweepSave() {
  let best = null;
  const consider = (axis, idx) => {
    const b = S.board.map((row) => row.slice());
    let full = 0;
    if (axis === 'row') { for (let cc = 0; cc < N; cc++) { if (b[idx][cc]) full++; b[idx][cc] = null; } }
    else { for (let rr = 0; rr < N; rr++) { if (b[rr][idx]) full++; b[rr][idx] = null; } }
    if (!full || !trayFitsOn(b)) return;
    if (!best || full > best.full) best = { axis, idx, full }; // rows first, then cols; earliest wins ties
  };
  for (let i = 0; i < N; i++) consider('row', i);
  for (let i = 0; i < N; i++) consider('col', i);
  return best;
}
// The save presentation: ~0.6 s freeze (timer + input pause), "SAVED!"
// banner, icon flies from its slot to the target, chime. The effect applies
// when the freeze ends. Caller owns S.autoSaving around the whole attempt.
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
async function presentSave(iconName, slotType, target, apply) {
  showBanner('SAVED!', 1100);
  Sfx.powerup(); Haptics.medium();
  const slotBtn = document.querySelector(`#powerups .pu[data-pu="${slotType}"]`);
  const from = slotBtn ? slotBtn.getBoundingClientRect() : null;
  flyIcon(iconName, from ? from.left + from.width / 2 : innerWidth / 2, from ? from.top + from.height / 2 : innerHeight / 2, target);
  await sleepMs(600);
  apply();
}
async function tryAutoSaveNoFit() {
  Analytics.log('autosave_attempt', { cause: 'no_fit', charges: { ...S.charges } });
  // 1. Reshuffle first: a fresh tray may fit.
  if (S.charges.reshuffle > 0) {
    spendCharge('reshuffle');
    await presentSave('shuffle', 'reshuffle', { x: innerWidth / 2, y: innerHeight * 0.62 }, () => { fx.trayFlip = 1; deal(); });
    if (trayFitsOn(S.board)) { Analytics.log('autosave_saved', { type: 'reshuffle' }); saveGame(); return true; }
    // Spent, still stuck — fall through to Bomb.
  }
  // 2. Bomb on the 3x3 that makes the most room for a tray piece.
  if (S.charges.bomb > 0) {
    const target = findBombSave();
    if (target) {
      spendCharge('bomb');
      const rect = cv.getBoundingClientRect();
      await presentSave('bomb', 'bomb', { x: rect.left + L.bx + (target.c + 0.5) * L.cell, y: rect.top + L.by + (target.r + 0.5) * L.cell }, () => { bombClear(target.r, target.c); });
      Analytics.log('autosave_saved', { type: 'bomb', r: target.r, c: target.c });
      saveGame(); checkGameOver(); return true;
    }
  }
  // 3. Sweep the fullest row or column that lets a piece fit.
  if (S.charges.sweep > 0) {
    const target = findSweepSave();
    if (target) {
      spendCharge('sweep');
      const rect = cv.getBoundingClientRect();
      const tx = target.axis === 'row' ? rect.left + L.bx + L.size / 2 : rect.left + L.bx + (target.idx + 0.5) * L.cell;
      const ty = target.axis === 'row' ? rect.top + L.by + (target.idx + 0.5) * L.cell : rect.top + L.by + L.size / 2;
      await presentSave('eraser', 'sweep', { x: tx, y: ty }, () => { sweepClear(target.axis, target.idx); });
      Analytics.log('autosave_saved', { type: 'sweep', axis: target.axis, idx: target.idx });
      saveGame(); checkGameOver(); return true;
    }
  }
  Analytics.log('autosave_failed', { cause: 'no_fit' });
  return false;
}
function checkGameOver() {
  if (Tutorial.active) return; // the scripted walkthrough never ends early
  if (!S.running || S.autoSaving) return;
  const alive = S.tray.filter(Boolean);
  if (alive.some((p) => fitsAnywhere(S.board, p.shape))) return;
  // Last-chance save BEFORE the game ends.
  if (totalCharges() > 0) {
    S.autoSaving = true;
    tryAutoSaveNoFit().then((saved) => {
      S.autoSaving = false;
      if (!saved) endNoMoves();
    });
    return;
  }
  endNoMoves();
}
function endNoMoves() {
  S.running = false;
  setTimeout(() => onNoMoves('no-moves'), 450);
}

function onNoMoves(reason) {
  Sfx.over();
  if (Music.setUrgency) Music.setUrgency(false);
  // No revive any more (Dylan, Nov 12): game over is game over. The
  // end-of-game interstitial (1 in 3) runs inside finishGame, before the
  // game-over panel; the reason line is set on the panel there.
  finishGame(reason);
}
async function finishGame(reason) {
  clearSave();
  cancelArmed();
  if (Music.setUrgency) Music.setUrgency(false);
  const daily = S.mode === 'daily';
  // One-and-done (Dylan, Nov 12): finishing the daily marks today done, so
  // the title can never offer "Continue daily" again today — not for this
  // game, and not for a replay of it that is later quit mid-game.
  if (daily) store.markDailyDone(S.dateKey);
  const challenge = S.mode === 'challenge';
  const prevBest = modeBest(), isBest = S.score > prevBest;
  // Challenge games never touch the local bests: the deal is shared with
  // one opponent, not a random classic game, so the score belongs to the
  // challenge doc, not to the classic/daily bests.
  if (isBest && !challenge) { if (daily) store.setDailyBest(S.dateKey, S.score); else store.best = S.score; Sfx.best(); Analytics.log('new_high_score', { score: S.score, prev: prevBest, mode: S.mode }); }
  if (!daily && !challenge) store.pushHistory(S.score); // daily + challenge games never feed the comeback-helper history
  // Lifetime player XP: 10/line + 5/max combo + 25/game. Cosmetics only.
  const xpBefore = store.xp, lvlBefore = playerLevelFor(xpBefore);
  const gained = xpForGame(S.lines, S.maxCombo);
  store.xp = xpBefore + gained;
  store.games = store.games + 1;
  const lvlAfter = playerLevelFor(store.xp);
  const newRewards = rewardsForLevel(lvlAfter).filter((r) => !rewardsForLevel(lvlBefore).includes(r));
  Analytics.log('game_over', { mode: S.mode, score: S.score, lines: S.lines, max_combo: S.maxCombo, placed: S.placed, secs: Math.round((Date.now() - S.startedAt) / 1000), xp_gained: gained, player_level: lvlAfter });
  renderOvScore(S.score); $('ov-best').textContent = modeBest(); $('ov-lines').textContent = S.lines; $('ov-combo').textContent = S.maxCombo;
  $('ov-new').classList.toggle('hidden', !isBest || challenge);
  // Challenge result line (the NEW BEST badge stays hidden for challenges —
  // the result is against one opponent, not a personal best).
  const ovCh = $('ov-challenge');
  if (challenge && ovCh) {
    const opp = S.challengeOpponent || 'your opponent';
    const oppScore = S.challengeOpponentScore;
    ovCh.textContent = oppScore == null
      ? `Waiting for ${opp} to play — your score: ${S.score}`
      : S.score > oppScore ? `You beat ${opp} ${S.score}–${oppScore}!`
      : S.score === oppScore ? `Tied with ${opp} at ${S.score}!`
      : `${opp} leads ${oppScore}–${S.score} — play again to beat them!`;
    ovCh.classList.remove('hidden');
  } else if (ovCh) ovCh.classList.add('hidden');
  $('ov-xp').textContent = `+${gained} XP  ·  Player Level ${lvlAfter}${newRewards.length ? ` — unlocked: ${newRewards.join(', ')}!` : ''}`;
  renderBest(modeBest());
  $('over').querySelector('h2').textContent = daily ? 'Daily challenge over' : challenge ? 'Challenge over' : 'Game over';
  // Why the game ended (Dylan, Nov 12): the line used to live in the revive
  // overlay; it now sits on the game-over panel itself.
  const ovWhy = $('ov-why');
  if (ovWhy) ovWhy.textContent = reason === 'timeout' ? "Time's up!" : 'No space left!';
  // The date never goes in the heading — it sits in smaller text underneath.
  const ovDate = $('ov-date');
  if (daily) { ovDate.textContent = friendlyDate(S.dateKey); ovDate.classList.remove('hidden'); }
  else ovDate.classList.add('hidden');
  // Star rating, revealed one star at a time once the panel is up.
  const stars = (isBest || S.score >= 1000) ? 3 : S.score >= 400 ? 2 : 1;
  const showPanel = () => {
    document.querySelectorAll('#ov-stars span').forEach((s, i) => {
      s.classList.remove('lit');
      if (i < stars) setTimeout(() => s.classList.add('lit'), 250 + i * 350);
    });
    $('over').classList.add('show');
  };
  // Cloud submits run BEFORE the ad (same as the old Play-again flow,
  // where finishGame completed before any ad could appear): a player who
  // force-quits during the interstitial must not lose the submit.
  // Accounts (Update 3): merge this game's progress into the cloud player
  // doc when signed in. Guests: no-op — nothing leaves the device.
  Accounts.recordGame().catch(() => {});
  // Leaderboards (Update 3, batch 2): daily games go to the daily board,
  // classic games to the weekly board. Best-only, validated, signed-in
  // only — guests: no-op, nothing leaves the device. Challenge games never
  // submit to the boards (their deal is shared with one opponent).
  if (!challenge) {
    const board = S.mode === 'daily' ? 'daily' : 'weekly';
    Leaderboards.submitScore({ board, score: S.score, lines: S.lines, maxCombo: S.maxCombo }).catch(() => {});
  }
  // Challenges (Update 3, batch 3): best-only submit to the challenge doc.
  if (challenge && S.challengeId) Challenges.submitChallengeScore(S.challengeId, S.score).catch(() => {});
  // End-of-game interstitial (Dylan, Nov 12): 1 in 3 games, picked by a
  // random roll — never tied to score, performance or any player state.
  // Never after the first game of a session, at least 2 minutes since the
  // last one. Timeout-guarded (10 s) so a hung ad can never trap the
  // player: the game-over panel always appears.
  await Promise.race([Ads.maybeInterstitialAtGameEnd(S.gamesThisSession), sleepMs(10000)]);
  // A new best gets its own beat: the badge pops over the board first (the
  // same medallion as the panel badge), then the panel opens with the badge
  // inside it. Showing both at once stacks two badges on top of each other
  // — that was the doubled-badge look in the game-over screenshot.
  // Challenges skip the badge beat (no NEW BEST for a challenge game).
  if (isBest && !challenge) { jackpotBurst(); showBestBadge(1500); setTimeout(showPanel, 1500); }
  else showPanel();
  if (lvlAfter > lvlBefore) showBanner(`PLAYER LEVEL ${lvlAfter}!`, 1600);
  renderPlayerCard();
}

// ---------- Input ----------
function slotAt(x, y) {
  if (y < L.trayY - 10 || y > L.trayY + L.trayH + 20) return -1;
  const i = Math.floor((x - L.trayX) / L.slotW);
  return (i < 0 || i > 2) ? -1 : (S.tray[i] ? i : -1);
}
cv.addEventListener('pointerdown', (e) => {
  Sfx.unlock();
  if (!S.running || drag || S.autoSaving) return;
  const rect = cv.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
  if (Tutorial.active) {
    // Scripted tutorial: only the expected slot can be picked up; the
    // power-up step takes no drags at all.
    const st = Tutorial.current;
    if (!st || st.slot == null || slotAt(x, y) !== st.slot) return;
  }
  // A power-up is armed: this tap targets the board instead of dragging.
  if (S.armed) {
    const c = Math.floor((x - L.bx) / L.cell), r = Math.floor((y - L.by) / L.cell);
    if (r < 0 || r >= N || c < 0 || c >= N) { /* tap outside the board while armed: nothing — the chip already says what to do. */ return; }
    if (S.armed === 'bomb') applyBomb(r, c);
    else if (S.armed === 'sweep') applySweep(r, c);
    return;
  }
  const i = slotAt(x, y); if (i < 0) return;
  const lift = e.pointerType === 'mouse' ? 0 : L.cell * 1.8; // keep the piece visible above the finger
  // Pick up at the piece's resting tray size, then ease to full board-cell
  // size while dragging (a slight smooth grow, never a pop).
  const startScale = trayCellFor(S.tray[i].shape) / L.cell;
  drag = { slot: i, piece: S.tray[i], x, y: y - lift, lift, id: e.pointerId, scale: startScale, startScale };
  cv.setPointerCapture(e.pointerId);
  Sfx.pick();
});
cv.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const rect = cv.getBoundingClientRect();
  drag.x = e.clientX - rect.left; drag.y = e.clientY - rect.top - drag.lift;
});
function endDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = dropCell(), slot = drag.slot;
  drag = null;
  if (d && d.ok && (!Tutorial.active || Tutorial.acceptsDrop(slot, d.r, d.c))) place(slot, d.r, d.c); else Sfx.invalid();
}
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);

// ---------- UI wiring ----------
function show(id, on) { $(id).classList.toggle('show', on); }
document.title = APP_NAME;
// Wordmark is inline SVG text (fix13): set the <text> content from the
// brand name — the old code wrote Clear<span>bloom</span> into the .logo
// div, which would destroy the svg. The text stays centred (middle anchor).
const logoEl = $('title').querySelector('.logo');
const logoText = logoEl && logoEl.querySelector('text');
if (logoText) { logoText.textContent = APP_NAME; logoEl.setAttribute('aria-label', APP_NAME); }
// Friendly daily date for the player ("Nov 11", never the 2026-11-11 key).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function friendlyDate(key) { const [, m, d] = key.split('-'); return `${MONTHS[+m - 1]} ${+d}`; }
function refreshTitle() {
  $('title-best').textContent = store.best; $('title-daily-best').textContent = store.dailyBest(localDateKey());
  $('daily-date').textContent = friendlyDate(localDateKey());
  const sv = resumableSave();
  $('btn-play').textContent = sv ? (sv.mode === 'daily' ? '▶ Continue daily' : '▶ Continue') : 'Play';
  $('btn-new').classList.toggle('hidden', !sv);
  renderPlayerCard();
  refreshRankChip();
}

// ---- "Your rank" teaser chip (Update 3, #5) ----
// Always renders instantly from the deterministic sample board (pure, no
// network) so the title never waits on anything. Signed-in players get a
// live upgrade in the background when the daily fetch resolves with a
// rank; anything else (offline, no index, outside the top 50) leaves the
// honest sample text in place. The chip never claims a live rank it
// doesn't have, and never presents sample ranks as real.
let rankChipSeq = 0, rankChipInit = false;
function refreshRankChip() {
  const chip = $('rank-chip'), main = $('rank-chip-main'), sub = $('rank-chip-sub');
  if (!chip || !main || !sub) return Promise.resolve();
  const seq = ++rankChipSeq;
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const dailyBest = store.dailyBest(localDateKey());
  const classicBest = store.best;
  const setChip = (mainText, subText, { live = false, top1 = false } = {}) => {
    if (rankChipInit && main.textContent !== mainText) {
      chip.classList.remove('pop'); void chip.offsetWidth; chip.classList.add('pop');
    }
    rankChipInit = true;
    main.textContent = mainText;
    sub.textContent = subText;
    chip.dataset.live = live ? '1' : '0';
    chip.classList.toggle('top1', top1);
  };
  if (dailyBest > 0) {
    const rank = sampleRank('daily', 'global', boardKey('daily'), dailyBest);
    if (rank) {
      setChip(rank === 1 ? "You'd be #1 today!" : `You'd be #${rank} today`, `Daily best ${fmt(dailyBest)} · Sample board`, { top1: rank === 1 });
    } else {
      setChip('Outside the top 10 — keep playing!', `Daily best ${fmt(dailyBest)} · Sample board`);
    }
  } else if (classicBest > 0) {
    setChip('Play to claim your rank!', `Classic best ${fmt(classicBest)} · play today's daily to rank it`);
  } else {
    setChip('Play to claim your rank!', 'Your first score lands here');
  }
  if (!Accounts.signedIn) return Promise.resolve();
  return Leaderboards.fetchBoard({ board: 'daily', scope: 'global' }).then((res) => {
    if (seq !== rankChipSeq || !res || !res.ok) return;
    const best = store.dailyBest(localDateKey());
    if (best <= 0) return; // daily best changed underneath us; refreshTitle will re-render
    if (res.ownRank) {
      setChip(res.ownRank === 1 ? "You're #1 today!" : `You're #${res.ownRank} today!`, `Daily best ${fmt(best)} · Live board`, { live: true, top1: res.ownRank === 1 });
    } else if (res.entries && res.entries.length) {
      setChip('Outside the top 50 — keep playing!', `Daily best ${fmt(best)} · Live board`, { live: true });
    }
  }).catch(() => {});
}
// 3D icons: every [data-icon] <img> gets its pre-rendered sprite URL.
function initIcons() {
  document.querySelectorAll('img[data-icon]').forEach((img) => { img.src = Sprites.iconURL(img.dataset.icon); });
}
refreshTitle(); renderBest(store.best);
let sessionLogged = false;
function leaveTitle() { Sfx.unlock(); show('title', false); if (!sessionLogged) { sessionLogged = true; Analytics.log('session_start', { ua_mobile: /Mobi/.test(navigator.userAgent) }); } }
$('btn-play').onclick = () => { leaveTitle(); const sv = resumableSave(); if (sv) restoreGame(sv); else startGame('classic'); };
$('btn-new').onclick = () => { const sv = readSave(); if (sv) Analytics.log('game_abandon', { score: sv.score, mode: sv.mode }); clearSave(); leaveTitle(); startGame('classic'); };
$('btn-daily').onclick = () => { const sv = readSave(); if (sv) Analytics.log('game_abandon', { score: sv.score, mode: sv.mode }); clearSave(); leaveTitle(); startGame('daily', localDateKey()); };
// Settings
const syncSettings = () => { $('set-music').checked = Music.on; $('set-sfx').checked = !Sfx.muted; $('set-haptics').checked = Haptics.enabled; $('set-motion').checked = reducedMotion(); syncSoundBtn(); };
// Master sound switch on the title screen: shows the real mute state (a
// player who once turned sound off stays off — this makes it visible and
// one-tap fixable instead of silent with no clue). Toggles music + SFX
// together; Settings keeps the separate toggles.
const soundOn = () => Music.on && !Sfx.muted;
function syncSoundBtn() { const img = $('sound-img'); if (!img) return; img.src = Sprites.iconURL(soundOn() ? 'sound' : 'mute'); $('btn-sound').setAttribute('aria-label', soundOn() ? 'Sound on — tap to mute' : 'Sound off — tap to unmute'); }
$('btn-sound').onclick = () => { const on = !soundOn(); Music.set(on); Sfx.setOn(on); syncSoundBtn(); };
$('btn-title-settings').onclick = () => { syncSettings(); show('settings', true); };
$('set-music').onchange = (e) => Music.set(e.target.checked);
$('set-sfx').onchange = (e) => Sfx.setOn(e.target.checked);
$('set-haptics').onchange = (e) => { Haptics.set(e.target.checked); if (e.target.checked) Haptics.light(); };
$('set-motion').onchange = (e) => { localStorage.setItem('gb_motion', e.target.checked ? '1' : '0'); applyMotionClass(); };
function applyMotionClass() { document.body.classList.toggle('reduced-motion', reducedMotion()); }
$('btn-set-close').onclick = () => show('settings', false);
$('btn-pu-first').onclick = () => show('pu-first', false);
$('btn-tut-again').onclick = () => { show('settings', false); localStorage.removeItem('gb_tut_done'); if (S.running) Tutorial.start(); else { leaveTitle(); startGame('classic'); } };

// ---- Friends — account & sign-in (Update 3) ----
// Guests play everything except social; sign-in is optional and never
// required to play. Safe to call before Accounts.init() resolves.
function refreshAccountUI() {
  const st = Accounts.debugState();
  const nameEl = $('acct-name'), subEl = $('acct-sub'), codeEl = $('acct-code');
  if (nameEl) nameEl.textContent = st.displayName;
  if (subEl) subEl.textContent = st.signedIn
    ? (st.provider === 'google' ? 'Signed in with Google'
       : st.provider === 'facebook' ? 'Signed in with Facebook'
       : 'Signed in with a private profile')
    : 'Progress saved on this device only';
  if (codeEl) codeEl.textContent = st.friendCode || '------';
  const input = $('acct-name-input');
  if (input && document.activeElement !== input) input.value = st.displayName === 'Guest' ? '' : st.displayName;
  const hide = $('set-hide-global');
  if (hide) hide.checked = st.hideFromGlobal;
  const cfg = st.configured;
  const setBtn = (id, enabled, title) => { const b = $(id); if (!b) return; b.disabled = !enabled; if (title !== undefined) b.title = title; };
  setBtn('btn-sign-google', cfg && !st.signedIn, cfg ? '' : "Sign-in isn't set up yet — keep playing as a guest");
  // Facebook is built but disabled until the provider exists in the console.
  // The button says so on its face ("coming soon") — the title tooltip
  // alone is invisible on touch screens.
  setBtn('btn-sign-facebook', false, "Facebook sign-in isn't set up yet");
  const out = $('btn-sign-out');
  if (out) out.classList.toggle('hidden', !st.signedIn);
  const msg = $('acct-msg');
  if (msg && !msg.dataset.sticky) { msg.textContent = ''; msg.classList.remove('error'); }
  refreshRankChip(); // sign-in state changes which rank path the chip uses
}
function acctMsg(text, isError) {
  const msg = $('acct-msg');
  if (!msg) return;
  msg.textContent = text || '';
  msg.classList.toggle('error', !!isError);
  if (text) { msg.dataset.sticky = '1'; } else { delete msg.dataset.sticky; }
}
function openAccount() {
  refreshAccountUI();
  acctMsg('');
  renderFriendList($('acct-friend-list'));
  // A redirect sign-in (iOS) that failed on the way back says so here
  // instead of failing silently — the player lands back in this panel.
  const st = Accounts.debugState();
  if (st.redirectError) acctMsg(authErrorMessage(st.redirectError), true);
  show('account', true);
}
$('btn-account').onclick = openAccount;
$('btn-set-account').onclick = () => { show('settings', false); openAccount(); };
$('btn-acct-close').onclick = () => show('account', false);
// Save is the one clear path to play without an account (Dylan, Nov 12):
// it saves the typed name to the guest profile and closes the panel so
// the player is back in the game — no separate "play signed in with no
// account" button, no jargon. Anonymous sign-in still exists in code
// (Accounts.signInAnonymous + the __gb hook) but has no button; Google
// is the only sign-in shown until Facebook is configured.
$('btn-name-save').onclick = () => {
  const input = $('acct-name-input');
  const res = Accounts.setDisplayName(input ? input.value : '');
  if (res.ok) { toast('Name saved'); refreshAccountUI(); show('account', false); }
  else acctMsg(Accounts.nameRejectMessage(res.reason), true);
};
// iOS keyboard Return must save too — before this fix it did nothing,
// so a player who typed their name and hit Return saw no save at all.
$('acct-name-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('btn-name-save').click(); }
});
$('btn-copy-code').onclick = async () => {
  const code = Accounts.friendCode;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    toast('Friend code copied');
  } catch {
    acctMsg('Your friend code: ' + code, false);
  }
};
$('set-hide-global').onchange = (e) => { Accounts.setHideFromGlobal(e.target.checked).catch(() => {}); };
$('btn-sign-google').onclick = async () => {
  const res = await Accounts.signInGoogle();
  if (res.ok) {
    // Redirect flow (iOS): the page is about to navigate to Google —
    // say so instead of claiming "Signed in" before it happens.
    if (res.reason === 'redirect-started') { acctMsg('Opening Google sign-in…', false); return; }
    toast('Signed in'); acctMsg(''); refreshAccountUI();
  }
  else acctMsg(authErrorMessage(res.reason), true);
};
$('btn-sign-out').onclick = async () => {
  await Accounts.signOut();
  toast('Signed out'); refreshAccountUI();
};
// Two-step delete: first tap arms it, second tap wipes. Arms itself back
// after 5s so a stray tap can't delete anything.
let deleteArmed = false, deleteTimer = 0;
$('btn-delete-account').onclick = async () => {
  const btn = $('btn-delete-account');
  if (!deleteArmed) {
    deleteArmed = true;
    btn.dataset.armed = '1';
    btn.textContent = 'Tap again to delete everything';
    btn.classList.add('armed-danger');
    clearTimeout(deleteTimer);
    deleteTimer = setTimeout(() => {
      deleteArmed = false;
      btn.textContent = 'Delete account…';
      btn.classList.remove('armed-danger');
    }, 5000);
    return;
  }
  clearTimeout(deleteTimer);
  deleteArmed = false;
  btn.textContent = 'Delete account…';
  btn.classList.remove('armed-danger');
  const res = await Accounts.deleteAccount();
  if (res.ok) {
    refreshTitle();
    renderPlayerCard();
    refreshAccountUI();
    show('settings', false);
    toast('Account deleted');
  } else if (res.reason === 'reauth-required') {
    toast('For safety, sign out and sign back in, then delete again');
  } else {
    toast("Couldn't delete — try again when you're back online");
  }
};
refreshAccountUI();
Accounts.onChange(() => refreshAccountUI());

// ---- Leaderboards (Update 3, batch 2) ----
let boardTab = 'daily', boardScope = 'global';
function syncBoardTabs() {
  const t = (id, on) => { const b = $(id); if (b) b.classList.toggle('on', on); };
  t('board-tab-daily', boardTab === 'daily');
  t('board-tab-weekly', boardTab === 'weekly');
  t('board-scope-global', boardScope === 'global');
  t('board-scope-friends', boardScope === 'friends');
}
function boardNoteFor(res, sample) {
  if (sample) return 'Sample leaderboard — sign in to play for real.';
  if (!res) return '';
  if (res.reason === 'needs-index') return 'Leaderboards are still being set up — check back soon.';
  if (res.reason === 'fetch-failed') return "Couldn't load the board — check your connection and try again.";
  if (res.empty === 'no-friends') return 'No friends yet — share your invite link below.';
  if (res.empty === 'no-scores') return 'No scores yet — be the first!';
  return boardTab === 'daily' ? `Daily challenge — ${boardKey('daily')}` : `Weekly classic — ${boardKey('weekly')}`;
}
// Renders into the boards list by default; pass the Friends-panel list
// to render there instead. Both lists show the same friends.
function renderFriendList(el) {
  const target = el || $('friend-list');
  if (!target) return;
  const friends = Leaderboards.friends();
  target.innerHTML = friends.length
    ? friends.map((f) => `<div class="friend-row"><span class="board-name">${escapeHtml(f.displayName)}</span><span class="friend-code-sm">${escapeHtml(f.code)}</span><button class="btn ghost sm friend-challenge" data-uid="${escapeHtml(f.uid)}" data-name="${escapeHtml(f.displayName)}">Challenge</button><button class="friend-remove" data-uid="${escapeHtml(f.uid)}" aria-label="Remove ${escapeHtml(f.displayName)}">✕</button></div>`).join('')
    : '';
}
async function loadBoard() {
  const list = $('board-list'), note = $('board-note'), rank = $('board-rank');
  if (!list) return;
  list.innerHTML = '<li class="board-empty">Loading…</li>';
  if (note) note.textContent = '';
  if (rank) rank.textContent = '';
  if (!Accounts.signedIn) {
    if (boardScope === 'friends') {
      // No sample names under "Friends" — that would imply these are
      // your friends. Guests see the honest empty state instead.
      list.innerHTML = '<li class="board-empty">No friends yet — sign in and share your invite link to add friends.</li>';
      if (note) note.textContent = 'Sign in to play on the real leaderboards.';
      renderFriendList();
      return;
    }
    // Guests see a clearly-labelled sample board — never fake ranks.
    // The own row uses the board's own best: daily best on the daily
    // board, classic best on the weekly board (they are different games).
    const ownScore = boardTab === 'daily' ? store.dailyBest(boardKey('daily')) : (+localStorage.getItem('gb_best') || 0);
    const entries = mockBoard(boardTab, boardScope, boardKey(boardTab), Accounts.displayName, ownScore);
    Leaderboards.renderInto(list, entries, 'you');
    if (note) note.textContent = boardNoteFor(null, true);
    renderFriendList();
    return;
  }
  const res = await Leaderboards.fetchBoard({ board: boardTab, scope: boardScope });
  if (!res.ok) {
    list.innerHTML = '<li class="board-empty">Leaderboard unavailable right now.</li>';
    if (note) note.textContent = boardNoteFor(res, false);
    renderFriendList();
    return;
  }
  Leaderboards.renderInto(list, res.entries, Accounts.uid);
  if (note) note.textContent = boardNoteFor(res, false);
  if (rank) rank.textContent = res.ownRank ? `Your rank: #${res.ownRank}` : (res.entries.length ? 'Your score is outside the top 50 — keep playing!' : '');
  renderFriendList();
}
function openBoards(board = 'daily', scope = 'global') {
  boardTab = board; boardScope = scope;
  syncBoardTabs();
  show('boards', true);
  loadBoard();
  renderChallengeList();
}
$('btn-boards').onclick = () => openBoards();
$('rank-chip').onclick = () => openBoards();
$('btn-boards-close').onclick = () => show('boards', false);
$('board-tab-daily').onclick = () => { boardTab = 'daily'; syncBoardTabs(); loadBoard(); };
$('board-tab-weekly').onclick = () => { boardTab = 'weekly'; syncBoardTabs(); loadBoard(); };
$('board-scope-global').onclick = () => { boardScope = 'global'; syncBoardTabs(); loadBoard(); };
$('board-scope-friends').onclick = () => { boardScope = 'friends'; syncBoardTabs(); loadBoard(); };
$('btn-copy-invite').onclick = async () => {
  const link = Leaderboards.inviteLink();
  if (!link) { toast('Sign in to invite friends'); return; }
  try {
    await navigator.clipboard.writeText(link);
    toast('Invite link copied');
  } catch {
    const note = $('board-note');
    if (note) note.textContent = link;
  }
};
// Add friend by code, from either entry point: the boards overlay
// (default elements) or the Friends panel (its own controls). One shared
// path — the input/msg/list are parameters, never hardcoded twice.
// Every failure is an inline message, never a crash; guests get the
// sign-in message inline and as a toast instead of the code flow.
// Enter in the input submits.
async function submitFriendCode(inputEl, msgEl, listEl) {
  const input = inputEl || $('friend-code-input'), msg = msgEl || $('friend-add-msg');
  if (!input) return;
  const setMsg = (t) => { if (msg) msg.textContent = t; };
  if (!Accounts.signedIn) { setMsg('Sign in to add friends by code'); toast('Sign in to add friends by code'); return; }
  const res = await Leaderboards.findByCode(input.value);
  if (res.ok) {
    input.value = '';
    setMsg('');
    toast(`Added ${res.name}!`);
    renderFriendList();
    if (listEl) renderFriendList(listEl);
    loadBoard();
    return;
  }
  setMsg(
    res.reason === 'bad-code' ? "That doesn't look like a friend code — 6 letters and numbers."
    : res.reason === 'own-code' ? "That's your own code."
    : res.reason === 'not-found' ? 'No player with that code — check the code or ask them to share their invite link.'
    : res.reason === 'lookup-unavailable' ? "Friend-code lookup isn't live yet — ask them to share their invite link instead."
    : res.reason === 'session-not-ready' ? 'Still signing you in — try again in a moment.'
    : "Couldn't add that friend — try again."
  );
}
$('btn-add-friend').onclick = () => submitFriendCode();
$('friend-code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitFriendCode(); } });
// Friends panel entry point — same path, the panel's own controls.
$('btn-acct-add-friend').onclick = () => submitFriendCode($('acct-friend-code-input'), $('acct-friend-add-msg'), $('acct-friend-list'));
$('acct-friend-code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitFriendCode($('acct-friend-code-input'), $('acct-friend-add-msg'), $('acct-friend-list')); } });
async function onFriendListClick(e) {
  const chBtn = e.target.closest ? e.target.closest('.friend-challenge') : null;
  if (chBtn) {
    if (!Accounts.signedIn) { toast('Sign in to challenge friends'); return; }
    const res = await Challenges.createChallenge({ toUid: chBtn.dataset.uid, toName: chBtn.dataset.name });
    if (!res.ok) { toast(res.reason === 'rules-not-deployed' ? 'Challenges are still being set up — check back soon.' : "Couldn't create the challenge"); return; }
    try { await navigator.clipboard.writeText(res.link); } catch {}
    toast(`Challenge sent to ${chBtn.dataset.name} — link copied, share it with them`);
    renderChallengeList();
    return;
  }
  const btn = e.target.closest ? e.target.closest('.friend-remove') : null;
  if (!btn) return;
  Leaderboards.removeFriend(btn.dataset.uid);
  renderFriendList();
  renderFriendList($('acct-friend-list'));
}
// Challenge + remove live on both friend lists (boards overlay and the
// Friends panel) — one shared handler, attached to each.
$('friend-list').onclick = onFriendListClick;
$('acct-friend-list').onclick = onFriendListClick;

// ---- Challenges (Update 3, batch 3) ----
function challengeRowHTML(c, opp, myScore, dir) {
  const oppName = escapeHtml(opp ? opp.name : 'Opponent');
  const oppScore = opp ? opp.score : null;
  const left = timeLeftText(c);
  if (c.status === 'expired') {
    const result = (myScore != null && oppScore != null)
      ? (myScore > oppScore ? ' — you won!' : myScore === oppScore ? ' — tied!' : ' — you lost.')
      : '';
    return `<div class="friend-row"><span class="board-name">${oppName} · expired${result}</span><button class="btn ghost sm" data-challenge-rematch="${escapeHtml(c.id)}" data-uid="${escapeHtml(opp ? opp.uid : '')}" data-name="${oppName}">Rematch</button></div>`;
  }
  if (c.status === 'done') {
    const result = (myScore != null && oppScore != null)
      ? (myScore > oppScore ? 'You won!' : myScore === oppScore ? 'Tied!' : 'You lost.')
      : '';
    return `<div class="friend-row"><span class="board-name">${oppName} · ${myScore ?? '–'}–${oppScore ?? '–'} · ${result}</span><button class="btn ghost sm" data-challenge-rematch="${escapeHtml(c.id)}" data-uid="${escapeHtml(opp ? opp.uid : '')}" data-name="${oppName}">Rematch</button></div>`;
  }
  if (dir === 'incoming') {
    const vs = oppScore != null ? ` · they scored ${oppScore}` : '';
    return `<div class="friend-row"><span class="board-name">${oppName} challenged you${vs} · ${left}</span><button class="btn ghost sm" data-challenge-play="${escapeHtml(c.id)}">Play</button></div>`;
  }
  const waiting = myScore != null ? ` · you scored ${myScore}, waiting for them` : ' · waiting for them';
  return `<div class="friend-row"><span class="board-name">${oppName}${waiting} · ${left}</span><button class="btn ghost sm" data-challenge-copy="${escapeHtml(c.id)}">Copy link</button></div>`;
}
async function renderChallengeList() {
  const el = $('challenge-list');
  if (!el) return;
  if (!Accounts.signedIn) {
    el.innerHTML = '<p class="small">Sign in to challenge friends.</p>';
    return;
  }
  el.innerHTML = '<p class="small">Loading…</p>';
  const res = await Challenges.fetchChallenges();
  if (!res.ok) {
    el.innerHTML = `<p class="small">${res.reason === 'rules-not-deployed' ? 'Challenges are still being set up — check back soon.' : "Couldn't load challenges — check your connection."}</p>`;
    return;
  }
  const rows = [];
  for (const c of res.incoming) rows.push(challengeRowHTML(c, Challenges.opponentOf(c, Accounts.uid), (c.scores || {})[Accounts.uid]?.score, 'incoming'));
  for (const c of res.outgoing) rows.push(challengeRowHTML(c, Challenges.opponentOf(c, Accounts.uid), (c.scores || {})[Accounts.uid]?.score, 'outgoing'));
  el.innerHTML = rows.length ? rows.join('') : '<p class="small">No challenges yet — tap Challenge on a friend to start one.</p>';
}
$('challenge-list').onclick = async (e) => {
  const t = e.target.closest ? e.target.closest('[data-challenge-play], [data-challenge-copy], [data-challenge-rematch]') : null;
  if (!t) return;
  if (t.hasAttribute('data-challenge-play')) { startChallengeGame(t.dataset.challengePlay); return; }
  if (t.hasAttribute('data-challenge-copy')) {
    try { await navigator.clipboard.writeText(Challenges.challengeLink(t.dataset.challengeCopy)); toast('Challenge link copied'); }
    catch { toast('Could not copy the link'); }
    return;
  }
  if (t.hasAttribute('data-challenge-rematch')) {
    const res = await Challenges.createChallenge({ toUid: t.dataset.uid, toName: t.dataset.name });
    if (!res.ok) { toast("Couldn't create the rematch"); return; }
    try { await navigator.clipboard.writeText(res.link); } catch {}
    toast(`Rematch sent to ${t.dataset.name} — link copied`);
    renderChallengeList();
  }
};
// Start a challenge game: same seed as the opponent, so the same pieces
// arrive in the same order. The HUD shows the score to beat.
async function startChallengeGame(id) {
  const res = await Challenges.fetchChallenge(id);
  if (!res.ok) {
    toast(res.reason === 'guest' ? 'Sign in to play this challenge' : res.reason === 'not-found' ? 'Challenge not found' : res.reason === 'rules-not-deployed' ? 'Challenges are still being set up — check back soon.' : "Couldn't load this challenge");
    return;
  }
  if (res.status === 'expired') { toast('This challenge has expired'); return; }
  const ch = res.challenge;
  const opp = Challenges.opponentOf(ch, Accounts.uid);
  S.challengeId = id;
  S.challengeOpponent = opp ? opp.name : '';
  S.challengeOpponentScore = opp ? opp.score : null;
  S.challengeToBeat = (opp && opp.score != null) ? opp.score : 0;
  show('boards', false);
  leaveTitle(); clearSave(); startGame('challenge', ch.seed);
}
// A challenge link was opened? Show the challenge in the boards overlay
// with a Play button — never auto-start a game from a link.
async function checkChallengeLink() {
  const id = Challenges.parseChallengeLink(location.href);
  if (!id) return;
  try {
    const url = new URL(location.href);
    url.searchParams.delete('challenge');
    const qs = url.searchParams.toString();
    history.replaceState(null, '', url.pathname + (qs ? '?' + qs : '') + url.hash);
  } catch {}
  const res = await Challenges.fetchChallenge(id);
  if (!res.ok) { toast(res.reason === 'guest' ? 'Sign in to play a challenge' : 'Challenge not found or expired'); return; }
  const opp = Challenges.opponentOf(res.challenge, Accounts.uid);
  openBoards();
  toast(opp ? `Challenge from ${opp.name} — tap Play when you're ready` : "Challenge ready — tap Play when you're ready");
}

// ---- Store (Update 3, batch 4): TEST products only. No billing is wired
// up in v1, so every buy/restore tap answers honestly that purchases are
// not live yet. No network call, no checkout, no charge.
function renderStore() {
  const el = $('store-products');
  if (!el) return;
  el.innerHTML = Store.products().map((p) => `<div class="store-product"><div class="store-info"><div class="store-name">${escapeHtml(p.name)}<span class="store-test">TEST</span></div><div class="store-blurb">${escapeHtml(p.blurb)}</div></div><span class="store-price">${escapeHtml(p.price)}</span><button class="btn ghost sm" data-buy="${escapeHtml(p.id)}">Buy</button></div>`).join('');
}
function openStore() {
  renderStore();
  show('store', true);
}
$('btn-store').onclick = () => openStore();
$('btn-store-close').onclick = () => show('store', false);
$('store-products').onclick = (e) => {
  const btn = e.target.closest ? e.target.closest('[data-buy]') : null;
  if (!btn) return;
  const res = Store.buy(btn.dataset.buy);
  if (res.reason === 'test-only') toast('Test product — purchases are not live yet');
  else toast("Couldn't find that product");
};
$('btn-restore').onclick = () => {
  const res = Store.restore();
  if (res.reason === 'test-only') toast('Nothing to restore — purchases are not live yet');
  else toast("Couldn't check purchases right now");
};

// ---- Skins (cosmetics): the 10 packs from js/cosmetics.js ----
// Same 37 shapes, same game — only the blocks' material + palette
// change. Applying a pack re-renders the block sprites and recolors the
// live board + tray by colour slot (same index, new palette), so a game
// in progress keeps its pieces. Locked packs are never claimable here:
// applyPack refuses them, and the picker shows the real requirement.
function cosmeticsCtx() { return unlockContext(store.xp); }
function applyPack(slug, { preview = false } = {}) {
  const pack = packBySlug(slug);
  if (!pack) return false;
  // Preview is the test/screenshot hook only — it never persists and
  // never unlocks. The real path enforces the unlock, always.
  if (!preview && !isPackUnlocked(slug, cosmeticsCtx())) return false;
  const from = packBySlug(selectedPack());
  const fromPal = from ? from.colors : null;
  if (!preview) setSelectedPack(slug);
  setActivePalette(pack.colors);
  Sprites.setPack(pack);
  if (fromPal) {
    S.board = S.board.map((row) => row.map((v) => (v ? recolorHex(v, fromPal, pack.colors) : v)));
    S.tray = S.tray.map((p) => { if (p) p.color = recolorHex(p.color, fromPal, pack.colors); return p; });
  }
  renderSkins();
  return true;
}
function skinCardHTML(pack, ctx, equipped) {
  const unlocked = isPackUnlocked(pack.slug, ctx);
  const favs = loadCosmetics().favorites;
  const isFav = favs.includes(pack.slug);
  const preview = Sprites.packPreview(pack);
  const state = equipped
    ? '<span class="skin-lock" style="color:#2f8cff">Equipped</span>'
    : unlocked
      ? `<button class="btn ghost sm" data-use="${escapeHtml(pack.slug)}">Use</button>`
      : `<div class="skin-lock">🔒 ${escapeHtml(lockText(pack))}</div>`;
  const buy = !unlocked && (pack.unlock.kind === 'iap' || pack.unlock.kind === 'supporter')
    ? `<button class="btn ghost sm" data-buy-pack="${escapeHtml(pack.unlock.product)}">${escapeHtml(pack.unlock.price)}</button>` : '';
  return `<div class="skin-card${equipped ? ' equipped' : ''}${unlocked ? '' : ' locked'}"><span class="skin-preview"><img src="${preview}" alt="${escapeHtml(pack.name)} preview"></span><div class="skin-info"><div class="skin-name">${escapeHtml(pack.name)}<span class="skin-badge">${escapeHtml(pack.badge)}</span></div><div class="skin-note">${escapeHtml(pack.note)}</div>${state}${buy}</div><button class="skin-fav${isFav ? ' on' : ''}" data-fav="${escapeHtml(pack.slug)}" ${unlocked ? '' : 'disabled title="Unlock this skin first — favorites are for skins you own"'} aria-label="${isFav ? 'Remove from favorites' : 'Add to favorites'}">${isFav ? '★' : '☆'}</button></div>`;
}
function renderSkins() {
  const list = $('skins-list'), favEl = $('skins-fav');
  if (!list || !favEl) return;
  const ctx = cosmeticsCtx();
  const equipped = selectedPack();
  const favs = loadCosmetics().favorites.filter((s) => isPackUnlocked(s, ctx));
  favEl.innerHTML = favs.length
    ? favs.map((s) => skinCardHTML(packBySlug(s), ctx, s === equipped)).join('')
    : '<p class="skins-empty">No favorites yet — tap ☆ on a skin you own to pin it here.</p>';
  list.innerHTML = PACKS.map((p) => skinCardHTML(p, ctx, p.slug === equipped)).join('');
}
function openSkins() {
  renderSkins();
  show('skins', true);
}
$('btn-skins').onclick = () => openSkins();
$('btn-skins-close').onclick = () => show('skins', false);
function skinsClick(e) {
  const use = e.target.closest ? e.target.closest('[data-use]') : null;
  if (use) {
    const pack = packBySlug(use.dataset.use);
    if (pack && applyPack(pack.slug)) toast(`${pack.name} equipped`);
    else toast("That skin isn't unlocked yet");
    return;
  }
  const fav = e.target.closest ? e.target.closest('[data-fav]') : null;
  if (fav && !fav.disabled) {
    const res = toggleFavorite(fav.dataset.fav, cosmeticsCtx());
    if (!res.ok) toast('Unlock this skin first — favorites are for skins you own');
    else { toast(res.favorited ? 'Added to favorites' : 'Removed from favorites'); renderSkins(); }
    return;
  }
  const buy = e.target.closest ? e.target.closest('[data-buy-pack]') : null;
  if (buy) {
    const res = Store.buy(buy.dataset.buyPack);
    if (res.reason === 'test-only') toast('Test product — purchases are not live yet');
    else toast("Couldn't find that product");
  }
}
$('skins-list').onclick = skinsClick;
$('skins-fav').onclick = skinsClick;
// Invite link opened? Add the friend (the link is the invitation) and
// clean the params so a reload does not re-add.
function checkInviteLink() {
  const invite = Leaderboards.parseInviteLink(location.href);
  if (!invite) return;
  const res = Leaderboards.addFriend(invite);
  if (res.ok) toast(`Added ${res.name} as a friend`);
  try {
    const url = new URL(location.href);
    url.searchParams.delete('friend'); url.searchParams.delete('code'); url.searchParams.delete('name');
    const qs = url.searchParams.toString();
    history.replaceState(null, '', url.pathname + (qs ? '?' + qs : '') + url.hash);
  } catch {}
}
$('btn-menu').onclick = () => { if (Tutorial.active) return; show('menu', true); Analytics.log('menu_open', {}); };
// Settings lives inside the pause menu now (the top-right gear is gone;
// the hamburger is the single top-right control).
$('btn-menu-settings').onclick = () => { show('menu', false); syncSettings(); show('settings', true); };
$('btn-resume').onclick = () => show('menu', false);
// Main Menu (Dylan, Nov 12 ~3:05 PM): quit to the title WITHOUT ending the
// run — save first, so Play offers "Continue" and the game resumes exactly
// where it left off. No score is submitted on quit (scores submit on game
// over only) and the run is not abandoned: S.running stays true and the
// timer simply pauses while the title is shown (see timerPaused).
$('btn-menu-home').onclick = () => { saveGame(); show('menu', false); refreshTitle(); show('title', true); Analytics.log('game_quit_to_menu', { score: S.score, mode: S.mode }); };
$('btn-restart').onclick = () => { show('menu', false); if (S.running) { S.running = false; Analytics.log('game_abandon', { score: S.score }); } clearSave(); startGame(S.mode === 'daily' ? 'daily' : S.mode === 'challenge' ? 'challenge' : 'classic', S.dateKey || localDateKey()); };
$('btn-log').onclick = () => { const el = $('log'); el.classList.toggle('hidden'); el.textContent = Analytics.all().slice(-60).map((e) => JSON.stringify(e)).join('\n'); };
// Hidden debug path only: the analytics log stays out of the player UI
// unless the page is opened with ?debug=1.
if (new URLSearchParams(location.search).has('debug')) $('btn-log').classList.remove('hidden');
// Power-up buttons (under the board) + targeting controls.
document.querySelectorAll('#powerups .pu').forEach((b) => { b.onclick = () => armPowerup(b.dataset.pu); });
$('pu-cancel').onclick = cancelArmed;
$('pu-mode-row-btn').onclick = () => { S.sweepMode = 'row'; renderPowerups(); };
$('pu-mode-col-btn').onclick = () => { S.sweepMode = 'col'; renderPowerups(); };
renderPowerups(); renderTimerBar();
$('btn-again').onclick = () => {
  show('over', false);
  // No ad here any more (Dylan, Nov 12): the end-of-game interstitial
  // already ran (or didn't) inside finishGame, before the panel opened.
  // Play Again just starts the fresh game.
  startGame(S.mode === 'daily' ? 'daily' : S.mode === 'challenge' ? 'challenge' : 'classic', S.mode === 'classic' ? localDateKey() : S.dateKey);
};
$('btn-over-boards').onclick = () => { show('over', false); openBoards(); };
$('btn-home').onclick = () => { show('over', false); refreshTitle(); show('title', true); };

// ---------- Scripted first-game tutorial: 5 steps, shown once ----------
// A guided walkthrough, not a dismissable text box: pre-selected pieces,
// a prepared board, highlights on the exact cells and the exact piece,
// locked input (only the scripted move can be made; a wrong drop snaps
// back). The caption is one short line over the score row — never over
// the board — and each step advances by itself on the right move. Small
// Skip in the corner returns to the menu. On finish: "Nice! You're
// ready." then a fresh real game (fresh board, normal timer, random tray).
const TUT_PALETTE = ['#ff4d4d', '#ff8a1e', '#ffd21f', '#2fd65a', '#2f8cff', '#9b4dff', '#ff5da2'];
function tutBoard(rows) {
  return rows.map((row, r) => [...row].map((ch, c) => (ch === '#' ? TUT_PALETTE[(r * 3 + c) % TUT_PALETTE.length] : null)));
}
const TUT_EMPTY = ['........', '........', '........', '........', '........', '........', '........', '........'];
// Shape ids (js/pieces.js): 0 = single cell, 1 = '##', 3 = '###'.
const TUT_STEPS = [
  { // 1 — Place.
    text: 'Drag this piece onto the highlighted squares.',
    board: TUT_EMPTY,
    tray: [1, 0, 0],
    slot: 0, target: { r: 7, c: 3 }, cells: [[7, 3], [7, 4]],
  },
  { // 2 — Clear a line.
    text: 'Fill a whole row or column to clear it.',
    board: ['........', '........', '........', '........', '........', '........', '........', '#######.'],
    tray: [0, 0, 0],
    slot: 0, target: { r: 7, c: 7 }, cells: [[7, 7]],
  },
  { // 3 — Combo: one single cell completes row 6 AND column 3.
    text: 'Clear more than one at a time for a combo.',
    board: ['...#....', '...#....', '...#....', '...#....', '...#....', '...#....', '###.####', '...#....'],
    tray: [0, 0, 0],
    slot: 0, target: { r: 6, c: 3 }, cells: [[6, 3]],
  },
  { // 4 — Time: clear a line and watch the TIME bar gain seconds.
    text: 'You have two minutes. Clearing lines adds time.',
    board: ['........', '........', '........', '........', '........', '#####..#', '........', '........'],
    tray: [1, 0, 0],
    slot: 0, target: { r: 5, c: 5 }, cells: [[5, 5], [5, 6]],
    spot: 'timer',
  },
  { // 5 — Power-ups: the dock itself is spotlighted; tap the star slot.
    text: 'Earn power-ups with a 3-line combo, or every 10 lines.',
    board: null, // keep the board from step 4
    tray: [0, 0, 0],
    slot: null, target: null, cells: null,
    spot: 'dock', grant: 'star',
  },
];
const Tutorial = {
  step: -1,
  get active() { return this.step >= 0; },
  get current() { return this.step >= 0 ? TUT_STEPS[this.step] : null; },
  start() {
    // Fresh tutorial session: reset the in-progress game, then step 0.
    S.board = tutBoard(TUT_EMPTY);
    S.score = 0; S.shownScore = 0; S.combo = 0; S.sinceClear = 0; S.maxCombo = 0; S.lines = 0; S.placed = 0;
    S.charges = emptyCharges(); S.earnIdx = 0; S.armed = null; S.sweepMode = 'row';
    S.level = 1; S.timeLeft = TIMER.start; S.lowTonePlayed = false; lastTickSecond = -1;
    $('countdown').classList.remove('on'); lastCdShown = '';
    S.timerStarted = false;
    renderPowerups(); renderTimerBar(); renderLevel(); renderScore(0); renderCombo(); setModeUI();
    this.step = 0;
    Analytics.log('tutorial_start', {});
    $('tut').classList.add('show');
    this.render();
  },
  render() {
    const st = this.current; if (!st) return;
    this.clearSpotlights();
    if (st.board) S.board = tutBoard(st.board);
    if (st.tray) S.tray = st.tray.map((i) => (i == null ? null : makePiece(SHAPES[i])));
    if (st.grant) {
      S.charges[st.grant] = (S.charges[st.grant] || 0) + 1;
      renderPowerups();
    }
    $('tut-text').textContent = st.text;
    $('tut-dots').querySelectorAll('i').forEach((d, i) => d.classList.toggle('on', i <= this.step));
    // Hand: animates the drag from the expected slot to the target cells
    // (aimed at the centre of the target cells, so a 2-wide piece lands
    // with its origin on the first highlighted cell).
    const hand = $('tut-hand');
    if (st.slot != null && st.cells) {
      const r = cv.getBoundingClientRect();
      const fx0 = r.left + L.trayX + L.slotW * (st.slot + 0.5) - 26, fy0 = r.top + L.trayY + L.trayH / 2 - 26;
      const cs = st.cells.map(([, c]) => c), rs = st.cells.map(([rr]) => rr);
      const tx = r.left + L.bx + ((Math.min(...cs) + Math.max(...cs) + 1) / 2) * L.cell - 26;
      const ty = r.top + L.by + ((Math.min(...rs) + Math.max(...rs) + 1) / 2) * L.cell - 26;
      hand.style.setProperty('--fx', fx0 + 'px'); hand.style.setProperty('--fy', fy0 + 'px');
      hand.style.setProperty('--tx', tx + 'px'); hand.style.setProperty('--ty', ty + 'px');
      hand.classList.add('on');
    } else hand.classList.remove('on');
    // Spotlights: TIME bar (step 4), dock + slot + arrow (step 5).
    if (st.spot === 'timer') $('timer-wrap').classList.add('tut-spot');
    if (st.spot === 'dock') {
      $('powerups').classList.add('tut-spot');
      const btn = document.querySelector('#powerups .pu[data-pu="star"]');
      btn.classList.add('tut-spot');
      const br = btn.getBoundingClientRect();
      const arrow = $('tut-arrow');
      arrow.style.left = (br.left + br.width / 2) + 'px';
      arrow.classList.remove('hidden');
      // Position from the arrow's own measured height (64px font): its tip
      // sits 16px above the slot at rest, 6px at the bottom of the bob, so
      // it never touches the slot. A fixed offset would drift with the
      // font size and could cover the tray or the slot.
      arrow.style.top = (br.top - arrow.offsetHeight - 16) + 'px';
    }
  },
  clearSpotlights() {
    $('timer-wrap').classList.remove('tut-spot');
    $('powerups').classList.remove('tut-spot');
    document.querySelectorAll('#powerups .pu.tut-spot').forEach((b) => b.classList.remove('tut-spot'));
    $('tut-arrow').classList.add('hidden');
  },
  acceptsDrop(slot, r, c) {
    const st = this.current;
    if (!st || st.slot == null || !st.target) return false;
    return slot === st.slot && r === st.target.r && c === st.target.c;
  },
  next() {
    if (this.step >= TUT_STEPS.length - 1) return this.finish('done');
    this.step++;
    this.render();
  },
  onPlaced() {
    if (!this.active) return;
    const st = this.current;
    if (!st || st.slot == null) return;
    this.next();
  },
  advanceFromDock() {
    if (this.active && this.current && this.current.spot === 'dock') this.next();
  },
  // Pulsing gold highlight on the exact target cells + a glow ring around
  // the expected tray piece. Called from draw(), after the tray.
  drawHighlights(g, t) {
    const st = this.current; if (!st) return;
    const { bx, by, cell: s } = L;
    const rm = reducedMotion();
    if (st.cells) {
      const pulse = rm ? 0.2 : 0.16 + 0.08 * Math.sin(t * 4);
      for (const [r, c] of st.cells) {
        const x = bx + c * s, y = by + r * s;
        g.fillStyle = `rgba(255,210,31,${pulse})`;
        rrect(x + 2, y + 2, s - 4, s - 4, s * 0.2); g.fill();
        g.strokeStyle = '#ffd21f'; g.lineWidth = 3; g.setLineDash([7, 6]); g.lineDashOffset = rm ? 0 : -t * 24;
        rrect(x + 3, y + 3, s - 6, s - 6, s * 0.2); g.stroke(); g.setLineDash([]);
      }
    }
    if (st.slot != null && S.tray[st.slot]) {
      const p = S.tray[st.slot], sh = p.shape, ts = trayCellFor(sh);
      const cx = L.trayX + L.slotW * (st.slot + 0.5), cy = L.trayY + L.trayH / 2;
      const w = sh.w * ts, h = sh.h * ts, pad = rm ? 6 : 6 + 2 * Math.sin(t * 4);
      g.strokeStyle = 'rgba(255,210,31,0.95)'; g.lineWidth = 3; g.setLineDash([8, 6]); g.lineDashOffset = rm ? 0 : -t * 24;
      rrect(cx - w / 2 - pad, cy - h / 2 - pad, w + pad * 2, h + pad * 2, 10); g.stroke(); g.setLineDash([]);
    }
  },
  finish(how) {
    if (!this.active) return;
    this.step = -1;
    this.clearSpotlights();
    $('tut-hand').classList.remove('on');
    $('tut').classList.remove('show');
    localStorage.setItem('gb_tut_done', '1');
    Analytics.log('tutorial_' + how, {});
    if (how === 'done') {
      // "Nice! You're ready." — one glossy moment over the fresh real
      // game, which starts right away and auto-continues underneath.
      const done = $('tut-done');
      $('tut').classList.add('show');
      done.classList.remove('hidden');
      startGame('classic');
      setTimeout(() => { done.classList.add('hidden'); $('tut').classList.remove('show'); }, 1400);
    } else {
      // Skip: back to the menu; the tutorial game is abandoned.
      S.running = false;
      clearSave();
      show('title', true);
      refreshTitle();
    }
  },
};
$('tut-skip').onclick = () => Tutorial.finish('skipped');

// ---------- Lifecycle: save on hide, pause music ----------
document.addEventListener('visibilitychange', () => { if (document.hidden) { saveGame(); Music.pause(); } else Music.resume(); });
// Menu music: iOS Safari + Chrome block audio before any user gesture, so
// there is no true zero-tap autoplay on load. Instead the music starts on
// the FIRST tap/keypress anywhere on the page — including the title
// screen, not just Play — and keeps playing across menu and game. No
// AudioContext is created before that gesture (the suite asserts
// audioState === 'none' pre-gesture); Sfx.unlock() both creates it and
// starts the music when it is on.
const unlockAudioOnce = () => Sfx.unlock();
document.addEventListener('pointerdown', unlockAudioOnce, { once: true, capture: true });
document.addEventListener('keydown', unlockAudioOnce, { once: true, capture: true });
window.addEventListener('pagehide', saveGame);

// ---------- Back button (Android, via native.js): close overlays, else pause ----------
window.__gbBack = () => {
  for (const id of ['settings', 'menu']) if ($(id).classList.contains('show')) { show(id, false); return true; }
  if (S.armed) { cancelArmed(); return true; }
  if (Tutorial.active) { Tutorial.finish('skipped'); return true; }
  if ($('ad').classList.contains('show')) return true; // never dismiss an ad via back here; the ad has its own close
  if ($('over').classList.contains('show')) { show('over', false); refreshTitle(); show('title', true); return true; }
  if (S.running) { saveGame(); show('menu', true); return true; } // pause: menu doubles as the pause screen
  return false; // on the title screen: let the app exit
};

S.board = emptyBoard();
// Equipped cosmetics pack first: new deals + block sprites use its
// palette + material from the first frame (not the classic default).
setActivePalette((packBySlug(selectedPack()) || packBySlug('classic-candy')).colors);
Sprites.init(packBySlug(selectedPack()) || packBySlug('classic-candy'));
// ---------- Hero type: glossy 3D numerals (pre-rendered sprites) ----------
// Score / BEST / combo / game-over score / countdown are <img> sprites once
// the hero type is ready; before that they show plain text (same value). The
// rolling score counter reuses a small <img> pool so it never rebuilds the
// DOM while animating. The wordmark itself is inline SVG text (.logo in
// index.html, gradient fill — fix13; the old CSS gradient text showed
// white lines on Safari, so the technique was replaced, not the look).
const scoreImgs = [], bestImgs = [], ovScoreImgs = [], cdImgs = [];
function renderDigitRow(pool, el, digits, pal) {
  if (el.dataset.mode !== 'img') { el.innerHTML = ''; el.dataset.mode = 'img'; }
  for (let i = 0; i < pool.length; i++) el.appendChild(pool[i]); // re-attach after any text phase
  while (pool.length < digits.length) { const img = document.createElement('img'); img.alt = ''; el.appendChild(img); pool.push(img); }
  for (let i = 0; i < digits.length; i++) {
    const img = pool[i];
    const key = `${pal}:${digits[i]}`;
    if (img.dataset.key !== key) { img.src = Sprites.numeralURL(digits[i], pal); img.dataset.key = key; img.alt = digits[i]; }
    img.style.display = '';
  }
  for (let i = digits.length; i < pool.length; i++) pool[i].style.display = 'none';
}
function renderScore(v) {
  const el = $('score');
  if (!Sprites.heroReady) { el.textContent = v; el.dataset.mode = ''; return; }
  renderDigitRow(scoreImgs, el, String(Math.round(v)), 'gold');
}
function renderBest(v) {
  const el = $('best');
  if (!Sprites.heroReady) { el.textContent = v; el.dataset.mode = ''; return; }
  renderDigitRow(bestImgs, el, String(v), 'gold');
}
function renderOvScore(v) {
  const el = $('ov-score');
  if (!Sprites.heroReady) { el.textContent = v; el.dataset.mode = ''; return; }
  renderDigitRow(ovScoreImgs, el, String(v), 'gold');
}
function renderCombo() {
  const el = $('combo');
  if (S.combo < 2) { el.innerHTML = ''; el.dataset.val = ''; return; }
  if (!Sprites.heroReady) { el.textContent = `Combo x${S.combo}`; el.dataset.val = ''; return; }
  const key = `x${S.combo}`;
  if (el.dataset.val === key) return;
  el.dataset.val = key;
  el.innerHTML = `<img class="combo-star" src="${Sprites.starURL('#ffd21f')}" alt="star"> Combo ×${[...String(S.combo)].map((d) => `<img src="${Sprites.numeralURL(d, 'gold')}" alt="${d}">`).join('')}`;
}
let lastCdShown = '';
function renderCountdown(secs) {
  const pal = secs <= 5 ? 'red' : 'amber';
  const key = `${pal}:${secs}`;
  if (lastCdShown === key) return;
  lastCdShown = key;
  const cd = $('countdown');
  cd.dataset.secs = secs; cd.dataset.palette = pal;
  const nums = $('cd-nums');
  if (!Sprites.heroReady) { nums.textContent = secs; return; }
  renderDigitRow(cdImgs, nums, String(secs), pal);
}
Sprites.initHeroType().then(() => {
  lastCdShown = '';
  renderScore(S.score); renderBest(modeBest()); renderCombo();
  if ($('over').classList.contains('show')) renderOvScore(S.score);
  if ($('countdown').classList.contains('on')) renderCountdown(parseInt($('countdown').dataset.secs || '20', 10));
});
initIcons();
syncSoundBtn(); // after initIcons: it would overwrite the mute icon with the default 'sound' art
applyMotionClass();
// Accounts (Update 3): guest profile is created locally; guests never
// load the SDK — it loads only on sign-in or for a returning session.
Accounts.init().then(() => {
  refreshAccountUI(); checkInviteLink(); checkChallengeLink();
  // A redirect sign-in that died on the way back (lost state, or an
  // error) must say so on the title screen — the player lands here,
  // not in the account panel, and silence reads as "nothing happened"
  // (Dylan, Nov 12: Google sign-in did nothing after signing in).
  const st = Accounts.debugState();
  if (st.redirectError) toast(authErrorMessage(st.redirectError));
}).catch(() => refreshAccountUI());
layout();
Ads.init();
requestAnimationFrame(frame);
const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
if (isNative) import('./native.js').then((m) => m.initNative()).catch((e) => console.warn('native init', e));
else if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

// ---------- Test hooks (read-only layout + state; mutation only with ?test=1) ----------
window.__gb = {
  layout: () => ({ ...L }),
  state: () => ({ board: S.board.map((r) => r.map(Boolean)), tray: S.tray.map((p) => p && { id: p.shape.id, cells: p.shape.cells, w: p.shape.w, h: p.shape.h, helper: p.helper }), score: S.score, combo: S.combo, lines: S.lines, running: S.running, placed: S.placed, mode: S.mode, dateKey: S.dateKey, helperAvailable: S.helperAvailable, tutorialStep: Tutorial.step, timeLeft: Math.round(S.timeLeft * 10) / 10, timerStarted: S.timerStarted, charges: { ...S.charges }, variant: S.variant, autoSaving: S.autoSaving, armed: S.armed, sweepMode: S.sweepMode, musicOn: Music.on, musicBpm: Music.bpm, musicLoopSeconds: Music.loopSeconds, musicLoopEvents: Music.loopEvents, musicUrgency: Music.urgency, audioState: Music.ctxState, audioTime: Music.ctxTime, musicScheduled: Music.scheduled, musicScheduler: Music.schedulerOn, musicGain: Music.busGain, musicBaseGain: Music.baseGain, sfxMuted: Sfx.muted, spritesReady: Sprites.ready, timerPaused: timerPaused(), level: S.level, xp: store.xp, playerLevel: playerLevelFor(store.xp), pack: selectedPack(), packMaterial: Sprites.packMaterial, reducedMotion: reducedMotion(), countdownVisible: $('countdown').classList.contains('on'), countdownText: $('countdown').dataset.secs || '', heroTypeReady: Sprites.heroReady,
    layout: { size: L.size, cell: Math.round(L.cell * 10) / 10, bx: Math.round(L.bx * 10) / 10, by: Math.round(L.by * 10) / 10, trayX: Math.round(L.trayX * 10) / 10, trayY: Math.round(L.trayY * 10) / 10, trayH: Math.round(L.trayH * 10) / 10, slotW: Math.round(L.slotW * 10) / 10, trayCellMax: Math.round(L.trayCell * 10) / 10, stageW: L.w, stageH: L.h },
    dragScale: drag ? Math.round(drag.scale * 100) / 100 : null, dragStartScale: drag ? Math.round(drag.startScale * 100) / 100 : null }),
  // Accounts (Update 3, batch 1): read-only state for tests.
  accounts: () => Accounts.debugState(),
};
if (new URLSearchParams(location.search).has('test')) {
  // Accounts (Update 3): mutation hooks, test-only like the rest here.
  window.__gb.setAccountName = (n) => Accounts.setDisplayName(n);
  window.__gb.setHideGlobal = (v) => Accounts.setHideFromGlobal(v);
  window.__gb.signInGoogle = () => Accounts.signInGoogle();
  window.__gb.signInFacebook = () => Accounts.signInFacebook();
  window.__gb.signInAnonymous = () => Accounts.signInAnonymous();
  window.__gb.signOut = () => Accounts.signOut();
  window.__gb.accountRecordGame = () => Accounts.recordGame();
  window.__gb.deleteAccount = () => Accounts.deleteAccount();
  // Test hook: preview the signed-in UI without the network (same idea as
  // setCharges for the dock) — sets the local profile to a signed-in
  // identity and refreshes the UI. Screenshots + the signed-in UI test
  // use it; it never touches Firebase and nothing leaves the device.
  window.__gb.setAccountPreview = (provider) => {
    if (!Accounts.profile) return null;
    Accounts.profile.provider = provider || 'anonymous';
    Accounts.profile.cloudUid = 'preview-' + (provider || 'anonymous');
    Accounts.saveProfile();
    refreshAccountUI();
    return Accounts.debugState();
  };
  // Leaderboards (Update 3, batch 2): state + actions for tests.
  window.__gb.submitScore = (o) => Leaderboards.submitScore(o);
  window.__gb.fetchBoard = (o) => Leaderboards.fetchBoard(o);
  window.__gb.mockBoard = (b, s, k, n, sc) => mockBoard(b, s, k, n, sc);
  window.__gb.addFriend = (f) => Leaderboards.addFriend(f);
  window.__gb.findByCode = (c) => Leaderboards.findByCode(c);
  window.__gb.friendsList = () => Leaderboards.friends();
  window.__gb.inviteLink = () => Leaderboards.inviteLink();
  window.__gb.showBoards = (b, s) => openBoards(b || 'daily', s || 'global');
  window.__gb.boardState = () => ({ board: boardTab, scope: boardScope });
  window.__gb.refreshTitle = () => { refreshTitle(); };
  window.__gb.todayKey = () => localDateKey();
  window.__gb.refreshRankChip = () => refreshRankChip();
  window.__gb.rankChip = () => {
    const c = $('rank-chip');
    if (!c) return null;
    return { main: $('rank-chip-main')?.textContent || '', sub: $('rank-chip-sub')?.textContent || '', top1: c.classList.contains('top1'), live: c.dataset.live === '1' };
  };
  window.__gb.weekKey = (d) => weekKeyFor(d ? new Date(d) : undefined);
  // Challenges (Update 3, batch 3): state + actions for tests.
  window.__gb.createChallenge = (o) => Challenges.createChallenge(o);
  window.__gb.fetchChallenge = (id) => Challenges.fetchChallenge(id);
  window.__gb.fetchChallenges = () => Challenges.fetchChallenges();
  window.__gb.submitChallengeScore = (id, s) => Challenges.submitChallengeScore(id, s);
  window.__gb.challengeStatus = (ch, now) => challengeStatus(ch, now);
  window.__gb.challengeLink = (id) => Challenges.challengeLink(id);
  window.__gb.parseChallengeLink = (u) => Challenges.parseChallengeLink(u);
  window.__gb.startChallenge = (id, seed, toBeat, oppName, oppScore) => {
    S.challengeId = id; S.challengeToBeat = toBeat || 0; S.challengeOpponent = oppName || ''; S.challengeOpponentScore = oppScore ?? null;
    show('title', false); clearSave(); startGame('challenge', seed);
  };
  window.__gb.startChallengeGame = (id) => startChallengeGame(id);
  // Store (Update 3, batch 4): test products only, no checkout.
  window.__gb.storeProducts = () => Store.products();
  window.__gb.buyProduct = (id) => Store.buy(id);
  window.__gb.restorePurchases = () => Store.restore();
  window.__gb.showStore = () => openStore();
  window.__gb.applyPack = (slug) => applyPack(slug);
  window.__gb.previewPack = (slug) => applyPack(slug, { preview: true });
  window.__gb.showSkins = () => openSkins();
  window.__gb.cosmeticsState = () => ({ selected: selectedPack(), favorites: loadCosmetics().favorites, owned: loadCosmetics().owned, packs: PACKS.map((p) => ({ slug: p.slug, name: p.name, unlocked: isPackUnlocked(p.slug, cosmeticsCtx()) })) });
  window.__gb.setBoard = (rows) => { S.board = rows.map((row) => [...row].map((ch) => (ch === '#' ? '#5aa2ff' : null))); };
  window.__gb.startDaily = (k) => { show('title', false); clearSave(); startGame('daily', k); };
  window.__gb.startGame = (mode, k) => { show('title', false); clearSave(); startGame(mode || 'classic', k || localDateKey()); };
  window.__gb.saveNow = saveGame;
  window.__gb.setTray = (ids) => { S.tray = ids.map((i) => (i == null ? null : makePiece(SHAPES[i]))); };
  window.__gb.setTimeLeft = (s) => { S.timeLeft = s; S.lowTonePlayed = s <= TIMER.lowSeconds; renderTimerBar(); };
  window.__gb.setCharges = (c) => {
    S.charges = { ...emptyCharges(), ...c };
    renderPowerups();
  };
  // Test hook: the Ads module, so tests can swap in a hanging provider and
  // prove Play Again never waits on an ad forever.
  window.__gb.ads = Ads;
  // Test hook: run the no-moves check (and any auto-save it triggers).
  window.__gb.checkGameOver = () => checkGameOver();
  window.__gb.place = (slot, r, c) => place(slot, r, c);
  window.__gb.armPowerup = (type) => armPowerup(type);
  window.__gb.targetCell = (r, c) => { if (S.armed === 'bomb') applyBomb(r, c); else if (S.armed === 'sweep') applySweep(r, c); };
  window.__gb.grantCharge = () => grantCharge();
  // Test hook: live canvas popups (text, stagger delay, position) — for
  // asserting the clear-flow popups don't stack on one another.
  window.__gb.popups = () => fx.popups.map((p) => ({ text: p.text, delay: p.delay || 0, x: Math.round(p.x), y: Math.round(p.y) }));
  // Test hook: pre-rendered numeral sprite URL (digit, palette) — for
  // asserting no hard line inside any digit glyph.
  window.__gb.numeralURL = (d, p) => Sprites.numeralURL(d, p || 'gold');
  // Test hook: pre-rendered icon sprite URL (name) — for asserting the
  // bomb ball is centred in its disc (Dylan flagged it twice).
  window.__gb.iconURL = (name) => Sprites.iconURL(name);
}
