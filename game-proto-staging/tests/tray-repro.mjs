// Tray-bug reproduction probe (Dylan, Nov 12 8:37 PM):
// cleared tray (star skin) -> 3 new pieces all greyed -> board + tray empty.
// Plays random fitting moves with the Gold Star Stickers skin equipped and
// asserts after every placement:
//   (a) no pageerror / console error (a throw in draw() kills the rAF loop
//       after clearRect -> blank canvas, frozen timer, no overlays),
//   (b) a re-deal after an emptied tray has >= 1 fitting piece (fair deal),
//   (c) pieces present in STATE are actually painted on #cv (board zone +
//       per-slot tray centres), (d) the rAF loop is alive (timer ticks),
//   (e) no soft-lock: running + tray non-empty + no fitting piece + no
//       overlay + autoSaving stuck.
// Run: node tests/tray-repro.mjs
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromiumPath = process.env.CHROMIUM_PATH
  || ['/home/hatch/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({
  ...(chromiumPath ? { executablePath: chromiumPath } : {}),
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
});

const errors = [];
let bug = null;
function fail(kind, detail, page) {
  if (bug) return;
  bug = { kind, detail };
  console.log('BUG FOUND:', kind, JSON.stringify(detail).slice(0, 2000));
}

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => { errors.push('pageerror: ' + e.message); if (!bug) fail('pageerror', { message: e.message }, page); });
  await page.addInitScript(() => { localStorage.setItem('gb_tut_done', '1'); localStorage.setItem('gb_xp', '300'); });
  await page.goto(`http://localhost:${PORT}/?test=1`);
  await page.waitForSelector('#btn-play');
  return { ctx, page };
}
async function waitFor(fn, timeout = 8000, label = 'condition') {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - t0 > timeout) throw new Error('timeout waiting for ' + label);
    await sleep(120);
  }
}
async function startGame(page) {
  await page.evaluate(() => window.__gb.startGame('classic'));
  await waitFor(async () => (await page.evaluate(() => window.__gb.state().running)), 5000, 'game running');
}
const st = (page) => page.evaluate(() => window.__gb.state());
const L = (page) => page.evaluate(() => window.__gb.layout());

// Pixels with alpha > 10 in a rect of #cv (the moving layer: blocks + tray).
// Coordinates are CSS px; the canvas is DPR-scaled.
async function pxCount(page, x, y, w, h) {
  return page.evaluate(({ x, y, w, h }) => {
    const cv = document.querySelector('#cv');
    const dpr = window.devicePixelRatio || 1;
    const g = cv.getContext('2d');
    const d = g.getImageData(Math.round(x * dpr), Math.round(y * dpr), Math.max(1, Math.round(w * dpr)), Math.max(1, Math.round(h * dpr))).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 10) n++;
    return n;
  }, { x, y, w, h });
}
async function overlays(page) {
  return page.evaluate(() => ({
    revive: !!document.querySelector('#revive.show'),
    over: !!document.querySelector('#over.show'),
  }));
}

