// Screenshots for Dylan feedback Nov 12 ~3:01-3:05 PM (items 1-5): wordmark
// saturation x1.15, #banner-text hard-lines fix, tutorial arrow much larger,
// standalone white gap at the bottom, pause-menu "Main Menu" entry.
// Usage: node tests/fix11-shots.mjs before|after
// Serves game-proto on localhost, drives headless Chromium via Playwright.
// Two viewports (phone 390x844, desktop 1280x800) + an iPhone 14 Pro Max
// viewport (430x932, DPR 3) for the standalone-gap check.
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

const MODE = process.argv[2] === 'after' ? 'after' : 'before';
const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '..', 'game-proto');
const OUT = DIR;
const PORT = 8921;
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
const shot = (name) => path.join(OUT, `fix11-${name}-${MODE}.png`);

for (const [name, vp] of [['phone', { width: 390, height: 844, dsf: 2 }], ['desktop', { width: 1280, height: 800, dsf: 1 }]]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dsf });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(name + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push(name + ': pageerror: ' + e.message));
  try {
    // 1. Title / wordmark.
    await page.goto(`http://localhost:${PORT}/?test=1`);
    await page.waitForSelector('#btn-play');
    await sleep(600);
    await page.screenshot({ path: shot(`wordmark-${name}`) });
    console.log(`fix11-wordmark-${MODE}-${name}.png saved`);

    // 2. Tutorial: drive to step 5 (power-up / arrow). Step 3 is the combo
    // moment: banner ("Nice!") + canvas popups fire together — capture it.
    await page.click('#btn-play');
    await waitFor(async () => page.locator('#tut.show').isVisible(), 5000, 'tutorial up');
    await page.evaluate(() => window.__gb.place(0, 7, 3)); // step 1
    await sleep(500);
    await page.evaluate(() => window.__gb.place(0, 7, 7)); // step 2: line clear
    await sleep(700);
    await page.evaluate(() => window.__gb.place(0, 6, 3)); // step 3: combo
    await sleep(450); // banner + canvas popups mid-flight
    await page.screenshot({ path: shot(`banner-${name}`) });
    console.log(`fix11-banner-${MODE}-${name}.png saved`);
    await sleep(800);
    await page.evaluate(() => window.__gb.place(0, 5, 5)); // step 4: time
    await sleep(900);
    const tutStep = await page.evaluate(() => window.__gb.state().tutorialStep);
    console.log(`${name}: tutorial step now ${tutStep} (want 4 = power-up step)`);
    const geo = await page.evaluate(() => {
      const a = document.querySelector('#tut-arrow').getBoundingClientRect();
      const s = document.querySelector('#powerups .pu[data-pu="star"]').getBoundingClientRect();
      const cv = document.querySelector('#cv').getBoundingClientRect();
      return { arrow: { x: a.x, y: a.y, w: a.width, h: a.height }, slot: { x: s.x, y: s.y, w: s.width, h: s.height }, canvas: { x: cv.x, y: cv.y, w: cv.width, h: cv.height }, innerH: window.innerHeight };
    });
    console.log(`${name}: arrow/slot/canvas geometry:`, JSON.stringify(geo));
    await page.screenshot({ path: shot(`arrow-${name}`) });
    console.log(`fix11-arrow-${MODE}-${name}.png saved`);
    // Close the tutorial (skip) so the page is a plain game for the rest.
    await page.click('#tut-skip');
    await waitFor(async () => page.locator('#title.show').isVisible(), 3000, 'back at title after skip');

    // 3. Pause menu with the Main Menu entry.
    await page.click('#btn-play');
    await waitFor(async () => (await page.evaluate(() => window.__gb.state().running)), 5000, 'game running');
    await page.click('#btn-menu');
    await waitFor(async () => page.locator('#menu.show').isVisible(), 3000, 'menu open');
    await sleep(300);
    await page.screenshot({ path: shot(`pausemenu-${name}`) });
    console.log(`fix11-pausemenu-${MODE}-${name}.png saved`);
    // Quit to menu via the new entry (if present) and confirm the save.
    const hasHome = await page.locator('#btn-menu-home').count();
    console.log(`${name}: #btn-menu-home present: ${hasHome}`);
    if (hasHome) {
      await page.click('#btn-menu-home');
      await waitFor(async () => page.locator('#title.show').isVisible(), 3000, 'back at title after Main Menu');
      const saved = await page.evaluate(() => !!localStorage.getItem('gb_save_v2') || !!localStorage.getItem('gb_save'));
      const playLabel = await page.locator('#btn-play').textContent();
      console.log(`${name}: save present after quit: ${saved}; Play button reads: "${playLabel}"`);
    } else {
      // No Main Menu entry yet (before state): close the menu to continue.
      await page.click('#btn-resume');
      await sleep(300);
    }
    await page.screenshot({ path: shot(`quit-${name}`) });
    console.log(`fix11-quit-${MODE}-${name}.png saved`);

    // 4. Game over (timeout): score numerals on the game-over panel.
    await page.click('#btn-play');
    await waitFor(async () => (await page.evaluate(() => window.__gb.state().running)), 5000, 'game running again');
    await page.evaluate(() => window.__gb.setTimeLeft(0.3));
    await waitFor(async () => (await page.locator('#revive.show').isVisible()) || (await page.locator('#over.show').isVisible()), 8000, 'game over');
    if (await page.locator('#revive.show').isVisible()) await page.click('#btn-norevive');
    await waitFor(async () => page.locator('#over.show').isVisible(), 5000, 'game-over panel');
    await sleep(1600); // let the NEW BEST badge finish popping (if any)
    await page.screenshot({ path: shot(`gameover-${name}`) });
    console.log(`fix11-gameover-${MODE}-${name}.png saved`);

    // 5. Countdown numerals (sprite type): force the <=20s countdown.
    await page.click('#btn-again');
    await waitFor(async () => (await page.evaluate(() => window.__gb.state().running)), 5000, 'game running for countdown');
    await page.evaluate(() => window.__gb.setTimeLeft(15));
    await waitFor(async () => page.locator('#countdown.on').isVisible(), 5000, 'countdown showing');
    await sleep(400);
    await page.screenshot({ path: shot(`countdown-${name}`) });
    console.log(`fix11-countdown-${MODE}-${name}.png saved`);
  } catch (e) {
    console.log(`${name}: SHOT ERROR:`, e.message);
    errors.push(name + ': shot: ' + e.message);
  }
  await ctx.close();
}

