// Screenshots for Dylan feedback #1.1 (Nov 11): the NEW BEST badge — glossy
// gold medallion in the game-over panel (same component as the in-game
// banner). Fresh profile, score a line, force timeout, decline revive.
// Two viewports (phone 390x844, desktop 1280x800). Chromium --no-sandbox.
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
const ROW7 = ['........', '........', '........', '........', '........', '........', '........', '#######.'];

for (const [name, vp] of [['phone', { width: 390, height: 844, dsf: 2 }], ['desktop', { width: 1280, height: 800, dsf: 1 }]]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dsf });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(name + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push(name + ': pageerror: ' + e.message));
  // Fresh profile (best 0) + tutorial done, so Play starts a classic game.
  await page.addInitScript(() => { localStorage.setItem('gb_tut_done', '1'); });
  await page.goto(`http://localhost:${PORT}/?test=1`);
  await page.waitForSelector('#btn-play');
  await page.click('#btn-play');
  await waitFor(async () => (await page.evaluate(() => window.__gb.state().running)), 5000, 'game running');
  await page.evaluate((rows) => { window.__gb.setBoard(rows); window.__gb.setTray([0, 0, 0]); }, ROW7);
  await sleep(150);
  await page.evaluate(() => window.__gb.place(0, 7, 7)); // clears row 7, score > 0
  await sleep(300);
  await page.evaluate(() => window.__gb.setTimeLeft(0.3));
  await waitFor(async () => page.locator('#revive.show').isVisible(), 6000, 'revive overlay');
  await page.click('#btn-norevive');
  await waitFor(async () => page.locator('#over.show').isVisible(), 5000, 'game-over panel');
  await sleep(1200); // stars reveal; badge settles
  const badge = await page.evaluate(() => {
    const el = document.getElementById('ov-new');
    return { visible: !el.classList.contains('hidden'), text: el.textContent.trim() };
  });
  console.log(`${name}: badge`, JSON.stringify(badge));
  await page.screenshot({ path: path.join(OUT, `fix10-badge-${name}.png`) });
  console.log(`fix10-badge-${name}.png saved`);
  await ctx.close();
}
console.log('console errors:', errors.length ? errors.slice(0, 5) : '0');
await browser.close();
server.close();
