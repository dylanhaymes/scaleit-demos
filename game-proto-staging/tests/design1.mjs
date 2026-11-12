// Clearbloom Design Update 5 tests (timer 120/150, countdown, levels, XP, power-up rings, icons, fonts, reduced motion) (Playwright, headless Chromium).
// Covers: timer start/bonus/cap/pause/timeout/revive-refill, power-up earn
// and use + cancel, charges reset, save/restore incl. timer + charges,
// music default-on + toggle, 0 console errors, basic FPS.
// Run: node tests/design1.mjs   (serves this folder on localhost itself)
// The upstream 26-test suite is NOT in this repo and is not run here.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Playwright resolution (portable — no machine-specific path required):
// PLAYWRIGHT_MODULE env var, a local `playwright` install, or the shared
// cache fallback. Same for the browser binary: CHROMIUM_PATH, a known
// cache location that exists, or Playwright's own default.
let chromium;
for (const cand of [process.env.PLAYWRIGHT_MODULE, 'playwright', '/home/hatch/.cache/giil/node_modules/playwright/index.mjs']) {
  if (!cand) continue;
  try { ({ chromium } = await import(cand)); break; } catch { /* try next */ }
}
if (!chromium) throw new Error('Playwright not found: set PLAYWRIGHT_MODULE or install playwright');

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

const chromiumPath = process.env.CHROMIUM_PATH
  || ['/home/hatch/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({
  ...(chromiumPath ? { executablePath: chromiumPath } : {}),
  // --no-sandbox: required on this VM — the Chromium sandbox dies with
  // SIGTRAP (rc=133) under the VM's seccomp/NoNewPrivs filter.
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
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
  await sleep(150); // let the frame settle
}
const EMPTY = ['........', '........', '........', '........', '........', '........', '........', '........'];
const ROW7 = ['........', '........', '........', '........', '........', '........', '........', '#######.'];
async function dragPiece(page, slot, r, c) {
  const box = await page.locator('#cv').boundingBox();
  const L = await page.evaluate(() => window.__gb.layout());
  const from = { x: box.x + L.trayX + L.slotW * (slot + 0.5), y: box.y + L.trayY + L.trayH / 2 };
  const to = { x: box.x + L.bx + (c + 0.5) * L.cell, y: box.y + L.by + (r + 0.5) * L.cell };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
  await page.mouse.up();
  await sleep(200);
}
// Like dragPiece, but drops the piece's centre on an exact canvas point
// (px, py in canvas coordinates) instead of a cell centre.
async function dragToPoint(page, slot, px, py) {
  const box = await page.locator('#cv').boundingBox();
  const L = await page.evaluate(() => window.__gb.layout());
  const from = { x: box.x + L.trayX + L.slotW * (slot + 0.5), y: box.y + L.trayY + L.trayH / 2 };
  const to = { x: box.x + px, y: box.y + py };
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
  await page.click('#btn-menu');
  await page.click('#btn-menu-settings');
  await page.uncheck('#set-music');
  eq(await page.evaluate(() => window.__gb.state().musicOn), false, 'music off after toggle');
  await page.reload();
  await page.waitForSelector('#btn-play');
  eq(await page.evaluate(() => window.__gb.state().musicOn), false, 'music still off after reload');
  await ctx.close();
});

await test('audio: title sound button shows the mute state and toggles both', async () => {
  const { ctx, page } = await newPage();
  // Fresh profile: sound on.
  eq(await page.locator('#btn-sound').getAttribute('aria-label'), 'Sound on — tap to mute', 'fresh profile shows sound on');
  // A returning player with both toggles off sees it immediately on the title.
  await page.evaluate(() => { localStorage.setItem('gb_music', '0'); localStorage.setItem('gb_sfx', '0'); });
  await page.reload();
  await page.waitForSelector('#btn-play');
  eq(await page.locator('#btn-sound').getAttribute('aria-label'), 'Sound off — tap to unmute', 'muted profile shows sound off');
  // One tap turns both back on, and it sticks across reload.
  await page.click('#btn-sound');
  let st = await page.evaluate(() => window.__gb.state());
  eq(st.musicOn, true, 'music back on');
  eq(st.sfxMuted, false, 'sfx back on');
  eq(await page.locator('#btn-sound').getAttribute('aria-label'), 'Sound on — tap to mute', 'button shows sound on again');
  await page.reload();
  await page.waitForSelector('#btn-play');
  eq(await page.evaluate(() => window.__gb.state().musicOn), true, 'music still on after reload');
  await ctx.close();
});

