import { N, dealTray, fits, fitsAnywhere, helperEligible, levelFor, RULES_TEXT } from './difficulty.js';
import { Ads } from './ads.js';
import { Analytics } from './analytics.js';
import { Sfx } from './audio.js';

const $ = (id) => document.getElementById(id);
const cv = $('cv'), g = cv.getContext('2d');

// ---------- Scoring table (the only source of points) ----------
// place: 1 point per cell placed
// clear: 10 per cell cleared x lines cleared at once (1 line = 80, 2 = 320, 3 = 720)
// combo: clear points x combo, where combo counts clears in a row; it survives
//        up to COMBO_GRACE placements without a clear, then resets.
// board wipe: +300
const COMBO_GRACE = 3;
function clearPoints(lines, cells, combo) { return 10 * cells * lines * Math.max(1, combo); }

// ---------- Persistent stats ----------
const store = {
  get best() { return +localStorage.getItem('gb_best') || 0; },
  set best(v) { localStorage.setItem('gb_best', String(v)); },
  get history() { try { return JSON.parse(localStorage.getItem('gb_history') || '[]'); } catch { return []; } },
  pushHistory(s) { const h = this.history; h.push(s); localStorage.setItem('gb_history', JSON.stringify(h.slice(-20))); },
};

// ---------- State ----------
const S = {
  board: [], tray: [null, null, null], score: 0, shownScore: 0, combo: 0, sinceClear: 0, maxCombo: 0,
  lines: 0, placed: 0, revived: false, helperAvailable: false, running: false, gamesThisSession: 0,
  startBest: 0, startedAt: 0,
};
const fx = { particles: [], clearing: [], popups: [], shake: 0, placedFlash: [], trayIn: 0 };
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
  const pad = s * 0.06, ss = (s - pad * 2) * scale, o = (s - ss) / 2;
  x += o; y += o;
  g.globalAlpha = alpha;
  const grd = g.createLinearGradient(x, y, x, y + ss);
  grd.addColorStop(0, shade(color, 0.12)); grd.addColorStop(1, shade(color, -0.12));
  g.fillStyle = grd; rrect(x, y, ss, ss, ss * 0.22); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.28)'; rrect(x + ss * 0.12, y + ss * 0.1, ss * 0.76, ss * 0.22, ss * 0.11); g.fill();
  g.fillStyle = 'rgba(0,0,0,0.18)'; rrect(x + ss * 0.08, y + ss * 0.8, ss * 0.84, ss * 0.12, ss * 0.06); g.fill();
  // little petal mark
  g.fillStyle = 'rgba(255,255,255,0.22)'; g.beginPath(); g.arc(x + ss * 0.5, y + ss * 0.55, ss * 0.1, 0, Math.PI * 2); g.fill();
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
  fx.trayIn = Math.min(1, fx.trayIn + dt * 4);
  if (S.shownScore < S.score) { S.shownScore = Math.min(S.score, S.shownScore + Math.max(1, (S.score - S.shownScore) * dt * 10)); $('score').textContent = Math.round(S.shownScore); }
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
  const res = dealTray({ board: S.board, placed: S.placed, helperAvailable: S.helperAvailable });
  S.tray = res.tray; fx.trayIn = 0;
  if (res.helperUsed) { S.helperAvailable = false; Analytics.log('helper_piece_dealt', { placed: S.placed, level: res.level }); toast('✦ Helper piece this round'); }
  if (res.rerolls) Analytics.log('fair_deal_reroll', { rerolls: res.rerolls });
}

function startGame() {
  S.board = emptyBoard(); S.score = 0; S.shownScore = 0; S.combo = 0; S.sinceClear = 0; S.maxCombo = 0; S.lines = 0; S.placed = 0;
  S.revived = false; S.running = true; S.startBest = store.best; S.startedAt = Date.now();
  S.helperAvailable = helperEligible(store.history, store.best);
  $('score').textContent = '0'; $('combo').textContent = ''; $('best').textContent = store.best;
  deal();
  S.gamesThisSession++;
  Analytics.log('game_start', { game: S.gamesThisSession, best: store.best, helper_eligible: S.helperAvailable });
}

function place(slot, r, c) {
  const piece = S.tray[slot]; const sh = piece.shape;
  for (const [dr, dc] of sh.cells) { S.board[r + dr][c + dc] = piece.color; fx.placedFlash.push({ r: r + dr, c: c + dc, t: 0 }); }
  S.tray[slot] = null; S.placed++;
  let gained = sh.cells.length;
  const { rows, cols } = wouldClearNow();
  const lines = rows.length + cols.length;
  if (lines) {
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
    const cx = L.bx + (c + sh.w / 2) * L.cell, cy = L.by + (r + sh.h / 2) * L.cell;
    popup(`+${pts}`, cx, cy, '#ffffff', 30 + lines * 4);
    if (lines >= 2) popup(['', '', 'Double!', 'Triple!', 'Mega!', 'Bloom!'][Math.min(5, lines)], L.w / 2, L.by + L.size * 0.35, '#7cf0c9', 40);
    if (S.combo >= 2) { popup(`Combo x${S.combo}`, L.w / 2, L.by + L.size * 0.5, '#ff7ab6', 34); Sfx.combo(S.combo); Analytics.log('combo', { combo: S.combo }); }
    Sfx.clear(lines, S.combo);
    fx.shake = 4 + lines * 3;
    Analytics.log('lines_cleared', { lines, combo: S.combo, pts });
    if (S.board.every((row) => row.every((v) => !v))) { gained += 300; popup('Board clear +300', L.w / 2, L.by + L.size * 0.65, '#ffd166', 32); Sfx.boardClear(); Analytics.log('board_clear', {}); }
  } else {
    Sfx.place();
    S.sinceClear++;
    if (S.sinceClear >= COMBO_GRACE) S.combo = 0;
  }
  S.score += gained;
  $('combo').textContent = S.combo >= 2 ? `🔥 Combo x${S.combo}` : '';
  const sc = $('score'); sc.classList.add('bump'); setTimeout(() => sc.classList.remove('bump'), 120);
  if (S.score > store.best) $('best').textContent = S.score;
  if (S.tray.every((p) => !p)) deal();
  const lvl = levelFor(S.placed);
  if (lvl !== levelFor(S.placed - 1)) Analytics.log('level_up', { level: lvl });
  checkGameOver();
}
function wouldClearNow() {
  const rows = [], cols = [];
  for (let i = 0; i < N; i++) { if (S.board[i].every(Boolean)) rows.push(i); if (S.board.every((row) => row[i])) cols.push(i); }
  return { rows, cols };
}

