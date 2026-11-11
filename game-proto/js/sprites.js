// Clearbloom sprites: a 3D Pixar-style look rendered as PRE-RENDERED 2D
// sprites in the existing 2D canvas. No real-time 3D engine (60fps on
// mid-range phones, small download). Every block colour is drawn ONCE at load
// into an offscreen canvas (256 px — about 3x a phone cell — and downscaled,
// so it stays crisp at 2x/3x DPR), with studio lighting baked in: soft top
// highlight, darker base, rounded corners, soft contact shadow. The frame
// then just blits sprites — no per-frame gradients or shadows on blocks.
// The board well and the night-garden background are also pre-rendered once
// (regenerated only on resize). Total added art: a few offscreen canvases in
// memory, zero image files.
import { PALETTE } from './pieces.js';

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + amt * 255)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
function rr(c, x, y, w, h, r) {
  c.beginPath();
  if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h);
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SPRITE = 256; // px per block sprite (cell art is 192, padding is glow/shadow)
const CELL = 192;

// ---- Glossy 3D block sprite for one colour ----
function renderBlockSprite(color) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = SPRITE;
  const c = cv.getContext('2d');
  const p = (SPRITE - CELL) / 2, r = 40;
  // Soft contact shadow, baked in (drawn once, not per frame).
  c.save();
  c.shadowColor = 'rgba(0,0,0,0.45)'; c.shadowBlur = 16; c.shadowOffsetY = 9;
  c.fillStyle = color; rr(c, p, p, CELL, CELL, r); c.fill();
  c.restore();
  // Body: studio lighting — light top, saturated middle, darker base.
  const grd = c.createLinearGradient(0, p, 0, p + CELL);
  grd.addColorStop(0, shade(color, 0.22));
  grd.addColorStop(0.45, color);
  grd.addColorStop(1, shade(color, -0.22));
  c.fillStyle = grd; rr(c, p, p, CELL, CELL, r); c.fill();
  // Glossy top highlight: soft white radial glow, upper left.
  const hi = c.createRadialGradient(p + CELL * 0.32, p + CELL * 0.22, 4, p + CELL * 0.32, p + CELL * 0.22, CELL * 0.62);
  hi.addColorStop(0, 'rgba(255,255,255,0.5)');
  hi.addColorStop(0.55, 'rgba(255,255,255,0.12)');
  hi.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = hi; rr(c, p, p, CELL, CELL, r); c.fill();
  // Bottom inner shade for depth.
  const sh = c.createLinearGradient(0, p + CELL * 0.7, 0, p + CELL);
  sh.addColorStop(0, 'rgba(0,0,0,0)');
  sh.addColorStop(1, 'rgba(0,0,0,0.22)');
  c.fillStyle = sh; rr(c, p, p, CELL, CELL, r); c.fill();
  // Fine rim light around the top edge.
  c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 3;
  rr(c, p + 2, p + 2, CELL - 4, CELL - 4, r - 2); c.stroke();
  return cv;
}

// ---- Glossy petal particle sprite ----
function renderPetalSprite(color) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 96;
  const c = cv.getContext('2d');
  c.translate(48, 48);
  const grd = c.createLinearGradient(-20, -26, 20, 26);
  grd.addColorStop(0, shade(color, 0.25));
  grd.addColorStop(1, shade(color, -0.15));
  c.fillStyle = grd;
  c.beginPath(); c.ellipse(0, 0, 26, 15, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.45)';
  c.beginPath(); c.ellipse(-7, -6, 10, 5, -0.3, 0, Math.PI * 2); c.fill();
  return cv;
}