await test('audio: unlocks on Play — context running, music schedules, SFX live', async () => {
  // A second browser WITHOUT --autoplay-policy, so the real user-gesture
  // path is exercised (the suite browser's flag auto-resumes contexts and
  // would hide an unlock bug).
  const browser2 = await chromium.launch({
    ...(chromiumPath ? { executablePath: chromiumPath } : {}),
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  try {
    const ctx2 = await browser2.newContext({ viewport: { width: 390, height: 844 } });
    const page2 = await ctx2.newPage();
    page2.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page2.addInitScript(() => { localStorage.setItem('gb_tut_done', '1'); });
    await page2.goto(`http://localhost:${PORT}/?test=1`);
    await page2.waitForSelector('#btn-play');
    let st = await page2.evaluate(() => window.__gb.state());
    eq(st.audioState, 'none', 'no audio context before the first gesture');
    eq(st.musicOn, true, 'music on by default');
    eq(st.sfxMuted, false, 'sfx on by default');
    await page2.click('#btn-play');
    await sleep(1200);
    st = await page2.evaluate(() => window.__gb.state());
    eq(st.audioState, 'running', 'context running after the Play tap');
    ok(st.musicScheduler, 'music scheduler is running');
    ok(st.musicScheduled > 0, 'music has scheduled notes, got ' + st.musicScheduled);
    const s1 = st.musicScheduled;
    await sleep(1500);
    st = await page2.evaluate(() => window.__gb.state());
    ok(st.musicScheduled > s1, 'music keeps scheduling (' + s1 + ' -> ' + st.musicScheduled + ')');
    ok(st.audioTime > 1, 'audio clock is advancing, got ' + st.audioTime);
    // A real SFX (place a piece) fires without error and leaves audio running.
    await page2.evaluate(() => { window.__gb.setBoard(['........', '........', '........', '........', '........', '........', '........', '........']); window.__gb.setTray([0, 0, 0]); });
    await sleep(150);
    await page2.evaluate(() => window.__gb.place(0, 0, 0));
    await sleep(300);
    st = await page2.evaluate(() => window.__gb.state());
    eq(st.audioState, 'running', 'context still running after an SFX');
    await ctx2.close();
  } finally {
    await browser2.close();
  }
});

await test('timer: starts at 120 and ticks down', async () => {
  const { page } = await newPage();
  await startClassic(page);
  let st = await page.evaluate(() => window.__gb.state());
  approx(st.timeLeft, 120, 1.5, 'timer starts at 120');
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

await test('dropCell: piece dropped exactly on a cell-centre boundary lands in the intended cell', async () => {
  const { page } = await newPage();
  await startClassic(page);
  // '##' (shape id 1) on an empty board. Drag its centre exactly onto the
  // centre of cell (row 0, col 3): the piece's top-left quotient is then
  // exactly 2.5 in column, so it must round UP to col 3 (cells 3-4). Float
  // noise reading 2.4999999 would silently land it on cols 2-3 instead.
  await setupBoard(page, EMPTY, [1, 0, 0]);
  const L = await page.evaluate(() => window.__gb.layout());
  await dragToPoint(page, 0, L.bx + 3.5 * L.cell, L.by + 0.5 * L.cell);
  const st = await page.evaluate(() => window.__gb.state());
  eq(st.placed, 1, 'piece placed');
  eq(st.board[0][2], false, 'col 2 stays empty');
  eq(st.board[0][3], true, 'col 3 filled');
  eq(st.board[0][4], true, 'col 4 filled');
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
  // (Set the clock to 80 first so the +22s bonus does not hit the 150s cap.)
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

await test('timer: caps at 150s', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await setupBoard(page, ROW7, [0, 0, 0]);
  await page.evaluate(() => window.__gb.setTimeLeft(148));
  await page.evaluate(() => window.__gb.place(0, 7, 7));
  const st = await page.evaluate(() => window.__gb.state());
  ok(st.timeLeft <= 150.5, 'capped at 150, got ' + st.timeLeft);
  ok(st.timeLeft >= 147, 'near cap, got ' + st.timeLeft);
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

await test('tutorial: pauses while up; skip returns to menu, not into a game', async () => {
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
  eq(st.tutorialStep, 0, 'tutorial on step 0');
  await page.click('#tut-skip');
  await waitFor(async () => page.locator('#title.show').isVisible(), 3000, 'back at the menu after skip');
  st = await page.evaluate(() => window.__gb.state());
  eq(st.running, false, 'no game running after skip');
  eq(st.tutorialStep, -1, 'tutorial closed after skip');
  eq(await page.evaluate(() => localStorage.getItem('gb_tut_done')), '1', 'skip marks the tutorial done');
  await ctx.close();
});

await test('tutorial: shown once — after skip, Play starts a real game', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(`http://localhost:${PORT}/?test=1`);
  await page.click('#btn-play');
  await page.waitForSelector('#tut.show');
  await page.click('#tut-skip');
  await waitFor(async () => page.locator('#title.show').isVisible(), 3000, 'back at the menu after skip');
  await page.click('#btn-play');
  await waitFor(async () => (await page.evaluate(() => window.__gb.state().running)), 5000, 'real game running');
  eq(await page.locator('#tut.show').count(), 0, 'tutorial not shown again');
  eq((await page.evaluate(() => window.__gb.state())).tutorialStep, -1, 'no tutorial step in the real game');
  await ctx.close();
});

await test('tutorial: scripted walkthrough plays through to a fresh real game', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(`http://localhost:${PORT}/?test=1`);
  await page.click('#btn-play');
  await page.waitForSelector('#tut.show');
  const st0 = await page.evaluate(() => window.__gb.state());
  eq(st0.tutorialStep, 0, 'tutorial starts on step 0');
  eq(await page.locator('#tut-text').textContent(), 'Drag this piece onto the highlighted squares.', 'step 1 caption');
  eq(st0.timerStarted, false, 'timer paused during the walkthrough');
  // A wrong drop snaps back: board + tray + step unchanged.
  await dragPiece(page, 0, 0, 0);
  let st = await page.evaluate(() => window.__gb.state());
  eq(st.tutorialStep, 0, 'wrong drop does not advance');
  ok(st.board.every((row) => row.every((v) => !v)), 'wrong drop places nothing');
  ok(st.tray[0], 'wrong drop keeps the piece in the tray');
  // The other tray slots are locked: no drag starts from slot 1.
  await dragPiece(page, 1, 7, 3);
  st = await page.evaluate(() => window.__gb.state());
  eq(st.tutorialStep, 0, 'locked slot does not advance');
  ok(st.board.every((row) => row.every((v) => !v)), 'locked slot places nothing');
  // Settings and menu stay locked during the walkthrough (the gear is gone:
  // the hamburger is the single top-right control, and it is locked too).
  await page.click('#btn-menu');
  eq(await page.locator('#menu.show').count(), 0, 'menu locked during tutorial');
  eq(await page.locator('#settings.show').count(), 0, 'settings locked during tutorial');
  // Step 1: the right drop advances (2-wide piece, aim at the centre of the two highlighted cells).
  let L = await page.evaluate(() => window.__gb.layout());
  await dragToPoint(page, 0, L.bx + 4 * L.cell, L.by + 7.5 * L.cell);
  st = await page.evaluate(() => window.__gb.state());
  eq(st.tutorialStep, 1, 'correct drop advances to step 1');
  ok(st.board[7][3] && st.board[7][4], 'step 1 piece placed on the highlighted cells');
  eq(await page.locator('#tut-text').textContent(), 'Fill a whole row or column to clear it.', 'step 2 caption');
  // Step 2: complete the row — it clears.
  await dragPiece(page, 0, 7, 7);
  st = await page.evaluate(() => window.__gb.state());
  eq(st.tutorialStep, 2, 'line clear advances to step 2');
  eq(st.lines, 1, 'one line cleared');
  // The clear itself is proven by lines === 1. By the time we read state,
  // the tutorial has already advanced and applied the step-3 board, whose
  // row 7 holds exactly one pre-filled cell at (7,3) — so the row is NOT
  // empty anymore; assert the step-3 board instead.
  eq(st.board[7].filter(Boolean).length, 1, 'step 3 board pre-fills one cell in row 7');
  ok(st.board[7][3], 'pre-filled cell is (7,3)');
  eq(await page.locator('#tut-text').textContent(), 'Clear more than one at a time for a combo.', 'step 3 caption');
  // Step 3: one cell completes a row AND a column — a combo. The TIME bar
  // is spotlighted for the next (time) step.
  await dragPiece(page, 0, 6, 3);
  st = await page.evaluate(() => window.__gb.state());
  eq(st.tutorialStep, 3, 'combo advances to step 3');
  eq(st.lines, 3, 'three lines cleared in total');
  eq(st.combo, 2, 'combo is 2 after the double clear');
  eq(await page.locator('#tut-text').textContent(), 'You have two minutes. Clearing lines adds time.', 'step 4 caption');
  eq(await page.locator('#timer-wrap.tut-spot').count(), 1, 'TIME bar spotlighted on the time step');
  // Step 4: clear a line and watch the TIME bar gain (120 +6 +14 +6 = 146).
  L = await page.evaluate(() => window.__gb.layout());
  await dragToPoint(page, 0, L.bx + 6 * L.cell, L.by + 5.5 * L.cell);
  st = await page.evaluate(() => window.__gb.state());
  eq(st.tutorialStep, 4, 'time step advances to step 4');
  approx(st.timeLeft, 146, 0.6, 'timer gained from the clears');
  eq(await page.locator('#tut-text').textContent(), 'Earn power-ups with a 3-line combo, or every 10 lines.', 'step 5 caption');
  // Step 5: the dock itself is spotlighted; tap the star slot to finish.
  eq(await page.locator('#powerups.tut-spot').count(), 1, 'dock spotlighted on the power-up step');
  ok(await page.locator('#tut-arrow:not(.hidden)').isVisible(), 'arrow points at the dock');
  eq(st.charges.star, 1, 'scripted Time Star charge in the dock');
  await page.click('#powerups .pu[data-pu="star"]');
  ok(await page.locator('#tut-done:not(.hidden)').isVisible(), '"Nice! You\'re ready." moment shows');
  await sleep(1600);
  st = await page.evaluate(() => window.__gb.state());
  eq(st.tutorialStep, -1, 'tutorial closed after finishing');
  eq(st.running, true, 'fresh real game running after the tutorial');
  eq(st.timerStarted, true, 'timer started in the real game');
  ok(st.board.every((row) => row.every((v) => !v)), 'real game starts on a fresh board');
  eq(st.tray.filter(Boolean).length, 3, 'real game deals a normal 3-piece tray');
  eq(await page.evaluate(() => localStorage.getItem('gb_tut_done')), '1', 'tutorial marked done');
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
  eq(st.charges.sweep + st.charges.reshuffle + st.charges.star, 0, 'only bomb so far');
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
  eq(st.charges.bomb + st.charges.sweep + st.charges.reshuffle + st.charges.star, 1, 'one charge at 10 lines');
  // Granting past the cap stops at 3.
  await page.evaluate(() => { window.__gb.grantCharge(); window.__gb.grantCharge(); window.__gb.grantCharge(); window.__gb.grantCharge(); });
  st = await page.evaluate(() => window.__gb.state());
  eq(st.charges.bomb + st.charges.sweep + st.charges.reshuffle + st.charges.star, 3, 'max 3 held');
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

await test('feedback 3: arming a power-up never moves the board; one glossy chip, no toast', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await page.evaluate(() => window.__gb.setCharges({ bomb: 1, sweep: 1 }));
  const before = await page.evaluate(() => window.__gb.layout());
  await page.click('.pu[data-pu="bomb"]');
  await sleep(300);
  // The reserved slot is always in the layout: board geometry identical.
  const armed = await page.evaluate(() => window.__gb.layout());
  eq(armed.size, before.size, 'board size unchanged when armed');
  eq(armed.cell, before.cell, 'board cell unchanged when armed');
  eq(armed.by, before.by, 'board top unchanged when armed');
  eq(armed.trayY, before.trayY, 'tray top unchanged when armed');
  // One descriptor: the chip is visible, the dark toast pill is not.
  ok(await page.locator('#pu-target:not(.off)').isVisible(), 'descriptor slot is on when armed');
  eq(await page.locator('#pu-hint').textContent(), 'Tap a cell — 3x3 blast!', 'bomb chip text');
  ok(await page.locator('#pu-cancel').isVisible(), 'Cancel is visible on the chip');
  eq(await page.locator('#toast.show').count(), 0, 'no dark toast pill on arm');
  // Cancel: slot hides (visibility, box kept), geometry still identical.
  await page.click('#pu-cancel');
  await sleep(200);
  eq(await page.locator('#pu-target.off').count(), 1, 'slot off after cancel');
  const after = await page.evaluate(() => window.__gb.layout());
  eq(after.size, before.size, 'board size unchanged after cancel');
  // Sweep arming shows the Row/Column buttons inside the same chip.
  await page.click('.pu[data-pu="sweep"]');
  await sleep(300);
  ok(await page.locator('#pu-mode:not(.hidden)').isVisible(), 'sweep chip shows Row/Column');
  eq(await page.locator('#pu-hint').textContent(), 'Tap a cell:', 'sweep chip text');
  const armed2 = await page.evaluate(() => window.__gb.layout());
  eq(armed2.size, before.size, 'board size unchanged when sweep armed');
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

await test('power-ups: Reshuffle deals a new fitting tray; Time Star adds 15s', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await page.evaluate(() => window.__gb.setCharges({ reshuffle: 1, star: 1 }));
  await page.click('.pu[data-pu="reshuffle"]');
  await sleep(200);
  let st = await page.evaluate(() => window.__gb.state());
  eq(st.charges.reshuffle, 0, 'reshuffle spent');
  ok(st.tray.every((t) => t !== null), 'fresh tray dealt');
  await page.evaluate(() => window.__gb.setTimeLeft(50));
  await page.click('.pu[data-pu="star"]');
  await sleep(200);
  st = await page.evaluate(() => window.__gb.state());
  eq(st.charges.star, 0, 'star spent');
  approx(st.timeLeft, 65, 1.5, 'star +15s');
  await page.close();
});

await test('power-ups: charges reset between games', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await page.evaluate(() => window.__gb.setCharges({ bomb: 2, star: 1 }));
  await page.evaluate(() => window.__gb.setTimeLeft(0.3));
  await waitFor(async () => (await page.locator('#revive.show').isVisible()) || (await page.locator('#over.show').isVisible()), 6000, 'game over');
  if (await page.locator('#revive.show').isVisible()) await page.click('#btn-norevive');
  await waitFor(async () => page.locator('#over.show').isVisible(), 5000, 'game-over panel');
  await page.click('#btn-again');
  await waitFor(async () => (await page.evaluate(() => window.__gb.state())).running, 5000, 'new game running');
  const st = await page.evaluate(() => window.__gb.state());
  eq(st.charges.bomb + st.charges.sweep + st.charges.reshuffle + st.charges.star, 0, 'charges reset');
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
  approx(st.timeLeft, 120, 1.5, 'daily timer starts at 120');
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

await test('update2 music: 120 BPM, 96s deterministic loop', async () => {
  const { page } = await newPage();
  await startClassic(page);
  const st = await page.evaluate(() => window.__gb.state());
  eq(st.musicBpm, 120, 'music is 120 BPM');
  eq(st.musicLoopSeconds, 96, 'loop is 96 seconds (1.5-2 min)');
  ok(st.musicLoopEvents > 200, 'loop has events, got ' + st.musicLoopEvents);
  // Loop is built once from a fixed seed: two reads must agree exactly.
  const again = await page.evaluate(() => window.__gb.state().musicLoopEvents);
  eq(again, st.musicLoopEvents, 'loop is deterministic (clean seam by construction)');
  await page.close();
});

await test('update2 music: urgency shaker fades in under 20s, out above 20s', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await page.evaluate(() => window.__gb.setTimeLeft(21));
  await sleep(1800); // ticks below 20s naturally
  let st = await page.evaluate(() => window.__gb.state());
  eq(st.musicUrgency, true, 'urgency on under 20s');
  await page.evaluate(() => window.__gb.setTimeLeft(50));
  await sleep(300);
  st = await page.evaluate(() => window.__gb.state());
  eq(st.musicUrgency, false, 'urgency off again above 20s');
  await page.close();
});

await test('update2 music: 6s of playback with urgency, no errors', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await page.evaluate(() => window.__gb.setTimeLeft(19.5));
  await sleep(6000);
  const st = await page.evaluate(() => window.__gb.state());
  ok(st.running, 'game still running through music playback');
  await page.close();
});

await test('update2 sprites: pre-rendered, glossy blocks on canvas', async () => {
  const { page } = await newPage();
  await startClassic(page);
  const board = ['........', '........', '........', '........', '........', '..###...', '..###...', '..###...'];
  await setupBoard(page, board, [0, 0, 0]);
  const st = await page.evaluate(() => window.__gb.state());
  eq(st.spritesReady, true, 'sprites initialised');
  // The placed 3x3 block must actually paint coloured pixels on the canvas.
  const painted = await page.evaluate(() => {
    const cv = document.getElementById('cv');
    const L = window.__gb.layout();
    const x = Math.round(L.bx + 3.5 * L.cell), y = Math.round(L.by + 6.5 * L.cell);
    const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height;
    const g = c.getContext('2d'); g.drawImage(cv, 0, 0);
    const d = g.getImageData(x * (cv.width / cv.clientWidth), y * (cv.height / cv.clientHeight), 4, 4).data;
    let coloured = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 60 || d[i + 1] > 60 || d[i + 2] > 60) coloured++;
    return coloured;
  });
  ok(painted > 4, 'block pixels painted, got ' + painted + ' coloured samples');
  await page.screenshot({ path: path.join(ROOT, 'tests', 'design2-shot.png') });
  await page.close();
});

await test('update2 perf: FPS under 4x CPU throttling (DevTools-style)', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await sleep(1200);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const fps = await page.evaluate(() => new Promise((res) => {
    let n = 0; const t0 = performance.now();
    const tick = () => { n++; if (performance.now() - t0 < 4000) requestAnimationFrame(tick); else res({ fps: +(n / 4).toFixed(1), frames: n }); };
    requestAnimationFrame(tick);
  }));
  console.log('  fps @4x throttle:', JSON.stringify(fps));
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  ok(fps.fps > 12, 'fps > 12 under 4x throttle, got ' + fps.fps);
  await page.close();
});


await test('timer: 20s countdown lives on the timer row + ticks', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await page.evaluate(() => window.__gb.setTimeLeft(20.5));
  await waitFor(async () => page.locator('#countdown.on').isVisible(), 3000, 'countdown visible');
  eq(await page.locator('#countdown').getAttribute('data-secs'), '20', 'countdown shows 20');
  eq(await page.locator('#countdown').getAttribute('data-palette'), 'amber', 'amber palette above 5s');
  // The countdown sits inside the timer row and never overlaps the score.
  const boxes = await page.evaluate(() => {
    const r = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
    return { cd: r('countdown'), wrap: r('timer-wrap'), score: r('score') };
  });
  ok(Math.abs(boxes.cd.y - boxes.wrap.y) < 6, 'countdown vertically centred on the timer row');
  ok(boxes.cd.x >= boxes.wrap.x && boxes.cd.x + boxes.cd.w <= boxes.wrap.x + boxes.wrap.w, 'countdown inside the timer row');
  const overlap = boxes.cd.x < boxes.score.x + boxes.score.w && boxes.score.x < boxes.cd.x + boxes.cd.w
    && boxes.cd.y < boxes.score.y + boxes.score.h && boxes.score.y < boxes.cd.y + boxes.cd.h;
  ok(!overlap, 'countdown does not overlap the score');
  await sleep(1700);
  eq(await page.locator('#countdown').getAttribute('data-secs'), '19', 'countdown ticks to 19');
  const st = await page.evaluate(() => window.__gb.state());
  eq(st.musicUrgency, true, 'urgency on at 20s');
  eq(st.countdownVisible, true, 'countdown visible in state');
  await page.close();
});

await test('timer: countdown goes red in the last 5s, hides above 20s', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await page.evaluate(() => window.__gb.setTimeLeft(4.5));
  await waitFor(async () => page.locator('#countdown.on').isVisible(), 3000, 'countdown visible at 4s');
  eq(await page.locator('#countdown').getAttribute('data-palette'), 'red', 'red palette at 4s');
  eq(await page.locator('#countdown.urgent').count(), 1, 'urgent pulse in last 5s');
  await page.evaluate(() => window.__gb.setTimeLeft(30));
  await waitFor(async () => (await page.locator('#countdown.on').count()) === 0, 3000, 'countdown hides above 20s');
  await page.close();
});

await test('hero type: wordmark sprite on home, gold numerals for score + BEST', async () => {
  const { page } = await newPage();
  await page.waitForSelector('#btn-play');
  await waitFor(async () => (await page.evaluate(() => window.__gb.state().heroTypeReady)), 5000, 'hero type ready');
  const logo = await page.evaluate(() => {
    const img = document.querySelector('#logo-img');
    return img ? { data: img.src.startsWith('data:image/png'), w: img.naturalWidth, h: img.naturalHeight } : null;
  });
  ok(logo, 'logo is an <img> sprite');
  ok(logo.data, 'logo src is a data URL');
  ok(logo.w > 800, 'wordmark rendered sharp (naturalWidth > 800)');
  const score = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('#score img')];
    return { n: imgs.length, allData: imgs.every((i) => i.src.startsWith('data:image/png')) };
  });
  eq(score.n, 1, 'score 0 renders one numeral img');
  ok(score.allData, 'score numerals are data URLs');
  const best = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('#best img')];
    return { n: imgs.length, allData: imgs.every((i) => i.src.startsWith('data:image/png')) };
  });
  eq(best.n, 1, 'BEST 0 renders one numeral img');
  ok(best.allData, 'BEST numerals are data URLs');
  await page.close();
});

