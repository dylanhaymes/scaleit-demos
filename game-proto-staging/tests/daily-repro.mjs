// Daily one-and-done repro probe (Dylan, Nov 12 8:49 PM; rule clarified 8:51 PM):
// after playing the daily once, his friend was offered "Continue daily" —
// and was given the exact same game start multiple times.
//
// DESIGN VERDICTS (verified in code + Node, Nov 12):
// - The SAME START is BY DESIGN, not a bug: the daily is seeded from the
//   local date (rng.js dailyRng), so every fresh daily on the same day deals
//   the identical first tray (Node sim: 2026-11-12 run1 == run2 exactly;
//   2026-11-13 differs; classic Math.random runs differ). Replays via
//   "Play again" / the Daily button intentionally restart that same seeded
//   layout to chase the daily best. This probe asserts the replay IS
//   identical — do not "fix" it into randomness.
// - The BUG is the CONTINUE option: finishGame() cleared the save, but a
//   daily save could still exist after a finish via (a) closing the tab
//   during the revive offer — pagehide saved while awaitingRevive, (b) a
//   stale daily save from another day — refreshTitle never checked the
//   dateKey, (c) finishing, replaying ("Play again"), then quitting — the
//   replay's save was offered as "Continue daily" although the daily was
//   already finished once. FIX (js/main.js, Nov 12): saveGame() refuses to
//   persist while awaitingRevive; finishGame() marks today done
//   (gb_daily_done); resumableSave() gates Continue on (save is today's
//   daily AND today not finished) and clears stale/finished daily saves.
//
// Scenarios (all UNRUN — Chromium outage #7; run when it recovers):
//   A. Finish daily by no-moves -> no save, daily marked done, title Play
//      button says "Play" (never "Continue daily"), replay = same start.
//   B. Finish daily by timeout -> same assertions as A.
//   C. Close-during-revive-offer: saveNow() while awaitingRevive must NOT
//      overwrite the save (stored board stays the start-of-game board).
//   D. Stale cross-day daily save -> cleared on sight, title says "Play".
//   E. Finish, replay, quit mid-replay -> NO "Continue daily" (gate).
//   F. Classic: starts differ, and quitting mid-classic still offers
//      "Continue" (the fix must not break classic continue).
// Run: node tests/daily-repro.mjs   (serves game-proto itself on localhost)
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromiumPath = process.env.CHROMIUM_PATH
  || ['/home/hatch/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({
  ...(chromiumPath ? { executablePath: chromiumPath } : {}),
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
});

const results = [];
let errors = [];
async function test(name, fn) {
  try { await fn(); results.push(['PASS', name]); console.log('PASS', name); }
  catch (e) { results.push(['FAIL', name, e.message]); console.log('FAIL', name, '-', e.message); }
}
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function ok(c, msg) { if (!c) throw new Error(msg); }
async function waitFor(fn, timeout = 8000, label = 'condition') {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - t0 > timeout) throw new Error('timeout waiting for ' + label);
    await sleep(120);
  }
}

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => { errors.push('pageerror: ' + e.message); });
  await page.addInitScript(() => { localStorage.setItem('gb_tut_done', '1'); });
  await page.goto(`http://localhost:${PORT}/?test=1`);
  await page.waitForSelector('#btn-play');
  return { ctx, page };
}
const ls = (page, k) => page.evaluate((key) => localStorage.getItem(key), k);
const playLabel = (page) => page.evaluate(() => document.querySelector('#btn-play').textContent);
const newHidden = (page) => page.evaluate(() => document.querySelector('#btn-new').classList.contains('hidden'));
const trayIds = (page) => page.evaluate(() => window.__gb.state().tray.map((p) => (p ? p.id : null)));
const todayKey = (page) => page.evaluate(() => window.__gb.todayKey());

async function goHome(page) {
  await page.click('#btn-home');
  await waitFor(async () => (await playLabel(page)) !== '', 5000, 'title play label');
}

