// Clearbloom sprites: a premium classroom look rendered as PRE-RENDERED 2D
// sprites in the existing 2D canvas. No real-time 3D engine (60fps on
// mid-range phones, small download). Every block colour is drawn ONCE at
// load into an offscreen canvas (256 px — about 3x a phone cell — and
// downscaled, so it stays crisp at 2x/3x DPR), with candy-3D lighting baked
// in: specular highlight, bevel, soft inner shadow, grounded drop shadow.
// The board well and the paper background are also pre-rendered once
// (regenerated only on resize). UI icons are drawn the same way — glossy
// 3D-style rendered icons, never emoji or flat SVG. Total added art: a few
// offscreen canvases in memory, zero image files.
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
function starPath(c, cx, cy, rO, rI, points = 5, rot = -Math.PI / 2) {
  c.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? rO : rI, a = rot + (i * Math.PI) / points;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
  }
  c.closePath();
}

const SPRITE = 256; // px per block sprite (cell art is 192, padding is glow/shadow)
const CELL = 192;

// ---- Glossy candy 3D block sprite for one colour (crayon palette) ----
// Specular highlight, subtle bevel (light top edge, dark base), soft inner
// shadow, grounded drop shadow. Light plastic-toy / glossy-eraser feel.
// No markings, icons, lines or textures on the block itself.
function renderBlockSprite(color) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = SPRITE;
  const c = cv.getContext('2d');
  const p = (SPRITE - CELL) / 2, r = 44;
  // Grounded drop shadow, baked in (drawn once, not per frame).
  c.save();
  c.shadowColor = 'rgba(90,40,0,0.4)'; c.shadowBlur = 14; c.shadowOffsetY = 8;
  c.fillStyle = color; rr(c, p, p, CELL, CELL, r); c.fill();
  c.restore();
  // Body: candy lighting — bright top, saturated middle, deeper base.
  const grd = c.createLinearGradient(0, p, 0, p + CELL);
  grd.addColorStop(0, shade(color, 0.3));
  grd.addColorStop(0.4, color);
  grd.addColorStop(1, shade(color, -0.26));
  c.fillStyle = grd; rr(c, p, p, CELL, CELL, r); c.fill();
  // Big specular highlight: soft white gloss, upper left.
  const hi = c.createRadialGradient(p + CELL * 0.3, p + CELL * 0.2, 4, p + CELL * 0.3, p + CELL * 0.2, CELL * 0.6);
  hi.addColorStop(0, 'rgba(255,255,255,0.75)');
  hi.addColorStop(0.5, 'rgba(255,255,255,0.18)');
  hi.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = hi; rr(c, p, p, CELL, CELL, r); c.fill();
  // Small bright specular dot.
  c.fillStyle = 'rgba(255,255,255,0.85)';
  c.beginPath(); c.ellipse(p + CELL * 0.3, p + CELL * 0.22, CELL * 0.11, CELL * 0.06, -0.5, 0, Math.PI * 2); c.fill();
  // Bevel: light top edge, dark bottom edge.
  c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 4;
  c.beginPath(); c.arc(p + r, p + r, r - 4, Math.PI, Math.PI * 1.5); c.stroke();
  c.beginPath(); c.moveTo(p + r, p + 3); c.lineTo(p + CELL - r, p + 3); c.stroke();
  c.strokeStyle = 'rgba(0,0,0,0.18)'; c.lineWidth = 4;
  c.beginPath(); c.moveTo(p + r, p + CELL - 3); c.lineTo(p + CELL - r, p + CELL - 3); c.stroke();
  // Soft inner shadow at the bottom for depth.
  const sh = c.createLinearGradient(0, p + CELL * 0.68, 0, p + CELL);
  sh.addColorStop(0, 'rgba(0,0,0,0)');
  sh.addColorStop(1, 'rgba(0,0,0,0.26)');
  c.fillStyle = sh; rr(c, p, p, CELL, CELL, r); c.fill();
  // Fine rim light around the top edge.
  c.strokeStyle = 'rgba(255,255,255,0.4)'; c.lineWidth = 3;
  rr(c, p + 2, p + 2, CELL - 4, CELL - 4, r - 2); c.stroke();
  return cv;
}