await test('hero type: score numerals track the score, combo shows a real star', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await setupBoard(page, ROW7, [0, 0, 0]);
  await page.evaluate(() => window.__gb.place(0, 7, 7)); // 1 line
  await setupBoard(page, ROW7, [0, 0, 0]);
  await page.evaluate(() => window.__gb.place(0, 7, 7)); // 2nd line -> combo 2
  await sleep(1200); // rolling score counter settles
  const st = await page.evaluate(() => window.__gb.state());
  eq(st.combo, 2, 'combo 2 after two quick line clears');
  const score = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('#score img')];
    return { n: imgs.length, allData: imgs.every((i) => i.src.startsWith('data:image/png')) };
  });
  eq(score.n, String(st.score).length, 'score numeral count matches the score digits');
  ok(score.allData, 'score numerals are data URLs');
  const combo = await page.evaluate(() => {
    const el = document.querySelector('#combo');
    return { star: !!el.querySelector('img.combo-star'), digits: el.querySelectorAll('img:not(.combo-star)').length, text: el.textContent };
  });
  ok(combo.star, 'combo line has a real 3D star img, not a unicode star');
  eq(combo.digits, 1, 'combo number renders as a numeral img');
  ok(combo.text.includes('Combo'), 'combo line still reads "Combo"');
  await page.close();
});

