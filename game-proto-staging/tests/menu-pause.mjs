// Clearbloom hamburger-menu pause/resume probe (Playwright, headless Chromium).
// Verifies the pause contract Dylan asked about (Nov 12, 8:52 PM: "cheeseburger
// stack menu needs to pause current game too. Automatically resume when it's
// closed." / "If it already works, then great. I was just making sure."):
//
//   VERDICT FROM CODE READING (no browser run yet — Chromium outage #7):
//   - Timer: ALREADY pauses. timerPaused() (main.js) lists 'menu' + 'settings';
//     tickTimer() early-returns while paused; timeLeft is only decremented in
//     tickTimer (line ~256); frame dt is clamped to 0.05s, so no jump on resume.
//     The suite already proves this: 'timer: pauses in menu, resumes after'
//     (design1.mjs ~287), green in the 141/141 run.
//   - Input: the .overlay covers the whole screen (position:fixed inset:0,
//     z-index 10) while shown, so canvas drags cannot start under the menu.
//   - checkGameOver/auto-save only fire after placements, never per frame —
//     nothing can end the game while the menu blocks input.
//   - Settings sub-flow: menu -> Settings stays paused ('settings' is in the
//     timerPaused list); Done closes settings WITHOUT returning to the menu,
//     so the game resumes directly. Same for hardware back. That matches
//     "resume when closed", but the player never sees the pause menu again.
//   - Music: the ONE subsystem that does NOT pause. Music.pause() exists but
//     is only called on document.hidden (visibilitychange); the code comment
//     (main.js ~2012) says music deliberately "keeps playing across menu and
//     game". This probe OBSERVES music state while the menu is open and logs
//     it — it does NOT assert paused. Pausing music on menu open is Dylan's
//     call, not a bug fix made here.
//
// Run: node tests/menu-pause.mjs   (serves game-proto/ on localhost itself)
// Port 8917 (the suite uses 8903; this stays runnable alongside it).
// PORT INTO design1.mjs once the fix13 agent finishes editing it.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let chromium;
for (const cand of [process.env.PLAYWRIGHT_MODULE, 'playwright', '/home/hatch/.cache/giil/node_modules/playwright/index.mjs']) {
  if (!cand) continue;
  try { ({ chromium } = await import(cand)); break; } catch { /* try next */ }
}
if (!chromium) throw new Error('Playwright not found: set PLAYWRIGHT_MODULE or install playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'game-proto');
const PORT = 8917;
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
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
});

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.addInitScript(() => { localStorage.setItem('gb_tut_done', '1'); });
  await page.goto(`http://localhost:${PORT}/?test=1`);
  await page.waitForSelector('#btn-play');
  return { ctx, page };
}
async function startClassic(page) {
  await page.click('#btn-play');
  await waitFor(async () => (await page.evaluate(() => window.__gb.state().running)), 5000, 'game running');
}
async function setupBoard(page, rows, tray = [0, 0, 0]) {
  await page.evaluate(({ rows, tray }) => { window.__gb.setBoard(rows); window.__gb.setTray(tray); }, { rows, tray });
  await sleep(150);
}
const EMPTY = ['........', '........', '........', '........', '........', '........', '........', '........'];

await test('menu: timer frozen while open, ticks again on close, no jump', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await page.evaluate(() => window.__gb.setTimeLeft(100));
  await page.click('#btn-menu');
  eq(await page.evaluate((id) => document.getElementById(id).classList.contains('show'), 'menu'), true, 'menu showing');
  const t0 = (await page.evaluate(() => window.__gb.state())).timeLeft;
  await sleep(1500);
  let st = await page.evaluate(() => window.__gb.state());
  approx(st.timeLeft, t0, 0.35, 'frozen while menu open');
  eq(st.timerPaused, true, 'timerPaused true in menu');
  const beforeClose = (await page.evaluate(() => window.__gb.state())).timeLeft;
  await page.click('#btn-resume');
  eq(await page.evaluate((id) => document.getElementById(id).classList.contains('show'), 'menu'), false, 'menu closed');
  st = await page.evaluate(() => window.__gb.state());
  eq(st.timerPaused, false, 'timerPaused false after close');
  approx(st.timeLeft, beforeClose, 0.35, 'no time jump on close (dt clamped)');
  await sleep(1200);
  st = await page.evaluate(() => window.__gb.state());
  ok(beforeClose - st.timeLeft > 0.7, 'ticks again after menu closes');
  await page.close();
});

await test('menu: canvas input blocked while open (no placement)', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await setupBoard(page, EMPTY, [0, 0, 0]);
  await page.click('#btn-menu');
  const box = await page.locator('#cv').boundingBox();
  const L = await page.evaluate(() => window.__gb.layout());
  const from = { x: box.x + L.trayX + L.slotW * 0.5, y: box.y + L.trayY + L.trayH / 2 };
  const to = { x: box.x + L.bx + 0.5 * L.cell, y: box.y + L.by + 0.5 * L.cell };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
  await page.mouse.up();
  await sleep(300);
  const st = await page.evaluate(() => window.__gb.state());
  eq(st.placed, 0, 'nothing placed through the menu overlay');
  eq(st.board[0][0], false, 'target cell stays empty');
  await page.close();
});