function checkGameOver() {
  const alive = S.tray.filter(Boolean);
  if (alive.some((p) => fitsAnywhere(S.board, p.shape))) return;
  S.running = false;
  setTimeout(onNoMoves, 450);
}

let reviveTimer = null;
function onNoMoves() {
  Sfx.over();
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
  // Revive effect (fixed, documented): clear the 3 fullest rows, deal a fresh tray. No points awarded.
  const order = [...Array(N).keys()].sort((a, b) => S.board[b].filter(Boolean).length - S.board[a].filter(Boolean).length).slice(0, 3);
  for (const rr of order) for (let cc = 0; cc < N; cc++) if (S.board[rr][cc]) {
    fx.clearing.push({ r: rr, c: cc, color: S.board[rr][cc], t: 0 });
    burst(L.bx + (cc + 0.5) * L.cell, L.by + (rr + 0.5) * L.cell, S.board[rr][cc], 4);
    S.board[rr][cc] = null;
  }
  Sfx.revive(); S.running = true; deal(); checkGameOver();
}
function finishGame() {
  const prevBest = store.best, isBest = S.score > prevBest;
  if (isBest) { store.best = S.score; Sfx.best(); Analytics.log('new_high_score', { score: S.score, prev: prevBest }); }
  store.pushHistory(S.score);
  Analytics.log('game_over', { score: S.score, lines: S.lines, max_combo: S.maxCombo, placed: S.placed, revived: S.revived, secs: Math.round((Date.now() - S.startedAt) / 1000) });
  $('ov-score').textContent = S.score; $('ov-best').textContent = store.best; $('ov-lines').textContent = S.lines; $('ov-combo').textContent = S.maxCombo;
  $('ov-new').classList.toggle('hidden', !isBest);
  $('best').textContent = store.best;
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
$('title-best').textContent = store.best; $('best').textContent = store.best;
$('btn-sound').textContent = Sfx.muted ? '🔇' : '🔊';
$('btn-sound').onclick = () => { $('btn-sound').textContent = Sfx.toggle() ? '🔇' : '🔊'; };
$('btn-play').onclick = () => { Sfx.unlock(); show('title', false); Analytics.log('session_start', { ua_mobile: /Mobi/.test(navigator.userAgent) }); startGame(); };
$('btn-how').onclick = () => show('menu', true);
$('btn-menu').onclick = () => { show('menu', true); Analytics.log('menu_open', {}); };
$('btn-resume').onclick = () => show('menu', false);
$('btn-restart').onclick = () => { show('menu', false); if (S.running) { S.running = false; Analytics.log('game_abandon', { score: S.score }); } startGame(); };
$('btn-log').onclick = () => { const el = $('log'); el.classList.toggle('hidden'); el.textContent = Analytics.all().slice(-60).map((e) => JSON.stringify(e)).join('\n'); };
$('btn-revive').onclick = takeRevive;
$('btn-norevive').onclick = () => declineRevive('declined');
$('btn-again').onclick = async () => { show('over', false); await Ads.maybeInterstitialAtBreak(S.gamesThisSession); startGame(); };
$('btn-home').onclick = () => { show('over', false); $('title-best').textContent = store.best; show('title', true); };

S.board = emptyBoard();
layout();
Ads.init();
requestAnimationFrame(frame);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

// ---------- Test hooks (read-only layout + state; mutation only with ?test=1) ----------
window.__gb = {
  layout: () => ({ ...L }),
  state: () => ({ board: S.board.map((r) => r.map(Boolean)), tray: S.tray.map((p) => p && { id: p.shape.id, cells: p.shape.cells, w: p.shape.w, h: p.shape.h, helper: p.helper }), score: S.score, combo: S.combo, lines: S.lines, running: S.running }),
};
if (new URLSearchParams(location.search).has('test')) {
  window.__gb.setBoard = (rows) => { S.board = rows.map((row) => [...row].map((ch) => (ch === '#' ? '#5aa2ff' : null))); };
  window.__gb.setTray = (ids) => { import('./pieces.js').then(({ SHAPES, makePiece }) => { S.tray = ids.map((i) => (i == null ? null : makePiece(SHAPES[i]))); }); };
}
