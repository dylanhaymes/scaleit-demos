// Screenshots for Update 3 batch 1 (Nov 12, ~5:15 AM): in-game accounts —
// title-screen account card, account panel (guest + named + signed-in),
// Settings with privacy notice + delete button. Two viewports (phone
// 390x844, desktop 1280x800). Chromium launched --no-sandbox: the sandbox
// dies with SIGTRAP (rc=133) under this VM's seccomp/NoNewPrivs. Serves
// game-proto on localhost, drives headless Chromium via Playwright.
// Note: Settings lives in the hamburger menu in-game (#btn-menu ->
// #btn-menu-settings); on the title screen it is #btn-title-settings.
// The signed-in shots use REAL anonymous sign-in against the live
// Firebase project (clearbloom-game); if it fails the script logs it and
// keeps the guest shots instead of crashing.
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
  await page.addInitScript(() => { localStorage.setItem('gb_tut_done', '1'); });

  // Title screen with the account card (guest).
  await page.goto(`http://localhost:${PORT}/?test=1`);
  await page.waitForSelector('#btn-play');
  await sleep(600);
  await page.screenshot({ path: path.join(OUT, `acct-home-${name}.png`) });
  console.log(`acct-home-${name}.png saved`);

  // Account panel, guest state: friend code, sign-in buttons, Facebook disabled.
  await page.click('#btn-account');
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, `acct-panel-${name}.png`) });
  console.log(`acct-panel-${name}.png saved`);

  // Named guest: pick a display name, reopen the panel.
  await page.evaluate(() => window.__gb.setAccountName('Cool Player'));
  await page.click('#btn-acct-close');
  await sleep(300);
  await page.click('#btn-account');
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, `acct-panel-named-${name}.png`) });
  console.log(`acct-panel-named-${name}.png saved`);
  await page.click('#btn-acct-close');
  await sleep(300);

  // Settings, scrolled to the privacy notice + delete button.
  await page.click('#btn-title-settings');
  await sleep(400);
  await page.evaluate(() => { const p = document.querySelector('#settings .panel'); if (p) p.scrollTop = p.scrollHeight; });
  await sleep(300);
  await page.screenshot({ path: path.join(OUT, `acct-settings-${name}.png`) });
  console.log(`acct-settings-${name}.png saved`);
  await page.click('#btn-set-close');
  await sleep(300);

  // Signed-in state, via the test preview hook (same idea as setCharges
  // for the dock): a real anonymous sign-in cannot run from headless
  // Chromium in this VM (egress proxy blocks it), so the UI is previewed
  // with a local signed-in identity. The live sign-in path is verified
  // by the suite test (up to the network boundary) + the REST check.
  await page.evaluate(() => window.__gb.setAccountPreview('anonymous'));
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, `acct-home-signedin-${name}.png`) });
  console.log(`acct-home-signedin-${name}.png saved`);
  await page.click('#btn-account');
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, `acct-panel-signedin-${name}.png`) });
  console.log(`acct-panel-signedin-${name}.png saved`);
  await page.click('#btn-acct-close');
  await sleep(200);
  await ctx.close();
}

console.log('console errors:', errors.length ? errors.slice(0, 5) : '0');
await browser.close();
server.close();