await test('menu: Settings sub-flow stays paused; Done resumes directly, menu does not return', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await page.evaluate(() => window.__gb.setTimeLeft(100));
  await page.click('#btn-menu');
  await page.click('#btn-menu-settings');
  eq(await page.evaluate((id) => document.getElementById(id).classList.contains('show'), 'settings'), true, 'settings showing');
  eq(await page.evaluate((id) => document.getElementById(id).classList.contains('show'), 'menu'), false, 'menu hidden while settings open');
  let st = await page.evaluate(() => window.__gb.state());
  eq(st.timerPaused, true, 'timerPaused true in settings');
  const t0 = st.timeLeft;
  await sleep(1200);
  st = await page.evaluate(() => window.__gb.state());
  approx(st.timeLeft, t0, 0.35, 'frozen in settings');
  await page.click('#btn-set-close');
  eq(await page.evaluate((id) => document.getElementById(id).classList.contains('show'), 'settings'), false, 'settings closed');
  eq(await page.evaluate((id) => document.getElementById(id).classList.contains('show'), 'menu'), false, 'menu does NOT return after Done (current behavior)');
  st = await page.evaluate(() => window.__gb.state());
  eq(st.timerPaused, false, 'timer resumes directly after Done');
  await sleep(1000);
  st = await page.evaluate(() => window.__gb.state());
  ok(t0 - st.timeLeft > 0.5, 'ticks again after Done');
  await page.close();
});

await test('menu: hardware back closes menu/settings and resumes', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await page.evaluate(() => window.__gb.setTimeLeft(100));
  await page.click('#btn-menu');
  await page.evaluate(() => window.__gbBack());
  eq(await page.evaluate((id) => document.getElementById(id).classList.contains('show'), 'menu'), false, 'back closes menu');
  let st = await page.evaluate(() => window.__gb.state());
  eq(st.timerPaused, false, 'resumes after back from menu');
  // Back from Settings: settings closes, game resumes directly (menu does not return).
  await page.click('#btn-menu');
  await page.click('#btn-menu-settings');
  await page.evaluate(() => window.__gbBack());
  eq(await page.evaluate((id) => document.getElementById(id).classList.contains('show'), 'settings'), false, 'back closes settings');
  eq(await page.evaluate((id) => document.getElementById(id).classList.contains('show'), 'menu'), false, 'menu does NOT return after back from settings');
  st = await page.evaluate(() => window.__gb.state());
  eq(st.timerPaused, false, 'resumes after back from settings');
  await page.close();
});

await test('menu: music observation — keeps playing (deliberate, main.js ~2012)', async () => {
  const { page } = await newPage();
  await startClassic(page); // the Play tap is the gesture that starts music
  await sleep(800);
  let st = await page.evaluate(() => window.__gb.state());
  eq(st.musicOn, true, 'music setting still on');
  console.log('  [observe] before menu: scheduler=' + st.musicScheduler + ' audioState=' + st.audioState + ' gain=' + st.musicGain);
  await page.click('#btn-menu');
  await sleep(1200);
  st = await page.evaluate(() => window.__gb.state());
  eq(st.timerPaused, true, 'timer paused while observing music');
  console.log('  [observe] menu open: scheduler=' + st.musicScheduler + ' audioState=' + st.audioState + ' gain=' + st.musicGain + ' musicOn=' + st.musicOn);
  // No assertion that music paused: Music.pause() is only wired to
  // document.hidden, and the code comment says music deliberately "keeps
  // playing across menu and game". If Dylan wants music paused on menu
  // open, flip this into: scheduler false while open, true after close.
  await page.click('#btn-resume');
  await page.close();
});

await test('menu: armed power-up survives open/close; auto-save mid-freeze stays consistent', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await page.evaluate(() => window.__gb.setCharges({ bomb: 1, sweep: 0, reshuffle: 0, star: 0 }));
  await page.evaluate(() => window.__gb.armPowerup('bomb'));
  let st = await page.evaluate(() => window.__gb.state());
  eq(st.armed, 'bomb', 'bomb armed before menu');
  await page.click('#btn-menu');
  await sleep(600);
  await page.click('#btn-resume');
  st = await page.evaluate(() => window.__gb.state());
  eq(st.armed, 'bomb', 'still armed after menu close');
  // Auto-save edge: full board + a reshuffle charge, trigger the no-fit
  // check, open the menu mid-freeze. Must end consistent: game over with
  // the panel up (the reshuffle cannot save a full board; revive is gone)
  // — never a crash or a stuck state.
  const FULL = ['########', '########', '########', '########', '########', '########', '########', '########'];
  await setupBoard(page, FULL, [0, 0, 0]);
  await page.evaluate(() => window.__gb.setCharges({ bomb: 0, sweep: 0, reshuffle: 1, star: 0 }));
  await page.evaluate(() => window.__gb.checkGameOver());
  await page.click('#btn-menu');
  await sleep(1500);
  await page.click('#btn-resume');
  await waitFor(async () => {
    const s = await page.evaluate(() => window.__gb.state());
    return !s.autoSaving;
  }, 5000, 'auto-save freeze ends');
  st = await page.evaluate(() => window.__gb.state());
  // Revive is gone (Dylan, Nov 12, e11f4e2): the only consistent end state
  // on a FULL board is game over — the reshuffle was spent, the fresh tray
  // cannot fit a full board, and no bomb/sweep was held. The panel may wait
  // behind the 1-in-3 game-end interstitial (mock ad: Close when it appears;
  // it enables after 2s).
  await waitFor(async () => {
    // Only click when the mock ad is actually showing: #ad-close is enabled
    // by default in the static markup, so enabled-but-hidden must not be
    // clicked (Playwright waits forever on an invisible button).
    if (await page.locator('#ad.show').isVisible() && await page.locator('#ad-close').isEnabled()) await page.click('#ad-close');
    return page.locator('#over.show').isVisible();
  }, 15000, 'game-over panel after auto-save');
  st = await page.evaluate(() => window.__gb.state());
  eq(st.running, false, 'game over after unresolvable no-fit');
  eq(await page.locator('#ov-why').textContent(), 'No space left!', 'reason line on the panel');
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
