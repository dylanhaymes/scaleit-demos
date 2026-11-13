// Screenshots for cosmetics packs (Nov 12, ~3:10 PM): the 10-pack picker,
// favorites, every pack applied to a live board, the level-2 unlock line,
// and the menu with music started on the first title tap. Two viewports
// (phone 390x844, desktop 1280x800). Chromium launched --no-sandbox
// (the sandbox dies with SIGTRAP rc=133 under this VM's seccomp).
// Serves game-proto on localhost, drives headless Chromium via Playwright.
// Locked paid packs are shown via the preview hook only (test-only) —
// nothing here buys anything.
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
const PORT = 8919;
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
const PACKS = ['classic-candy', 'gold-star', 'crayon-box', 'construction-paper', 'gummy-garden', 'midnight-galaxy', 'ocean-gummies', 'sunshine-citrus', 'frosted-winter', 'lollipop-swirl'];
// Scattered single cells — no full row/column, so nothing clears.
const CELLS = [[0, 0], [0, 1], [1, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6], [7, 7], [0, 7], [7, 0]];

for (const [name, vp] of [['phone', { width: 390, height: 844, dsf: 2 }], ['desktop', { width: 1280, height: 800, dsf: 1 }]]) {
  // --- Level 2 player (300 XP): Gold Star unlocked, picker is rich. ---
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dsf });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(name + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push(name + ': pageerror: ' + e.message));
  await page.addInitScript(() => {
    localStorage.setItem('gb_tut_done', '1');
    localStorage.setItem('gb_xp', '300');
  });
  await page.goto(`http://localhost:${PORT}/?test=1`);
  await page.waitForSelector('#btn-play');
  await sleep(600);

  // Title at level 2: next reward is the real level-5 pack.
  await page.screenshot({ path: path.join(OUT, `cosmetics-title-${name}.png`) });
  console.log(`cosmetics-title-${name}.png saved`);

  // Menu music: first tap anywhere on the title starts it (no Play needed).
  await page.click('#title .logo');
  await sleep(1200);
  const audio = await page.evaluate(() => window.__gb.state());
  console.log(`${name}: menu music after title tap — ctx=${audio.audioState} scheduler=${audio.musicScheduler} scheduled=${audio.musicScheduled} running=${audio.running}`);
  await page.screenshot({ path: path.join(OUT, `cosmetics-menu-music-${name}.png`) });
  console.log(`cosmetics-menu-music-${name}.png saved`);

  // Picker: 10 cards, Gold Star usable, paid packs priced + locked.
  await page.click('#btn-skins');
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, `cosmetics-picker-${name}.png`) });
  console.log(`cosmetics-picker-${name}.png saved`);

  // Favorites: star Classic Candy + Gold Star, both land at the top.
  await page.click('[data-fav="classic-candy"]');
  await page.click('[data-fav="gold-star"]');
  await sleep(300);
  await page.screenshot({ path: path.join(OUT, `cosmetics-favorites-${name}.png`) });
  console.log(`cosmetics-favorites-${name}.png saved`);
  await page.click('#btn-skins-close');
  await sleep(200);

  // Every pack on a live board: one board, recolored per pack by slot.
  await page.click('#btn-play');
  await page.waitForFunction(() => window.__gb.state().running, null, { timeout: 5000 });
  await sleep(300);
  for (const slug of PACKS) {
    await page.evaluate((s) => window.__gb.previewPack(s), slug);
    // Refill the tray + place scattered singles (first pack only needs
    // the placements; later packs recolor the same board by slot).
    const placed = await page.evaluate(() => window.__gb.state().placed);
    if (placed === 0) {
      await page.evaluate((cells) => {
        let slot = 0;
        for (const [r, c] of cells) {
          if (slot === 0) window.__gb.setTray([0, 0, 0]);
          window.__gb.place(slot, r, c);
          slot = (slot + 1) % 3;
        }
      }, CELLS);
      await sleep(300);
    } else {
      await page.evaluate(() => window.__gb.setTray([0, 0, 0]));
      await sleep(200);
    }
    const st = await page.evaluate(() => window.__gb.state());
    console.log(`${name}: pack ${slug} — pack=${st.pack} material=${st.packMaterial} placed=${st.placed}`);
    await page.screenshot({ path: path.join(OUT, `cosmetics-pack-${slug}-${name}.png`) });
    console.log(`cosmetics-pack-${slug}-${name}.png saved`);
  }
  await ctx.close();

  // --- Level-up unlock line: 290 XP + one game (25 XP) -> level 2. ---
  const ctx2 = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dsf });
  const page2 = await ctx2.newPage();
  page2.on('console', (m) => { if (m.type() === 'error') errors.push(name + '-unlock: ' + m.text()); });
  page2.on('pageerror', (e) => errors.push(name + '-unlock: pageerror: ' + e.message));
  await page2.addInitScript(() => {
    localStorage.setItem('gb_tut_done', '1');
    // 75 XP + one game (25 XP, no line) = 100 -> Player Level 2.
    // (290 XP was already level 2 — level 2 starts at 100 XP — so no
    // unlock could ever show; and revive is score-gated, so a piece
    // must be placed first or #revive never appears.)
    localStorage.setItem('gb_xp', '75');
  });
  await page2.goto(`http://localhost:${PORT}/?test=1`);
  await page2.waitForSelector('#btn-play');
  await page2.click('#btn-play');
  await page2.waitForFunction(() => window.__gb.state().running, null, { timeout: 5000 });
  await page2.evaluate(() => { window.__gb.setTray([0, 0, 0]); window.__gb.place(0, 7, 7); }); // score > 0 so revive is offered
  await sleep(300);
  await page2.evaluate(() => window.__gb.setTimeLeft(0.3));
  await page2.waitForSelector('#revive.show', { timeout: 6000 });
  await page2.click('#btn-norevive');
  await page2.waitForSelector('#over.show', { timeout: 5000 });
  await sleep(400);
  console.log(`${name}: unlock line — ${await page2.locator('#ov-xp').textContent()}`);
  await page2.screenshot({ path: path.join(OUT, `cosmetics-unlock-${name}.png`) });
  console.log(`cosmetics-unlock-${name}.png saved`);
  await ctx2.close();
}

console.log('console errors:', errors.length ? errors.slice(0, 5) : '0');
await browser.close();
server.close();