// ---- Glossy star particle sprite (classroom: gold stars + confetti) ----
function renderStarSprite(color) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 96;
  const c = cv.getContext('2d');
  c.translate(48, 48);
  const g = c.createLinearGradient(-20, -26, 20, 26);
  g.addColorStop(0, shade(color, 0.3));
  g.addColorStop(1, shade(color, -0.15));
  c.fillStyle = g;
  starPath(c, 0, 0, 34, 15);
  c.fill();
  c.fillStyle = 'rgba(255,255,255,0.55)';
  starPath(c, -6, -8, 12, 5);
  c.fill();
  return cv;
}
function renderConfettiSprite(color) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  const g = c.createLinearGradient(0, 0, 48, 48);
  g.addColorStop(0, shade(color, 0.25));
  g.addColorStop(1, shade(color, -0.2));
  c.fillStyle = g;
  rr(c, 8, 14, 48, 34, 8); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.4)';
  rr(c, 12, 18, 40, 8, 4); c.fill();
  return cv;
}
// Keep the old petal name as an alias: clear bursts still use it.
function renderPetalSprite(color) { return renderStarSprite(color); }

// ---- Board sprite (regenerated on resize): premium wooden tray ----
// Warm wood frame with grain, depth + inner shadow; empty cells are softly
// recessed paper wells. Gold stars at the corners instead of leaves.
function renderBoardSprite(size, cell) {
  const SS = 2;
  const pad = 14, W = size + pad * 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = W * SS;
  const c = cv.getContext('2d');
  c.scale(SS, SS);
  // Wooden frame: warm gradient + grain lines + soft outer glow.
  c.save();
  c.shadowColor = 'rgba(120,60,0,0.35)'; c.shadowBlur = 16;
  const frame = c.createLinearGradient(0, 0, W, W);
  frame.addColorStop(0, '#e0a55c'); frame.addColorStop(0.5, '#c07f35'); frame.addColorStop(1, '#96601f');
  c.fillStyle = frame; rr(c, 4, 4, W - 8, W - 8, 26); c.fill();
  c.restore();
  // Wood grain: a few soft darker arcs across the frame.
  c.save();
  rr(c, 4, 4, W - 8, W - 8, 26); c.clip();
  c.strokeStyle = 'rgba(120,60,0,0.18)'; c.lineWidth = 2;
  for (let i = 0; i < 5; i++) {
    c.beginPath();
    c.moveTo(0, 20 + i * (W / 5));
    c.bezierCurveTo(W * 0.3, 12 + i * (W / 5), W * 0.7, 28 + i * (W / 5), W, 18 + i * (W / 5));
    c.stroke();
  }
  // Frame bevel: light top edge, dark bottom edge.
  c.strokeStyle = 'rgba(255,220,160,0.6)'; c.lineWidth = 3;
  rr(c, 6, 6, W - 12, W - 12, 24); c.stroke();
  c.restore();
  // Gold stars on the frame corners.
  const goldStar = (x, y, r) => {
    const g = c.createLinearGradient(x - r, y - r, x + r, y + r);
    g.addColorStop(0, '#ffe98a'); g.addColorStop(1, '#f5a623');
    c.fillStyle = g; starPath(c, x, y, r, r * 0.45); c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.6)'; c.lineWidth = 1.5;
    starPath(c, x, y, r, r * 0.45); c.stroke();
  };
  goldStar(pad + 4, pad - 4, 9); goldStar(W - pad - 4, W - pad + 4, 9);
  // Well: warm paper with edge darkening (inner shadow feel).
  const bx = pad, by = pad;
  const well = c.createLinearGradient(0, by, 0, by + size);
  well.addColorStop(0, '#fff6da'); well.addColorStop(1, '#f7e3ae');
  c.fillStyle = well; rr(c, bx, by, size, size, 16); c.fill();
  c.save(); rr(c, bx, by, size, size, 16); c.clip();
  const edge = (x0, y0, x1, y1) => {
    const g = c.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, 'rgba(120,60,0,0.35)'); g.addColorStop(1, 'rgba(120,60,0,0)');
    c.fillStyle = g; c.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0) || size, Math.abs(y1 - y0) || size);
  };
  edge(bx, by, bx, by + 22); edge(bx, by, bx + 22, by);
  edge(bx, by + size, bx, by + size - 22); edge(bx + size, by, bx + size - 22, by);
  // Recessed empty cells: soft inset wells.
  for (let r = 0; r < 8; r++) for (let col = 0; col < 8; col++) {
    const x = bx + col * cell + cell * 0.06, y = by + r * cell + cell * 0.06, s = cell * 0.88;
    c.fillStyle = (r + col) % 2 ? '#eedcae' : '#f2e2b6';
    rr(c, x, y, s, s, cell * 0.2); c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(x + 4, y + s - 2); c.lineTo(x + s - 4, y + s - 2); c.stroke();
    c.strokeStyle = 'rgba(150,100,30,0.25)'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(x + 4, y + 2); c.lineTo(x + s - 4, y + 2); c.stroke();
  }
  c.restore();
  return cv;
}

