import { N, dealTray, fits, fitsAnywhere, helperEligible, levelFor, RULES_TEXT, TIMER, POWERUPS, timeForClear, powerUpPoints } from './difficulty.js';
import { Ads } from './ads.js';
import { Analytics } from './analytics.js';
import { Sfx, Music } from './audio.js';
import { Haptics } from './haptics.js';
import { COMBO_GRACE, BOARD_CLEAR_BONUS, clearPoints } from './scoring.js';
import { dailyRng, localDateKey } from './rng.js';
import { SHAPES, makePiece } from './pieces.js';
import { APP_NAME } from './brand.js';

const $ = (id) => document.getElementById(id);
const cv = $('cv'), g = cv.getContext('2d');

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
};
const SAVE_KEY = 'gb_save', SAVE_V = 2;

// ---------- State ----------
const S = {
  board: [], tray: [null, null, null], score: 0, shownScore: 0, combo: 0, sinceClear: 0, maxCombo: 0,
  lines: 0, placed: 0, revived: false, helperAvailable: false, running: false, gamesThisSession: 0,
  startBest: 0, startedAt: 0, mode: 'classic', dateKey: null, rng: Math.random,
  timeLeft: TIMER.start, timerStarted: false, lowTonePlayed: false,
  charges: { bomb: 0, sweep: 0, reshuffle: 0, petal: 0 }, earnIdx: 0,
  armed: null, sweepMode: 'row',
};
const emptyCharges = () => ({ bomb: 0, sweep: 0, reshuffle: 0, petal: 0 });
const totalCharges = () => Object.values(S.charges).reduce((a, b) => a + b, 0);
const modeBest = () => (S.mode === 'daily' ? store.dailyBest(S.dateKey) : store.best);
const fx = { particles: [], clearing: [], popups: [], shake: 0, placedFlash: [], trayIn: 0, glow: 0, shimmer: 0 };
let L = {}; // layout
let drag = null;

function emptyBoard() { return Array.from({ length: N }, () => Array(N).fill(null)); }

// ---------- Layout ----------
function layout() {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = cv.clientWidth, h = cv.clientHeight;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const boardSize = Math.floor(Math.min(w * 0.92, h * 0.62, 520));
  const cell = boardSize / N;
  const bx = (w - boardSize) / 2;
  const trayH = Math.min(cell * 3.4, h - boardSize - 30);
  const by = Math.max(10, (h - boardSize - trayH) / 2 - 6);
  L = { w, h, cell, bx, by, size: boardSize, trayY: by + boardSize + 16, trayH, slotW: w / 3, trayCell: cell * 0.55 };
  // Position the glowing board frame (DOM, behind the canvas) around the board.
  const glow = $('board-glow');
  glow.style.left = (bx - 14) + 'px'; glow.style.top = (by - 14) + 'px';
  glow.style.width = (boardSize + 28) + 'px'; glow.style.height = (boardSize + 28) + 'px';
}
window.addEventListener('resize', layout);

// ---------- Drawing helpers ----------
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + amt * 255)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
function rrect(x, y, w, h, r) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); }
function block(x, y, s, color, alpha = 1, scale = 1) {
  // Clean, solid, rounded blocks — no markings, lines, bevels, icons or
  // textures. A very soft glow underneath is the only decoration.
  const pad = s * 0.06, ss = (s - pad * 2) * scale, o = (s - ss) / 2;
  x += o; y += o;
  g.globalAlpha = alpha * 0.22;
  g.fillStyle = color; rrect(x - 2, y - 2, ss + 4, ss + 4, ss * 0.24); g.fill();
  g.globalAlpha = alpha;
  g.fillStyle = color; rrect(x, y, ss, ss, ss * 0.22); g.fill();
  g.globalAlpha = 1;
}

function pieceAt(piece, x, y, s, alpha = 1) { for (const [r, c] of piece.shape.cells) block(x + c * s, y + r * s, s, piece.color, alpha); }

