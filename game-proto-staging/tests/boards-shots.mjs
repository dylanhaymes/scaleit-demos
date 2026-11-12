// Screenshots for Update 3 batch 2 (Nov 12, ~6:15 AM): leaderboards —
// Daily sample board, Weekly sample board, Friends empty state, and a
// named guest with a best score so their own row shows in the sample.
// Two viewports (phone 390x844, desktop 1280x800). Chromium launched
// --no-sandbox: the sandbox dies with SIGTRAP (rc=133) under this VM's
// seccomp/NoNewPrivs. Serves game-proto on localhost, drives headless
// Chromium via Playwright. Guests only here: the live board needs a
// signed-in player + deployed Firestore rules (batch 4), so the sample
// board is the correct thing to screenshot in this batch.
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

for (const [name, vp] of [['phone', { width: 390, height: 844, dsf: 2 }], ['desktop', { width: 1280, height: 800, dsf: 1 }]]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dsf });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(name + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push(name + ': pageerror: ' + e.message));
  await page.addInitScript(() => {
    localStorage.setItem('gb_tut_done', '1');
    localStorage.setItem('gb_best', '1234');
  });

  // Title screen with the new Leaderboards button.
  await page.goto(`http://localhost:${PORT}/?test=1`);
  await page.waitForSelector('#btn-play');
  await sleep(600);
  await page.screenshot({ path: path.join(OUT, `boards-home-${name}.png`) });
  console.log(`boards-home-${name}.png saved`);

  // Named guest so the sample board shows the player's own row.
  await page.evaluate(() => window.__gb.setAccountName('Cool Player'));
  await sleep(200);

  // Daily sample board.
  await page.click('#btn-boards');
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, `boards-daily-${name}.png`) });
  console.log(`boards-daily-${name}.png saved`);

  // Weekly sample board.
  await page.click('#board-tab-weekly');
  await sleep(300);
  await page.screenshot({ path: path.join(OUT, `boards-weekly-${name}.png`) });
  console.log(`boards-weekly-${name}.png saved`);

  // Friends scope: honest empty state for guests, no sample names.
  await page.click('#board-scope-friends');
  await sleep(300);
  await page.screenshot({ path: path.join(OUT, `boards-friends-${name}.png`) });
  console.log(`boards-friends-${name}.png saved`);

  await page.click('#btn-boards-close');
  await sleep(200);
  await ctx.close();
}

console.log('console errors:', errors.length ? errors.slice(0, 5) : '0');
await browser.close();
server.close();
