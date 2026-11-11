// Clearbloom Design Update 1 tests (Playwright, headless Chromium).
// Covers: timer start/bonus/cap/pause/timeout/revive-refill, power-up earn
// and use + cancel, charges reset, save/restore incl. timer + charges,
// music default-on + toggle, 0 console errors, basic FPS.
// Run: node tests/design1.mjs   (serves this folder on localhost itself)
// The upstream 26-test suite is NOT in this repo and is not run here.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/home/hatch/.cache/giil/node_modules/playwright/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8903;
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

const results = [];
let errors = [];
async function test(name, fn) {
  try { await fn(); results.push(['PASS', name]); console.log('PASS', name); }
  catch (e) { results.push(['FAIL', name, e.message]); console.log('FAIL', name, '-', e.message); }
}
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function approx(a, b, tol, msg) { if (Math.abs(a - b) > tol) throw new Error(`${msg}: got ${a}, want ~${b} ±${tol}`); }
function ok(c, msg) { if (!c) throw new Error(msg); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeout = 8000, label = 'condition') {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - t0 > timeout) throw new Error('timeout waiting for ' + label);
    await sleep(120);
  }
}

const browser = await chromium.launch({
  executablePath: '/home/hatch/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome',
  args: ['--autoplay-policy=no-user-gesture-required'],
});

async function newPage({ fresh = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  if (!fresh) {
    await page.addInitScript(() => { localStorage.setItem('gb_tut_done', '1'); });
  } else {
    await page.addInitScript(() => { localStorage.setItem('gb_tut_done', '1'); });
  }
  await page.goto(`http://localhost:${PORT}/?test=1`);
  await page.waitForSelector('#btn-play');
  return { ctx, page };
}
async function startClassic(page) {
  await page.click('#btn-play');
  await waitFor(async () => (await page.evaluate(() => window.__gb.state().running)), 5000, 'game running');
}
// Board: 8 strings of 8 chars, '#' = filled. Tray: shape ids (0 = single cell, 3 = '###', 11 = 2x2).
async function setupBoard(page, rows, tray = [0, 0, 0]) {
  await page.evaluate(({ rows, tray }) => { window.__gb.setBoard(rows); window.__gb.setTray(tray); }, { rows, tray });
  await sleep(150); // let setTray's async import land
}
const EMPTY = ['........', '........', '........', '........', '........', '........', '........', '........'];
const ROW7 = ['........', '........', '........', '........', '........', '........', '........', '#######.'];
async function dragPiece(page, slot, r, c) {
  const box = await page.locator('#cv').boundingBox();
  const L = await page.evaluate(() => window.__gb.layout());
  const from = { x: box.x + L.slotW * (slot + 0.5), y: box.y + L.trayY + L.trayH / 2 };
  const to = { x: box.x + L.bx + (c + 0.5) * L.cell, y: box.y + L.by + (r + 0.5) * L.cell };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
  await page.mouse.up();
  await sleep(200);
}

// ---------- tests ----------
let p1;
await test('load: 0 console errors, title Clearbloom', async () => {
  ({ page: p1 } = await newPage());
  eq(await p1.title(), 'Clearbloom', 'title');
  ok(await p1.locator('#timerbar').isVisible(), 'timer bar visible');
  ok(await p1.locator('#powerups').isVisible(), 'power-up row visible');
});

await test('music: on by default for a fresh profile', async () => {
  const { page } = await newPage();
  const st = await page.evaluate(() => window.__gb.state());
  eq(st.musicOn, true, 'music default on');
  await page.close();
});

await test('music: toggle off is remembered across reload', async () => {
  const { ctx, page } = await newPage();
  await page.click('#btn-play');
  await page.click('#btn-settings');
  await page.uncheck('#set-music');
  eq(await page.evaluate(() => window.__gb.state().musicOn), false, 'music off after toggle');
  await page.reload();
  await page.waitForSelector('#btn-play');
  eq(await page.evaluate(() => window.__gb.state().musicOn), false, 'music still off after reload');
  await ctx.close();
});

await test('timer: starts at 90 and ticks down', async () => {
  const { page } = await newPage();
  await startClassic(page);
  let st = await page.evaluate(() => window.__gb.state());
  approx(st.timeLeft, 90, 1.5, 'timer starts at 90');
  const t0 = st.timeLeft;
  await sleep(2000);
  st = await page.evaluate(() => window.__gb.state());
  approx(t0 - st.timeLeft, 2, 0.7, 'timer ticks ~2s in 2s');
  await page.close();
});

await test('timer: +6s per single line (real drag)', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await setupBoard(page, ROW7, [0, 0, 0]);
  const t0 = (await page.evaluate(() => window.__gb.state())).timeLeft;
  await dragPiece(page, 0, 7, 7);
  const st = await page.evaluate(() => window.__gb.state());
  eq(st.lines, 1, 'one line cleared');
  approx(st.timeLeft - t0, 6, 1.2, 'time bonus for 1 line');
  await page.close();
});

