// Screenshots for the round-3 batch (Nov 11, ~6:53 PM): sync setTray, hidden
// 0-count badges, desktop tray under the board, new Sweep/Tray action icons,
// game-over heading "Daily challenge over". Two viewports (phone 390x844,
// desktop 1280x800): desktop gameplay HUD with a normal tray, dock empty,
// dock with charges (via the ?test=1 debug hook setCharges — never a
// player-facing cheat), daily game-over. Chromium launched --no-sandbox:
// the sandbox dies with SIGTRAP (rc=133) under this VM's seccomp/NoNewPrivs.
// Serves game-proto on localhost, drives headless Chromium via Playwright.
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
const PORT = 8913;
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

  // Gameplay: start, place a few pieces so LEVEL shows progress + timer bar visible.
  await page.goto(`http://localhost:${PORT}/?test=1`);
  await page.waitForSelector('#btn-play');
  await page.click('#btn-play');
  await page.waitForFunction(() => window.__gb.state().running);
  await page.waitForTimeout(500);
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.__gb.setTray([0, 0, 0]));
    await sleep(200);
    await page.evaluate((i) => window.__gb.place(0, 7, i * 2), i);
    await sleep(250);
  }
  await page.waitForTimeout(400);
  // Refill the tray so the HUD shot shows a NORMAL full tray: the game only
  // deals a fresh tray once all three slots are empty, so after the three
  // placements above slot 0 is legitimately null — that is correct behaviour,
  // but it reads as a broken tray in a screenshot. Deal a varied full tray.
  await page.evaluate(() => window.__gb.setTray([0, 3, 11]));
  await sleep(400);
  if (name === 'desktop') {
    await page.screenshot({ path: path.join(OUT, 'fix6-hud-desktop.png') });
    console.log('fix6-hud-desktop.png saved');
  }
  // Dock empty (no charges yet).
  await page.locator('#powerups').screenshot({ path: path.join(OUT, `fix6-dock-empty-${name}.png`) });
  console.log(`fix6-dock-empty-${name}.png saved`);
  // Dock with charges: grant one of each kind via the test hook.
  await page.evaluate(() => window.__gb.setCharges({ bomb: 1, sweep: 2, reshuffle: 1, star: 1 }));
  await sleep(500);
  await page.locator('#powerups').screenshot({ path: path.join(OUT, `fix6-dock-charged-${name}.png`) });
  console.log(`fix6-dock-charged-${name}.png saved`);

  // Game over (daily): heading must read "Daily challenge over", date (if
  // shown) in smaller text underneath, never in the heading.
  await page.evaluate(() => window.__gb.startDaily('2026-11-11'));
  await waitFor(async () => (await page.evaluate(() => window.__gb.state())).running, 5000, 'daily running');
  await page.evaluate(() => window.__gb.setTimeLeft(0.3));
  await waitFor(async () => (await page.locator('#revive.show').isVisible()) || (await page.locator('#over.show').isVisible()), 6000, 'game over');
  if (await page.locator('#revive.show').isVisible()) await page.click('#btn-norevive');
  await waitFor(async () => page.locator('#over.show').isVisible(), 5000, 'game-over panel');
  await sleep(1400); // let the star reveal finish
  await page.screenshot({ path: path.join(OUT, `fix6-gameover-${name}.png`) });
  console.log(`fix6-gameover-${name}.png saved`);
  const heading = await page.locator('#over h2, #over .ov-title').first().textContent().catch(() => '(no heading found)');
  console.log(`game-over heading (${name}): ${JSON.stringify(heading)}`);
  await ctx.close();
}

console.log('console errors:', errors.length ? errors.slice(0, 5) : '0');
await browser.close();
server.close();