// A. Finish daily by no-moves -> no continue, daily marked done, replay identical.
await test('daily: finish by no-moves -> no Continue daily; replay same start (by design)', async () => {
  const { ctx, page } = await newPage();
  try {
    const key = await todayKey(page);
    await page.evaluate((k) => window.__gb.startDaily(k), key);
    await waitFor(async () => (await page.evaluate(() => window.__gb.state().running)), 5000, 'daily running');
    const firstTray = await trayIds(page);
    await page.evaluate(() => { window.__gb.setCharges({}); window.__gb.setBoard(Array(8).fill('########')); window.__gb.checkGameOver(); });
    await waitFor(async () => page.evaluate(() => document.querySelector('#over').classList.contains('show')), 8000, 'game-over panel');
    eq(await ls(page, 'gb_save'), null, 'save cleared on daily finish');
    eq(await ls(page, 'gb_daily_done'), key, 'daily marked done');
    await goHome(page);
    eq(await playLabel(page), 'Play', 'title Play button after finished daily');
    ok(await newHidden(page), 'New game button hidden when no save');
    await page.evaluate((k) => window.__gb.startDaily(k), key);
    await waitFor(async () => (await page.evaluate(() => window.__gb.state().running)), 5000, 'daily replay running');
    eq(JSON.stringify(await trayIds(page)), JSON.stringify(firstTray), 'replay deals the identical seeded first tray');
  } finally { await ctx.close(); }
});

// B. Finish daily by timeout -> same assertions as A.
await test('daily: finish by timeout -> no Continue daily', async () => {
  const { ctx, page } = await newPage();
  try {
    const key = await todayKey(page);
    await page.evaluate((k) => window.__gb.startDaily(k), key);
    await waitFor(async () => (await page.evaluate(() => window.__gb.state().running)), 5000, 'daily running');
    await page.evaluate(() => window.__gb.setTimeLeft(0.5));
    await waitFor(async () => page.evaluate(() => document.querySelector('#over').classList.contains('show')), 8000, 'game-over panel');
    eq(await ls(page, 'gb_save'), null, 'save cleared on daily timeout');
    eq(await ls(page, 'gb_daily_done'), key, 'daily marked done');
    await goHome(page);
    eq(await playLabel(page), 'Play', 'title Play button after timed-out daily');
  } finally { await ctx.close(); }
});

// C. saveNow() while awaitingRevive must NOT persist the dead board.
await test('daily: close during revive offer writes no save', async () => {
  const { ctx, page } = await newPage();
  try {
    const key = await todayKey(page);
    await page.evaluate((k) => window.__gb.startDaily(k), key);
    await waitFor(async () => (await page.evaluate(() => window.__gb.state().running)), 5000, 'daily running');
    // End the game (no moves), then save in the same tick — while the revive
    // offer is pending (awaitingRevive) — exactly what pagehide does when
    // the tab is closed on the offer. The stored save must still be the
    // start-of-game save (empty board), never the dead full board.
    const stored = await page.evaluate(() => {
      window.__gb.setCharges({});
      window.__gb.setBoard(Array(8).fill('########'));
      window.__gb.checkGameOver();
      window.__gb.saveNow();
      return JSON.parse(localStorage.getItem('gb_save') || 'null');
    });
    ok(stored, 'start-of-game save still present');
    const filled = stored.board.flat().filter(Boolean).length;
    eq(filled, 0, 'saveNow during awaitingRevive must not store the dead board');
    await waitFor(async () => page.evaluate(() => document.querySelector('#over').classList.contains('show')), 8000, 'game-over panel');
    eq(await ls(page, 'gb_save'), null, 'save cleared once the game finishes');
    eq(await ls(page, 'gb_daily_done'), key, 'daily marked done');
  } finally { await ctx.close(); }
});

