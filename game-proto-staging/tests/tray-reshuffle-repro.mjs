// Focused probe for the suite-5381c72 tray failure:
// "iter 7: placed slot emptied: got 33, want null".
// Mirrors the suite test's loop but records the reshuffle charge before/after
// each placement. Hypothesis (test bug, not game bug): after the placement the
// remaining pieces had no fit, so checkGameOver -> tryAutoSaveNoFit spent the
// armed reshuffle charge and re-dealt the whole tray (presentSave 600ms < the
// test's 900ms sleep), so the placed slot legitimately holds a fresh piece.
// Proven if: placed slot non-null AND reshuffle charge dropped by 1 AND
// unplaced slots changed ids in the same iteration.
// Run: node tests/tray-reshuffle-repro.mjs
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
const PORT = 8924;
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
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.addInitScript(() => { localStorage.setItem('gb_tut_done', '1'); localStorage.setItem('gb_xp', '300'); });
await page.goto(`http://localhost:${PORT}/?test=1`);
await page.waitForSelector('#btn-play');
const st = () => page.evaluate(() => window.__gb.state());
const waitFor = async (fn, timeout = 8000, label = 'cond') => {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - t0 > timeout) throw new Error('timeout: ' + label);
    await sleep(120);
  }
};
await page.evaluate(() => window.__gb.startGame('classic'));
await waitFor(async () => (await st()).running, 5000, 'game running');

let moves = 0, reshuffleInterventions = 0, caught = null;
const ITERS = 60;
for (let i = 0; i < ITERS; i++) {
  let s = await st();
  if (!s.running) { await page.reload(); await page.waitForSelector('#btn-play'); await page.evaluate(() => window.__gb.startGame('classic')); await waitFor(async () => (await st()).running, 5000, 'game running'); s = await st(); }
  if (!s.charges.reshuffle) await page.evaluate(() => window.__gb.setCharges({ reshuffle: 1 }));
  await page.evaluate(() => window.__gb.setTimeLeft(120));
  s = await st();
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
  if (!options.length) { await sleep(1200); continue; }
  const [slot, r, c] = options[Math.floor(Math.random() * options.length)];
  const beforeIds = s.tray.map((p) => (p ? p.id : null));
  const beforeCharges = { ...s.charges };
  const wasLastPiece = beforeIds.filter((id) => id !== null).length === 1;
  await page.evaluate(({ slot, r, c }) => window.__gb.place(slot, r, c), { slot, r, c });
  await sleep(900);
  const after = await st();
  moves++;
  const afterIds = after.tray.map((p) => (p ? p.id : null));
  const reshuffleSpent = beforeCharges.reshuffle - after.charges.reshuffle;
  if (reshuffleSpent > 0) reshuffleInterventions++;
  if (!wasLastPiece && afterIds[slot] !== null) {
    // The suite test's failure condition.
    const unplacedChanged = [0, 1, 2].filter((k) => k !== slot && beforeIds[k] !== null && afterIds[k] !== beforeIds[k]);
    caught = { iter: i, slot, beforeIds, afterIds, beforeCharges, afterCharges: { ...after.charges }, reshuffleSpent, unplacedChanged, autoSaving: after.autoSaving };
    console.log('CAUGHT:', JSON.stringify(caught));
    break;
  }
}
console.log(`moves=${moves} reshuffleInterventions=${reshuffleInterventions} errors=${errors.length}`);
console.log(caught
  ? (caught.reshuffleSpent === 1 && caught.unplacedChanged.length > 0
    ? 'VERDICT: reshuffle re-deal PROVEN — placed slot refilled by the designed auto-save, test assertion is wrong (test bug)'
    : 'VERDICT: placed slot refilled WITHOUT a reshuffle — needs game-code investigation')
  : 'VERDICT: failure condition did not reproduce in 60 iterations');
await browser.close();
await new Promise((r) => server.close(r));
process.exit(0);
