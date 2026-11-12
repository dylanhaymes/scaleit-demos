// Screenshots for Dylan feedback #1.3 + #3 (Nov 11, ~9:30 PM): the tutorial
// power-up step (dock spotlight + arrow + star slot) and the armed Bomb
// chip (single glossy descriptor in its reserved slot — board must not
// move). Two viewports (phone 390x844, desktop 1280x800). Chromium launched
// --no-sandbox (see fix8-shots.mjs). Serves game-proto on localhost.
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
const PORT = 8918;
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

  // Armed Bomb chip: full board, one glossy descriptor above the dock.
  await page.addInitScript(() => { localStorage.setItem('gb_tut_done', '1'); });
  await page.goto(`http://localhost:${PORT}/?test=1`);
  await page.waitForSelector('#btn-play');
  await page.click('#btn-play');
  await waitFor(async () => (await page.evaluate(() => window.__gb.state().running)), 5000, 'game running');
  await page.evaluate(() => window.__gb.setCharges({ bomb: 1 }));
  await page.click('.pu[data-pu="bomb"]');
  await waitFor(async () => (await page.evaluate(() => window.__gb.state())).armed === 'bomb', 3000, 'bomb armed');
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, `fix9-armed-${name}.png`) });
  console.log(`fix9-armed-${name}.png saved`);

  // Tutorial power-up step: fresh profile, play the scripted steps with
  // the debug place hook (it advances the tutorial the same way a drop
  // does), then the dock spotlight + arrow + star slot show.
  const ctx2 = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dsf });
  const page2 = await ctx2.newPage();
  page2.on('console', (m) => { if (m.type() === 'error') errors.push(name + ': ' + m.text()); });
  page2.on('pageerror', (e) => errors.push(name + ': pageerror: ' + e.message));
  await page2.goto(`http://localhost:${PORT}/?test=1`);
  await page2.waitForSelector('#btn-play');
  await page2.click('#btn-play');
  await waitFor(async () => page2.locator('#tut.show').isVisible(), 5000, 'tutorial up');
  await page2.evaluate(() => window.__gb.place(0, 7, 3)); // step 1: place
  await sleep(500);
  await page2.evaluate(() => window.__gb.place(0, 7, 7)); // step 2: clear a line
  await sleep(700);
  await page2.evaluate(() => window.__gb.place(0, 6, 3)); // step 3: combo
  await sleep(700);
  await page2.evaluate(() => window.__gb.place(0, 5, 5)); // step 4: time
  await sleep(900);
  const tutStep = await page2.evaluate(() => window.__gb.state().tutorialStep);
  console.log(`${name}: tutorial step now ${tutStep} (want 4 = power-up step)`);
  await page2.screenshot({ path: path.join(OUT, `fix9-tut-powerup-${name}.png`) });
  console.log(`fix9-tut-powerup-${name}.png saved`);
  await ctx.close();
  await ctx2.close();
}

console.log('console errors:', errors.length ? errors.slice(0, 5) : '0');
await browser.close();
server.close();