// ---- Paper background sprite (regenerated on resize): bright, rich
// gradient with a soft paper/felt texture and floating chalk doodles
// (stars, squiggles, crayon strokes). NOT a classroom scene — a calm
// backdrop so the premium board stands out. Drawn as one blit per frame.
function renderBackground(w, h) {
  const cv = document.createElement('canvas');
  cv.width = Math.max(2, Math.round(w)); cv.height = Math.max(2, Math.round(h));
  const c = cv.getContext('2d');
  const rng = mulberry32(20261111); // same backdrop every time
  const g = c.createLinearGradient(0, 0, w * 0.4, h);
  g.addColorStop(0, '#fff8e0'); g.addColorStop(0.5, '#ffedb8'); g.addColorStop(1, '#ffd9c2');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  // Soft paper texture: tiny low-alpha dots.
  for (let i = 0; i < 900; i++) {
    c.fillStyle = rng() < 0.5 ? 'rgba(150,100,30,0.05)' : 'rgba(255,255,255,0.09)';
    c.fillRect(rng() * w, rng() * h, 1.6, 1.6);
  }
  // Warm sunlight glow, upper left.
  const sun = c.createRadialGradient(w * 0.15, h * 0.06, 4, w * 0.15, h * 0.06, w * 0.45);
  sun.addColorStop(0, 'rgba(255,240,180,0.5)');
  sun.addColorStop(1, 'rgba(255,240,180,0)');
  c.fillStyle = sun; c.fillRect(0, 0, w, h);
  // Floating chalk doodles: stars, squiggles, crayon strokes (soft, pale).
  const doodleCols = ['#ff8a1e', '#2f8cff', '#9b4dff', '#ff5da2', '#2fd65a', '#ff4d4d'];
  for (let i = 0; i < 14; i++) {
    const x = rng() * w, y = rng() * h, col = doodleCols[Math.floor(rng() * doodleCols.length)];
    c.strokeStyle = col; c.fillStyle = col; c.globalAlpha = 0.1 + rng() * 0.08;
    c.lineWidth = 3; c.lineCap = 'round';
    const kind = Math.floor(rng() * 3);
    if (kind === 0) { // chalk star outline
      starPath(c, x, y, 10 + rng() * 10, 5 + rng() * 5);
      c.stroke();
    } else if (kind === 1) { // squiggle
      c.beginPath(); c.moveTo(x - 18, y);
      c.bezierCurveTo(x - 6, y - 14, x + 6, y + 14, x + 18, y);
      c.stroke();
    } else { // crayon stroke
      c.beginPath(); c.moveTo(x - 16, y + 6 - rng() * 12);
      c.lineTo(x + 16, y - 6 + rng() * 12);
      c.lineWidth = 6; c.stroke();
    }
  }
  c.globalAlpha = 1;
  // Gentle vignette so the board stands out.
  const v = c.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.35, w / 2, h * 0.45, Math.max(w, h) * 0.75);
  v.addColorStop(0, 'rgba(255,255,255,0)');
  v.addColorStop(1, 'rgba(150,80,0,0.14)');
  c.fillStyle = v; c.fillRect(0, 0, w, h);
  return cv;
}

