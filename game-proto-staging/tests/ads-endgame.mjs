// Ads endgame probe (Dylan, Nov 12 9:06 PM — interstitial 1 IN 3 at game end):
// the rewarded revive is gone (game over is game over); an interstitial now
// shows when a game ends, before the game-over panel, on a 1-in-3 random
// roll — never after the first game of a session, never within 2 minutes of
// the last one, never tied to score/performance, and timeout-guarded (10 s)
// so a hung ad can never trap the player.
//   (a) game over never offers a revive (no #revive in the DOM, no rewarded
//       call, #over shows)
//   (b) the roll fires ~1/3 over 120 direct calls (band 25-55, expected 40)
//   (c) never after the first game of a session (roll forced to hit)
//   (d) never mid-game (roll forced to hit, play moves, no ad)
//   (e) 2-min gap respected (hit, then blocked, then hit after backdating)
//   (f) a hung ad (never-resolving provider) still reaches the game-over
//       screen within ~10 s (the 10 s race)
//   (g) Play again after a game-end ad shows no second ad
//   (h) an old save with revived:true loads fine
// Run: node tests/ads-endgame.mjs  (serves game-proto/ itself, port 8919)
// NOTE: Chromium outage #7 was active when this was written — UNRUN.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let chromium;
for (const cand of [process.env.PLAYWRIGHT_MODULE, 'playwright', '/home/hatch/.cache/giil/node_modules/playwright/index.mjs']) {
  if (!cand) continue;
  try { ({ chromium } = await import(cand)); break; } catch { /* try next */ }
}
if (!chromium) throw new Error('Playwright not found');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'game-proto');
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

const results = [];
let errors = [];
async function test(name, fn) {
  try { await fn(); results.push(['PASS', name]); console.log('PASS', name); }
  catch (e) { results.push(['FAIL', name, e.message]); console.log('FAIL', name, '-', e.message); }
}
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function ok(c, msg) { if (!c) throw new Error(msg); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeout = 8000, label = 'condition') {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - t0 > timeout) throw new Error('timeout waiting for ' + label);
    await sleep(120);
  }
}

const chromiumPath = process.env.CHROMIUM_PATH
  || ['/home/hatch/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({
  ...(chromiumPath ? { executablePath: chromiumPath } : {}),
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
});

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.addInitScript(() => { localStorage.setItem('gb_tut_done', '1'); });
  await page.goto(`http://localhost:${PORT}/?test=1`);
  await page.waitForSelector('#btn-play');
  return { ctx, page };
}
async function startClassic(page) {
  await page.click('#btn-play');
  await waitFor(async () => (await page.evaluate(() => window.__gb.state().running)), 5000, 'game running');
}
async function setupBoard(page, rows, tray = [0, 0, 0]) {
  await page.evaluate(({ rows, tray }) => { window.__gb.setBoard(rows); window.__gb.setTray(tray); }, { rows, tray });
  await sleep(150);
}
const EMPTY = ['........', '........', '........', '........', '........', '........', '........', '........'];
const st = (page) => page.evaluate(() => window.__gb.state());
// End the current game by timeout and wait for the game-over panel.
async function endByTimeout(page, timeout = 15000) {
  await page.evaluate(() => window.__gb.setTimeLeft(0.4));
  await waitFor(async () => page.locator('#over.show').isVisible(), timeout, 'game-over panel');
}
// Provider that resolves instantly and counts calls (no DOM overlay).
async function installCountingProvider(page) {
  await page.evaluate(() => {
    window.__adCalls = { interstitial: 0, rewarded: 0 };
    window.__gb.ads.setProvider({ name: 'count', init() {}, showInterstitial() { window.__adCalls.interstitial++; return Promise.resolve({ shown: true }); }, showRewarded() { window.__adCalls.rewarded++; return Promise.resolve({ rewarded: false }); } });
  });
}
const adCalls = (page) => page.evaluate(() => ({ ...window.__adCalls }));
// Force the 1-in-3 roll to hit (0.01 < 1/3). Stub AFTER the game starts and
// the board is set up: classic deals use Math.random, so stubbing earlier
// would change the deal. Restored per test by using a fresh page.
async function forceRollHit(page) {
  await page.evaluate(() => { window.__origRandom = Math.random; Math.random = () => 0.01; });
}

