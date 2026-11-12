// Screenshots for polish item 3 (Nov 11, ~7:50 PM): glossy 3D type —
// pre-rendered wordmark sprite on home, gold 3D numerals for score/BEST/
// combo/game-over, real 3D star in the combo line, and the last-20s
// countdown moved onto the TIME bar (amber >5s, red <=5s, never an overlay).
// Two viewports (phone 390x844, desktop 1280x800). Chromium launched
// --no-sandbox: the sandbox dies with SIGTRAP (rc=133) under this VM's
// seccomp/NoNewPrivs filter. Serves game-proto on localhost, drives
// headless Chromium via Playwright.
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

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '..', 'game-proto');
const OUT = DIR;
const PORT = 8916;
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
const chromiumPath = process.env.CHROMIUM_PATH
  || ['/home/hatch/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({
  ...(chromiumPath ? { executablePath: chromiumPath } : {}),
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
});
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeout = 8000, label = 'condition') {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - t0 > timeout) throw new Error('timeout waiting for ' + label);
    await sleep(120);
  }
}

for (const [name, vp] of [['phone', { width: 390, height: 844, dsf: 2 }], ['desktop', { width: 1280, height: 800, dsf: 1 }]]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dsf });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(name + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push(name + ': pageerror: ' + e.message));
  await page.addInitScript(() => { localStorage.setItem('gb_tut_done', '1'); });

  // Home: the wordmark sprite.
  await page.goto(`http://localhost:${PORT}/?test=1`);
  await page.waitForSelector('#btn-play');
  await waitFor(async () => (await page.evaluate(() => window.__gb.state().heroTypeReady)), 5000, 'hero type ready');
  await sleep(600);
  await page.screenshot({ path: path.join(OUT, `fix8-home-${name}.png`) });
  console.log(`fix8-home-${name}.png saved`);

  // Gameplay HUD: place pieces and clear a row so the gold-numeral score
  // and BEST are visible, plus a combo line with the real star.
  await page.click('#btn-play');
  await waitFor(async () => (await page.evaluate(() => window.__gb && window.__gb.state().running)), 5000, 'game running');
  await sleep(500);
  const ROW7 = ['........', '........', '........', '........', '........', '........', '........', '#######.'];
  for (let i = 0; i < 2; i++) {
    await page.evaluate(({ rows }) => { window.__gb.setBoard(rows); window.__gb.setTray([0, 0, 0]); }, { rows: ROW7 });
    await sleep(200);
    await page.evaluate(() => window.__gb.place(0, 7, 7));
    await sleep(600);
  }
  await page.evaluate(() => window.__gb.setTray([0, 3, 11]));
  await sleep(800); // rolling score counter settles
  await page.screenshot({ path: path.join(OUT, `fix8-hud-${name}.png`) });
  console.log(`fix8-hud-${name}.png saved`);

  // Countdown, amber (19s): on the TIME bar, beside the bar.
  await page.evaluate(() => window.__gb.setTimeLeft(19.5));
  await waitFor(async () => page.locator('#countdown.on').isVisible(), 3000, 'countdown visible');
  await sleep(300);
  await page.screenshot({ path: path.join(OUT, `fix8-countdown-${name}.png`) });
  console.log(`fix8-countdown-${name}.png saved`);

  // Countdown, red + urgent pulse (4s).
  await page.evaluate(() => window.__gb.setTimeLeft(4.5));
  await waitFor(async () => page.locator('#countdown.urgent').isVisible(), 3000, 'countdown urgent');
  await sleep(300);
  await page.screenshot({ path: path.join(OUT, `fix8-countdown-red-${name}.png`) });
  console.log(`fix8-countdown-red-${name}.png saved`);

  // Game over (daily): gold-numeral game-over score.
  await page.evaluate(() => window.__gb.startDaily('2026-11-11'));
  await waitFor(async () => (await page.evaluate(() => window.__gb.state())).running, 5000, 'daily running');
  await page.evaluate(() => window.__gb.setTimeLeft(0.3));
  await waitFor(async () => (await page.locator('#revive.show').isVisible()) || (await page.locator('#over.show').isVisible()), 6000, 'game over');
  if (await page.locator('#revive.show').isVisible()) await page.click('#btn-norevive');
  await waitFor(async () => page.locator('#over.show').isVisible(), 5000, 'game-over panel');
  await sleep(1400); // let the star reveal finish
  await page.screenshot({ path: path.join(OUT, `fix8-gameover-${name}.png`) });
  console.log(`fix8-gameover-${name}.png saved`);
  await ctx.close();
}

console.log('console errors:', errors.length ? errors.slice(0, 5) : '0');
await browser.close();
server.close();