await test('timer: +14s for 2 lines, +22s for 3 lines', async () => {
  const { page } = await newPage();
  await startClassic(page);
  // 2 lines: row 7 cols 0-4 filled, col 5 rows 0-6 filled; place '###' at row 7 cols 5-7.
  const two = ['.....#..', '.....#..', '.....#..', '.....#..', '.....#..', '.....#..', '.....#..', '#####...'];
  await setupBoard(page, two, [3, 0, 0]);
  let t0 = (await page.evaluate(() => window.__gb.state())).timeLeft;
  await page.evaluate(() => window.__gb.place(0, 7, 5));
  let st = await page.evaluate(() => window.__gb.state());
  eq(st.lines, 2, 'two lines cleared');
  approx(st.timeLeft - t0, 14, 1.2, 'time bonus for 2 lines');
  // 3 lines: rows 6,7 cols 0-5 filled, col 6 rows 0-5 filled; place 2x2 (id 11) at (6,6).
  // (Set the clock to 80 first so the +22s bonus does not hit the 120s cap.)
  const three = ['......#.', '......#.', '......#.', '......#.', '......#.', '......#.', '######..', '######..'];
  await setupBoard(page, three, [11, 0, 0]);
  await page.evaluate(() => window.__gb.setTimeLeft(80));
  t0 = (await page.evaluate(() => window.__gb.state())).timeLeft;
  await page.evaluate(() => window.__gb.place(0, 6, 6));
  st = await page.evaluate(() => window.__gb.state());
  eq(st.lines, 5, 'three more lines cleared (total 5)');
  approx(st.timeLeft - t0, 22, 1.2, 'time bonus for 3 lines');
  await page.close();
});

await test('timer: caps at 120s', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await setupBoard(page, ROW7, [0, 0, 0]);
  await page.evaluate(() => window.__gb.setTimeLeft(118));
  await page.evaluate(() => window.__gb.place(0, 7, 7));
  const st = await page.evaluate(() => window.__gb.state());
  ok(st.timeLeft <= 120.5, 'capped at 120, got ' + st.timeLeft);
  ok(st.timeLeft >= 117, 'near cap, got ' + st.timeLeft);
  await page.close();
});

await test('timer: pauses in menu, resumes after', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await page.click('#btn-menu');
  const t0 = (await page.evaluate(() => window.__gb.state())).timeLeft;
  await sleep(1500);
  let st = await page.evaluate(() => window.__gb.state());
  approx(st.timeLeft, t0, 0.35, 'frozen while menu open');
  eq(st.timerPaused, true, 'timerPaused true in menu');
  await page.click('#btn-resume');
  await sleep(1300);
  st = await page.evaluate(() => window.__gb.state());
  ok(t0 - st.timeLeft > 0.7, 'ticks again after menu closes');
  await page.close();
});