// D. Stale cross-day daily save is cleared on sight, never offered.
await test('daily: stale cross-day save cleared, never offered as Continue', async () => {
  const { ctx, page } = await newPage();
  try {
    const key = await todayKey(page);
    const yest = await page.evaluate(() => {
      const d = new Date(Date.now() - 864e5);
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    });
    ok(yest !== key, 'yesterday differs from today');
    await page.evaluate((k) => {
      const save = { v: 2, mode: 'daily', dateKey: k, rngState: null, board: Array.from({ length: 8 }, () => Array(8).fill(null)), tray: [null, null, null], score: 50, combo: 0, sinceClear: 0, maxCombo: 0, lines: 0, placed: 3, revived: false, helperAvailable: false, startBest: 0, elapsed: 1000, savedAt: Date.now(), timeLeft: 100, charges: {}, earnIdx: 0, variant: 'relaxed' };
      localStorage.setItem('gb_save', JSON.stringify(save));
    }, yest);
    await page.evaluate(() => window.__gb.refreshTitle());
    eq(await ls(page, 'gb_save'), null, 'stale daily save cleared by refreshTitle');
    eq(await playLabel(page), 'Play', 'title Play button with stale daily save');
  } finally { await ctx.close(); }
});

// E. Finish, replay, quit mid-replay -> NO "Continue daily".
await test('daily: finish + replay + quit -> no Continue daily (one-and-done gate)', async () => {
  const { ctx, page } = await newPage();
  try {
    const key = await todayKey(page);
    await page.evaluate((k) => window.__gb.startDaily(k), key);
    await waitFor(async () => (await page.evaluate(() => window.__gb.state().running)), 5000, 'daily running');
    const firstTray = await trayIds(page);
    await page.evaluate(() => { window.__gb.setCharges({}); window.__gb.setBoard(Array(8).fill('########')); window.__gb.checkGameOver(); });
    await waitFor(async () => page.evaluate(() => document.querySelector('#over').classList.contains('show')), 8000, 'game-over panel');
    eq(await ls(page, 'gb_daily_done'), key, 'daily marked done after finish');
    // Replay the same seeded daily, then quit to the menu mid-replay.
    await page.evaluate((k) => window.__gb.startDaily(k), key);
    await waitFor(async () => (await page.evaluate(() => window.__gb.state().running)), 5000, 'daily replay running');
    eq(JSON.stringify(await trayIds(page)), JSON.stringify(firstTray), 'replay first tray identical');
    await page.click('#btn-menu');
    await waitFor(async () => page.evaluate(() => document.querySelector('#menu').classList.contains('show')), 5000, 'pause menu');
    await page.click('#btn-menu-home');
    await waitFor(async () => (await playLabel(page)) !== '', 5000, 'title play label');
    eq(await playLabel(page), 'Play', 'no Continue daily after quitting a replay of a finished daily');
    eq(await ls(page, 'gb_save'), null, 'replay save cleared by the gate');
  } finally { await ctx.close(); }
});

// F. Classic: starts differ, and classic continue still works.
await test('classic: starts differ; quit mid-classic still offers Continue', async () => {
  const { ctx, page } = await newPage();
  try {
    const trays = [];
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.__gb.startGame('classic'));
      await waitFor(async () => (await page.evaluate(() => window.__gb.state().running)), 5000, 'classic running');
      trays.push(JSON.stringify(await trayIds(page)));
    }
    ok(!(trays[0] === trays[1] && trays[1] === trays[2]), 'classic first trays differ across starts: ' + trays.join(' / '));
    await page.click('#btn-menu');
    await waitFor(async () => page.evaluate(() => document.querySelector('#menu').classList.contains('show')), 5000, 'pause menu');
    await page.click('#btn-menu-home');
    await waitFor(async () => (await playLabel(page)) !== '', 5000, 'title play label');
    eq(await playLabel(page), '▶ Continue', 'classic mid-game quit still offers Continue');
    ok(!(await newHidden(page)), 'New game button visible when a classic save exists');
  } finally { await ctx.close(); }
});

console.log(`\n${results.filter((r) => r[0] === 'PASS').length}/${results.length} passed`);
if (errors.length) console.log('console/page errors:', JSON.stringify(errors.slice(0, 5)));
const failed = results.filter((r) => r[0] === 'FAIL');
await browser.close();
await new Promise((r) => server.close(r));
process.exit(failed.length ? 1 : 0);