// (a) game over never offers a revive.
await test('(a) game over: no revive overlay, no rewarded call, panel shows', async () => {
  const { page } = await newPage();
  await installCountingProvider(page);
  await startClassic(page);
  await setupBoard(page, EMPTY, [0, 0, 0]);
  await page.evaluate(() => window.__gb.place(0, 0, 0)); // score > 0: the old code offered a revive here
  await endByTimeout(page);
  eq(await page.evaluate(() => document.querySelector('#revive')), null, '#revive removed from the DOM');
  eq(await page.evaluate(() => document.querySelector('#btn-revive')), null, '#btn-revive removed from the DOM');
  eq((await adCalls(page)).rewarded, 0, 'no rewarded call');
  await page.close();
});

// (b) the roll fires ~1/3 over 120 direct calls (band 25-55, expected 40).
await test('(b) roll rate ~1/3 over 120 calls', async () => {
  const { page } = await newPage();
  await installCountingProvider(page);
  const hits = await page.evaluate(async () => {
    let hits = 0;
    for (let i = 0; i < 120; i++) {
      window.__gb.ads._lastInterstitial = 0; // keep the 2-min gap out of the rate check
      if (await window.__gb.ads.maybeInterstitialAtGameEnd(2)) hits++;
    }
    return hits;
  });
  ok(hits >= 25 && hits <= 55, `roll hits ${hits}/120, expected ~40 (band 25-55)`);
  await page.close();
});

// (c) never after the first game of a session, even with the roll forced.
await test('(c) no ad after the first game of a session', async () => {
  const { page } = await newPage();
  await installCountingProvider(page);
  await startClassic(page);
  await setupBoard(page, EMPTY, [0, 0, 0]);
  await page.evaluate(() => window.__gb.place(0, 0, 0));
  await forceRollHit(page);
  await endByTimeout(page);
  eq((await adCalls(page)).interstitial, 0, 'no interstitial after game 1');
  eq(await page.locator('#ad.show').isVisible(), false, 'no ad overlay after game 1');
  await page.close();
});

// (d) never mid-game, even with the roll forced.
await test('(d) no ad mid-game', async () => {
  const { page } = await newPage();
  await installCountingProvider(page);
  await startClassic(page);
  await setupBoard(page, EMPTY, [0, 0, 0]);
  await forceRollHit(page);
  await page.evaluate(() => window.__gb.place(0, 0, 0));
  await page.evaluate(() => window.__gb.place(1, 0, 1));
  await sleep(2000);
  eq((await adCalls(page)).interstitial, 0, 'no interstitial mid-game');
  eq(await page.locator('#ad.show').isVisible(), false, 'no ad overlay mid-game');
  eq((await st(page)).running, true, 'game still running');
  await page.close();
});

// (e) 2-min gap respected.
await test('(e) 2-min gap blocks, then expires', async () => {
  const { page } = await newPage();
  await installCountingProvider(page);
  const r = await page.evaluate(async () => {
    const A = window.__gb.ads;
    const origRandom = Math.random;
    Math.random = () => 0.01;
    A._lastInterstitial = 0;
    const first = await A.maybeInterstitialAtGameEnd(2);
    const second = await A.maybeInterstitialAtGameEnd(2); // gap blocks
    A._lastInterstitial = Date.now() - 130000; // 130 s ago: gap expired
    const third = await A.maybeInterstitialAtGameEnd(2);
    Math.random = origRandom;
    return { first, second, third };
  });
  eq(r.first, true, 'first call shows an ad');
  eq(r.second, false, 'second call inside 2 min is blocked');
  eq(r.third, true, 'call after the gap expires shows an ad');
  await page.close();
});

