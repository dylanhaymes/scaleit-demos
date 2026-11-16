// Screenshots for the friend-requests replication build: 390px Friends
// panel (incoming request + friend row + preview) and the signed-in
// title screen (sign-in chip). Run: node tests/friend-requests-shots.mjs
// Serves game-proto on its own port so it never clashes with the suite.
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
const PORT = 8904;
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
async function waitFor(fn, timeout = 8000, label = 'condition') {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - t0 > timeout) throw new Error('timeout waiting for ' + label);
    await sleep(120);
  }
}

// Minimal stubbed-Firebase installer (same shape as the suite's
// installFakeFirebaseRedirect): redirect success + a friendRequests store
// seeded with one incoming request from Pal.
function installFake() {
  const fakeUser = { uid: 'google-uid-1', displayName: 'Dylan', email: 'dylan@example.com', isAnonymous: false, providerData: [{ providerId: 'google.com' }] };
  const reqStore = window.__fakeDbStore = window.__fakeDbStore || { friendRequests: {}, reqSeq: 0 };
  if (Array.isArray(window.__fakeSeedRequests)) {
    for (const s of window.__fakeSeedRequests) reqStore.friendRequests[s.id] = { ...s };
    window.__fakeSeedRequests = [];
  }
  const fakeQuery = {
    where() { return fakeQuery; },
    orderBy() { return fakeQuery; },
    limit() { return fakeQuery; },
    get: async () => ({ empty: true, forEach() {}, docs: [] }),
  };
  const fakeDb = {
    collection(name) {
      if (name === 'friendRequests') {
        return {
          doc(id) {
            return {
              get: async () => {
                const d = reqStore.friendRequests[id];
                return d ? { exists: true, data: () => ({ ...d }) } : { exists: false, data: () => ({}) };
              },
              set: async (data, opts) => { reqStore.friendRequests[id] = opts && opts.merge ? { ...(reqStore.friendRequests[id] || {}), ...data } : { ...data }; },
              delete: async () => { delete reqStore.friendRequests[id]; },
            };
          },
          add: async (doc) => { const id = 'req-' + (++reqStore.reqSeq); reqStore.friendRequests[id] = { ...doc }; return { id }; },
          where(field, op, value) {
            const filters = [{ field, op, value }];
            const q = {
              where(f, o, v) { filters.push({ field: f, op: o, value: v }); return q; },
              orderBy() { return q; },
              limit() { return q; },
              get: async () => {
                const docs = Object.entries(reqStore.friendRequests)
                  .filter(([, d]) => filters.every(({ field, op, value }) => (op === '==' ? d[field] === value : true)))
                  .map(([id, d]) => ({ id, exists: true, data: () => ({ ...d }) }));
                return { empty: docs.length === 0, docs, forEach(fn) { docs.forEach(fn); } };
              },
            };
            return q;
          },
        };
      }
      return {
        doc() {
          return {
            get: async () => {
              if (name === 'friendCodes') return { exists: true, data: () => ({ uid: 'friend-uid-1', displayName: 'Pal' }) };
              return { exists: false, data: () => ({}) };
            },
            set: async () => ({}),
            delete: async () => ({}),
          };
        },
        where() { return fakeQuery; },
      };
    },
    batch() { return { delete() {}, commit: async () => ({}) }; },
  };
  const fakeAuth = {
    currentUser: null,
    onAuthStateChanged(cb) { window.__fakeAuthCb = cb; return () => {}; },
    getRedirectResult: async () => {
      fakeAuth.currentUser = fakeUser;
      if (window.__fakeAuthCb) setTimeout(() => window.__fakeAuthCb(fakeUser), 0);
      return { user: fakeUser, credential: null };
    },
    signInWithRedirect: async () => {},
    signInWithPopup: async () => {},
    linkWithRedirect: async () => {},
    linkWithPopup: async () => {},
    signInAnonymously: async () => {},
    signOut: async () => { fakeAuth.currentUser = null; },
    signInWithCredential: async () => ({ user: fakeUser }),
  };
  function authFn() { return fakeAuth; }
  authFn.GoogleAuthProvider = class {};
  authFn.FacebookAuthProvider = class {};
  window.firebase = { apps: [{}], initializeApp() {}, auth: authFn, firestore: () => fakeDb };
  window.__fakeAuth = fakeAuth;
}

const chromiumPath = process.env.CHROMIUM_PATH
  || ['/home/hatch/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({
  ...(chromiumPath ? { executablePath: chromiumPath } : {}),
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
});
const errors = [];
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

async function signedInPage() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, userAgent: IPHONE_UA });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.addInitScript(() => {
    localStorage.setItem('gb_tut_done', '1');
    localStorage.setItem('gb_auth_redirect', '1');
    // One friend already (shows the row + avatar), one incoming request.
    localStorage.setItem('gb_friends', JSON.stringify([{ uid: 'friend-uid-9', code: 'KLM456', displayName: 'Rex', addedAt: Date.now() - 86400000 }]));
    window.__fakeSeedRequests = [{ id: 'req-seed-1', fromUid: 'friend-uid-1', fromName: 'Pal', toUid: 'google-uid-1', toName: 'Dylan', code: 'ABC123', status: 'pending', createdAt: Date.now() - 1000, expiresAt: Date.now() + 7 * 86400000 }];
  });
  await page.addInitScript(installFake);
  await page.goto(`http://localhost:${PORT}/?test=1`);
  await page.waitForSelector('#btn-play');
  await waitFor(async () => (await page.evaluate(() => window.__gb.accounts())).signedIn === true, 8000, 'signed in');
  return { ctx, page };
}

// Shot 1: title screen, signed in — the sign-in chip.
{
  const { ctx, page } = await signedInPage();
  await sleep(400);
  await page.screenshot({ path: path.join(ROOT, 'tests/friend-requests-title-phone.png') });
  console.log('title shot saved');
  await ctx.close();
}

// Shot 2: Friends panel — incoming request row + friend row.
{
  const { ctx, page } = await signedInPage();
  await page.click('#btn-account');
  await waitFor(async () => (await page.locator('#acct-friend-requests').textContent()).includes('wants to be friends'), 5000, 'incoming request row');
  await sleep(300);
  await page.screenshot({ path: path.join(ROOT, 'tests/friend-requests-panel-phone.png') });
  console.log('panel shot saved');
  // Shot 3: preview — type a code, see the found player before sending.
  const own = await page.evaluate(() => window.__gb.accounts().friendCode);
  await page.fill('#acct-friend-code-input', own === 'ABC123' ? 'XYZ789' : 'ABC123');
  await page.click('#btn-acct-add-friend');
  await waitFor(async () => (await page.locator('#acct-friend-preview').textContent()).includes('Pal'), 5000, 'preview shows');
  await sleep(300);
  await page.screenshot({ path: path.join(ROOT, 'tests/friend-requests-preview-phone.png') });
  console.log('preview shot saved');
  await ctx.close();
}

console.log('console errors:', errors.length ? errors.join(' | ') : '0');
await browser.close();
server.close();