// ---- 3D-style UI icons (canvas-drawn, glossy, never emoji/flat SVG) ----
// Each icon is drawn once at 96 px into an offscreen canvas and cached;
// DOM code uses iconURL(name) as an <img> src. Colours are the crayon set.
function gloss(c, x, y, r) {
  const hi = c.createRadialGradient(x - r * 0.3, y - r * 0.4, 1, x - r * 0.3, y - r * 0.4, r * 1.1);
  hi.addColorStop(0, 'rgba(255,255,255,0.7)');
  hi.addColorStop(0.5, 'rgba(255,255,255,0.08)');
  hi.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = hi;
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
}
// Small glossy candy block for action icons — same lighting as the big
// board blocks (bright top, saturated middle, deeper base, specular gloss,
// light top edge / dark base bevel), just at icon scale.
function miniBlock(c, x, y, s, color) {
  const r = s * 0.22;
  c.save();
  c.shadowColor = 'rgba(90,40,0,0.35)'; c.shadowBlur = 4; c.shadowOffsetY = 2;
  c.fillStyle = color; rr(c, x, y, s, s, r); c.fill();
  c.restore();
  const grd = c.createLinearGradient(0, y, 0, y + s);
  grd.addColorStop(0, shade(color, 0.3));
  grd.addColorStop(0.45, color);
  grd.addColorStop(1, shade(color, -0.26));
  c.fillStyle = grd; rr(c, x, y, s, s, r); c.fill();
  const hi = c.createRadialGradient(x + s * 0.3, y + s * 0.2, 1, x + s * 0.3, y + s * 0.2, s * 0.6);
  hi.addColorStop(0, 'rgba(255,255,255,0.75)');
  hi.addColorStop(0.5, 'rgba(255,255,255,0.15)');
  hi.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = hi; rr(c, x, y, s, s, r); c.fill();
  c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(x + r, y + 1.5); c.lineTo(x + s - r, y + 1.5); c.stroke();
  c.strokeStyle = 'rgba(0,0,0,0.18)'; c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(x + r, y + s - 1.5); c.lineTo(x + s - r, y + s - 1.5); c.stroke();
}
function iconCanvas(name) {
  const S = 96, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d');
  const cx = S / 2, cy = S / 2;
  const body = (fill, stroke = 'rgba(0,0,0,0.12)') => ({ fill, stroke });
  const grad = (c0, c1, x0 = 0, y0 = 0, x1 = 0, y1 = S) => {
    const g = c.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, c0); g.addColorStop(1, c1);
    return g;
  };
  const paint = (fill) => { c.fillStyle = fill; };
  const outline = () => { c.strokeStyle = 'rgba(90,40,0,0.18)'; c.lineWidth = 3; };
  switch (name) {
    case 'gear': {
      paint(grad('#ffe98a', '#f5a623')); outline();
      for (let i = 0; i < 8; i++) {
        c.save(); c.translate(cx, cy); c.rotate((i * Math.PI) / 4);
        rr(c, -9, -46, 18, 18, 6); c.fill(); c.stroke(); c.restore();
      }
      c.beginPath(); c.arc(cx, cy, 30, 0, Math.PI * 2); c.fill(); c.stroke();
      c.fillStyle = '#fff8e0'; c.beginPath(); c.arc(cx, cy, 13, 0, Math.PI * 2); c.fill();
      gloss(c, cx, cy, 34);
      break;
    }
    case 'menu': {
      paint(grad('#7cf0c9', '#2f8cff'));
      for (let i = 0; i < 3; i++) { rr(c, 20, 26 + i * 16, 56, 10, 5); c.fill(); }
      gloss(c, cx, cy, 34);
      break;
    }
    case 'sound':
    case 'mute': {
      paint(grad('#2f8cff', '#2f6fd6')); outline();
      c.beginPath(); c.moveTo(22, 40); c.lineTo(40, 40); c.lineTo(54, 26); c.lineTo(54, 70); c.lineTo(40, 56); c.lineTo(22, 56); c.closePath(); c.fill(); c.stroke();
      if (name === 'sound') {
        c.strokeStyle = '#2f8cff'; c.lineWidth = 6; c.lineCap = 'round';
        c.beginPath(); c.arc(58, 48, 12, -0.9, 0.9); c.stroke();
        c.beginPath(); c.arc(58, 48, 20, -0.9, 0.9); c.stroke();
      } else {
        c.strokeStyle = '#ff4d4d'; c.lineWidth = 8; c.lineCap = 'round';
        c.beginPath(); c.moveTo(62, 36); c.lineTo(80, 60); c.stroke();
        c.beginPath(); c.moveTo(80, 36); c.lineTo(62, 60); c.stroke();
      }
      gloss(c, 44, 44, 26);
      break;
    }
    case 'pause': {
      paint(grad('#ff8a1e', '#ff5da2'));
      rr(c, 28, 24, 15, 48, 7); c.fill();
      rr(c, 53, 24, 15, 48, 7); c.fill();
      gloss(c, cx, cy, 34);
      break;
    }
    case 'play': {
      paint(grad('#2fd65a', '#1fae46')); outline();
      c.beginPath(); c.moveTo(36, 24); c.lineTo(74, 48); c.lineTo(36, 72); c.closePath(); c.fill(); c.stroke();
      gloss(c, cx, cy, 34);
      break;
    }
    case 'home': {
      paint(grad('#ff8a1e', '#e0641e')); outline();
      c.beginPath(); c.moveTo(48, 20); c.lineTo(80, 46); c.lineTo(72, 46); c.lineTo(72, 76); c.lineTo(24, 76); c.lineTo(24, 46); c.lineTo(16, 46); c.closePath(); c.fill(); c.stroke();
      c.fillStyle = '#7a3c00'; rr(c, 42, 54, 12, 22, 3); c.fill();
      gloss(c, cx, cy, 34);
      break;
    }
    case 'star': {
      const g = grad('#ffe98a', '#f5a623');
      paint(g); outline();
      starPath(c, cx, cy, 36, 16); c.fill(); c.stroke();
      gloss(c, cx, cy, 30);
      break;
    }
    case 'trophy': {
      paint(grad('#ffe98a', '#f5a623')); outline();
      rr(c, 28, 20, 40, 34, 10); c.fill(); c.stroke();
      c.beginPath(); c.arc(28, 36, 10, Math.PI * 0.5, Math.PI * 1.5); c.stroke();
      c.beginPath(); c.arc(68, 36, 10, -Math.PI * 0.5, Math.PI * 0.5); c.stroke();
      c.fillStyle = '#f5a623'; rr(c, 44, 54, 8, 12, 3); c.fill();
      rr(c, 32, 66, 32, 8, 4); c.fill();
      gloss(c, cx, 36, 24);
      break;
    }
    case 'bomb': {
      // Ball + fuse + spark as ONE unit, optically centred in the disc
      // (equal breathing room all round) — the ball used to sit low.
      c.fillStyle = '#3a3a4d';
      c.beginPath(); c.arc(cx, cy + 13, 27, 0, Math.PI * 2); c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 3; c.stroke();
      c.strokeStyle = '#8a6a2f'; c.lineWidth = 5; c.lineCap = 'round';
      c.beginPath(); c.moveTo(cx + 12, cy - 8); c.quadraticCurveTo(cx + 24, cy - 16, cx + 18, cy - 22); c.stroke();
      paint(grad('#ffe98a', '#ff8a1e'));
      starPath(c, cx + 18, cy - 31, 9, 4); c.fill();
      gloss(c, cx - 6, cy + 7, 21);
      break;
    }
    case 'eraser': {
      // Sweep: three BIG glossy blocks are the subject — no beam, no glare
      // layer, only the blocks' own top-left specular. A small eraser at
      // the bottom-right edge is the action cue.
      miniBlock(c, 7, 34, 26, '#2f8cff');
      miniBlock(c, 35, 34, 26, '#2fd65a');
      miniBlock(c, 63, 34, 26, '#ff8a1e');
      c.save();
      c.translate(82, 70); c.rotate(-0.25);
      c.fillStyle = '#ff8fb3'; rr(c, -11, -6, 22, 12, 3); c.fill();
      c.fillStyle = '#fff8e0'; rr(c, -11, -6, 8, 12, 3); c.fill();
      c.strokeStyle = 'rgba(90,40,0,0.25)'; c.lineWidth = 1.5; rr(c, -11, -6, 22, 12, 3); c.stroke();
      c.restore();
      break;
    }
    case 'shuffle': {
      // Shuffle Tray: three BIG glossy blocks, the middle one bounced up.
      // No white arc, no glare layer — only the blocks' own specular.
      // The action cue is a small GOLD circular arrow in the top-right
      // corner (gold, not white: Dylan's glare complaint was about white
      // washing out the disc, so the cue carries no white at all).
      miniBlock(c, 9, 48, 24, '#ff4d4d');
      miniBlock(c, 36, 34, 24, '#ffd21f');
      miniBlock(c, 63, 48, 24, '#9b4dff');
      c.save();
      const aEnd = 2.6;
      c.strokeStyle = 'rgba(255,210,31,0.95)'; c.lineWidth = 3.5; c.lineCap = 'round';
      c.beginPath(); c.arc(80, 18, 9, -1.2, aEnd); c.stroke();
      c.translate(80 + Math.cos(aEnd) * 9, 18 + Math.sin(aEnd) * 9);
      c.rotate(aEnd + Math.PI / 2);
      c.fillStyle = 'rgba(255,210,31,0.95)';
      c.beginPath(); c.moveTo(6, 0); c.lineTo(-3, -4); c.lineTo(-3, 4); c.closePath(); c.fill();
      c.restore();
      break;
    }
    case 'clock': {
      paint(grad('#ffffff', '#ffe9b8')); outline();
      c.beginPath(); c.arc(cx, cy, 32, 0, Math.PI * 2); c.fill(); c.stroke();
      c.strokeStyle = '#2b2b4a'; c.lineWidth = 6; c.lineCap = 'round';
      c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx, cy - 18); c.stroke();
      c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + 12, cy + 6); c.stroke();
      c.fillStyle = '#ff4d4d'; c.beginPath(); c.arc(cx, cy, 5, 0, Math.PI * 2); c.fill();
      gloss(c, cx, cy, 26);
      break;
    }
    case 'close': {
      c.strokeStyle = '#ff4d4d'; c.lineWidth = 12; c.lineCap = 'round';
      c.beginPath(); c.moveTo(30, 30); c.lineTo(66, 66); c.stroke();
      c.beginPath(); c.moveTo(66, 30); c.lineTo(30, 66); c.stroke();
      break;
    }
    case 'check': {
      c.strokeStyle = '#2fd65a'; c.lineWidth = 12; c.lineCap = 'round'; c.lineJoin = 'round';
      c.beginPath(); c.moveTo(26, 50); c.lineTo(42, 66); c.lineTo(72, 30); c.stroke();
      break;
    }
    case 'music': {
      paint(grad('#9b4dff', '#6a2fd6')); outline();
      c.beginPath(); c.ellipse(36, 68, 12, 9, -0.3, 0, Math.PI * 2); c.fill(); c.stroke();
      c.fillRect(46, 28, 6, 42);
      c.beginPath(); c.moveTo(52, 28); c.quadraticCurveTo(70, 34, 66, 48); c.lineTo(60, 46); c.quadraticCurveTo(62, 36, 52, 34); c.closePath(); c.fill();
      gloss(c, cx, cy, 30);
      break;
    }
    case 'tap': {
      paint(grad('#ffe98a', '#f5a623')); outline();
      starPath(c, cx, cy, 30, 13); c.fill(); c.stroke();
      c.strokeStyle = '#ff8a1e'; c.lineWidth = 5; c.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + (i - 1) * 0.5;
        c.beginPath();
        c.moveTo(cx + Math.cos(a) * 38, cy + Math.sin(a) * 38);
        c.lineTo(cx + Math.cos(a) * 44, cy + Math.sin(a) * 44);
        c.stroke();
      }
      gloss(c, cx, cy, 26);
      break;
    }
    default: {
      paint(grad('#e8e8e8', '#c8c8c8'));
      c.beginPath(); c.arc(cx, cy, 30, 0, Math.PI * 2); c.fill();
    }
  }
  return cv;
}