// (f) a hung ad still reaches the game-over screen (10 s race).
await test('(f) hung ad: game-over panel still appears within ~10 s', async () => {
  const { page } = await newPage();
  await page.evaluate(() => {
    window.__gb.ads.setProvider({ name: 'hang', init() {}, showInterstitial() { return new Promise(() => {}); }, showRewarded() { return Promise.resolve({ rewarded: false }); } });
  });
  await startClassic(page);
  await setupBoard(page, EMPTY, [0, 0, 0]);
  await page.evaluate(() => window.__gb.place(0, 0, 0));
  await endByTimeout(page); // game 1: first-game guard, no ad
  await page.click('#btn-again');
  await waitFor(async () => (await st(page)).running, 5000, 'game 2 running');
  await setupBoard(page, EMPTY, [0, 0, 0]);
  await forceRollHit(page);
  const t0 = Date.now();
  await page.evaluate(() => window.__gb.setTimeLeft(0.4));
  await waitFor(async () => page.locator('#over.show').isVisible(), 15000, 'game-over panel after hung ad');
  const elapsed = Date.now() - t0;
  ok(elapsed < 13000, `panel appeared after ${elapsed} ms with a hung ad (want < 13000)`);
  await page.close();
});

// (g) Play again after a game-end ad shows no second ad.
await test('(g) no double ad across Play again', async () => {
  const { page } = await newPage();
  await installCountingProvider(page);
  await startClassic(page);
  await setupBoard(page, EMPTY, [0, 0, 0]);
  await page.evaluate(() => window.__gb.place(0, 0, 0));
  await forceRollHit(page);
  await endByTimeout(page); // game 1: guard blocks
  eq((await adCalls(page)).interstitial, 0, 'no ad after game 1');
  await page.click('#btn-again');
  await waitFor(async () => (await st(page)).running, 5000, 'game 2 running');
  await setupBoard(page, EMPTY, [0, 0, 0]);
  await endByTimeout(page); // game 2: roll forced, ad shows
  eq((await adCalls(page)).interstitial, 1, 'one ad after game 2');
  await page.click('#btn-again'); // Play again itself must not show an ad
  await waitFor(async () => (await st(page)).running, 5000, 'game 3 running');
  eq((await adCalls(page)).interstitial, 1, 'Play again shows no ad');
  await setupBoard(page, EMPTY, [0, 0, 0]);
  await endByTimeout(page); // game 3: 2-min gap blocks the next end-of-game ad
  eq((await adCalls(page)).interstitial, 1, 'no second ad at the next game end');
  await page.close();
});

// (h) an old save with revived:true loads fine.
await test('(h) old save with revived:true restores', async () => {
  const { page } = await newPage();
  await startClassic(page);
  await setupBoard(page, EMPTY, [0, 0, 0]);
  await page.evaluate(() => window.__gb.place(0, 0, 0)); // score 1, save written
  const hadSave = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('gb_save') || 'null');
    if (!d) return false;
    d.revived = true; // an old (pre-removal) save
    localStorage.setItem('gb_save', JSON.stringify(d));
    return true;
  });
  ok(hadSave, 'a save existed to tamper with');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#btn-play');
  await page.click('#btn-play'); // Continue: restores the tampered save
  await waitFor(async () => (await st(page)).running, 5000, 'restored game running');
  eq((await st(page)).score, 1, 'restored score preserved');
  await page.close();
});

const fails = results.filter(([s]) => s === 'FAIL');
console.log(`\n${results.length - fails.length}/${results.length} passed, 0 console errors expected`);
if (errors.length) console.log('PAGE/CONSOLE ERRORS:', errors.slice(0, 10));
await browser.close();
await server.close();
process.exit(fails.length || errors.length ? 1 : 0);