// ---- Board well sprite (regenerated on resize): 3D tray with inner shadow,
// sculpted gradient frame with tiny 3D leaves at the corners. ----
function renderBoardSprite(size, cell) {
  // Rendered at 2x and downscaled, so the frame stays crisp at 2x/3x DPR.
  const SS = 2;
  const pad = 14, W = size + pad * 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = W * SS;
  const c = cv.getContext('2d');
  c.scale(SS, SS);
  // Sculpted frame: gradient stroke + soft outer glow.
  c.save();
  c.shadowColor = 'rgba(124,240,201,0.5)'; c.shadowBlur = 18;
  const frame = c.createLinearGradient(0, 0, W, W);
  frame.addColorStop(0, '#7cf0c9'); frame.addColorStop(0.35, '#5aa2ff');
  frame.addColorStop(0.65, '#a879ff'); frame.addColorStop(1, '#ff7ab6');
  c.strokeStyle = frame; c.lineWidth = 10;
  rr(c, 7, 7, W - 14, W - 14, 24); c.stroke();
  c.restore();
  // Tiny 3D leaves on the frame (top-left + bottom-right clusters).
  const leaf = (x, y, rot, col) => {
    c.save(); c.translate(x, y); c.rotate(rot);
    const g = c.createLinearGradient(-10, -5, 10, 5);
    g.addColorStop(0, shade(col, 0.2)); g.addColorStop(1, shade(col, -0.15));
    c.fillStyle = g;
    c.beginPath(); c.ellipse(0, 0, 12, 6, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(-10, 0); c.lineTo(10, 0); c.stroke();
    c.restore();
  };
  leaf(pad + 2, pad - 2, -0.6, '#a3e36b'); leaf(pad + 18, pad - 6, -0.2, '#7cf0c9');
  leaf(W - pad - 2, W - pad + 2, 2.5, '#a3e36b'); leaf(W - pad - 18, W - pad + 6, 2.9, '#ff7ab6');
  // Well: dark gradient with edge darkening (inner shadow feel).
  const bx = pad, by = pad;
  const well = c.createLinearGradient(0, by, 0, by + size);
  well.addColorStop(0, '#262061'); well.addColorStop(1, '#17123e');
  c.fillStyle = well; rr(c, bx, by, size, size, 16); c.fill();
  // Inner shadow: darkened edges.
  const edge = (x0, y0, x1, y1) => {
    const g = c.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, 'rgba(0,0,0,0.4)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0) || size, Math.abs(y1 - y0) || size);
  };
  c.save(); rr(c, bx, by, size, size, 16); c.clip();
  edge(bx, by, bx, by + 22); edge(bx, by, bx + 22, by);
  edge(bx, by + size, bx, by + size - 22); edge(bx + size, by, bx + size - 22, by);
  // Cell wells: subtle rounded squares.
  for (let r = 0; r < 8; r++) for (let col = 0; col < 8; col++) {
    c.fillStyle = (r + col) % 2 ? 'rgba(255,255,255,0.045)' : 'rgba(255,255,255,0.025)';
    rr(c, bx + col * cell + cell * 0.05, by + r * cell + cell * 0.05, cell * 0.9, cell * 0.9, cell * 0.18);
    c.fill();
  }
  c.restore();
  return cv;
}

// ---- Night-garden background sprite (regenerated on resize): soft-focus
// 3D garden with depth of field + warm moonlight. Calm, so the board stands
// out. Drawn as one blit per frame — no per-frame blur. ----
function renderBackground(w, h) {
  const cv = document.createElement('canvas');
  cv.width = Math.max(2, Math.round(w)); cv.height = Math.max(2, Math.round(h));
  const c = cv.getContext('2d');
  const rng = mulberry32(20261111); // same garden every time
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#241d5e'); g.addColorStop(0.55, '#17123e'); g.addColorStop(1, '#0e0a28');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  // Warm moonlight, upper right.
  const moon = c.createRadialGradient(w * 0.82, h * 0.1, 4, w * 0.82, h * 0.1, w * 0.3);
  moon.addColorStop(0, 'rgba(255,233,184,0.55)');
  moon.addColorStop(0.25, 'rgba(255,220,150,0.18)');
  moon.addColorStop(1, 'rgba(255,220,150,0)');
  c.fillStyle = moon; c.fillRect(0, 0, w, h);
  c.fillStyle = '#ffe9b8';
  c.beginPath(); c.arc(w * 0.82, h * 0.1, Math.max(14, w * 0.035), 0, Math.PI * 2); c.fill();
  // Soft-focus bokeh: glowing orbs at different depths.
  const bokehCols = ['124,240,201', '90,162,255', '168,121,255', '255,122,182', '255,209,102'];
  for (let i = 0; i < 16; i++) {
    const x = rng() * w, y = rng() * h * 0.7, r = 14 + rng() * 64;
    const col = bokehCols[Math.floor(rng() * bokehCols.length)];
    const b = c.createRadialGradient(x, y, 1, x, y, r);
    b.addColorStop(0, `rgba(${col},${0.05 + rng() * 0.08})`);
    b.addColorStop(1, `rgba(${col},0)`);
    c.fillStyle = b;
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  }
  // Soft leaf silhouettes along the bottom edges.
  c.save();
  c.shadowColor = 'rgba(0,0,0,0.5)'; c.shadowBlur = 30;
  c.fillStyle = 'rgba(12,36,24,0.85)';
  for (const [x, y, rx, ry, rot] of [[w * 0.06, h * 1.02, w * 0.22, h * 0.06, -0.25], [w * 0.94, h * 1.02, w * 0.24, h * 0.07, 0.2], [w * 0.5, h * 1.04, w * 0.3, h * 0.05, 0]]) {
    c.save(); c.translate(x, y); c.rotate(rot);
    c.beginPath(); c.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); c.fill();
    c.restore();
  }
  c.restore();
  // Gentle vignette so the board stands out.
  const v = c.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.35, w / 2, h * 0.45, Math.max(w, h) * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.35)');
  c.fillStyle = v; c.fillRect(0, 0, w, h);
  return cv;
}

let blocks = null, petals = null, whiteBlock = null;
let boardSprite = null, boardKey = '';
let bgSprite = null, bgKey = '';

export const Sprites = {
  get ready() { return !!blocks; },
  init() {
    if (blocks) return;
    blocks = new Map();
    for (const col of PALETTE) blocks.set(col, renderBlockSprite(col));
    whiteBlock = renderBlockSprite('#ffffff');
    petals = new Map();
    for (const col of [...PALETTE, '#ffffff']) petals.set(col, renderPetalSprite(col));
  },
  block(color) { return blocks.get(color) || blocks.get(PALETTE[0]); },
  white() { return whiteBlock; },
  petal(color) { return petals.get(color) || petals.get(PALETTE[0]); },
  // Board + background are size-dependent; regenerated only when size changes.
  board(size, cell) {
    const key = `${size}x${cell}`;
    if (key !== boardKey) { boardKey = key; boardSprite = renderBoardSprite(size, cell); }
    return boardSprite;
  },
  background(w, h) {
    const key = `${Math.round(w)}x${Math.round(h)}`;
    if (key !== bgKey) { bgKey = key; bgSprite = renderBackground(w, h); }
    return bgSprite;
  },
  // Draw a block sprite centred on (cx, cy) at display size s, alpha + scale.
  drawBlock(g, sprite, cx, cy, s, alpha = 1, scale = 1) {
    const d = s * (SPRITE / CELL) * scale; // sprite has padding; scale to cell size
    g.globalAlpha = alpha;
    g.drawImage(sprite, cx - d / 2, cy - d / 2, d, d);
    g.globalAlpha = 1;
  },
};
