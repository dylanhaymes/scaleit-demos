// Crayon Box freeze repro probe (Dylan, Nov 12 9:06 PM):
// while using Crayon Box: small yellow piece floats mid-board, frozen;
// nothing on screen responds.
// Root cause (proven in Node against the real modules, /tmp/crayon-verify.mjs):
// Sprites.confetti()/petal() fell back to PALETTE[0] ('#ff4d4d'), which is
// absent from 8 of 10 packs' particle maps. A bomb burst ('#ff8a1e') or a
// jackpot burst (4-line clear / new best) returns undefined -> drawImage
// (undefined) throws inside draw() -> frame() never re-schedules rAF ->
// the game freezes forever with the last frame on screen.
// The fix: burst colours are pre-rendered in every pack's particle maps
// and the fallback is gold ('#ffd21f', always a map key); the particle
// loop also skips a falsy sprite instead of throwing.
// This probe FAILS on old code by construction (scenario A returns
// undefined lookups; B/C throw a pageerror) and PASSES on fixed code.
// Run: node tests/crayon-repro.mjs   (own port 8920)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let chromium;
for (const cand of [process.env.PLAYWRIGHT_MODULE, 'playwright', '/home/hatch/.cache/giil/node_modules/playwright/index.mjs']) {
  if (!cand) continue;
  try { ({ chromium } = await import(cand)); break; } catch { /* try next */ }
}
if (!chromium) throw new Error('Playwright not found');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'game-proto');
const PORT = 8920;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  if (!p.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(p, (e, data) => {
    if (e) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(PORT, r));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromiumPath = process.env.CHROMIUM_PATH
  || ['/home/hatch/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({
  ...(chromiumPath ? { executablePath: chromiumPath } : {}),
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
});

const errors = [];
let bug = null;
function fail(kind, detail) {
  if (bug) return;
  bug = { kind, detail };
  console.log('BUG FOUND:', kind, JSON.stringify(detail).slice(0, 2000));
}

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => { errors.push('pageerror: ' + e.message); if (!bug) fail('pageerror', { message: e.message }); });
  // xp 1500 = Player Level 5 -> Crayon Box unlocked; tutorial done.
  await page.addInitScript(() => { localStorage.setItem('gb_tut_done', '1'); localStorage.setItem('gb_xp', '1500'); });
  await page.goto(`http://localhost:${PORT}/?test=1`);
  await page.waitForSelector('#btn-play');
  return { ctx, page };
}
async function waitFor(fn, timeout = 8000, label = 'condition') {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - t0 > timeout) throw new Error('timeout waiting for ' + label);
    await sleep(120);
  }
}
const st = (page) => page.evaluate(() => window.__gb.state());
const L = (page) => page.evaluate(() => window.__gb.layout());
async function startGame(page) {
  await page.evaluate(() => window.__gb.startGame('classic'));
  await waitFor(async () => (await page.evaluate(() => window.__gb.state().running)), 5000, 'game running');
}
// (d) loop alive: timer must tick while running and unpaused.
async function assertLoopAlive(page, label) {
  const a = (await st(page)).timeLeft;
  await sleep(700);
  const b = (await st(page)).timeLeft;
  if (b >= a) {
    fail('loop-frozen', { label, timeBefore: a, timeAfter: b });
    await page.screenshot({ path: `tests/crayon-repro-frozen-${label}.png` });
    return false;
  }
  return true;
}
async function pxCount(page, x, y, w, h) {
  return page.evaluate(({ x, y, w, h }) => {
    const cv = document.querySelector('#cv');
    const dpr = window.devicePixelRatio || 1;
    const g = cv.getContext('2d');
    const d = g.getImageData(Math.round(x * dpr), Math.round(y * dpr), Math.max(1, Math.round(w * dpr)), Math.max(1, Math.round(h * dpr))).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 10) n++;
    return n;
  }, { x, y, w, h });
}

// Every colour burst()/jackpotBurst() can emit, plus the equipped pack's.
const BURST_COLORS = ['#ff8a1e', '#ff5da2', '#2f8cff', '#2fd65a', '#ffd21f', '#ffffff'];
async function lookupCheck(page, colors, label) {
  return page.evaluate(async (colors) => {
    const { Sprites } = await import('/js/sprites.js');
    const bad = [];
    for (const c of colors) {
      if (!Sprites.confetti(c)) bad.push('confetti:' + c);
      if (!Sprites.petal(c)) bad.push('petal:' + c);
      if (!Sprites.star(c)) bad.push('star:' + c);
    }
    return bad;
  }, colors).then((bad) => {
    if (bad.length) fail('sprite-lookup-undefined', { label, bad });
    return !bad.length;
  });
}

