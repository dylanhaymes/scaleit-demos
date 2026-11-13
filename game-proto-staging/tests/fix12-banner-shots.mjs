// Fresh banner-text screenshots AFTER fix12 (0-blur shadow removed from
// #banner-text). Captures the mid-clear banner ("Nice!" / combo word) on
// phone + desktop from the current game tree, so the gradient can be
// checked for lines inside the glyphs.
// Usage: node tests/fix12-banner-shots.mjs
// Serves game-proto on localhost:8923, drives headless Chromium via Playwright.
// Outputs: design5/tests/fix12-banner-desktop-after.png,
//           design5/tests/fix12-banner-phone-after.png
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
const PORT = 8923;
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
  // Tutorial steps 1-3: step 2 clears a line, step 3 is the combo moment
  // when the banner ("Nice!" / combo word) + canvas popups fire together.
  await page.goto(`http://localhost:${PORT}/?test=1`);
  await page.waitForSelector('#btn-play');
  await page.click('#btn-play');
  await waitFor(async () => page.locator('#tut.show').isVisible(), 5000, 'tutorial up');
  await page.evaluate(() => window.__gb.place(0, 7, 3)); // step 1
  await sleep(500);
  await page.evaluate(() => window.__gb.place(0, 7, 7)); // step 2: line clear
  await sleep(700);
  await page.evaluate(() => window.__gb.place(0, 6, 3)); // step 3: combo
  await sleep(450); // banner + canvas popups mid-flight
  const banner = await page.evaluate(() => {
    const b = document.getElementById('banner');
    const t = document.getElementById('banner-text');
    return { visible: !b.classList.contains('hidden'), text: t ? t.textContent : '' };
  });
  console.log(`${name}: banner visible=${banner.visible} text="${banner.text}"`);
  await page.screenshot({ path: path.join(DIR, `fix12-banner-${name}-after.png`) });
  console.log(`fix12-banner-${name}-after.png saved`);
  await ctx.close();
}
await browser.close();
await new Promise((r) => server.close(r));
console.log('console errors:', errors.length ? errors : 'none');
console.log('BANNER SHOTS DONE');