// ---------- Hero type: glossy 3D numerals + wordmark ----------
// Pre-rendered at 2x/3x so hero type reads like a physical glossy toy:
// chunky rounded letters, key light top-left, tight specular stripe on the
// top edge, shallow bevel/extrusion, soft colored shadow. The wordmark and
// numerals are rendered once (after the embedded fonts are ready) and cached
// as data URLs; the game DOM then shows <img> sprites, never live gradient
// text. Body UI stays clean Fredoka/Baloo.
const NUMERAL_PALS = {
  gold: { top: '#fffbe0', mid: '#ffd21f', bottom: '#ff8a1e', side: '#c98a1f', outline: '#7a3c00' },
  amber: { top: '#fff6c8', mid: '#ffb347', bottom: '#ff8a1e', side: '#c97a1f', outline: '#7a3c00' },
  red: { top: '#ffe2d6', mid: '#ff6b5e', bottom: '#d92b2b', side: '#a02020', outline: '#5a1000' },
};
const numeralCache = new Map();
const starURLCache = new Map();
let heroReady = false;
let wordmarkURLCache = null;

function heroFont(fs) { return `800 ${fs}px 'Baloo 2', 'Fredoka', system-ui, sans-serif`; }

function renderNumeralCanvas(digit, pal) {
  const fs = 220, pad = 30;
  const meas = document.createElement('canvas').getContext('2d');
  meas.font = heroFont(fs);
  const tw = meas.measureText(digit).width;
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(tw + pad * 2 + 20);
  cv.height = 320;
  const c = cv.getContext('2d');
  const x = pad + 10, y = 252;
  c.font = heroFont(fs); c.textBaseline = 'alphabetic'; c.textAlign = 'left'; c.lineJoin = 'round';
  // Shallow extrusion: down-right steps, darkening.
  for (let k = 7; k >= 1; k--) {
    c.fillStyle = shade(pal.side, -0.05 * k);
    c.fillText(digit, x + k * 1.4, y + k * 2.1);
  }
  // Face with soft colored shadow.
  c.save();
  c.shadowColor = 'rgba(122,60,0,0.35)'; c.shadowBlur = 14; c.shadowOffsetY = 8;
  const g = c.createLinearGradient(0, y - fs, 0, y + 8);
  g.addColorStop(0, pal.top); g.addColorStop(0.45, pal.mid); g.addColorStop(1, pal.bottom);
  c.fillStyle = g;
  c.fillText(digit, x, y);
  c.restore();
  // Specular: a TIGHT glossy band on the top edge only — a highlight, not
  // a whitewash (the old 0.9-alpha band over half the glyph washed the
  // colour out to pastel).
  c.save();
  c.globalCompositeOperation = 'source-atop';
  const sg = c.createLinearGradient(0, y - fs, 0, y - fs * 0.38);
  sg.addColorStop(0, 'rgba(255,255,255,0.6)');
  sg.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = sg;
  c.fillRect(0, y - fs - 12, cv.width, fs * 0.38);
  c.fillStyle = 'rgba(255,255,255,0.9)';
  c.fillRect(0, y - fs + 4, cv.width, 7);
  c.restore();
  // Thin darker outline.
  c.strokeStyle = pal.outline; c.lineWidth = 9;
  c.strokeText(digit, x, y);
  return cv;
}

