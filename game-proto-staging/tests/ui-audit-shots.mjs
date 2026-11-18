// UI audit screenshots: phone (390x844) + desktop (1280x800).
// Serves game-proto/ itself on localhost:8931. Run: node tests/ui-audit-shots.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/home/hatch/.cache/giil/node_modules/playwright/index.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..', 'game-proto');
const OUT = path.resolve(SCRIPT_DIR, 'ui-audit');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 8931;
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

const browser = await chromium.launch({ executablePath: '/home/hatch/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome', args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, name) });
  console.log('SHOT', name);
}

async function runViewport(label, width, height, dsf) {
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dsf });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  await page.addInitScript(() => { localStorage.setItem('gb_tut_done', '1'); });
  await page.goto(`http://localhost:${PORT}/?test=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#btn-play');
  await sleep(400);
  await shot(page, `${label}-title.png`);

  // HUD mid-game
  await page.click('#btn-play');
  await sleep(1200);
  await shot(page, `${label}-hud.png`);

  // Dock empty / charged
  await page.evaluate(() => window.__gb.setCharges({ bomb: 0, sweep: 0, reshuffle: 0, star: 0 }));
  await sleep(400);
  await shot(page, `${label}-dock-empty.png`);
  await page.evaluate(() => window.__gb.setCharges({ bomb: 3, sweep: 3, reshuffle: 3, star: 3 }));
  await sleep(400);
  await shot(page, `${label}-dock-charged.png`);

  // Settings (via pause menu)
  await page.click('#btn-menu');
  await page.click('#btn-menu-settings');
  await sleep(500);
  await shot(page, `${label}-settings.png`);
  await page.click('#btn-set-close');
  await sleep(300);

  // Back to title for the overlay screens
  await page.click('#btn-menu');
  await page.click('#btn-menu-home');
  await sleep(500);

  // Friends panel
  await page.click('#btn-account');
  await sleep(500);
  await shot(page, `${label}-friends.png`);
  await page.click('#btn-acct-close');
  await sleep(300);

  // Leaderboards
  await page.click('#btn-boards');
  await sleep(800);
  await shot(page, `${label}-boards.png`);

  // Store
  await page.click('#btn-boards-close');
  await sleep(300);
  await page.click('#btn-store');
  await sleep(500);
  await shot(page, `${label}-store.png`);
  await page.click('#btn-store-close');
  await sleep(300);

  // Daily game-over: start the daily, run the clock out
  await page.evaluate(() => window.__gb.startDaily());
  await sleep(800);
  await page.evaluate(() => window.__gb.setTimeLeft(1));
  try {
    await page.waitForSelector('#over.show, #over:not(.hidden)', { timeout: 15000 });
  } catch { /* interstitial may be showing first */ }
  await sleep(1000);
  // If the 1-in-3 interstitial is up, close it and wait for the panel
  const adVisible = await page.evaluate(() => { const a = document.querySelector('#ad'); return a && getComputedStyle(a).display !== 'none' && a.classList.contains('show'); }).catch(() => false);
  if (adVisible) { await page.click('#ad-close').catch(() => {}); await sleep(1000); }
  await page.waitForSelector('#over', { state: 'visible', timeout: 10000 }).catch(() => {});
  await sleep(500);
  await shot(page, `${label}-daily-over.png`);

  console.log(label.toUpperCase(), 'console errors:', errors.length ? errors.join(' | ') : 'none');
  await ctx.close();
}

await runViewport('phone', 390, 844, 2);
await runViewport('desktop', 1280, 800, 1);

// Tutorial: fresh profile, no gb_tut_done
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/?test=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#btn-play');
  await page.click('#btn-play');
  await sleep(1500);
  await shot(page, 'phone-tutorial.png');
  await ctx.close();
}

await browser.close();
server.close();
console.log('DONE');
