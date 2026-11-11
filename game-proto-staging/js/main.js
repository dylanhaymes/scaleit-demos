import { N, dealTray, fits, fitsAnywhere, helperEligible, levelFor, RULES_TEXT, TIMER, POWERUPS, timeForClear, powerUpPoints, LEVEL_EVERY } from './difficulty.js';
import { xpForGame, playerLevelFor, playerProgress, nextReward, rewardsForLevel } from './progress.js';
import { Ads } from './ads.js';
import { Analytics } from './analytics.js';
import { Sfx, Music } from './audio.js';
import { Haptics } from './haptics.js';
import { COMBO_GRACE, BOARD_CLEAR_BONUS, clearPoints } from './scoring.js';
import { dailyRng, localDateKey } from './rng.js';
import { SHAPES, makePiece } from './pieces.js';
import { APP_NAME } from './brand.js';
import { Sprites } from './sprites.js';

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
  lines: 0, placed: 0, revived: false, helperAvailable: false, running: false, gamesThisSession: 0,
  startBest: 0, startedAt: 0, mode: 'classic', dateKey: null, rng: Math.random,
  timeLeft: TIMER.start, timerStarted: false, lowTonePlayed: false,
  charges: { bomb: 0, sweep: 0, reshuffle: 0, star: 0 }, earnIdx: 0,
  // Each held charge has its own 30 s play-time clock (oldest first).
  // chargeClocks[type] is an array of seconds remaining, parallel to the count.
  chargeClocks: { bomb: [], sweep: [], reshuffle: [], star: [] },
  autoSaving: false, bannerUntil: 0,
  armed: null, sweepMode: 'row', level: 1,
};
const emptyCharges = () => ({ bomb: 0, sweep: 0, reshuffle: 0, star: 0 });
const totalCharges = () => Object.values(S.charges).reduce((a, b) => a + b, 0);
function emptyChargeClocks() { return { bomb: [], sweep: [], reshuffle: [], star: [] }; }
// Use-it-or-lose-it: each charge lasts POWERUPS.chargeLifetimeSeconds of
// PLAY time. The clock only runs while the game timer runs and no banner is
// showing (pause/menu/settings/ads/tutorial/level-up banners/background all
// pause it). Oldest charge first (FIFO per type).
function addCharge(type) {
  S.charges[type]++;
  S.chargeClocks[type].push(POWERUPS.chargeLifetimeSeconds);
}
function spendCharge(type) {
  if (!S.charges[type]) return;
  S.charges[type]--;
  S.chargeClocks[type].shift();
  renderPowerups();
}
// Age every held charge by dt seconds of play time; expired charges fade
// away with a soft poof and no points. Returns the number that expired.
function ageChargeClocks(dt) {
  if (dt <= 0) return 0;
  let expired = 0;
  for (const type of Object.keys(S.chargeClocks)) {
    const clocks = S.chargeClocks[type];
    for (let i = 0; i < clocks.length; i++) clocks[i] -= dt;
    while (clocks.length && clocks[0] <= 0) {
      clocks.shift();
      S.charges[type]--;
      expired++;
      Analytics.log('powerup_expired', { type, remaining: totalCharges() });
      const btn = document.querySelector(`#powerups .pu[data-pu="${type}"]`);
      if (btn) { btn.classList.remove('poof'); void btn.offsetWidth; btn.classList.add('poof'); }
    }
  }
  if (expired) renderPowerups();
  else renderChargeClocks();
  return expired;
}
// Ring + seconds text for held charges (drains as the oldest charge runs
// down; pulses under 5 s). Only touches the DOM when the shown second changes.
const lastClockShown = {};
function renderChargeClocks() {
  document.querySelectorAll('#powerups .pu').forEach((b) => {
    const type = b.dataset.pu, n = S.charges[type] || 0;
    const ring = b.querySelector('.pu-ring'), prog = b.querySelector('.pu-progress');
    if (n > 0) {
      const secs = Math.max(0, S.chargeClocks[type][0] || 0);
      const shown = Math.ceil(secs);
      if (lastClockShown[type] !== shown) {
        lastClockShown[type] = shown;
        ring.style.setProperty('--ring', Math.round((secs / POWERUPS.chargeLifetimeSeconds) * 100));
        prog.textContent = `${shown}s`;
      }
      b.classList.toggle('expiring', secs <= 5);
    } else {
      const into = S.lines % POWERUPS.linesMilestone;
      const key = 'm' + into;
      if (lastClockShown[type] !== key) {
        lastClockShown[type] = key;
        ring.style.setProperty('--ring', Math.round((into / POWERUPS.linesMilestone) * 100));
        prog.textContent = `${into}/${POWERUPS.linesMilestone}`;
      }
      b.classList.remove('expiring');
    }
  });
}
const modeBest = () => (S.mode === 'daily' ? store.dailyBest(S.dateKey) : store.best);
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
  const boardSize = Math.floor(Math.min(w * 0.92, h * 0.62, 520));
  const cell = boardSize / N;
  const bx = (w - boardSize) / 2;
  const trayH = Math.min(cell * 3.4, h - boardSize - 30);
  const by = Math.max(10, (h - boardSize - trayH) / 2 - 6);
  L = { w, h, cell, bx, by, size: boardSize, trayY: by + boardSize + 16, trayH, slotW: w / 3, trayCell: cell * 0.55 };
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
  fx.popups = fx.popups.filter((p) => p.t < 1.2);
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
  // Charge clocks run only during active play (same pause rules as the
  // timer, plus while a banner is showing).
  if (!timerPaused() && Date.now() > S.bannerUntil) ageChargeClocks(dt);
  tickTimer(dt);
  if (S.shownScore < S.score) {
    S.shownScore = Math.min(S.score, S.shownScore + Math.max(1, (S.score - S.shownScore) * dt * 10));
    $('score').textContent = Math.round(S.shownScore);
    $('score').classList.add('rolling');
  } else $('score').classList.remove('rolling');
}