function numeralURL(digit, palName = 'gold') {
  const key = `${palName}:${digit}`;
  if (!numeralCache.has(key)) numeralCache.set(key, renderNumeralCanvas(digit, NUMERAL_PALS[palName]).toDataURL('image/png'));
  return numeralCache.get(key);
}

function renderWordmarkCanvas() {
  const word = 'Clearbloom';
  const fs = 210, pad = 40;
  const meas = document.createElement('canvas').getContext('2d');
  meas.font = heroFont(fs);
  const widths = [...word].map((ch) => meas.measureText(ch).width);
  const tracking = -6;
  const totalW = widths.reduce((a, b) => a + b, 0) + tracking * (word.length - 1);
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(totalW * 0.96 + pad * 2 + 40);
  cv.height = 330;
  const c = cv.getContext('2d');
  c.save();
  c.translate(pad + 16, 0);
  c.scale(0.96, 1); // slightly condensed so the word has presence at phone width
  const baseline = 258;
  // Deep saturated candy colours — the old bright blue→pink face washed to
  // pastel under the specular. These read as colour, not a pale wash, on
  // the cream panel.
  const grad = c.createLinearGradient(0, 0, totalW, 0);
  grad.addColorStop(0, '#1e63d8');
  grad.addColorStop(0.38, '#5b21d6');
  grad.addColorStop(0.68, '#a313d6');
  grad.addColorStop(1, '#e0247e');
  c.font = heroFont(fs); c.textBaseline = 'alphabetic'; c.textAlign = 'left'; c.lineJoin = 'round';
  const letters = [...word];
  // Extrusion pass (all letters), cream-gold sides.
  for (let k = 7; k >= 1; k--) {
    c.fillStyle = shade('#e8b64c', -0.055 * k);
    let lx = 0;
    for (let i = 0; i < letters.length; i++) { c.fillText(letters[i], lx + k * 1.3, baseline + k * 2.0); lx += widths[i] + tracking; }
  }
  // Face pass with soft colored shadow.
  c.save();
  c.shadowColor = 'rgba(122,60,0,0.45)'; c.shadowBlur = 18; c.shadowOffsetY = 10;
  c.fillStyle = grad;
  let lx = 0;
  for (let i = 0; i < letters.length; i++) { c.fillText(letters[i], lx, baseline); lx += widths[i] + tracking; }
  c.restore();
  // Specular: a TIGHT glossy band on the top edge only — a highlight, not
  // a whitewash (the old 0.9-alpha band over half the glyphs turned the
  // wordmark pale on the cream panel).
  c.save();
  c.globalCompositeOperation = 'source-atop';
  const sg = c.createLinearGradient(0, baseline - fs, 0, baseline - fs * 0.34);
  sg.addColorStop(0, 'rgba(255,255,255,0.5)');
  sg.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = sg;
  c.fillRect(0, baseline - fs - 14, totalW, fs * 0.34);
  c.fillStyle = 'rgba(255,255,255,0.85)';
  c.fillRect(0, baseline - fs + 4, totalW, 6);
  c.restore();
  // Strong darker outline — the old 5px rim was too thin to hold the
  // letters against the paper.
  c.strokeStyle = '#7a3c00'; c.lineWidth = 10;
  lx = 0;
  for (let i = 0; i < letters.length; i++) { c.strokeText(letters[i], lx, baseline); lx += widths[i] + tracking; }
  // Small 3D gold star accent sitting on the final m.
  const starX = totalW - widths[widths.length - 1] * 0.45;
  const starY = baseline - fs + 6;
  c.save();
  c.translate(starX, starY);
  c.rotate(0.35);
  const sg2 = c.createLinearGradient(0, -26, 0, 26);
  sg2.addColorStop(0, '#fffbe0'); sg2.addColorStop(0.5, '#ffd21f'); sg2.addColorStop(1, '#ff8a1e');
  c.fillStyle = sg2;
  starPath(c, 0, 0, 24, 11, 5);
  c.fill();
  c.strokeStyle = '#7a3c00'; c.lineWidth = 3; c.stroke();
  c.fillStyle = 'rgba(255,255,255,0.85)';
  c.beginPath(); c.arc(-6, -9, 6, 0, Math.PI * 2); c.fill();
  c.restore();
  c.restore();
  return cv;
}