await test('hero type: game-over score is gold numerals', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await setupBoard(page, ROW7, [0, 0, 0]);
  await page.evaluate(() => window.__gb.place(0, 7, 7)); // score > 0
  await page.evaluate(() => window.__gb.setTimeLeft(0.3));
  await waitFor(async () => page.locator('#revive.show').isVisible(), 6000, 'revive overlay');
  await page.click('#btn-norevive');
  await waitFor(async () => page.locator('#over.show').isVisible(), 5000, 'game-over panel');
  const st = await page.evaluate(() => window.__gb.state());
  const ov = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('#ov-score img')];
    return { n: imgs.length, allData: imgs.every((i) => i.src.startsWith('data:image/png')) };
  });
  eq(ov.n, String(st.score).length, 'game-over numeral count matches the score digits');
  ok(ov.allData, 'game-over numerals are data URLs');
  await page.close();
});

await test('levels: 15 placements level up, +5s, banner', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await page.click('#btn-menu'); // pause the timer so the +5s is exact
  await page.evaluate(() => window.__gb.setTimeLeft(100));
  // 15 single cells that never complete a row (7+7+1 across rows 0-2):
  // placed 0 -> 15, level 1 -> 2, no line bonus to confuse the +5s.
  const cells = [];
  for (let c = 0; c < 7; c++) cells.push([0, c]);
  for (let c = 0; c < 7; c++) cells.push([1, c]);
  cells.push([2, 0]);
  for (const [r, c] of cells) {
    await page.evaluate(([r, c]) => { window.__gb.setTray([0, 0, 0]); window.__gb.place(0, r, c); }, [r, c]);
  }
  const st = await page.evaluate(() => window.__gb.state());
  eq(st.placed, 15, '15 pieces placed');
  eq(st.level, 2, 'level 2 after 15 placements');
  eq(st.lines, 0, 'no lines cleared by the test cells');
  approx(st.timeLeft - 100, 5, 0.6, 'level-up +5s');
  ok(await page.locator('#banner:not(.hidden)').isVisible(), 'level-up banner shown');
  ok((await page.locator('#banner-text').textContent()).includes('LEVEL 2'), 'banner says LEVEL 2');
  eq(await page.locator('#level-label').textContent(), 'LEVEL 2', 'HUD level label');
  await page.close();
});