// ---------- Timer ----------
// Pauses during the tutorial, pause/menu, settings, game-over/revive/ad
// overlays, and when the app is backgrounded (rAF also stops when hidden, and
// dt is clamped, so no time jump on return).
function timerPaused() {
  if (!S.running || !S.timerStarted) return true;
  if (Tutorial.active) return true;
  if (document.hidden) return true;
  if (S.autoSaving) return true; // ~0.6s save freeze
  for (const id of ['menu', 'settings', 'over', 'revive', 'ad']) if ($(id).classList.contains('show')) return true;
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
    cd.textContent = secs;
    cd.classList.remove('hidden');
    cd.classList.remove('pop'); void cd.offsetWidth; cd.classList.add('pop');
  } else if (S.timeLeft > TIMER.lowSeconds) {
    $('countdown').classList.add('hidden');
    lastTickSecond = -1;
  }
  if (S.timeLeft <= 0) { S.timeLeft = 0; $('countdown').classList.add('hidden'); renderTimerBar(); onTimeout(); return; }
  renderTimerBar();
}
let lastTimerShown = -1;
function renderTimerBar() {
  const secs = Math.max(0, Math.ceil(S.timeLeft));
  const fill = $('timer-fill');
  fill.style.width = Math.max(0, Math.min(100, (S.timeLeft / TIMER.cap) * 100)) + '%';
  // Glossy pill colour shift: green -> yellow -> red as time runs low.
  const frac = S.timeLeft / TIMER.cap;
  fill.classList.toggle('low', S.timeLeft <= TIMER.lowSeconds && S.running);
  fill.classList.toggle('mid', S.timeLeft > TIMER.lowSeconds && frac < 0.5 && S.running);
  $('timerbar').classList.toggle('low', S.timeLeft <= TIMER.lowSeconds && S.running);
  if (secs !== lastTimerShown) { lastTimerShown = secs; $('timer-text').textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`; }
}
function onTimeout() {
  if (!S.running) return;
  if (Music.setUrgency) Music.setUrgency(false);
  // Timeout never auto-uses a charge: it ends the game like no-moves-left.
  S.running = false; S.awaitingRevive = true;
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
  // clearing animation: flash white then shrink
  for (const k of fx.clearing) {
    const p = k.t / 0.45;
    block(bx + k.c * s, by + k.r * s, s, k.t < 0.08 ? '#ffffff' : k.color, 1 - p, 1 - p * 0.8);
  }
  // tray — idle bob (off when reduced motion or while dragging that slot)
  for (let i = 0; i < 3; i++) {
    const p = S.tray[i]; if (!p || (drag && drag.slot === i)) continue;
    const ts = L.trayCell, sh = p.shape;
    const bob = reducedMotion() ? 0 : Math.sin(t * 2 + i * 1.7) * 3;
    const flip = fx.trayFlip > 0 ? Math.abs(Math.cos(fx.trayFlip * Math.PI)) : 1;
    const cx = L.slotW * (i + 0.5), cy = L.trayY + L.trayH / 2 + bob + (1 - easeOut(fx.trayIn)) * 80;
    const canFit = fitsAnywhere(S.board, sh);
    pieceAt(p, cx - (sh.w * ts) / 2, cy - (sh.h * ts) / 2, ts * flip, canFit ? 1 : 0.35);
    if (p.helper && Sprites.ready) {
      const d = ts * 1.1;
      g.drawImage(Sprites.star('#ffd21f'), cx - d / 2, cy - (sh.h * ts) / 2 - d - 2, d, d);
    }
  }
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
  // popups — chunky display type
  for (const p of fx.popups) {
    const k = p.t / 1.2;
    g.globalAlpha = 1 - k * k; g.textAlign = 'center'; g.font = `800 ${p.size * (1 + 0.25 * easeOut(Math.min(1, p.t * 5)))}px 'Baloo 2', 'Fredoka', system-ui, sans-serif`;
    g.lineWidth = 6; g.strokeStyle = 'rgba(122,60,0,0.75)'; g.strokeText(p.text, p.x, p.y - k * 50);
    g.fillStyle = p.color; g.fillText(p.text, p.x, p.y - k * 50); g.globalAlpha = 1;
  }
  g.restore();
}
const easeOut = (x) => 1 - Math.pow(1 - x, 3);

function burst(x, y, color, n = 10) {
  if (reducedMotion()) n = Math.min(n, 4);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = 120 + Math.random() * 380;
    fx.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 260, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12,
      life: 0.6 + Math.random() * 0.6, size: 3 + Math.random() * 6, color: Math.random() < 0.3 ? '#ffd21f' : color, confetti: Math.random() < 0.35 });
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
function popup(text, x, y, color = '#fff', size = 28) { fx.popups.push({ text, x, y, color, size, t: 0 }); }
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 1800); }
// Big-moment banner (DOM, chunky display type). Visual juice only.
let bannerTimer = null;
function showBanner(text, ms = 1100) {
  const b = $('banner');
  $('banner-text').textContent = text;
  b.classList.remove('hidden');
  S.bannerUntil = Date.now() + ms; // charge clocks pause while a banner shows
  const span = $('banner-text');
  span.style.animation = 'none'; void span.offsetWidth; span.style.animation = '';
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
  const res = dealTray({ board: S.board, placed: S.placed, helperAvailable: S.helperAvailable }, S.rng);
  S.tray = res.tray; fx.trayIn = 0;
  if (res.helperUsed) { S.helperAvailable = false; Analytics.log('helper_piece_dealt', { placed: S.placed, level: res.level }); toast('Helper piece this round — look for the gold star!'); }
  if (res.rerolls) Analytics.log('fair_deal_reroll', { rerolls: res.rerolls });
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
  $('player-next-reward').textContent = nr ? `Next reward at Level ${nr.level}: ${nr.reward}` : 'All rewards unlocked — superstar!';
}

function setModeUI() {
  $('best-label').textContent = S.mode === 'daily' ? 'DAILY BEST' : 'BEST';
  $('best').textContent = modeBest();
}
function startGame(mode = 'classic', dateKey = localDateKey()) {
  S.mode = mode; S.dateKey = mode === 'daily' ? dateKey : null;
  S.rng = mode === 'daily' ? dailyRng(dateKey) : Math.random;
  S.board = emptyBoard(); S.score = 0; S.shownScore = 0; S.combo = 0; S.sinceClear = 0; S.maxCombo = 0; S.lines = 0; S.placed = 0;
  S.revived = false; S.running = true; S.startBest = modeBest(); S.startedAt = Date.now();
  // Timer: full bar every game. It starts now unless the first-game tutorial
  // is about to run — then it starts when the tutorial finishes.
  S.timeLeft = TIMER.start; S.lowTonePlayed = false; lastTickSecond = -1;
  $('countdown').classList.add('hidden');
  const willTut = mode === 'classic' && !localStorage.getItem('gb_tut_done');
  S.timerStarted = !willTut;
  if (Music.setUrgency) Music.setUrgency(false);
  // Power-ups never carry between games.
  S.charges = emptyCharges(); S.chargeClocks = emptyChargeClocks(); S.earnIdx = 0; S.armed = null; S.sweepMode = 'row';
  S.level = 1;
  renderPowerups(); renderTimerBar(); renderLevel();
  // Comeback helper is classic-only; the daily deal is identical for everyone.
  S.helperAvailable = mode === 'classic' && helperEligible(store.history, store.best);
  $('score').textContent = '0'; $('combo').textContent = ''; setModeUI();
  deal();
  S.gamesThisSession++;
  Analytics.log('game_start', { game: S.gamesThisSession, mode, best: modeBest(), helper_eligible: S.helperAvailable });
  saveGame();
  if (willTut) Tutorial.start();
}

// ---------- Save / restore a game in progress ----------
function saveGame() {
  if (!S.running && !S.awaitingRevive) return;
  const data = {
    v: SAVE_V, mode: S.mode, dateKey: S.dateKey, rngState: S.rng.getState ? S.rng.getState() : null,
    board: S.board, tray: S.tray.map((p) => p && { id: p.shape.id, color: p.color, helper: !!p.helper }),
    score: S.score, combo: S.combo, sinceClear: S.sinceClear, maxCombo: S.maxCombo, lines: S.lines, placed: S.placed,
    revived: S.revived, helperAvailable: S.helperAvailable, startBest: S.startBest, elapsed: Date.now() - S.startedAt, savedAt: Date.now(),
    timeLeft: S.timeLeft, charges: { ...S.charges }, earnIdx: S.earnIdx, chargeClocks: S.chargeClocks,
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
function restoreGame(d) {
  S.mode = d.mode === 'daily' ? 'daily' : 'classic'; S.dateKey = d.dateKey || null;
  S.rng = S.mode === 'daily' ? dailyRng(S.dateKey) : Math.random;
  if (S.rng.setState && d.rngState != null) S.rng.setState(d.rngState);
  S.board = d.board.map((row) => row.map((v) => v || null));
  S.tray = d.tray.map((p) => { if (!p || !SHAPES[p.id]) return null; const pc = makePiece(SHAPES[p.id]); pc.color = p.color; pc.helper = !!p.helper; return pc; });
  Object.assign(S, { score: d.score, shownScore: d.score, combo: d.combo, sinceClear: d.sinceClear, maxCombo: d.maxCombo, lines: d.lines, placed: d.placed,
    revived: !!d.revived, helperAvailable: !!d.helperAvailable, startBest: d.startBest, startedAt: Date.now() - (d.elapsed || 0), running: true });
  S.timeLeft = typeof d.timeLeft === 'number' ? d.timeLeft : TIMER.start;
  S.charges = { ...emptyCharges(), ...(d.charges || {}) };
  if (S.charges.petal) { S.charges.star = (S.charges.star || 0) + S.charges.petal; delete S.charges.petal; } // pre-Update-5 saves used "petal"
  // Restore each charge's remaining clock (missing/short entries get a fresh
  // 30 s clock; extra entries are dropped).
  S.chargeClocks = emptyChargeClocks();
  for (const type of Object.keys(S.chargeClocks)) {
    const saved = (d.chargeClocks && d.chargeClocks[type]) || [];
    const n = S.charges[type] || 0;
    S.chargeClocks[type] = saved.filter((v) => typeof v === 'number' && v > 0).slice(0, n);
    while (S.chargeClocks[type].length < n) S.chargeClocks[type].push(POWERUPS.chargeLifetimeSeconds);
  }
  S.earnIdx = d.earnIdx || 0; S.armed = null; S.lowTonePlayed = S.timeLeft <= TIMER.lowSeconds;
  S.level = levelFor(S.placed) + 1; renderLevel();
  // A restored game is already past the tutorial (it closed mid-game), so the
  // timer runs from the moment play resumes.
  S.timerStarted = true;
  renderPowerups(); renderTimerBar();
  if (!S.tray.some(Boolean)) deal();
  $('score').textContent = S.score; $('combo').textContent = S.combo >= 2 ? `Combo x${S.combo}` : ''; setModeUI();
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
      burst(L.bx + (cc + 0.5) * L.cell, L.by + (rr + 0.5) * L.cell, col, 7);
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
    const cx = L.bx + (c + sh.w / 2) * L.cell, cy = L.by + (r + sh.h / 2) * L.cell;
    popup(`+${pts}`, cx, cy, '#ffffff', 30 + lines * 4);
    popup(`+${bonus}s`, L.w / 2, L.by - 4, '#7cf0c9', 22);
    if (lines >= 2) popup(['', '', 'Double!', 'Triple!', 'Mega!', 'Bloom!'][Math.min(5, lines)], L.w / 2, L.by + L.size * 0.35, '#7cf0c9', 40);
    // Combo banner: escalating words with rising pitch (visual juice only).
    if (S.combo >= 2) {
      const words = ['', '', 'Nice!', 'Great!', 'AMAZING!', 'INCREDIBLE!'];
      showBanner(words[Math.min(5, S.combo)], 900);
      popup(`Combo x${S.combo}`, L.w / 2, L.by + L.size * 0.5, '#ff7ab6', 34);
      Sfx.combo(S.combo); Analytics.log('combo', { combo: S.combo });
    }
    // 4-line clear: jackpot-style burst (visual celebration, no reward).
    if (lines >= 4) { jackpotBurst(); showBanner('INCREDIBLE!', 1300); }
    Sfx.clear(lines, S.combo); Haptics.medium();
    fx.shake = 4 + lines * 3;
    Analytics.log('lines_cleared', { lines, combo: S.combo, pts });
    if (S.board.every((row) => row.every((v) => !v))) { gained += BOARD_CLEAR_BONUS; popup('Board clear +300', L.w / 2, L.by + L.size * 0.65, '#ffd166', 32); Sfx.boardClear(); Analytics.log('board_clear', {}); }
  } else {
    Sfx.place(); Haptics.light();
    S.sinceClear++;
    if (S.sinceClear >= COMBO_GRACE) S.combo = 0;
  }
  S.score += gained;
  $('combo').textContent = S.combo >= 2 ? `Combo x${S.combo}` : '';
  const sc = $('score'); sc.classList.add('bump'); setTimeout(() => sc.classList.remove('bump'), 120);
  if (S.score > modeBest()) $('best').textContent = S.score;
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
  // Ring + seconds/milestone text live in renderChargeClocks (drains while a
  // charge is held, milestone progress while the slot is empty).
  document.querySelectorAll('#powerups .pu').forEach((b) => {
    const type = b.dataset.pu, n = S.charges[type] || 0;
    b.querySelector('.pu-count').textContent = n;
    b.classList.toggle('empty', n === 0);
    b.classList.toggle('earned', n > 0);
    b.classList.toggle('armed', S.armed === type);
    b.disabled = n === 0 && S.armed !== type;
  });
  renderChargeClocks();
  $('pu-target').classList.toggle('hidden', !S.armed);
  $('pu-mode').classList.toggle('hidden', S.armed !== 'sweep');
  $('pu-mode-row-btn').classList.toggle('on', S.sweepMode === 'row');
  $('pu-mode-col-btn').classList.toggle('on', S.sweepMode === 'col');
  $('pu-hint').textContent = S.armed === 'bomb' ? 'Tap a board cell — clears the 3x3 around it.'
    : S.armed === 'sweep' ? `Tap a board cell — clears its ${S.sweepMode === 'row' ? 'row' : 'column'}.`
    : '';
}
function armPowerup(type) {
  if (!S.running || S.autoSaving) return;
  if (S.armed === type) return cancelArmed();
  if (!S.charges[type]) return;
  if (type === 'reshuffle') return applyReshuffle();
  if (type === 'star') return applyStar();
  S.armed = type;
  renderPowerups();
  toast(type === 'bomb' ? 'Tap a board cell for the 3x3 blast.' : 'Tap a board cell to sweep its row or column.');
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
    burst(L.bx + (c + 0.5) * L.cell, L.by + (r + 0.5) * L.cell, col, 5);
    S.board[r][c] = null; n++;
  }
  if (n) {
    const pts = powerUpPoints(n);
    S.score += pts;
    $('score').textContent = S.score; S.shownScore = S.score;
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

// ---------- Auto-save (use-it-or-lose-it power-ups) ----------
// When no tray piece fits and a charge is held, the game auto-uses one to
// save you BEFORE the revive offer — Reshuffle first, then the Bomb on the
// 3x3 that makes the most room for a tray piece, then the Sweep on the
// fullest row or column. First choice that lets a piece fit wins. The choice
// is deterministic (fixed priority + fixed tie-breaks) and the same for
// everyone — never ads, spend or segment. Timeout never auto-uses a charge.
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
  if (!S.running || S.autoSaving) return;
  const alive = S.tray.filter(Boolean);
  if (alive.some((p) => fitsAnywhere(S.board, p.shape))) return;
  // Last-chance save BEFORE the revive offer.
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
  S.running = false; S.awaitingRevive = true;
  setTimeout(onNoMoves, 450);
}

let reviveTimer = null;
function onNoMoves(reason = 'no_moves') {
  Sfx.over();
  if (Music.setUrgency) Music.setUrgency(false);
  $('rv-title').textContent = reason === 'timeout' ? "Time's up!" : 'No space left!';
  $('rv-why').textContent = reason === 'timeout'
    ? 'The timer ran out. Watch a short ad to clear your 3 fullest rows, get a fresh tray, and refill the timer to 60 seconds.'
    : 'Watch a short ad to clear your 3 fullest rows, get a fresh tray, and refill the timer to 60 seconds.';
  if (!S.revived && S.score > 0 && Ads.isRewardedReady()) {
    // Opt-in only. Offered at the same moment for every player; nothing about the
    // board or pieces was changed to get here.
    Analytics.log('revive_offered', { score: S.score, placed: S.placed });
    $('rv-score').textContent = S.score;
    let left = 6; $('rv-count').textContent = left;
    $('revive').classList.add('show');
    reviveTimer = setInterval(() => { left--; $('rv-count').textContent = left; if (left <= 0) declineRevive('timeout'); }, 1000);
  } else finishGame();
}
function declineRevive(reason = 'declined') {
  clearInterval(reviveTimer); $('revive').classList.remove('show');
  Analytics.log('revive_declined', { reason });
  finishGame();
}
async function takeRevive() {
  clearInterval(reviveTimer); $('revive').classList.remove('show');
  const r = await Ads.showRewarded('revive');
  if (!r.rewarded) { Analytics.log('revive_declined', { reason: 'ad_closed_early' }); return finishGame(); }
  Analytics.log('revive_taken', { score: S.score });
  S.revived = true;
  // Revive effect (fixed, documented): clear the 3 fullest rows, deal a fresh
  // tray, and refill the timer to 60 seconds. No points awarded.
  const order = [...Array(N).keys()].sort((a, b) => S.board[b].filter(Boolean).length - S.board[a].filter(Boolean).length).slice(0, 3);
  for (const rr of order) for (let cc = 0; cc < N; cc++) if (S.board[rr][cc]) {
    fx.clearing.push({ r: rr, c: cc, color: S.board[rr][cc], t: 0 });
    burst(L.bx + (cc + 0.5) * L.cell, L.by + (rr + 0.5) * L.cell, S.board[rr][cc], 4);
    S.board[rr][cc] = null;
  }
  S.awaitingRevive = false;
  S.timeLeft = TIMER.reviveRefill; S.timerStarted = true; S.lowTonePlayed = false;
  renderTimerBar();
  Sfx.revive(); S.running = true; deal(); saveGame(); checkGameOver();
}
function finishGame() {
  S.awaitingRevive = false; clearSave();
  cancelArmed();
  if (Music.setUrgency) Music.setUrgency(false);
  const daily = S.mode === 'daily';
  const prevBest = modeBest(), isBest = S.score > prevBest;
  if (isBest) { if (daily) store.setDailyBest(S.dateKey, S.score); else store.best = S.score; Sfx.best(); Analytics.log('new_high_score', { score: S.score, prev: prevBest, mode: S.mode }); }
  if (!daily) store.pushHistory(S.score); // daily games never feed the comeback-helper history
  // Lifetime player XP: 10/line + 5/max combo + 25/game. Cosmetics only.
  const xpBefore = store.xp, lvlBefore = playerLevelFor(xpBefore);
  const gained = xpForGame(S.lines, S.maxCombo);
  store.xp = xpBefore + gained;
  store.games = store.games + 1;
  const lvlAfter = playerLevelFor(store.xp);
  const newRewards = rewardsForLevel(lvlAfter).filter((r) => !rewardsForLevel(lvlBefore).includes(r));
  Analytics.log('game_over', { mode: S.mode, score: S.score, lines: S.lines, max_combo: S.maxCombo, placed: S.placed, revived: S.revived, secs: Math.round((Date.now() - S.startedAt) / 1000), xp_gained: gained, player_level: lvlAfter });
  $('ov-score').textContent = S.score; $('ov-best').textContent = modeBest(); $('ov-lines').textContent = S.lines; $('ov-combo').textContent = S.maxCombo;
  $('ov-new').classList.toggle('hidden', !isBest);
  $('ov-xp').textContent = `+${gained} XP  ·  Player Level ${lvlAfter}${newRewards.length ? ` — unlocked: ${newRewards.join(', ')}!` : ''}`;
  $('best').textContent = modeBest();
  $('over').querySelector('h2').textContent = daily ? `Daily ${S.dateKey} over` : 'Game over';
  // Star rating, revealed one star at a time (CSS delays set below).
  const stars = (isBest || S.score >= 1000) ? 3 : S.score >= 400 ? 2 : 1;
  document.querySelectorAll('#ov-stars span').forEach((s, i) => {
    s.classList.remove('lit');
    if (i < stars) setTimeout(() => s.classList.add('lit'), 250 + i * 350);
  });
  if (isBest) { jackpotBurst(); showBanner('NEW BEST!', 1500); }
  if (lvlAfter > lvlBefore) showBanner(`PLAYER LEVEL ${lvlAfter}!`, 1600);
  $('over').classList.add('show');
  renderPlayerCard();
}

// ---------- Input ----------
function slotAt(x, y) {
  if (y < L.trayY - 10 || y > L.trayY + L.trayH + 20) return -1;
  const i = Math.floor(x / L.slotW); return S.tray[i] ? i : -1;
}
cv.addEventListener('pointerdown', (e) => {
  Sfx.unlock();
  if (!S.running || drag || S.autoSaving) return;
  const rect = cv.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
  // A power-up is armed: this tap targets the board instead of dragging.
  if (S.armed) {
    const c = Math.floor((x - L.bx) / L.cell), r = Math.floor((y - L.by) / L.cell);
    if (r < 0 || r >= N || c < 0 || c >= N) { toast('Tap a board cell, or ✕ to cancel.'); return; }
    if (S.armed === 'bomb') applyBomb(r, c);
    else if (S.armed === 'sweep') applySweep(r, c);
    return;
  }
  const i = slotAt(x, y); if (i < 0) return;
  const lift = e.pointerType === 'mouse' ? 0 : L.cell * 1.8; // keep the piece visible above the finger
  drag = { slot: i, piece: S.tray[i], x, y: y - lift, lift, id: e.pointerId, scale: 0.6 };
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
  if (d && d.ok) place(slot, d.r, d.c); else Sfx.invalid();
}
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);

// ---------- UI wiring ----------
function show(id, on) { $(id).classList.toggle('show', on); }
$('rules').innerHTML = '<ol>' + RULES_TEXT.map((r) => `<li>${r}</li>`).join('') + '</ol>';
document.title = APP_NAME;
$('title').querySelector('.logo').innerHTML = APP_NAME.replace(/bloom$/i, '<span>$&</span>');
// Friendly daily date for the player ("Nov 11", never the 2026-11-11 key).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function friendlyDate(key) { const [, m, d] = key.split('-'); return `${MONTHS[+m - 1]} ${+d}`; }
function refreshTitle() {
  $('title-best').textContent = store.best; $('title-daily-best').textContent = store.dailyBest(localDateKey());
  $('daily-date').textContent = friendlyDate(localDateKey());
  const sv = readSave();
  $('btn-play').textContent = sv ? (sv.mode === 'daily' ? '▶ Continue daily' : '▶ Continue') : 'Play';
  $('btn-new').classList.toggle('hidden', !sv);
  renderPlayerCard();
}
// 3D icons: every [data-icon] <img> gets its pre-rendered sprite URL.
function initIcons() {
  document.querySelectorAll('img[data-icon]').forEach((img) => { img.src = Sprites.iconURL(img.dataset.icon); });
}
refreshTitle(); $('best').textContent = store.best;
let sessionLogged = false;
function leaveTitle() { Sfx.unlock(); show('title', false); if (!sessionLogged) { sessionLogged = true; Analytics.log('session_start', { ua_mobile: /Mobi/.test(navigator.userAgent) }); } }
$('btn-play').onclick = () => { leaveTitle(); const sv = readSave(); if (sv) restoreGame(sv); else startGame('classic'); };
$('btn-new').onclick = () => { const sv = readSave(); if (sv) Analytics.log('game_abandon', { score: sv.score, mode: sv.mode }); clearSave(); leaveTitle(); startGame('classic'); };
$('btn-daily').onclick = () => { const sv = readSave(); if (sv) Analytics.log('game_abandon', { score: sv.score, mode: sv.mode }); clearSave(); leaveTitle(); startGame('daily', localDateKey()); };
$('btn-how').onclick = () => show('menu', true);
// Settings
const syncSettings = () => { $('set-music').checked = Music.on; $('set-sfx').checked = !Sfx.muted; $('set-haptics').checked = Haptics.enabled; $('set-motion').checked = reducedMotion(); };
$('btn-settings').onclick = () => { syncSettings(); show('settings', true); };
$('btn-title-settings').onclick = () => { syncSettings(); show('settings', true); };
$('set-music').onchange = (e) => Music.set(e.target.checked);
$('set-sfx').onchange = (e) => Sfx.setOn(e.target.checked);
$('set-haptics').onchange = (e) => { Haptics.set(e.target.checked); if (e.target.checked) Haptics.light(); };
$('set-motion').onchange = (e) => { localStorage.setItem('gb_motion', e.target.checked ? '1' : '0'); applyMotionClass(); };
function applyMotionClass() { document.body.classList.toggle('reduced-motion', reducedMotion()); }
$('btn-set-close').onclick = () => show('settings', false);
$('btn-pu-first').onclick = () => show('pu-first', false);
$('btn-set-rules').onclick = () => { show('settings', false); show('menu', true); };
$('btn-tut-again').onclick = () => { show('settings', false); localStorage.removeItem('gb_tut_done'); if (S.running) Tutorial.start(); };
$('btn-menu').onclick = () => { show('menu', true); Analytics.log('menu_open', {}); };
$('btn-resume').onclick = () => show('menu', false);
$('btn-restart').onclick = () => { show('menu', false); if (S.running) { S.running = false; Analytics.log('game_abandon', { score: S.score }); } clearSave(); startGame(S.mode === 'daily' ? 'daily' : 'classic', S.dateKey || localDateKey()); };
$('btn-log').onclick = () => { const el = $('log'); el.classList.toggle('hidden'); el.textContent = Analytics.all().slice(-60).map((e) => JSON.stringify(e)).join('\n'); };
// Hidden debug path only: the analytics log stays out of the player UI
// unless the page is opened with ?debug=1.
if (new URLSearchParams(location.search).has('debug')) $('btn-log').classList.remove('hidden');
$('btn-revive').onclick = takeRevive;
$('btn-norevive').onclick = () => declineRevive('declined');
// Power-up buttons (under the board) + targeting controls.
document.querySelectorAll('#powerups .pu').forEach((b) => { b.onclick = () => armPowerup(b.dataset.pu); });
$('pu-cancel').onclick = cancelArmed;
$('pu-mode-row-btn').onclick = () => { S.sweepMode = 'row'; renderPowerups(); };
$('pu-mode-col-btn').onclick = () => { S.sweepMode = 'col'; renderPowerups(); };
renderPowerups(); renderTimerBar();
$('btn-again').onclick = async () => { show('over', false); await Ads.maybeInterstitialAtBreak(S.gamesThisSession); startGame(S.mode === 'daily' ? 'daily' : 'classic', localDateKey()); };
$('btn-home').onclick = () => { show('over', false); refreshTitle(); show('title', true); };

// ---------- First-game tutorial: 3 steps, shown once, skippable ----------
const TUT_STEPS = [
  'Step 1 of 3 — <b>Drag a piece</b> from the tray onto the board. Try it now!',
  'Step 2 of 3 — <b>Fill a whole row or column</b> to clear it. Cleared blocks burst into gold stars and score points.',
  'Step 3 of 3 — <b>Clear again within 3 moves</b> for a combo multiplier. <b>Fair deal:</b> every new tray has at least one piece that fits, and the rules never change based on ads.',
];
const Tutorial = {
  step: -1,
  get active() { return this.step >= 0; },
  start() { this.step = 0; Analytics.log('tutorial_start', {}); $('tut').classList.add('show'); this.render(); },
  render() {
    $('tut-text').innerHTML = TUT_STEPS[this.step];
    $('tut').querySelectorAll('.tut-dots i').forEach((d, i) => d.classList.toggle('on', i <= this.step));
    $('tut-next').textContent = this.step === TUT_STEPS.length - 1 ? 'Got it' : 'Next';
    const hand = $('tut-hand'), demo = $('tut-demo');
    hand.classList.toggle('on', this.step === 0);
    demo.classList.toggle('on', this.step >= 1); demo.classList.toggle('clear', this.step >= 1);
    demo.innerHTML = this.step >= 1 ? '<span></span>'.repeat(7) + '<span class="gap"></span>' : '';
    if (this.step === 0) {
      const r = cv.getBoundingClientRect();
      const slot = Math.max(0, S.tray.findIndex(Boolean));
      const fx0 = r.left + L.slotW * (slot + 0.5) - 14, fy0 = r.top + L.trayY + L.trayH / 2 - 6;
      const tx = r.left + L.bx + L.size / 2 - 14, ty = r.top + L.by + L.size / 2;
      hand.style.setProperty('--fx', fx0 + 'px'); hand.style.setProperty('--fy', fy0 + 'px');
      hand.style.setProperty('--tx', tx + 'px'); hand.style.setProperty('--ty', ty + 'px');
    }
  },
  next() { if (this.step >= TUT_STEPS.length - 1) return this.finish('done'); this.step++; this.render(); },
  onPlaced() { if (this.step === 0) this.next(); },
  finish(how) { if (!this.active) return; this.step = -1; localStorage.setItem('gb_tut_done', '1'); $('tut').classList.remove('show'); Analytics.log('tutorial_' + how, {}); if (S.running) S.timerStarted = true; },
};
$('tut-next').onclick = () => Tutorial.next();
$('tut-skip').onclick = () => Tutorial.finish('skipped');

// ---------- Lifecycle: save on hide, pause music ----------
document.addEventListener('visibilitychange', () => { if (document.hidden) { saveGame(); Music.pause(); } else Music.resume(); });
window.addEventListener('pagehide', saveGame);

// ---------- Back button (Android, via native.js): close overlays, else pause ----------
window.__gbBack = () => {
  for (const id of ['settings', 'menu']) if ($(id).classList.contains('show')) { show(id, false); return true; }
  if (S.armed) { cancelArmed(); return true; }
  if (Tutorial.active) { Tutorial.finish('skipped'); return true; }
  if ($('ad').classList.contains('show')) return true; // never dismiss an ad via back here; the ad has its own close
  if ($('revive').classList.contains('show')) { declineRevive('back'); return true; }
  if ($('over').classList.contains('show')) { show('over', false); refreshTitle(); show('title', true); return true; }
  if (S.running) { saveGame(); show('menu', true); return true; } // pause: menu doubles as the pause screen
  return false; // on the title screen: let the app exit
};

S.board = emptyBoard();
Sprites.init();
initIcons();
applyMotionClass();
layout();
Ads.init();
requestAnimationFrame(frame);
const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
if (isNative) import('./native.js').then((m) => m.initNative()).catch((e) => console.warn('native init', e));
else if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

// ---------- Test hooks (read-only layout + state; mutation only with ?test=1) ----------
window.__gb = {
  layout: () => ({ ...L }),
  state: () => ({ board: S.board.map((r) => r.map(Boolean)), tray: S.tray.map((p) => p && { id: p.shape.id, cells: p.shape.cells, w: p.shape.w, h: p.shape.h, helper: p.helper }), score: S.score, combo: S.combo, lines: S.lines, running: S.running, placed: S.placed, revived: S.revived, mode: S.mode, dateKey: S.dateKey, helperAvailable: S.helperAvailable, tutorialStep: Tutorial.step, timeLeft: Math.round(S.timeLeft * 10) / 10, timerStarted: S.timerStarted, charges: { ...S.charges }, chargeSecs: Object.fromEntries(Object.entries(S.chargeClocks).map(([t, arr]) => [t, arr.length ? Math.round(arr[0] * 10) / 10 : null])), autoSaving: S.autoSaving, armed: S.armed, sweepMode: S.sweepMode, musicOn: Music.on, musicBpm: Music.bpm, musicLoopSeconds: Music.loopSeconds, musicLoopEvents: Music.loopEvents, musicUrgency: Music.urgency, spritesReady: Sprites.ready, timerPaused: timerPaused(), level: S.level, xp: store.xp, playerLevel: playerLevelFor(store.xp), reducedMotion: reducedMotion(), countdownVisible: !$('countdown').classList.contains('hidden'), countdownText: $('countdown').textContent }),
};
if (new URLSearchParams(location.search).has('test')) {
  window.__gb.setBoard = (rows) => { S.board = rows.map((row) => [...row].map((ch) => (ch === '#' ? '#5aa2ff' : null))); };
  window.__gb.startDaily = (k) => { show('title', false); clearSave(); startGame('daily', k); };
  window.__gb.startGame = (mode, k) => { show('title', false); clearSave(); startGame(mode || 'classic', k || localDateKey()); };
  window.__gb.saveNow = saveGame;
  window.__gb.setTray = (ids) => { import('./pieces.js').then(({ SHAPES, makePiece }) => { S.tray = ids.map((i) => (i == null ? null : makePiece(SHAPES[i]))); }); };
  window.__gb.setTimeLeft = (s) => { S.timeLeft = s; S.lowTonePlayed = s <= TIMER.lowSeconds; renderTimerBar(); };
  window.__gb.setCharges = (c) => {
    S.charges = { ...emptyCharges(), ...c };
    // Test hook: fresh 30 s clocks for every charge set.
    S.chargeClocks = emptyChargeClocks();
    for (const type of Object.keys(S.charges)) for (let i = 0; i < (S.charges[type] || 0); i++) S.chargeClocks[type].push(POWERUPS.chargeLifetimeSeconds);
    renderPowerups();
  };
  // Test hook: advance every held charge's clock by sec seconds of play
  // time (processes expiries). Deterministic; does not touch the game timer.
  window.__gb.fastForwardCharges = (sec) => ageChargeClocks(sec);
  // Test hook: run the no-moves check (and any auto-save it triggers).
  window.__gb.checkGameOver = () => checkGameOver();
  window.__gb.place = (slot, r, c) => place(slot, r, c);
  window.__gb.armPowerup = (type) => armPowerup(type);
  window.__gb.targetCell = (r, c) => { if (S.armed === 'bomb') applyBomb(r, c); else if (S.armed === 'sweep') applySweep(r, c); };
  window.__gb.grantCharge = () => grantCharge();
}