function wordmarkURL() {
  if (!wordmarkURLCache) wordmarkURLCache = renderWordmarkCanvas().toDataURL('image/png');
  return wordmarkURLCache;
}

// Renders hero type after the embedded fonts are ready; safe to call early.
async function initHeroType() {
  try {
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1200))]);
  } catch { /* fall through with whatever fonts are available */ }
  // Warm the caches so first paint is already the sprite version.
  for (let d = 0; d <= 9; d++) numeralURL(String(d), 'gold');
  numeralURL('2', 'amber'); numeralURL('0', 'amber'); numeralURL('1', 'red');
  wordmarkURL();
  heroReady = true;
}

let blocks = null, petals = null, stars = null, confetti = null, whiteBlock = null;
let boardSprite = null, boardKey = '';
let bgSprite = null, bgKey = '';
let iconCache = null, iconURLCache = null;

export const Sprites = {
  get ready() { return !!blocks; },
  init() {
    if (blocks) return;
    blocks = new Map();
    for (const col of PALETTE) blocks.set(col, renderBlockSprite(col));
    whiteBlock = renderBlockSprite('#ffffff');
    petals = new Map();
    stars = new Map();
    confetti = new Map();
    for (const col of [...PALETTE, '#ffffff', '#ffd21f']) {
      petals.set(col, renderPetalSprite(col));
      stars.set(col, renderStarSprite(col));
      confetti.set(col, renderConfettiSprite(col));
    }
    iconCache = new Map();
    iconURLCache = new Map();
  },
  block(color) { return blocks.get(color) || blocks.get(PALETTE[0]); },
  white() { return whiteBlock; },
  petal(color) { return petals.get(color) || petals.get(PALETTE[0]); },
  star(color) { return stars.get(color) || stars.get('#ffd21f'); },
  confetti(color) { return confetti.get(color) || confetti.get(PALETTE[0]); },
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
  // 3D-style UI icon as a canvas (for canvas drawing) or data URL (for DOM <img>).
  icon(name) {
    if (!iconCache.has(name)) iconCache.set(name, iconCanvas(name));
    return iconCache.get(name);
  },
  iconURL(name) {
    if (!iconURLCache.has(name)) iconURLCache.set(name, this.icon(name).toDataURL('image/png'));
    return iconURLCache.get(name);
  },
  // Hero type: pre-rendered glossy 3D numerals / wordmark (data URLs).
  get heroReady() { return heroReady; },
  initHeroType,
  numeralURL,
  wordmarkURL,
  starURL(color = '#ffd21f') {
    if (!starURLCache.has(color)) starURLCache.set(color, renderStarSprite(color).toDataURL('image/png'));
    return starURLCache.get(color);
  },
};