async function playScenario(name, { equipAtStart, equipAfterMoves }) {
  console.log(`--- scenario: ${name} ---`);
  const { ctx, page } = await newPage();
  await startGame(page);
  if (equipAtStart) {
    const ok = await page.evaluate(() => window.__gb.applyPack('gold-star'));
    console.log('applyPack gold-star at start:', ok);
    if (!ok) { fail('setup', { msg: 'gold-star refused at level 3' }); await ctx.close(); return; }
  }
  let moves = 0, deals = 0, games = 1, noFitDeals = 0;
  const t0 = Date.now();
  let equippedMid = false;
  while (moves < 400 && Date.now() - t0 < 8 * 60 * 1000) {
    if (bug) break;
    let s = await st(page);
    if (!s.running) {
      const ov = await overlays(page);
      console.log(`game ${games} ended cleanly (score ${s.score}, placed ${s.placed}, overlays revive=${ov.revive} over=${ov.over})`);
      games++;
      await page.reload();
      await page.waitForSelector('#btn-play');
      await startGame(page);
      if (equipAtStart) await page.evaluate(() => window.__gb.applyPack('gold-star'));
      s = await st(page);
    }
    if (equipAfterMoves && !equippedMid && moves >= equipAfterMoves) {
      const ok = await page.evaluate(() => window.__gb.applyPack('gold-star'));
      console.log(`applyPack gold-star mid-game after ${moves} moves:`, ok);
      equippedMid = true;
      await sleep(500);
    }
    await page.evaluate(() => window.__gb.setTimeLeft(120));
    s = await st(page);
    const board = s.board.map((r) => r.map(Boolean));
    const tray = s.tray.map((p) => (p ? { id: p.id, cells: p.cells, w: p.w, h: p.h } : null));
    const options = await page.evaluate(async ({ board, tray }) => {
      const d = await import('/js/difficulty.js');
      const out = [];
      tray.forEach((p, slot) => {
        if (!p) return;
        for (let r = 0; r <= 8 - p.h; r++) for (let c = 0; c <= 8 - p.w; c++) {
          if (d.fits(board, { cells: p.cells, w: p.w, h: p.h }, r, c)) out.push([slot, r, c]);
        }
      });
      return out;
    }, { board, tray });
    if (!options.length) {
      // No moves: auto-save (if a charge is held) or game over must resolve it.
      await sleep(1500);
      const s2 = await st(page);
      const ov = await overlays(page);
      if (s2.running && s2.tray.some(Boolean) && !ov.revive && !ov.over) {
        fail('soft-lock', { moves, score: s2.score, placed: s2.placed, tray: s2.tray, charges: s2.charges, autoSaving: s2.autoSaving, timeLeft: s2.timeLeft });
        await page.screenshot({ path: `tests/tray-repro-softlock-${name}.png` });
        break;
      }
      if (s2.autoSaving) {
        await sleep(2000);
        const s3 = await st(page);
        if (s3.autoSaving) { fail('autosave-stuck', { moves, score: s3.score }); await page.screenshot({ path: `tests/tray-repro-autosave-${name}.png` }); break; }
      }
      continue;
    }
    const [slot, r, c] = options[Math.floor(Math.random() * options.length)];
    const beforeIds = s.tray.map((p) => (p ? p.id : null));
    const wasLastPiece = beforeIds.filter((id) => id !== null).length === 1;
    const tBefore = s.timeLeft;
    await page.evaluate(({ slot, r, c }) => window.__gb.place(slot, r, c), { slot, r, c });
    await sleep(900); // fade (0.25s) + clear anim (<=0.74s) settled
    moves++;
    const after = await st(page);
    if (errors.length) { fail('pageerror-during-play', { moves, errors: errors.slice(-3) }); break; }
    // (b) fair-deal check on a re-deal after an emptied tray.
    if (wasLastPiece) {
      deals++;
      const afterIds = after.tray.map((p) => (p ? p.id : null));
      if (!afterIds.every((id) => id !== null)) {
        fail('redeal-incomplete', { moves, beforeIds, afterIds, running: after.running });
        await page.screenshot({ path: `tests/tray-repro-redeal-${name}.png` });
        break;
      }
      const b2 = after.board.map((rr) => rr.map(Boolean));
      const t2 = after.tray.map((p) => (p ? { id: p.id, cells: p.cells, w: p.w, h: p.h } : null));
      const fitsOne = await page.evaluate(async ({ board, tray }) => {
        const d = await import('/js/difficulty.js');
        return tray.some((p) => p && d.fitsAnywhere(board, { cells: p.cells, w: p.w, h: p.h }));
      }, { board: b2, tray: t2 });
      if (!fitsOne && after.running) {
        noFitDeals++;
        console.log(`iter ${moves}: re-deal with NO fitting piece (score ${after.score}, placed ${after.placed}) — waiting to see if the game resolves it`);
        await sleep(2000);
        const s2 = await st(page);
        const ov = await overlays(page);
        if (s2.running && !ov.revive && !ov.over) {
          fail('nofit-no-resolution', { moves, score: s2.score, placed: s2.placed, tray: s2.tray, charges: s2.charges, autoSaving: s2.autoSaving });
          await page.screenshot({ path: `tests/tray-repro-nofit-${name}.png` });
          break;
        }
      }
    }
    // (c) rendering: state says blocks/pieces exist -> #cv must show pixels.
    const lay = await L(page);
    const occupied = [];
    after.board.forEach((row, rr) => row.forEach((v, cc) => { if (v) occupied.push([rr, cc]); }));
    if (occupied.length) {
      const n = await pxCount(page, lay.bx, lay.by, lay.size, lay.size);
      if (n < 200) {
        fail('board-not-painted', { moves, score: after.score, placed: after.placed, occupiedCells: occupied.length, px: n, running: after.running });
        await page.screenshot({ path: `tests/tray-repro-boardblank-${name}.png` });
        break;
      }
    }
    for (let i = 0; i < 3; i++) {
      const p = after.tray[i];
      if (!p) continue;
      // Sample the WHOLE slot, not just its centre: L-shaped pieces (e.g.
      // id 30, cells top row + left column only) have an empty centre cell,
      // so a 16x16 centre sample reads 0 px even though the piece is fully
      // painted (verified against the failure screenshot: all 3 pieces
      // render). The slot rect on #cv holds only that piece's pixels.
      const n = await pxCount(page, lay.trayX + lay.slotW * i, lay.trayY, lay.slotW, lay.trayH);
      if (n < 20) {
        fail('tray-piece-not-painted', { moves, slot: i, piece: p, px: n, running: after.running, autoSaving: after.autoSaving });
        await page.screenshot({ path: `tests/tray-repro-trayblank-${name}.png` });
        break;
      }
    }
    if (bug) break;
    // (d) loop alive: timer must tick while running and unpaused.
    const s2 = await st(page);
    if (s2.running && !s2.timerPaused && moves % 10 === 0) {
      const a = s2.timeLeft;
      await sleep(600);
      const b = (await st(page)).timeLeft;
      if (b >= a) {
        fail('loop-frozen', { moves, timeBefore: a, timeAfter: b, running: s2.running });
        await page.screenshot({ path: `tests/tray-repro-frozen-${name}.png` });
        break;
      }
    }
    if (moves % 50 === 0) console.log(`  ${name}: ${moves} moves, ${deals} re-deals, score ${after.score}, placed ${after.placed}`);
  }
  console.log(`--- ${name}: done, moves=${moves} deals=${deals} games=${games} noFitDeals=${noFitDeals} errors=${errors.length} ---`);
  await ctx.close();
}

await playScenario('star-from-start', { equipAtStart: true });
if (!bug) await playScenario('star-mid-game', { equipAtStart: false, equipAfterMoves: 30 });
if (!bug) await playScenario('classic-control', { equipAtStart: false });

console.log(bug ? `RESULT: BUG REPRODUCED (${bug.kind})` : 'RESULT: no bug reproduced in any scenario');
console.log('page errors:', JSON.stringify(errors.slice(0, 5)));
await browser.close();
await new Promise((r) => server.close(r));
process.exit(bug ? 1 : 0);
