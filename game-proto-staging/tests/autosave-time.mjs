// Clearbloom timeout auto-save tests (Dylan, Nov 12: Time Star saves a
// timeout; Sweep already auto-saves in the no-fit cascade — verified, see
// test (a) and the suite's passing 'autosave: Sweep saves a no-fit board').
// Standalone Playwright script — Chromium is DOWN (outage #7), so this is
// UNRUN. Run: node tests/autosave-time.mjs (serves game-proto on 8917).
//
// PORT NOTE — do not just append these to tests/design1.mjs. The suite test
// 'autosave: timeout never auto-uses a charge (star kept, revive offered)'
// (design1.mjs ~line 1683) asserts the SUPERSEDED behavior and WILL FAIL
// after this change: REPLACE it with tests (b)-(e) below. Test (a) is new
// coverage (bomb-tried-first ordering) and can be appended as-is.
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
async function waitSaveDone(page) {
  await waitFor(async () => (await page.evaluate(() => window.__gb.state())).autoSaving === false, 5000, 'save attempt finished');
  await sleep(200);
}
const EMPTY = ['........', '........', '........', '........', '........', '........', '........', '........'];
const ROW7 = ['........', '........', '........', '........', '........', '........', '........', '#######.'];
const FULL = ['########', '########', '########', '########', '########', '########', '########', '########'];

// (a) No-fit cascade reaches Sweep PAST Bomb: full board + 1x4 bars (shape 9).
// A 3x3 bomb clear can never make a 1x4 bar fit (max 3-wide hole), so Bomb
// has no target; a full-row sweep does. Proves the cascade order
// Reshuffle -> Bomb -> Sweep in the real game (suite already proves the
// sweep-only case; this proves Bomb is tried and skipped first).
await test('autosave: cascade reaches Sweep when Bomb has no target (bomb kept)', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await setupBoard(page, FULL, [9, 9, 9]);
  await page.evaluate(() => window.__gb.setCharges({ bomb: 1, sweep: 1 }));
  await page.evaluate(() => window.__gb.checkGameOver());
  await waitFor(async () => page.locator('#banner:not(.hidden)').isVisible(), 3000, 'SAVED banner');
  eq(await page.locator('#banner-text').textContent(), 'SAVED!', 'banner says SAVED!');
  await waitSaveDone(page);
  const st = await page.evaluate(() => window.__gb.state());
  eq(st.charges.sweep, 0, 'sweep spent on the save');
  eq(st.charges.bomb, 1, 'bomb untouched — it had no target');
  eq(st.running, true, 'game continues after save');
  ok(st.board[0].every((v) => !v), 'row 0 swept');
  ok(await page.locator('#revive.show').isVisible() === false, 'no revive offered after a save');
  await page.close();
});

// (b) Timeout with a Time Star held: +15 s, one charge consumed, game continues.
await test('autosave: timeout spends one Time Star (+15s, SAVED!, game continues)', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await setupBoard(page, ROW7, [0, 0, 0]);
  await page.evaluate(() => window.__gb.place(0, 7, 7)); // score > 0 so revive would be offered
  await page.evaluate(() => window.__gb.setCharges({ star: 1 }));
  await page.evaluate(() => window.__gb.setTimeLeft(0.3));
  await waitFor(async () => page.locator('#banner:not(.hidden)').isVisible(), 6000, 'SAVED banner');
  eq(await page.locator('#banner-text').textContent(), 'SAVED!', 'banner says SAVED!');
  await waitSaveDone(page);
  const st = await page.evaluate(() => window.__gb.state());
  eq(st.charges.star, 0, 'Time Star spent on the timeout save');
  eq(st.running, true, 'game continues after timeout save');
  ok(st.timeLeft > 10 && st.timeLeft <= 15, 'time refilled to ~15s, got ' + st.timeLeft);
  ok(await page.locator('#revive.show').isVisible() === false, 'no revive offered after a save');
  await page.close();
});