// ---------- Placement / preview ----------
function dropCell() {
  if (!drag) return null;
  const s = L.cell, p = drag.piece.shape;
  const px = drag.x - (p.w * s) / 2, py = drag.y - (p.h * s) / 2;
  const c = Math.round((px - L.bx) / s), r = Math.round((py - L.by) / s);
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
  fx.shake = Math.max(0, fx.shake - dt * 30);
  fx.glow = Math.max(0, fx.glow - dt * 1.4);
  fx.shimmer = Math.max(0, fx.shimmer - dt * 1.1);
  fx.trayIn = Math.min(1, fx.trayIn + dt * 4);
  tickTimer(dt);
  if (S.shownScore < S.score) { S.shownScore = Math.min(S.score, S.shownScore + Math.max(1, (S.score - S.shownScore) * dt * 10)); $('score').textContent = Math.round(S.shownScore); }
}

// ---------- Timer ----------
// Pauses during the tutorial, pause/menu, settings, game-over/revive/ad
// overlays, and when the app is backgrounded (rAF also stops when hidden, and
// dt is clamped, so no time jump on return).
function timerPaused() {
  if (!S.running || !S.timerStarted) return true;
  if (Tutorial.active) return true;
  if (document.hidden) return true;
  for (const id of ['menu', 'settings', 'over', 'revive', 'ad']) if ($(id).classList.contains('show')) return true;
  return false;
}
function tickTimer(dt) {
  if (timerPaused()) return;
  S.timeLeft -= dt;
  if (S.timeLeft <= TIMER.lowSeconds && !S.lowTonePlayed) {
    S.lowTonePlayed = true;
    Music.lowTime();
    if (Music.setUrgency) Music.setUrgency(true);
  }
  if (S.timeLeft <= 0) { S.timeLeft = 0; renderTimerBar(); onTimeout(); return; }
  renderTimerBar();
}
let lastTimerShown = -1;
function renderTimerBar() {
  const secs = Math.max(0, Math.ceil(S.timeLeft));
  const fill = $('timer-fill');
  fill.style.width = Math.max(0, Math.min(100, (S.timeLeft / TIMER.cap) * 100)) + '%';
  fill.classList.toggle('low', S.timeLeft <= TIMER.lowSeconds && S.running);
  $('timerbar').classList.toggle('low', S.timeLeft <= TIMER.lowSeconds && S.running);
  if (secs !== lastTimerShown) { lastTimerShown = secs; $('timer-text').textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`; }
}
function onTimeout() {
  if (!S.running) return;
  if (Music.setUrgency) Music.setUrgency(false);
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
  g.save();
  if (fx.shake > 0) g.translate((Math.random() - 0.5) * fx.shake, (Math.random() - 0.5) * fx.shake);
  // board frame
  g.fillStyle = 'rgba(0,0,0,0.25)'; rrect(bx - 8, by - 8 + 6, size + 16, size + 16, 18); g.fill();
  g.fillStyle = '#231d58'; rrect(bx - 8, by - 8, size + 16, size + 16, 18); g.fill();
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    g.fillStyle = (r + c) % 2 ? '#2c2570' : '#2a236a';
    rrect(bx + c * s + s * 0.05, by + r * s + s * 0.05, s * 0.9, s * 0.9, s * 0.18); g.fill();
  }
  // preview
  let prev = null;
  if (drag) { const d = dropCell(); if (d && d.ok) prev = { ...d, ...wouldClear(drag.piece.shape, d.r, d.c) }; }
  if (prev) {
    g.fillStyle = 'rgba(255,255,255,0.08)';
    for (const r of prev.rows) { rrect(bx, by + r * s, size, s, s * 0.2); g.fill(); }
    for (const c of prev.cols) { rrect(bx + c * s, by, s, size, s * 0.2); g.fill(); }
  }
  // placed blocks
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const col = S.board[r][c]; if (!col) continue;
    const hl = prev && (prev.rows.includes(r) || prev.cols.includes(c));
    block(bx + c * s, by + r * s, s, hl ? drag.piece.color : col);
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
  // tray
  for (let i = 0; i < 3; i++) {
    const p = S.tray[i]; if (!p || (drag && drag.slot === i)) continue;
    const ts = L.trayCell, sh = p.shape;
    const cx = L.slotW * (i + 0.5), cy = L.trayY + L.trayH / 2 + (1 - easeOut(fx.trayIn)) * 80;
    const canFit = fitsAnywhere(S.board, sh);
    pieceAt(p, cx - (sh.w * ts) / 2, cy - (sh.h * ts) / 2, ts, canFit ? 1 : 0.35);
    if (p.helper) { g.fillStyle = '#ffd166'; g.font = `bold ${Math.round(ts * 0.9)}px system-ui`; g.textAlign = 'center'; g.fillText('✦', cx, cy - (sh.h * ts) / 2 - 6); }
  }
  // dragged piece (full size, lifted)
  if (drag) {
    const sh = drag.piece.shape, sc = drag.scale;
    const ds = s * sc;
    g.shadowColor = 'rgba(0,0,0,0.4)'; g.shadowBlur = 18; g.shadowOffsetY = 10;
    pieceAt(drag.piece, drag.x - (sh.w * ds) / 2, drag.y - (sh.h * ds) / 2, ds, 0.95);
    g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0;
    drag.scale += (1 - drag.scale) * 0.35;
  }
  // particles (petals + sparks)
  for (const p of fx.particles) {
    g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.globalAlpha = Math.min(1, p.life * 2);
    g.fillStyle = p.color;
    if (p.petal) { g.beginPath(); g.ellipse(0, 0, p.size, p.size * 0.5, 0, 0, Math.PI * 2); g.fill(); }
    else { g.fillRect(-p.size / 2, -p.size / 2, p.size, p.size); }
    g.restore();
  }
  // popups
  for (const p of fx.popups) {
    const k = p.t / 1.2;
    g.globalAlpha = 1 - k * k; g.textAlign = 'center'; g.font = `900 ${p.size * (1 + 0.25 * easeOut(Math.min(1, p.t * 5)))}px system-ui`;
    g.lineWidth = 6; g.strokeStyle = 'rgba(20,10,50,0.8)'; g.strokeText(p.text, p.x, p.y - k * 50);
    g.fillStyle = p.color; g.fillText(p.text, p.x, p.y - k * 50); g.globalAlpha = 1;
  }
  g.restore();
}
const easeOut = (x) => 1 - Math.pow(1 - x, 3);

function burst(x, y, color, n = 10) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = 120 + Math.random() * 380;
    fx.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 260, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12,
      life: 0.6 + Math.random() * 0.6, size: 3 + Math.random() * 6, color: Math.random() < 0.3 ? '#ffffff' : color, petal: Math.random() < 0.6 });
  }
}
function popup(text, x, y, color = '#fff', size = 28) { fx.popups.push({ text, x, y, color, size, t: 0 }); }
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 1800); }

// ---------- Game flow ----------
function deal() {
  const res = dealTray({ board: S.board, placed: S.placed, helperAvailable: S.helperAvailable }, S.rng);
  S.tray = res.tray; fx.trayIn = 0;
  if (res.helperUsed) { S.helperAvailable = false; Analytics.log('helper_piece_dealt', { placed: S.placed, level: res.level }); toast('✦ Helper piece this round'); }
  if (res.rerolls) Analytics.log('fair_deal_reroll', { rerolls: res.rerolls });
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
  S.timeLeft = TIMER.start; S.lowTonePlayed = false;
  const willTut = mode === 'classic' && !localStorage.getItem('gb_tut_done');
  S.timerStarted = !willTut;
  if (Music.setUrgency) Music.setUrgency(false);
  // Power-ups never carry between games.
  S.charges = emptyCharges(); S.earnIdx = 0; S.armed = null; S.sweepMode = 'row';
  renderPowerups(); renderTimerBar();
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
    timeLeft: S.timeLeft, charges: { ...S.charges }, earnIdx: S.earnIdx,
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
  S.earnIdx = d.earnIdx || 0; S.armed = null; S.lowTonePlayed = S.timeLeft <= TIMER.lowSeconds;
  // A restored game is already past the tutorial (it closed mid-game), so the
  // timer runs from the moment play resumes.
  S.timerStarted = true;
  renderPowerups(); renderTimerBar();
  if (!S.tray.some(Boolean)) deal();
  $('score').textContent = S.score; $('combo').textContent = S.combo >= 2 ? `🔥 Combo x${S.combo}` : ''; setModeUI();
  S.gamesThisSession++;
  Analytics.log('game_restored', { mode: S.mode, score: S.score, placed: S.placed });
  checkGameOver();
}

function place(slot, r, c) {
  const piece = S.tray[slot]; const sh = piece.shape;
  for (const [dr, dc] of sh.cells) { S.board[r + dr][c + dc] = piece.color; fx.placedFlash.push({ r: r + dr, c: c + dc, t: 0 }); }
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
    // Timer: +6 s per line, +2 s per extra line on a multi-line clear, cap 120.
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
    if (S.combo >= 2) { popup(`Combo x${S.combo}`, L.w / 2, L.by + L.size * 0.5, '#ff7ab6', 34); Sfx.combo(S.combo); Analytics.log('combo', { combo: S.combo }); }
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
  $('combo').textContent = S.combo >= 2 ? `🔥 Combo x${S.combo}` : '';
  const sc = $('score'); sc.classList.add('bump'); setTimeout(() => sc.classList.remove('bump'), 120);
  if (S.score > modeBest()) $('best').textContent = S.score;
  if (S.tray.every((p) => !p)) deal();
  Tutorial.onPlaced();
  const lvl = levelFor(S.placed);
  if (lvl !== levelFor(S.placed - 1)) Analytics.log('level_up', { level: lvl });
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
  S.charges[type]++;
  renderPowerups();
  const def = POWERUPS.defs[type];
  toast(`${def.icon} ${def.name} earned!`);
  Analytics.log('powerup_earned', { type, total: totalCharges() });
  if (!localStorage.getItem('gb_powerup_tip')) {
    localStorage.setItem('gb_powerup_tip', '1');
    toast(`${def.icon} Power-up earned! Tap it, then tap its target. Tap again to cancel.`);
  }
  return true;
}
function renderPowerups() {
  document.querySelectorAll('#powerups .pu').forEach((b) => {
    const type = b.dataset.pu, n = S.charges[type] || 0;
    b.querySelector('.pu-count').textContent = n;
    b.classList.toggle('empty', n === 0);
    b.classList.toggle('armed', S.armed === type);
    b.disabled = n === 0 && S.armed !== type;
  });
  $('pu-target').classList.toggle('hidden', !S.armed);
  $('pu-mode').classList.toggle('hidden', S.armed !== 'sweep');
  $('pu-mode-row-btn').classList.toggle('on', S.sweepMode === 'row');
  $('pu-mode-col-btn').classList.toggle('on', S.sweepMode === 'col');
  $('pu-hint').textContent = S.armed === 'bomb' ? 'Tap a board cell — clears the 3x3 around it.'
    : S.armed === 'sweep' ? `Tap a board cell — clears its ${S.sweepMode === 'row' ? 'row' : 'column'}.`
    : '';
}
function armPowerup(type) {
  if (!S.running) return;
  if (S.armed === type) return cancelArmed();
  if (!S.charges[type]) return;
  if (type === 'reshuffle') return applyReshuffle();
  if (type === 'petal') return applyPetal();
  S.armed = type;
  renderPowerups();
  toast(type === 'bomb' ? '💣 Tap a board cell for the 3x3 blast.' : '↔ Tap a board cell to sweep its row or column.');
}
function cancelArmed() { S.armed = null; renderPowerups(); }
function spendCharge(type) { S.charges[type]--; renderPowerups(); }
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
function applyBomb(r, c) {
  spendCharge('bomb'); cancelArmed();
  const cells = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    const rr = r + dr, cc = c + dc;
    if (rr >= 0 && rr < N && cc >= 0 && cc < N) cells.push([rr, cc]);
  }
  const n = clearCellsWithFx(cells);
  Analytics.log('powerup_used', { type: 'bomb', cells: n });
  saveGame(); checkGameOver();
}
function applySweep(r, c) {
  spendCharge('sweep'); cancelArmed();
  const cells = [];
  if (S.sweepMode === 'row') for (let cc = 0; cc < N; cc++) cells.push([r, cc]);
  else for (let rr = 0; rr < N; rr++) cells.push([rr, c]);
  const n = clearCellsWithFx(cells);
  Analytics.log('powerup_used', { type: 'sweep', mode: S.sweepMode, cells: n });
  saveGame(); checkGameOver();
}
function applyReshuffle() {
  spendCharge('reshuffle');
  deal(); // fair-deal tray rule applies to the new tray, same as always
  toast('🔀 New tray dealt');
  Analytics.log('powerup_used', { type: 'reshuffle' });
  saveGame(); checkGameOver();
}
function applyPetal() {
  spendCharge('petal');
  S.timeLeft = Math.min(TIMER.cap, S.timeLeft + POWERUPS.timePetalSeconds);
  renderTimerBar();
  popup(`+${POWERUPS.timePetalSeconds}s`, L.w / 2, L.by - 4, '#ffd166', 26);
  toast('🌸 +15 seconds');
  Analytics.log('powerup_used', { type: 'petal', timeLeft: Math.round(S.timeLeft) });
  saveGame();
}

function checkGameOver() {
  const alive = S.tray.filter(Boolean);
  if (alive.some((p) => fitsAnywhere(S.board, p.shape))) return;
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
  Analytics.log('game_over', { mode: S.mode, score: S.score, lines: S.lines, max_combo: S.maxCombo, placed: S.placed, revived: S.revived, secs: Math.round((Date.now() - S.startedAt) / 1000) });
  $('ov-score').textContent = S.score; $('ov-best').textContent = modeBest(); $('ov-lines').textContent = S.lines; $('ov-combo').textContent = S.maxCombo;
  $('ov-new').classList.toggle('hidden', !isBest);
  $('best').textContent = modeBest();
  $('over').querySelector('h2').textContent = daily ? `Daily ${S.dateKey} over` : 'Game over';
  $('over').classList.add('show');
}

// ---------- Input ----------
function slotAt(x, y) {
  if (y < L.trayY - 10 || y > L.trayY + L.trayH + 20) return -1;
  const i = Math.floor(x / L.slotW); return S.tray[i] ? i : -1;
}
cv.addEventListener('pointerdown', (e) => {
  Sfx.unlock();
  if (!S.running || drag) return;
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
function refreshTitle() {
  $('title-best').textContent = store.best; $('title-daily-best').textContent = store.dailyBest(localDateKey());
  $('daily-date').textContent = localDateKey();
  const sv = readSave();
  $('btn-play').textContent = sv ? (sv.mode === 'daily' ? '▶ Continue daily' : '▶ Continue') : 'Play';
  $('btn-new').classList.toggle('hidden', !sv);
}
refreshTitle(); $('best').textContent = store.best;
let sessionLogged = false;
function leaveTitle() { Sfx.unlock(); show('title', false); if (!sessionLogged) { sessionLogged = true; Analytics.log('session_start', { ua_mobile: /Mobi/.test(navigator.userAgent) }); } }
$('btn-play').onclick = () => { leaveTitle(); const sv = readSave(); if (sv) restoreGame(sv); else startGame('classic'); };
$('btn-new').onclick = () => { const sv = readSave(); if (sv) Analytics.log('game_abandon', { score: sv.score, mode: sv.mode }); clearSave(); leaveTitle(); startGame('classic'); };
$('btn-daily').onclick = () => { const sv = readSave(); if (sv) Analytics.log('game_abandon', { score: sv.score, mode: sv.mode }); clearSave(); leaveTitle(); startGame('daily', localDateKey()); };
$('btn-how').onclick = () => show('menu', true);
// Settings
const syncSettings = () => { $('set-music').checked = Music.on; $('set-sfx').checked = !Sfx.muted; $('set-haptics').checked = Haptics.enabled; };
$('btn-settings').onclick = () => { syncSettings(); show('settings', true); };
$('set-music').onchange = (e) => Music.set(e.target.checked);
$('set-sfx').onchange = (e) => Sfx.setOn(e.target.checked);
$('set-haptics').onchange = (e) => { Haptics.set(e.target.checked); if (e.target.checked) Haptics.light(); };
$('btn-set-close').onclick = () => show('settings', false);
$('btn-set-rules').onclick = () => { show('settings', false); show('menu', true); };
$('btn-tut-again').onclick = () => { show('settings', false); localStorage.removeItem('gb_tut_done'); if (S.running) Tutorial.start(); };
$('btn-menu').onclick = () => { show('menu', true); Analytics.log('menu_open', {}); };
$('btn-resume').onclick = () => show('menu', false);
$('btn-restart').onclick = () => { show('menu', false); if (S.running) { S.running = false; Analytics.log('game_abandon', { score: S.score }); } clearSave(); startGame(S.mode === 'daily' ? 'daily' : 'classic', S.dateKey || localDateKey()); };
$('btn-log').onclick = () => { const el = $('log'); el.classList.toggle('hidden'); el.textContent = Analytics.all().slice(-60).map((e) => JSON.stringify(e)).join('\n'); };
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
  'Step 2 of 3 — <b>Fill a whole row or column</b> to clear it. Cleared blocks bloom into petals and score points.',
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
layout();
Ads.init();
requestAnimationFrame(frame);
const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
if (isNative) import('./native.js').then((m) => m.initNative()).catch((e) => console.warn('native init', e));
else if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

// ---------- Test hooks (read-only layout + state; mutation only with ?test=1) ----------
window.__gb = {
  layout: () => ({ ...L }),
  state: () => ({ board: S.board.map((r) => r.map(Boolean)), tray: S.tray.map((p) => p && { id: p.shape.id, cells: p.shape.cells, w: p.shape.w, h: p.shape.h, helper: p.helper }), score: S.score, combo: S.combo, lines: S.lines, running: S.running, placed: S.placed, revived: S.revived, mode: S.mode, dateKey: S.dateKey, helperAvailable: S.helperAvailable, tutorialStep: Tutorial.step, timeLeft: Math.round(S.timeLeft * 10) / 10, timerStarted: S.timerStarted, charges: { ...S.charges }, armed: S.armed, sweepMode: S.sweepMode, musicOn: Music.on, timerPaused: timerPaused() }),
};
if (new URLSearchParams(location.search).has('test')) {
  window.__gb.setBoard = (rows) => { S.board = rows.map((row) => [...row].map((ch) => (ch === '#' ? '#5aa2ff' : null))); };
  window.__gb.startDaily = (k) => { show('title', false); clearSave(); startGame('daily', k); };
  window.__gb.startGame = (mode, k) => { show('title', false); clearSave(); startGame(mode || 'classic', k || localDateKey()); };
  window.__gb.saveNow = saveGame;
  window.__gb.setTray = (ids) => { import('./pieces.js').then(({ SHAPES, makePiece }) => { S.tray = ids.map((i) => (i == null ? null : makePiece(SHAPES[i]))); }); };
  window.__gb.setTimeLeft = (s) => { S.timeLeft = s; S.lowTonePlayed = s <= TIMER.lowSeconds; renderTimerBar(); };
  window.__gb.setCharges = (c) => { S.charges = { ...emptyCharges(), ...c }; renderPowerups(); };
  window.__gb.place = (slot, r, c) => place(slot, r, c);
  window.__gb.armPowerup = (type) => armPowerup(type);
  window.__gb.targetCell = (r, c) => { if (S.armed === 'bomb') applyBomb(r, c); else if (S.armed === 'sweep') applySweep(r, c); };
  window.__gb.grantCharge = () => grantCharge();
}