// --- Scenario A: lookup regression (fails on old code by construction) ---
console.log('--- scenario A: crayon-box sprite lookups ---');
{
  const { ctx, page } = await newPage();
  const ok = await page.evaluate(() => window.__gb.applyPack('crayon-box'));
  console.log('applyPack crayon-box:', ok);
  if (!ok) fail('setup', { msg: 'crayon-box refused at level 5' });
  else {
    const crayon = ['#e63946', '#f77f00', '#fcbf49', '#2a9d8f', '#277da1', '#7b2cbf', '#ef476f'];
    await lookupCheck(page, [...BURST_COLORS, ...crayon], 'crayon-box');
  }
  console.log(errors.length ? 'errors: ' + JSON.stringify(errors.slice(0, 3)) : 'no errors');
  await ctx.close();
}

// --- Scenario B: bomb burst end-to-end with Crayon Box ---
console.log('--- scenario B: bomb burst, crayon-box equipped ---');
if (!bug) {
  const { ctx, page } = await newPage();
  await page.evaluate(() => window.__gb.applyPack('crayon-box'));
  await startGame(page);
  await page.evaluate(() => window.__gb.setCharges({ bomb: 1, sweep: 0, reshuffle: 0, star: 0 }));
  await page.evaluate(() => window.__gb.setTimeLeft(120));
  await page.evaluate(() => window.__gb.armPowerup('bomb'));
  await page.evaluate(() => window.__gb.targetCell(4, 4));
  await sleep(2000); // burst particles live <= 1.6s; a throw kills the loop at once
  if (errors.length) fail('pageerror-during-bomb', { errors: errors.slice(-3) });
  else {
    const s = await st(page);
    console.log(`after bomb: running=${s.running} score=${s.score} charges=${JSON.stringify(s.charges)}`);
    await assertLoopAlive(page, 'bomb');
    const lay = await L(page);
    const n = await pxCount(page, lay.bx, lay.by, lay.size, lay.size);
    if (n < 200) fail('board-not-painted-after-bomb', { px: n });
  }
  await ctx.close();
}

// --- Scenario C: jackpot burst (4-line clear) end-to-end, Crayon Box ---
console.log('--- scenario C: jackpot burst (4-line clear), crayon-box equipped ---');
if (!bug) {
  const { ctx, page } = await newPage();
  await page.evaluate(() => window.__gb.applyPack('crayon-box'));
  await startGame(page);
  await page.evaluate(() => window.__gb.setTimeLeft(120));
  await page.evaluate(() => window.__gb.setBoard(['########', '########', '########', '########', '........', '........', '........', '........']));
  await page.evaluate(() => window.__gb.setTray([0])); // single-cell piece
  await page.evaluate(() => window.__gb.place(0, 4, 0));
  await sleep(2000);
  if (errors.length) fail('pageerror-during-jackpot', { errors: errors.slice(-3) });
  else {
    const s = await st(page);
    console.log(`after jackpot: running=${s.running} score=${s.score} lines=${s.lines}`);
    if (s.score <= 0) fail('setup', { msg: '4-line clear did not fire (score 0) — jackpot not exercised' });
    else await assertLoopAlive(page, 'jackpot');
  }
  await ctx.close();
}

// --- Scenario D: all 10 packs resolve every burst colour ---
console.log('--- scenario D: all-packs sprite lookup sweep ---');
if (!bug) {
  const { ctx, page } = await newPage();
  const slugs = await page.evaluate(() => window.__gb.cosmeticsState().packs.map((p) => p.slug));
  for (const slug of slugs) {
    const ok = await page.evaluate((s) => window.__gb.previewPack(s), slug);
    if (!ok) { fail('setup', { msg: 'previewPack refused for ' + slug }); break; }
    const mat = (await st(page)).packMaterial;
    // Resolve the pack's own colours via the cosmetics registry in-page.
    const packColors = await page.evaluate(async (slug) => {
      const { PACKS } = await import('/js/cosmetics.js');
      return PACKS.find((p) => p.slug === slug).colors;
    }, slug);
    console.log(`  ${slug} (material ${mat}): checking ${packColors.length + BURST_COLORS.length} colours`);
    if (!(await lookupCheck(page, [...BURST_COLORS, ...packColors], slug))) break;
    if (errors.length) { fail('pageerror-during-sweep', { slug, errors: errors.slice(-3) }); break; }
  }
  await ctx.close();
}

console.log(bug ? `RESULT: BUG REPRODUCED (${bug.kind})` : 'RESULT: no bug reproduced — fix holds');
console.log('page errors:', JSON.stringify(errors.slice(0, 5)));
await browser.close();
await new Promise((r) => server.close(r));
process.exit(bug ? 1 : 0);