// (c) Timeout with no Time Star held: the game ends exactly as before.
await test('autosave: timeout with no Time Star held ends the game (revive offered)', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await setupBoard(page, ROW7, [0, 0, 0]);
  await page.evaluate(() => window.__gb.place(0, 7, 7)); // score > 0 so revive is offered
  await page.evaluate(() => window.__gb.setCharges({}));
  await page.evaluate(() => window.__gb.setTimeLeft(0.3));
  await waitFor(async () => page.locator('#revive.show').isVisible(), 6000, 'revive overlay');
  const st = await page.evaluate(() => window.__gb.state());
  eq(st.running, false, 'game ended on timeout with no Time Star');
  await page.close();
});

// (d) Timeout with only Bomb/Sweep/Reshuffle held: they do NOT save a
// timeout (they add no time) — game ends, all three charges kept.
await test('autosave: timeout with only Bomb/Sweep/Reshuffle held ends the game (charges kept)', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await setupBoard(page, ROW7, [0, 0, 0]);
  await page.evaluate(() => window.__gb.place(0, 7, 7)); // score > 0 so revive is offered
  await page.evaluate(() => window.__gb.setCharges({ bomb: 1, sweep: 1, reshuffle: 1 }));
  await page.evaluate(() => window.__gb.setTimeLeft(0.3));
  await waitFor(async () => page.locator('#revive.show').isVisible(), 6000, 'revive overlay');
  const st = await page.evaluate(() => window.__gb.state());
  eq(st.running, false, 'game ended on timeout');
  eq(st.charges.bomb, 1, 'bomb kept');
  eq(st.charges.sweep, 1, 'sweep kept');
  eq(st.charges.reshuffle, 1, 'reshuffle kept');
  await page.close();
});

// (e) Repeated timeouts consume one Time Star each until none remain, then
// the game ends. (3 held = +45 s max across three timeouts.)
await test('autosave: repeated timeouts spend one Time Star each, then the game ends', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await setupBoard(page, ROW7, [0, 0, 0]);
  await page.evaluate(() => window.__gb.place(0, 7, 7)); // score > 0 so revive is offered
  await page.evaluate(() => window.__gb.setCharges({ star: 2 }));
  // Timeout 1: star 2 -> 1.
  await page.evaluate(() => window.__gb.setTimeLeft(0.3));
  await waitFor(async () => page.locator('#banner:not(.hidden)').isVisible(), 6000, 'SAVED banner 1');
  await waitSaveDone(page);
  let st = await page.evaluate(() => window.__gb.state());
  eq(st.charges.star, 1, 'first timeout spent one star');
  eq(st.running, true, 'game continues after first timeout save');
  // Timeout 2: star 1 -> 0.
  await page.evaluate(() => window.__gb.setTimeLeft(0.3));
  await waitFor(async () => page.locator('#banner:not(.hidden)').isVisible(), 6000, 'SAVED banner 2');
  await waitSaveDone(page);
  st = await page.evaluate(() => window.__gb.state());
  eq(st.charges.star, 0, 'second timeout spent the last star');
  eq(st.running, true, 'game continues after second timeout save');
  // Timeout 3: no stars left — the game ends.
  await page.evaluate(() => window.__gb.setTimeLeft(0.3));
  await waitFor(async () => page.locator('#revive.show').isVisible(), 6000, 'revive overlay');
  st = await page.evaluate(() => window.__gb.state());
  eq(st.running, false, 'game ended on the third timeout with no stars left');
  await page.close();
});

// RULES_TEXT documents the new rule (fairness rule 8).
await test('difficulty: RULES_TEXT discloses the timeout Time Star save', async () => {
  const { page } = await newPage();
  const rules = await page.evaluate(async () => {
    const d = await import('/js/difficulty.js');
    return d.RULES_TEXT.join('\n');
  });
  ok(rules.includes('Time Star saves you automatically') || rules.includes('Time Star to save you'), 'timeout Time Star save disclosed');
  ok(rules.includes('One charge per timeout') || rules.includes('one charge per timeout'), 'one charge per timeout disclosed');
  ok(rules.includes('Only the Time Star can save a timeout'), 'only-Time-Star rule disclosed');
  ok(!rules.includes('Timeout never auto-uses'), 'old timeout wording gone');
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
