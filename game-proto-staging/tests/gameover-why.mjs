// Game-over reason probe (Dylan, Nov 12, 9:24 PM — "put the reason on the
// game-over panel"): the "Time's up!" / "No space left!" line used to live
// in the removed revive overlay; it now sits on the game-over panel itself
// (#ov-why, under the heading).
//   (a) timeout ends the game → panel shows "Time's up!"
//   (b) no-moves ends the game → panel shows "No space left!"
//   (c) 0 console errors
// Run: node tests/gameover-why.mjs  (serves game-proto/ itself, port 8922)
// NOTE: Chromium outage #7 was active when this was written — UNRUN.
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
const PORT = 8922;
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
const NOFIT = ['########', '########', '########', '########', '########', '########', '########', '........'];
// Counting provider (no DOM overlay): the game-end interstitial resolves
// instantly, so the panel appears promptly either way the 1-in-3 roll lands.
async function installCountingProvider(page) {
  await page.evaluate(() => {
    window.__gb.ads.setProvider({ name: 'count', init() {}, showInterstitial() { return Promise.resolve({ shown: true }); }, showRewarded() { return Promise.resolve({ rewarded: false }); } });
  });
}

// (a) timeout ends the game → "Time's up!".
await test('(a) timeout → "Time\'s up!" on the panel', async () => {
  const { page } = await newPage();
  await installCountingProvider(page);
  await startClassic(page);
  await setupBoard(page, EMPTY, [0, 0, 0]);
  await page.evaluate(() => window.__gb.place(0, 0, 0)); // score > 0
  await page.evaluate(() => window.__gb.setTimeLeft(0.4));
  await waitFor(async () => page.locator('#over.show').isVisible(), 15000, 'game-over panel');
  eq(await page.locator('#ov-why').textContent(), "Time's up!", 'timeout reason');
  await page.close();
});

// (b) no-moves ends the game → "No space left!".
await test('(b) no-moves → "No space left!" on the panel', async () => {
  const { page } = await newPage();
  await installCountingProvider(page);
  await startClassic(page);
  await setupBoard(page, EMPTY, [0, 0, 0]);
  await page.evaluate(() => window.__gb.place(0, 0, 0)); // score > 0
  await setupBoard(page, NOFIT, [11, 11, 11]);
  await page.evaluate(() => window.__gb.checkGameOver()); // tray cannot fit the board
  await waitFor(async () => page.locator('#over.show').isVisible(), 15000, 'game-over panel');
  eq(await page.locator('#ov-why').textContent(), 'No space left!', 'no-moves reason');
  await page.close();
});

// (c) 0 console errors.
await test('(c) 0 console errors', async () => {
  if (errors.length) throw new Error(errors.join(' | '));
});

const fails = results.filter((r) => r[0] === 'FAIL');
console.log(`\n${results.length - fails.length}/${results.length} passed${errors.length ? `, ${errors.length} console errors` : ', 0 console errors'}`);
await browser.close();
server.close();
process.exit(fails.length || errors.length ? 1 : 0);