await test('levels: player XP persists + home bar shows it', async () => {
  const { ctx, page } = await newPage();
  await startClassic(page);
  await setupBoard(page, ROW7, [0, 0, 0]);
  await page.evaluate(() => window.__gb.place(0, 7, 7)); // 1 line, score > 0
  await page.evaluate(() => window.__gb.setTimeLeft(0.3));
  await waitFor(async () => page.locator('#revive.show').isVisible(), 6000, 'revive overlay');
  await page.click('#btn-norevive');
  await waitFor(async () => page.locator('#over.show').isVisible(), 5000, 'game-over panel');
  // XP: 10/line + 5/max combo + 25/game = 40.
  eq(await page.evaluate(() => localStorage.getItem('gb_xp')), '40', 'XP awarded (40)');
  ok((await page.locator('#ov-xp').textContent()).includes('+40 XP'), 'game-over XP line');
  const st = await page.evaluate(() => window.__gb.state());
  eq(st.playerLevel, 1, 'player level 1 at 40 XP');
  await page.click('#btn-home');
  await waitFor(async () => page.locator('#player-card').isVisible(), 3000, 'player card');
  ok((await page.locator('#player-level-label').textContent()).includes('Player Level 1'), 'home card level');
  const w = await page.locator('#player-xp-fill').evaluate((el) => parseFloat(el.style.width));
  ok(w > 0 && w < 100, 'home XP bar partially filled, got ' + w + '%');
  await ctx.close();
});

await test('levels: game-over star rating reveals 3 stars for a new best', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await setupBoard(page, ROW7, [0, 0, 0]);
  await page.evaluate(() => window.__gb.place(0, 7, 7)); // score > 0, fresh profile => new best
  await page.evaluate(() => window.__gb.setTimeLeft(0.3));
  await waitFor(async () => page.locator('#revive.show').isVisible(), 6000, 'revive overlay');
  await page.click('#btn-norevive');
  await waitFor(async () => page.locator('#over.show').isVisible(), 5000, 'game-over panel');
  await sleep(1500); // stars reveal one at a time (250ms + 350ms apart)
  const lit = await page.locator('#ov-stars span.lit').count();
  eq(lit, 3, '3 stars lit for new best');
  await page.close();
});

await test('new best: glossy badge in banner + game-over panel', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await setupBoard(page, ROW7, [0, 0, 0]);
  await page.evaluate(() => window.__gb.place(0, 7, 7)); // score > 0, fresh profile => new best
  await page.evaluate(() => window.__gb.setTimeLeft(0.3));
  await waitFor(async () => page.locator('#revive.show').isVisible(), 6000, 'revive overlay');
  await page.click('#btn-norevive');
  // A new best gets its own beat: the banner badge pops over the board
  // FIRST, then the panel opens with the same badge inside it. The two
  // must never be on screen together — that stacked two badges.
  await waitFor(async () => page.locator('#banner-badge:not(.hidden)').isVisible(), 3000, 'banner badge pops first');
  ok(!(await page.locator('#over.show').isVisible()), 'panel still closed while the badge pops');
  const bb = await page.evaluate(() => {
    const el = document.getElementById('banner-badge');
    const img = el.querySelector('img');
    return { text: el.textContent.trim(), imgData: img.src.startsWith('data:image/png'), big: el.classList.contains('big') };
  });
  eq(bb.text, 'NEW BEST', 'banner badge reads NEW BEST');
  ok(bb.imgData, 'banner badge star is a data-URL sprite');
  ok(bb.big, 'banner badge is the big size');
  await waitFor(async () => page.locator('#over.show').isVisible(), 5000, 'game-over panel');
  // The banner badge has handed off to the panel badge by now.
  ok(!(await page.locator('#banner:not(.hidden)').isVisible()), 'banner badge gone once the panel is up');
  ok(await page.locator('#ov-new.best-badge:not(.hidden)').isVisible(), 'game-over panel badge visible');
  const ov = await page.evaluate(() => {
    const el = document.getElementById('ov-new');
    const img = el.querySelector('img');
    return { text: el.textContent.trim(), imgData: img.src.startsWith('data:image/png') };
  });
  eq(ov.text, 'NEW BEST', 'panel badge reads NEW BEST');
  ok(ov.imgData, 'panel badge star is a data-URL sprite');
  await page.close();
});

await test('power-ups: ring shows 7/10 progress after 7 lines', async () => {
  const { page } = await newPage();
  await startClassic(page);
  for (let i = 0; i < 7; i++) {
    await setupBoard(page, ROW7, [0, 0, 0]);
    await page.evaluate(() => window.__gb.place(0, 7, 7));
  }
  const st = await page.evaluate(() => window.__gb.state());
  eq(st.lines, 7, '7 lines cleared');
  eq(await page.locator('.pu[data-pu="bomb"] .pu-progress').textContent(), '7/10', 'ring progress text 7/10');
  ok(await page.locator('.pu[data-pu="bomb"]').evaluate((el) => el.classList.contains('empty')), 'slots dimmed while empty');
  await page.close();
});

await test('power-ups: earn moment shows POWER-UP! banner + first-time card', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await page.evaluate(() => window.__gb.grantCharge());
  await waitFor(async () => page.locator('#banner:not(.hidden)').isVisible(), 3000, 'POWER-UP banner');
  eq(await page.locator('#banner-text').textContent(), 'POWER-UP!', 'banner text');
  ok(await page.locator('#pu-first.show').isVisible(), 'first-time explainer card shown');
  ok((await page.locator('#pu-first').textContent()).includes('Clear 3 lines at once or every 10 lines'), 'explainer copy');
  await page.click('#btn-pu-first');
  const st = await page.evaluate(() => window.__gb.state());
  eq(st.charges.bomb, 1, 'bomb earned (fixed rotation first)');
  ok(await page.locator('.pu[data-pu="bomb"]').evaluate((el) => el.classList.contains('earned')), 'earned slot glows');
  await page.close();
});

await test('ui: icons are pre-rendered sprites, no emoji in the UI', async () => {
  const { page } = await newPage();
  await startClassic(page);
  const icons = await page.evaluate(() => [...document.querySelectorAll('img[data-icon]')].map((img) => img.src));
  ok(icons.length >= 10, 'icon imgs present, got ' + icons.length);
  ok(icons.every((s) => s.startsWith('data:image/png')), 'all icons are data-URI sprites');
  const bodyText = await page.evaluate(() => document.body.innerText);
  for (const e of ['🔥', '✦', '🔊', '☰', '💣', '🌸', '🔀', '👆']) ok(!bodyText.includes(e), 'no emoji ' + e + ' in UI');
  await page.close();
});

await test('ui: display font is Baloo 2 (chunky display type)', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await page.evaluate(() => document.fonts.load('800 32px "Baloo 2"'));
  // The score is now a pre-rendered Baloo 2 sprite (see the hero-type
  // tests); the live display text left in the HUD is the TIME bar text.
  const ff = await page.evaluate(() => getComputedStyle(document.getElementById('timer-text')).fontFamily);
  ok(ff.includes('Baloo 2'), 'timer text uses Baloo 2, got ' + ff);
  eq(await page.locator('#score img').count(), 1, 'score is a numeral sprite');
  await page.close();
});

await test('ui: reduced-motion toggle persists and gates the body class', async () => {
  const { ctx, page } = await newPage();
  await startClassic(page);
  await page.click('#btn-menu');
  await page.click('#btn-menu-settings');
  await page.check('#set-motion');
  ok(await page.evaluate(() => document.body.classList.contains('reduced-motion')), 'body class set');
  eq(await page.evaluate(() => localStorage.getItem('gb_motion')), '1', 'motion pref stored');
  await page.reload();
  await page.waitForSelector('#btn-play');
  await page.click('#btn-title-settings');
  eq(await page.locator('#set-motion').isChecked(), true, 'toggle still on after reload');
  await ctx.close();
});