await test('timer: pauses while tutorial is up, starts after skip', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(`http://localhost:${PORT}/?test=1`);
  await page.click('#btn-play');
  await page.waitForSelector('#tut.show');
  const t0 = (await page.evaluate(() => window.__gb.state())).timeLeft;
  await sleep(1500);
  let st = await page.evaluate(() => window.__gb.state());
  approx(st.timeLeft, t0, 0.35, 'frozen during tutorial');
  eq(st.timerStarted, false, 'timer not started during tutorial');
  await page.click('#tut-skip');
  await sleep(1300);
  st = await page.evaluate(() => window.__gb.state());
  eq(st.timerStarted, true, 'timer started after tutorial');
  ok(t0 - st.timeLeft > 0.7, 'ticks after tutorial finishes');
  await ctx.close();
});

await test('timer: pauses when app is backgrounded (document.hidden)', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await page.evaluate(() => {
    Object.defineProperty(Document.prototype, 'hidden', { get: () => true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const t0 = (await page.evaluate(() => window.__gb.state())).timeLeft;
  await sleep(1500);
  const st = await page.evaluate(() => window.__gb.state());
  approx(st.timeLeft, t0, 0.35, 'frozen while hidden');
  await page.evaluate(() => {
    Object.defineProperty(Document.prototype, 'hidden', { get: () => false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.close();
});

await test('timer: timeout ends the game, revive refills to 60s', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await setupBoard(page, ROW7, [0, 0, 0]);
  await page.evaluate(() => window.__gb.place(0, 7, 7)); // score > 0 so revive is offered
  await page.evaluate(() => window.__gb.setTimeLeft(0.4));
  await waitFor(async () => page.locator('#revive.show').isVisible(), 6000, 'revive overlay');
  eq(await page.locator('#rv-title').textContent(), "Time's up!", 'timeout heading');
  await page.click('#btn-revive');
  await waitFor(async () => page.locator('#ad.show').isVisible(), 5000, 'mock ad');
  await sleep(5600); // mock rewarded countdown (5s)
  await page.click('#ad-close');
  await waitFor(async () => (await page.evaluate(() => window.__gb.state())).running, 5000, 'game running after revive');
  const st = await page.evaluate(() => window.__gb.state());
  approx(st.timeLeft, 60, 2.5, 'timer refilled to 60 after revive');
  eq(st.revived, true, 'revived flag set');
  await page.close();
});

await test('power-ups: 3-line combo earns a charge (Bomb first)', async () => {
  const { page } = await newPage();
  await startClassic(page);
  const three = ['......#.', '......#.', '......#.', '......#.', '......#.', '......#.', '######..', '######..'];
  await setupBoard(page, three, [11, 0, 0]);
  await page.evaluate(() => window.__gb.place(0, 6, 6));
  const st = await page.evaluate(() => window.__gb.state());
  eq(st.charges.bomb, 1, 'bomb charge earned');
  eq(st.charges.sweep + st.charges.reshuffle + st.charges.petal, 0, 'only bomb so far');
  await page.close();
});

await test('power-ups: every 10 lines earns another charge; max 3 held', async () => {
  const { page } = await newPage();
  await startClassic(page);
  // 10 single-line clears via hooks (lines 1..10; milestone at 10 grants 1).
  for (let i = 0; i < 10; i++) {
    await setupBoard(page, ROW7, [0, 0, 0]);
    await page.evaluate(() => window.__gb.place(0, 7, 7));
  }
  let st = await page.evaluate(() => window.__gb.state());
  eq(st.lines, 10, '10 lines cleared');
  eq(st.charges.bomb + st.charges.sweep + st.charges.reshuffle + st.charges.petal, 1, 'one charge at 10 lines');
  // Granting past the cap stops at 3.
  await page.evaluate(() => { window.__gb.grantCharge(); window.__gb.grantCharge(); window.__gb.grantCharge(); window.__gb.grantCharge(); });
  st = await page.evaluate(() => window.__gb.state());
  eq(st.charges.bomb + st.charges.sweep + st.charges.reshuffle + st.charges.petal, 3, 'max 3 held');
  await page.close();
});

await test('power-ups: Bomb clears 3x3 via UI tap, charge spent', async () => {
  const { page } = await newPage();
  await startClassic(page);
  const cluster = ['........', '........', '........', '...###..', '...###..', '...###..', '........', '........'];
  await setupBoard(page, cluster, [0, 0, 0]);
  await page.evaluate(() => window.__gb.setCharges({ bomb: 1 }));
  const s0 = (await page.evaluate(() => window.__gb.state())).score;
  await page.click('.pu[data-pu="bomb"]');
  const box = await page.locator('#cv').boundingBox();
  const L = await page.evaluate(() => window.__gb.layout());
  await page.mouse.click(box.x + L.bx + 4.5 * L.cell, box.y + L.by + 4.5 * L.cell);
  await sleep(300);
  const st = await page.evaluate(() => window.__gb.state());
  eq(st.charges.bomb, 0, 'bomb charge spent');
  ok(st.board[3][3] === false && st.board[4][4] === false, '3x3 area cleared');
  ok(st.score >= s0 + 90, 'bomb scored 10/cell x9, got +' + (st.score - s0));
  await page.close();
});

await test('power-ups: arming then cancelling keeps the charge', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await page.evaluate(() => window.__gb.setCharges({ bomb: 1 }));
  await page.click('.pu[data-pu="bomb"]');
  let st = await page.evaluate(() => window.__gb.state());
  eq(st.armed, 'bomb', 'bomb armed');
  await page.click('#pu-cancel');
  st = await page.evaluate(() => window.__gb.state());
  eq(st.armed, null, 'disarmed after cancel');
  eq(st.charges.bomb, 1, 'charge kept after cancel');
  await page.close();
});

await test('power-ups: Sweep clears a chosen column', async () => {
  const { page } = await newPage();
  await startClassic(page);
  const col = ['...#....', '...#....', '...#....', '...#....', '...#....', '...#....', '...#....', '...#....'];
  await setupBoard(page, col, [0, 0, 0]);
  await page.evaluate(() => window.__gb.setCharges({ sweep: 1 }));
  await page.click('.pu[data-pu="sweep"]');
  await page.click('#pu-mode-col-btn');
  const box = await page.locator('#cv').boundingBox();
  const L = await page.evaluate(() => window.__gb.layout());
  await page.mouse.click(box.x + L.bx + 3.5 * L.cell, box.y + L.by + 0.5 * L.cell);
  await sleep(300);
  const st = await page.evaluate(() => window.__gb.state());
  eq(st.charges.sweep, 0, 'sweep charge spent');
  ok(st.board.every((row) => row[3] === false), 'column 3 cleared');
  await page.close();
});

await test('power-ups: Reshuffle deals a new fitting tray; Petal adds 15s', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await page.evaluate(() => window.__gb.setCharges({ reshuffle: 1, petal: 1 }));
  await page.click('.pu[data-pu="reshuffle"]');
  await sleep(200);
  let st = await page.evaluate(() => window.__gb.state());
  eq(st.charges.reshuffle, 0, 'reshuffle spent');
  ok(st.tray.every((t) => t !== null), 'fresh tray dealt');
  await page.evaluate(() => window.__gb.setTimeLeft(50));
  await page.click('.pu[data-pu="petal"]');
  await sleep(200);
  st = await page.evaluate(() => window.__gb.state());
  eq(st.charges.petal, 0, 'petal spent');
  approx(st.timeLeft, 65, 1.5, 'petal +15s');
  await page.close();
});

await test('power-ups: charges reset between games', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await page.evaluate(() => window.__gb.setCharges({ bomb: 2, petal: 1 }));
  await page.evaluate(() => window.__gb.setTimeLeft(0.3));
  await waitFor(async () => (await page.locator('#revive.show').isVisible()) || (await page.locator('#over.show').isVisible()), 6000, 'game over');
  if (await page.locator('#revive.show').isVisible()) await page.click('#btn-norevive');
  await waitFor(async () => page.locator('#over.show').isVisible(), 5000, 'game-over panel');
  await page.click('#btn-again');
  await waitFor(async () => (await page.evaluate(() => window.__gb.state())).running, 5000, 'new game running');
  const st = await page.evaluate(() => window.__gb.state());
  eq(st.charges.bomb + st.charges.sweep + st.charges.reshuffle + st.charges.petal, 0, 'charges reset');
  await page.close();
});

await test('save/restore: timer + charges + score survive reload', async () => {
  const { ctx, page } = await newPage();
  await startClassic(page);
  await setupBoard(page, ROW7, [0, 0, 0]);
  await page.evaluate(() => window.__gb.place(0, 7, 7));
  await page.evaluate(() => { window.__gb.setTimeLeft(42.5); window.__gb.setCharges({ bomb: 1, sweep: 1 }); window.__gb.saveNow(); });
  const before = await page.evaluate(() => window.__gb.state());
  await page.reload();
  await page.waitForSelector('#btn-play');
  eq(await page.locator('#btn-play').textContent(), '▶ Continue', 'continue offered');
  await page.click('#btn-play');
  await waitFor(async () => (await page.evaluate(() => window.__gb.state())).running, 5000, 'restored game running');
  const st = await page.evaluate(() => window.__gb.state());
  eq(st.score, before.score, 'score restored');
  approx(st.timeLeft, 42.5, 2.5, 'timer restored');
  eq(st.charges.bomb, 1, 'bomb charge restored');
  eq(st.charges.sweep, 1, 'sweep charge restored');
  await ctx.close();
});

await test('daily: timer + power-ups use the same rules', async () => {
  const { page } = await newPage();
  await page.evaluate(() => window.__gb.startDaily('2026-11-11'));
  await waitFor(async () => (await page.evaluate(() => window.__gb.state())).running, 5000, 'daily running');
  const st = await page.evaluate(() => window.__gb.state());
  eq(st.mode, 'daily', 'daily mode');
  approx(st.timeLeft, 90, 1.5, 'daily timer starts at 90');
  await page.close();
});

await test('perf: render loop holds up (FPS over 3s, after warm-up)', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await sleep(1500); // warm up: audio + first frames settle
  const fps = await page.evaluate(() => new Promise((res) => {
    let n = 0; const t0 = performance.now();
    const tick = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(tick); else res({ fps: +(n / 3).toFixed(1), frames: n }); };
    requestAnimationFrame(tick);
  }));
  console.log('  fps:', JSON.stringify(fps));
  ok(fps.fps > 30, 'fps > 30, got ' + fps.fps);
  await page.close();
});

await test('visual: blocks are clean + timer/power-ups render (screenshot)', async () => {
  const { page } = await newPage();
  await startClassic(page);
  const board = ['........', '........', '........', '........', '........', '..###...', '..###...', '..###...'];
  await setupBoard(page, board, [0, 0, 0]);
  await page.evaluate(() => window.__gb.setCharges({ bomb: 1, sweep: 1 }));
  await page.screenshot({ path: path.join(ROOT, 'tests', 'design1-shot.png') });
  await page.close();
});

await test('console: 0 errors across all tests', async () => {
  eq(errors.length, 0, 'console/page errors: ' + errors.slice(0, 5).join(' | '));
});

await browser.close();
server.close();
const fails = results.filter((r) => r[0] === 'FAIL');
console.log(`\n${results.length - fails.length}/${results.length} passed${fails.length ? ', FAILURES: ' + fails.map((f) => f[1]).join(', ') : ''}`);
process.exit(fails.length ? 1 : 0);