// 5. Standalone-gap check: iPhone 14 Pro Max viewport (430x932, DPR 3),
// in-game; report the bottom rows' colours from the page itself.
{
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push('iphone: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('iphone: pageerror: ' + e.message));
  try {
    await page.addInitScript(() => { localStorage.setItem('gb_tut_done', '1'); });
    await page.goto(`http://localhost:${PORT}/?test=1`);
    await page.waitForSelector('#btn-play');
    await page.click('#btn-play');
    await waitFor(async () => (await page.evaluate(() => window.__gb.state().running)), 5000, 'game running');
    await sleep(800);
    const dims = await page.evaluate(() => {
      const de = document.documentElement;
      return { innerW: window.innerWidth, innerH: window.innerHeight, docH: de.scrollHeight, bodyH: document.body.scrollHeight, htmlBg: getComputedStyle(de).backgroundColor, bodyBg: getComputedStyle(document.body).backgroundColor };
    });
    console.log('iphone viewport dims:', JSON.stringify(dims));
    await page.screenshot({ path: shot('gap-iphone') });
    console.log(`fix11-gap-iphone-${MODE}.png saved`);
  } catch (e) {
    console.log('iphone: SHOT ERROR:', e.message);
    errors.push('iphone: shot: ' + e.message);
  }
  await ctx.close();
}

console.log('console errors:', errors.length ? errors.slice(0, 8) : '0');
await browser.close();
server.close();