await test('visual: classroom style after shot', async () => {
  const { page } = await newPage();
  await startClassic(page);
  const board = ['........', '........', '........', '........', '........', '..###...', '..###...', '..###...'];
  await setupBoard(page, board, [0, 0, 0]);
  await page.evaluate(() => window.__gb.setCharges({ bomb: 1, sweep: 1 }));
  await page.screenshot({ path: path.join(ROOT, 'tests', 'design5-shot.png') });
  await page.close();
});


// No-fit board for auto-save tests: rows 0-6 full, row 7 empty, tray of 2x2s.
// A 2x2 cannot fit (only one empty row), so checkGameOver triggers a save.
const NOFIT = ['########', '########', '########', '########', '########', '########', '########', '........'];
async function setupNoFit(page, charges) {
  await setupBoard(page, NOFIT, [11, 11, 11]);
  await page.evaluate((c) => window.__gb.setCharges(c), charges);
}
async function waitSaveDone(page) {
  await waitFor(async () => (await page.evaluate(() => window.__gb.state())).autoSaving === false, 5000, 'save attempt finished');
  await sleep(200);
}

await test('autosave: charge expires after 30s of play (oldest first, no points)', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await page.evaluate(() => window.__gb.setCharges({ bomb: 1 }));
  let st = await page.evaluate(() => window.__gb.state());
  approx(st.chargeSecs.bomb, 30, 1.5, 'fresh charge has ~30s');
  await page.evaluate(() => window.__gb.fastForwardCharges(26));
  st = await page.evaluate(() => window.__gb.state());
  approx(st.chargeSecs.bomb, 4, 1.5, '26s fast-forwarded, ~4s left');
  ok(await page.locator('.pu[data-pu="bomb"]').evaluate((el) => el.classList.contains('expiring')), 'slot pulses under 5s');
  eq(await page.locator('.pu[data-pu="bomb"] .pu-progress').textContent(), '4s', 'seconds remaining shown');
  const scoreBefore = st.score;
  await page.evaluate(() => window.__gb.fastForwardCharges(5));
  st = await page.evaluate(() => window.__gb.state());
  eq(st.charges.bomb, 0, 'charge expired');
  eq(st.score, scoreBefore, 'expiry gives no points');
  eq(await page.locator('.pu[data-pu="bomb"] .pu-progress').textContent(), '0/10', 'empty slot back to milestone ring');
  await page.close();
});

await test('autosave: charge clock pauses in the menu, runs in play', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await page.evaluate(() => window.__gb.setCharges({ bomb: 1 }));
  await page.click('#btn-menu');
  const t0 = (await page.evaluate(() => window.__gb.state())).chargeSecs.bomb;
  await sleep(2000);
  let st = await page.evaluate(() => window.__gb.state());
  approx(st.chargeSecs.bomb, t0, 0.6, 'clock frozen while menu open');
  await page.click('#btn-resume');
  await sleep(2000);
  st = await page.evaluate(() => window.__gb.state());
  approx(t0 - st.chargeSecs.bomb, 2, 0.8, 'clock runs again after menu closes');
  await page.close();
});

await test('autosave: Bomb saves a no-fit board (SAVED! banner, charge spent)', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await setupNoFit(page, { bomb: 1 });
  await page.evaluate(() => window.__gb.checkGameOver());
  await waitFor(async () => page.locator('#banner:not(.hidden)').isVisible(), 3000, 'SAVED banner');
  eq(await page.locator('#banner-text').textContent(), 'SAVED!', 'banner says SAVED!');
  await waitSaveDone(page);
  const st = await page.evaluate(() => window.__gb.state());
  eq(st.charges.bomb, 0, 'bomb spent on the save');
  eq(st.running, true, 'game continues after save');
  const empties = st.board.flat().filter((v) => !v).length;
  ok(empties >= 14, 'bomb cleared room (empties ' + empties + ', was 8)');
  ok(await page.locator('#revive.show').isVisible() === false, 'no revive offered after a save');
  await page.close();
});

await test('autosave: Sweep saves a no-fit board (fullest row that fits)', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await setupNoFit(page, { sweep: 1 });
  await page.evaluate(() => window.__gb.checkGameOver());
  await waitSaveDone(page);
  const st = await page.evaluate(() => window.__gb.state());
  eq(st.charges.sweep, 0, 'sweep spent on the save');
  eq(st.running, true, 'game continues after save');
  ok(st.board[6].every((v) => !v), 'row 6 swept (the one adjacent to the empty row)');
  await page.close();
});

await test('autosave: Reshuffle saves a no-fit board (fresh tray fits)', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await setupNoFit(page, { reshuffle: 1 });
  await page.evaluate(() => window.__gb.checkGameOver());
  await waitSaveDone(page);
  const st = await page.evaluate(() => window.__gb.state());
  eq(st.charges.reshuffle, 0, 'reshuffle spent on the save');
  eq(st.running, true, 'game continues after save');
  ok(await page.locator('#revive.show').isVisible() === false, 'no revive offered after a save');
  await page.close();
});

await test('autosave: Reshuffle is tried before Bomb', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await setupNoFit(page, { reshuffle: 1, bomb: 1 });
  await page.evaluate(() => window.__gb.checkGameOver());
  await waitSaveDone(page);
  const st = await page.evaluate(() => window.__gb.state());
  eq(st.charges.reshuffle, 0, 'reshuffle spent first');
  eq(st.charges.bomb, 1, 'bomb untouched when reshuffle saves');
  eq(st.running, true, 'game continues after save');
  await page.close();
});

await test('autosave: no save when no charges held (revive offered)', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await setupBoard(page, EMPTY, [0, 0, 0]);
  await page.evaluate(() => window.__gb.place(0, 0, 0)); // score 1, so a revive is offered
  await setupBoard(page, NOFIT, [11, 11, 11]);
  // Drive the no-moves check directly (the tray cannot fit the board).
  await page.evaluate(() => window.__gb.checkGameOver());
  await waitFor(async () => page.locator('#revive.show').isVisible(), 6000, 'revive overlay');
  await page.close();
});

await test('autosave: timeout never auto-uses a charge (star kept, revive offered)', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await setupBoard(page, ROW7, [0, 0, 0]);
  await page.evaluate(() => window.__gb.place(0, 7, 7)); // score > 0 so revive is offered
  await page.evaluate(() => window.__gb.setCharges({ star: 1 }));
  await page.evaluate(() => window.__gb.setTimeLeft(0.3));
  await waitFor(async () => page.locator('#revive.show').isVisible(), 6000, 'revive overlay');
  const st = await page.evaluate(() => window.__gb.state());
  eq(st.charges.star, 1, 'Time Star NOT spent on timeout');
  await page.close();
});

await test('review fixes: menu buttons have large type (>= 21px)', async () => {
  const { page } = await newPage();
  // Menu buttons are large type; #tut-skip is excluded — it is a small
  // caption-pill control by design (13px), not a menu button.
  const sizes = await page.evaluate(() => [...document.querySelectorAll('.btn:not(#tut-skip)')].map((b) => parseFloat(getComputedStyle(b).fontSize)));
  ok(sizes.length >= 8, 'panel buttons present, got ' + sizes.length);
  ok(sizes.every((s) => s >= 21), 'all .btn >= 21px, got ' + sizes.join(','));
  const big = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('btn-play')).fontSize));
  ok(big >= 24, 'Play button >= 24px, got ' + big);
  await page.close();
});

await test('review fixes: no builder copy in the player UI', async () => {
  const { page } = await newPage();
  const bodyText = await page.evaluate(() => document.body.innerText);
  for (const s of ['120 BPM', 'BPM', 'Mock ad', 'AdMob', 'AdSense', 'js/ads.js', 'analytics log', '2026-11-11', 'seeded', 'generator']) {
    ok(!bodyText.includes(s), 'no builder copy "' + s + '" in UI');
  }
  const date = await page.evaluate(() => document.getElementById('daily-date').textContent);
  ok(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}$/.test(date), 'daily date is friendly, got ' + date);
  eq(await page.evaluate(() => document.querySelector('.ad-body').textContent.trim()), 'Advertisement', 'mock ad shows only Advertisement');
  ok(await page.evaluate(() => document.getElementById('btn-log').classList.contains('hidden')), 'analytics log hidden by default');
  await page.close();
});

await test('review fixes: difficulty explainer is gone from the player UI', async () => {
  const { page } = await newPage();
  // No entry point anywhere: home panel, settings, or in-game.
  eq(await page.locator('#btn-how').count(), 0, 'no How-difficulty button on the home panel');
  await page.click('#btn-title-settings');
  eq(await page.locator('#btn-set-rules').count(), 0, 'no How-difficulty button in Settings');
  await page.click('#btn-set-close');
  await startClassic(page);
  await page.click('#btn-menu');
  await waitFor(async () => page.locator('#menu.show').isVisible(), 3000, 'pause menu open');
  eq(await page.locator('#rules').count(), 0, 'no rules panel in the UI');
  eq(await page.locator('#menu h2').textContent(), 'Paused', 'menu is the pause menu now');
  ok(await page.locator('#btn-menu-settings').isVisible(), 'Settings lives inside the pause menu');
  const menuText = await page.evaluate(() => document.getElementById('menu').innerText);
  for (const s of ['How difficulty works', 'Ads never', 'tied to ads', 'based on ads']) {
    ok(!menuText.includes(s), 'no "' + s + '" in the menu');
  }
  await page.close();
});

await test('review fixes: analytics log returns with ?debug=1', async () => {
  const { ctx, page } = await newPage();
  await page.goto(`http://localhost:${PORT}/?test=1&debug=1`);
  await page.waitForSelector('#btn-play');
  ok(await page.evaluate(() => !document.getElementById('btn-log').classList.contains('hidden')), 'log button visible with ?debug=1');
  await ctx.close();
});

await test('review fixes: timer is its own labelled bar, time on it; level bar separate + labelled', async () => {
  const { page } = await newPage();
  await startClassic(page);
  eq(await page.evaluate(() => document.getElementById('timer-label').textContent), 'TIME', 'timer label');
  eq(await page.evaluate(() => document.getElementById('level-label').textContent), 'LEVEL 1', 'level label');
  const geom = await page.evaluate(() => {
    const bar = document.getElementById('timerbar').getBoundingClientRect();
    const txt = document.getElementById('timer-text').getBoundingClientRect();
    const lvl = document.getElementById('level-row').getBoundingClientRect();
    return { bar, txt, lvl, xp: document.getElementById('level-xp').textContent };
  });
  ok(geom.txt.top >= geom.bar.top && geom.txt.bottom <= geom.bar.bottom, 'time text sits ON the timer bar');
  ok(geom.txt.left >= geom.bar.left && geom.txt.right <= geom.bar.right, 'time text inside bar horizontally');
  ok(geom.bar.top > geom.lvl.bottom, 'timer bar is below the level row, not overlapping it');
  ok(/^\d+\/15$/.test(geom.xp), 'level XP progress labelled (15 per level), got ' + geom.xp);
  await page.close();
});

await test('review fixes: power-up dock is a 3D tray with glossy discs', async () => {
  const { page } = await newPage();
  await startClassic(page);
  const dock = await page.evaluate(() => {
    const cs = getComputedStyle(document.getElementById('powerups'));
    const img = document.querySelector('.pu[data-pu="bomb"] .pu-ring img');
    const ics = getComputedStyle(img);
    return { dockBg: cs.backgroundImage, dockShadow: cs.boxShadow, discBg: ics.backgroundImage, ring: getComputedStyle(document.querySelector('.pu-ring')).width };
  });
  ok(dock.dockBg.includes('gradient'), 'dock has a gradient tray background');
  ok(dock.dockShadow !== 'none', 'dock has depth shadow');
  ok(dock.discBg.includes('radial-gradient'), 'slot icon sits on a glossy radial disc, got ' + dock.discBg.slice(0, 40));
  ok(parseFloat(dock.ring) >= 46, 'ring is large (>= 46px), got ' + dock.ring);
  await page.close();
});

await test('review fixes 2: daily game-over heading is "Daily challenge over"', async () => {
  const { page } = await newPage();
  await page.evaluate(() => window.__gb.startDaily('2026-11-11'));
  await waitFor(async () => (await page.evaluate(() => window.__gb.state())).running, 5000, 'daily running');
  await page.evaluate(() => window.__gb.setTimeLeft(0.3));
  await waitFor(async () => (await page.locator('#revive.show').isVisible()) || (await page.locator('#over.show').isVisible()), 6000, 'game over');
  if (await page.locator('#revive.show').isVisible()) await page.click('#btn-norevive');
  await waitFor(async () => page.locator('#over.show').isVisible(), 5000, 'game-over panel');
  const h = await page.locator('#over h2').textContent();
  eq(h, 'Daily challenge over', 'heading, got ' + h);
  ok(!h.includes('Nov 11') && !h.includes('2026-'), 'no date in the heading text');
  ok(!(await page.locator('#over').textContent()).includes('2026-'), 'no raw ISO date in the game-over panel');
  // The date lives in its own smaller sub-element under the heading.
  eq(await page.locator('#ov-date').textContent(), 'Nov 11', 'date shown separately under the heading');
  const sizes = await page.evaluate(() => ({
    date: parseFloat(getComputedStyle(document.getElementById('ov-date')).fontSize),
    head: parseFloat(getComputedStyle(document.querySelector('#over h2')).fontSize),
  }));
  ok(sizes.date < sizes.head, 'date text is smaller than the heading');
  await page.close();
});

await test('review fixes 2: pause menu has one top-right control, Settings inside it', async () => {
  const { page } = await newPage();
  // One top-right button in-game: the hamburger only (the gear is gone).
  eq(await page.locator('#btn-settings').count(), 0, 'no gear button in the HUD');
  eq(await page.locator('#btn-menu').count(), 1, 'one hamburger in the HUD');
  await startClassic(page);
  await page.click('#btn-menu');
  await waitFor(async () => page.locator('#menu.show').isVisible(), 3000, 'pause menu open');
  await page.click('#btn-menu-settings');
  await waitFor(async () => page.locator('#settings.show').isVisible(), 3000, 'settings open from the pause menu');
  eq(await page.locator('#set-music').isChecked(), true, 'music toggle reflects the on state');
  await page.close();
});

await test('review fixes 2: dock is capped to board width with 56px discs on desktop', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.addInitScript(() => { localStorage.setItem('gb_tut_done', '1'); });
  await page.goto(`http://localhost:${PORT}/?test=1`);
  await page.waitForSelector('#btn-play');
  await startClassic(page);
  const d = await page.evaluate(() => {
    const dock = document.getElementById('powerups');
    const box = dock.getBoundingClientRect();
    const ring = getComputedStyle(document.querySelector('.pu-ring'));
    const name = getComputedStyle(document.querySelector('.pu-name'));
    const empty = getComputedStyle(document.querySelector('.pu.empty'));
    return { w: box.width, left: box.left, ring: ring.width, name: name.fontSize, emptyOpacity: empty.opacity, emptyFilter: empty.filter };
  });
  ok(d.w <= 521 && d.w >= 500, 'dock capped at ~520px on desktop, got ' + d.w);
  ok(Math.abs(d.left - (1280 - d.w) / 2) < 2, 'dock centred on desktop');
  eq(d.ring, '56px', 'icon discs are 56px, got ' + d.ring);
  eq(d.name, '14px', 'slot labels are 14px, got ' + d.name);
  eq(d.emptyOpacity, '1', 'empty slots keep full opacity, got ' + d.emptyOpacity);
  ok(d.emptyFilter.includes('saturate(0.5)'), 'empty slots keep colour at half saturation, got ' + d.emptyFilter);
  ok(!d.emptyFilter.includes('grayscale'), 'empty slots use no grayscale, got ' + d.emptyFilter);
  await ctx.close();
});

await test('review fixes 3: empty dock slots hide the count badge', async () => {
  const { page } = await newPage();
  await startClassic(page);
  const hidden0 = await page.evaluate(() => [...document.querySelectorAll('.pu .pu-count')].every((el) => el.classList.contains('hidden')));
  ok(hidden0, 'no count badges on empty slots');
  await page.evaluate(() => window.__gb.setCharges({ bomb: 1 }));
  const shown = await page.evaluate(() => {
    const b = document.querySelector('.pu[data-pu="bomb"] .pu-count');
    return !b.classList.contains('hidden') && b.textContent === '1';
  });
  ok(shown, 'badge shows "1" once a charge is held');
  await page.close();
});

await test('review fixes 3: desktop tray is a row under the board within board width', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.addInitScript(() => { localStorage.setItem('gb_tut_done', '1'); });
  await page.goto(`http://localhost:${PORT}/?test=1`);
  await page.waitForSelector('#btn-play');
  await startClassic(page);
  const L = await page.evaluate(() => window.__gb.layout());
  eq(L.trayX, L.bx, 'tray starts at the board left edge');
  approx(L.slotW, L.size / 3, 1, 'slots divide the board width');
  ok(L.trayY > L.by + L.size, 'tray sits directly under the board');
  ok(L.trayX + 3 * L.slotW <= L.bx + L.size + 1, 'tray row stays within the board width');
  // A real drag from the desktop tray still lands on the board.
  await setupBoard(page, ROW7, [0, 0, 0]);
  await dragPiece(page, 0, 7, 7);
  const st = await page.evaluate(() => window.__gb.state());
  eq(st.lines, 1, 'desktop tray drag clears a line');
  await ctx.close();
});

await test('polish 1: larger board + larger tray tiles on phone and desktop', async () => {
  for (const [name, vp] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 800 }]]) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: name === 'phone' ? 2 : 1 });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.addInitScript(() => { localStorage.setItem('gb_tut_done', '1'); });
    await page.goto(`http://localhost:${PORT}/?test=1`);
    await page.waitForSelector('#btn-play');
    await startClassic(page);
    const L = await page.evaluate(() => window.__gb.state().layout);
    ok(L.size >= 350, name + ': board is large, got ' + L.size);
    ok(L.bx >= 14, name + ': board frame stays inside the canvas, bx=' + L.bx);
    approx(L.trayCellMax / L.cell, 0.85, 0.02, name + ': resting tray tiles are 85% of a board cell');
    ok(3 * L.trayCellMax <= L.slotW, name + ': a 3-wide tray piece fits its slot');
    ok(L.trayY + L.trayH <= L.stageH + 1, name + ': tray row fits inside the stage');
    ok(L.trayY > L.by + L.size, name + ': tray sits under the board');
    await ctx.close();
  }
});

await test('polish 1: drag starts at resting tray size and eases to board-cell size', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await setupBoard(page, EMPTY, [3, 0, 0]); // '###', 3-wide — rests at 0.85x cell
  const box = await page.locator('#cv').boundingBox();
  const L = await page.evaluate(() => window.__gb.layout());
  const from = { x: box.x + L.trayX + L.slotW * 0.5, y: box.y + L.trayY + L.trayH / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const atPickup = await page.evaluate(() => window.__gb.state());
  approx(atPickup.dragStartScale, 0.85, 0.02, 'drag starts at resting tray size, got ' + atPickup.dragStartScale);
  await sleep(600);
  const held = await page.evaluate(() => window.__gb.state());
  approx(held.dragScale, 1, 0.02, 'held piece eases to full board-cell size, got ' + held.dragScale);
  await page.mouse.up();
  await sleep(150);
  const after = await page.evaluate(() => window.__gb.state());
  eq(after.dragScale, null, 'drag ends on release');
  eq(after.placed, 0, 'an invalid drop does not place');
  await page.close();
});

await test('review fixes 3: Sweep + Tray icons are the new action art', async () => {
  const { page } = await newPage();
  await startClassic(page);
  const art = await page.evaluate(async () => {
    async function sample(sel) {
      const img = document.querySelector(sel);
      const cv = document.createElement('canvas'); cv.width = cv.height = 96;
      const g = cv.getContext('2d');
      await new Promise((res) => { if (img.complete) res(); else img.onload = res; });
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, 96, 96).data;
      let white = 0, opaque = 0; const buckets = new Set();
      let minX = 96, maxX = 0, minY = 96, maxY = 0;
      for (let i = 0; i < d.length; i += 16) { // every 4th pixel
        const px = (i / 4) % 96, py = Math.floor((i / 4) / 96);
        const r = d[i], gg = d[i + 1], b = d[i + 2], a = d[i + 3];
        if (a < 40) continue;
        opaque++;
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
        if (r > 225 && gg > 225 && b > 225) white++;
        // Bucket saturated block colours (ignore near-white speculars).
        const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
        if (mx - mn > 60 && mx > 120) buckets.add(`${Math.round(r / 64)}-${Math.round(gg / 64)}-${Math.round(b / 64)}`);
      }
      return { white, opaque, colors: buckets.size, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
    }
    return { sweep: await sample('.pu[data-pu="sweep"] .pu-ring img'), tray: await sample('.pu[data-pu="reshuffle"] .pu-ring img'), bomb: await sample('.pu[data-pu="bomb"] .pu-ring img') };
  });
  ok(art.sweep.opaque > 500, 'sweep icon is drawn, got ' + art.sweep.opaque + ' opaque samples');
  ok(art.sweep.colors >= 3, 'sweep shows three big block colours, got ' + art.sweep.colors);
  // Dylan feedback #2: the big white beam is gone — white is only the small
  // speculars now (old beam: ~15% white; new render: ~2%).
  ok(art.sweep.white / Math.max(1, art.sweep.opaque) < 0.08, 'sweep has no big white beam, white share ' + (art.sweep.white / Math.max(1, art.sweep.opaque)).toFixed(3));
  // The new tray art (3 blocks + a small corner arrow, no arc/star) has
  // fewer opaque pixels than the old arc version — 400 still proves it is
  // drawn (500 samples measured).
  ok(art.tray.opaque > 400, 'tray icon is drawn, got ' + art.tray.opaque + ' opaque samples');
  ok(art.tray.colors >= 3, 'tray shows three block colours, got ' + art.tray.colors);
  ok(art.tray.white / Math.max(1, art.tray.opaque) < 0.08, 'tray has no big white arc, white share ' + (art.tray.white / Math.max(1, art.tray.opaque)).toFixed(3));
  // Dylan feedback #2: bomb ball + fuse + spark as one unit, centred.
  ok(Math.abs(art.bomb.cx - 48) <= 8 && Math.abs(art.bomb.cy - 48) <= 8, 'bomb art is centred in its disc, got (' + art.bomb.cx + ',' + art.bomb.cy + ')');
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
